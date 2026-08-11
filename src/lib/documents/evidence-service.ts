/**
 * Shared attachment/evidence service (task T22,
 * Docs/PHASE2_EMS_FOUNDATION_SPEC.md §3 "Controlled documents and
 * evidence"). The T22 generalisation of `src/lib/lca/evidence-service.ts`:
 * one `EvidenceObject` table for metadata/checksum/classification/retention,
 * bytes behind the shared storage provider (`storage/provider.ts`), and a
 * generic `EvidenceLink` for attaching an evidence object to an allow-listed
 * resource type — currently only controlled document revisions (T22 scope).
 *
 * `readEvidenceBytes` is the single choke point every download route must
 * go through: it re-checks organisation ownership and the caller's
 * classification clearance before ever asking the storage provider for
 * bytes, so a denial reveals nothing about whether the id exists
 * (Phase 2 spec §6: "Document download denial reveals no filename, MIME,
 * size, checksum or existence.").
 */

import { createHash } from "node:crypto";
import type { EvidenceClassification, RetentionCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import {
  findTenantEvidenceObject,
  toTenantRepositoryContext,
  tenantWhere,
} from "@/lib/repositories/documents-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { documentEvidenceStorage } from "@/lib/documents/storage/provider";
import { scanEvidence } from "@/lib/documents/malware-scan";

export { TenantOwnershipError };

/** Guard against a single upload filling the database — same limit as the LCA module's evidence uploads. */
export const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;

export const ALLOWED_EVIDENCE_MIME_PREFIXES = [
  "application/pdf",
  "image/",
  "text/",
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-excel",
  "application/msword",
  "application/json",
  "application/xml",
  "application/zip",
  "application/octet-stream",
];

/**
 * Every resource type an EvidenceLink may target. T22 only wires up
 * controlled document revisions; later phases extend this array, never the
 * schema (Phase 2 spec §3: "no generic polymorphic link may skip target
 * validation").
 */
export const EVIDENCE_LINK_RESOURCE_TYPES = [
  "controlled_document_revision",
  // EMS programme foundation (task T23): "source/evidence" on an interested
  // party requirement, and supporting evidence for a risk/opportunity or
  // change assessment entry.
  "interested_party_requirement",
  "ems_risk_opportunity",
  "change_assessment",
] as const;
export type EvidenceLinkResourceType = (typeof EVIDENCE_LINK_RESOURCE_TYPES)[number];

export function isKnownEvidenceLinkResourceType(value: string): value is EvidenceLinkResourceType {
  return (EVIDENCE_LINK_RESOURCE_TYPES as readonly string[]).includes(value);
}

export class EvidenceError extends Error {}

export interface UploadEvidenceObjectInput {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  classification?: EvidenceClassification;
  retentionCategory?: RetentionCategory;
  retentionUntil?: Date | null;
  uploadedByUserId: string;
}

function assertValidFile(input: Pick<UploadEvidenceObjectInput, "mimeType" | "bytes">): void {
  if (input.bytes.byteLength === 0) {
    throw new EvidenceError("The uploaded file is empty.");
  }
  if (input.bytes.byteLength > MAX_EVIDENCE_BYTES) {
    throw new EvidenceError(
      `The file is ${(input.bytes.byteLength / (1024 * 1024)).toFixed(1)} MB. The limit is ${MAX_EVIDENCE_BYTES / (1024 * 1024)} MB.`,
    );
  }
  const allowed = ALLOWED_EVIDENCE_MIME_PREFIXES.some((prefix) => input.mimeType.startsWith(prefix));
  if (!allowed) {
    throw new EvidenceError(`Files of type "${input.mimeType}" are not accepted as evidence.`);
  }
}

/**
 * Stores a new evidence object: validates the file, creates the metadata
 * row, writes bytes through the active storage provider, and always runs
 * the malware-scanning interface before the object is considered usable.
 */
export async function uploadEvidenceObject(context: OrganisationContext, input: UploadEvidenceObjectInput) {
  assertValidFile(input);

  const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex");

  const evidence = await prisma.evidenceObject.create({
    data: {
      organisationId: context.organisationId,
      filename: input.fileName,
      mimeType: input.mimeType,
      byteSize: input.bytes.byteLength,
      checksumSha256,
      classification: input.classification ?? "INTERNAL",
      retentionCategory: input.retentionCategory ?? "STANDARD",
      retentionUntil: input.retentionUntil ?? null,
      uploadedByUserId: input.uploadedByUserId,
      malwareScanStatus: "PENDING",
    },
  });

  const provider = documentEvidenceStorage.active();
  const stored = await provider.put({
    evidenceId: evidence.id,
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
  });

  const scan = await scanEvidence({
    evidenceId: evidence.id,
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
  });

  return prisma.evidenceObject.update({
    where: { id: evidence.id },
    data: {
      storageProvider: stored.storageProvider,
      storageKey: stored.storageKey,
      malwareScanStatus: scan.status,
      malwareScannedAt: new Date(),
      malwareScanner: scan.scannerName,
    },
  });
}

/**
 * Attaches an evidence object to an allow-listed resource. The caller is
 * responsible for having already proven `resourceId` belongs to the same
 * Organisation before calling this — the resource-type allow list check
 * here is necessary but not sufficient on its own.
 */
export async function linkEvidence(
  context: OrganisationContext,
  input: { evidenceId: string; resourceType: EvidenceLinkResourceType; resourceId: string; purpose?: string | null; linkedByUserId: string },
) {
  if (!isKnownEvidenceLinkResourceType(input.resourceType)) {
    throw new EvidenceError(`Evidence cannot be linked to resource type "${input.resourceType}".`);
  }
  const ctx = toTenantRepositoryContext(context);
  await findTenantEvidenceObject(ctx, input.evidenceId);

  return prisma.evidenceLink.create({
    data: {
      evidenceId: input.evidenceId,
      organisationId: context.organisationId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      purpose: input.purpose ?? null,
      linkedByUserId: input.linkedByUserId,
    },
  });
}

/** Organisation-scoped read — a foreign-tenant id is denied identically to a missing one. */
export async function getEvidenceObject(context: OrganisationContext, evidenceId: string) {
  const ctx = toTenantRepositoryContext(context);
  return findTenantEvidenceObject(ctx, evidenceId);
}

export async function listEvidenceForResource(
  ctx: TenantRepositoryContext,
  resourceType: EvidenceLinkResourceType,
  resourceId: string,
) {
  const links = await prisma.evidenceLink.findMany({
    where: tenantWhere(ctx, { resourceType, resourceId }),
    include: { evidence: true },
    orderBy: { linkedAt: "desc" },
  });
  return links.map((link) => link.evidence);
}

/**
 * The classification levels a caller may read, ordered least to most
 * sensitive. `hasClassificationClearance` follows PUBLIC < INTERNAL <
 * CONFIDENTIAL < RESTRICTED, gated by permission — RESTRICTED requires the
 * controlled-document manage permission even for an organisation member,
 * matching the "classification-aware" download requirement in the T22
 * acceptance criteria.
 */
const CLASSIFICATION_RANK: Record<EvidenceClassification, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  RESTRICTED: 3,
};

export function hasClassificationClearance(
  context: OrganisationContext,
  classification: EvidenceClassification,
): boolean {
  if (CLASSIFICATION_RANK[classification] <= CLASSIFICATION_RANK.INTERNAL) return true;
  return context.permissions.has("ems.controlled_document.manage") || context.permissions.has("ems.controlled_document.approve");
}

/**
 * Loads evidence bytes for download, or null on any failure — missing id,
 * foreign tenant, or insufficient classification clearance are all
 * indistinguishable to the caller, per the non-disclosing-error acceptance
 * criterion.
 */
export async function readEvidenceObjectBytes(
  context: OrganisationContext,
  evidenceId: string,
): Promise<{ bytes: Buffer; evidence: NonNullable<Awaited<ReturnType<typeof getEvidenceObject>>> } | null> {
  let evidence;
  try {
    evidence = await getEvidenceObject(context, evidenceId);
  } catch {
    return null;
  }
  if (!evidence || !evidence.storageKey) return null;
  if (!hasClassificationClearance(context, evidence.classification)) return null;
  if (evidence.malwareScanStatus === "INFECTED") return null;

  const provider = documentEvidenceStorage.forKey(evidence.storageProvider) ?? documentEvidenceStorage.active();
  const bytes = await provider.get(evidence.storageKey);
  if (!bytes) return null;
  return { bytes, evidence };
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

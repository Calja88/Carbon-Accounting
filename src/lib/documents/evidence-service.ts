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
  findTenantEvidenceLink,
  toTenantRepositoryContext,
  tenantWhere,
} from "@/lib/repositories/documents-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { documentEvidenceStorage } from "@/lib/documents/storage/provider";
import { scanEvidence } from "@/lib/documents/malware-scan";
import { requirePermission } from "@/lib/rbac/authorize";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { isUnderLegalHold } from "@/lib/retention/legal-hold-service";

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
  // Aspect/impact register (task T31): callers must resolve the aspect with
  // findTenantEnvironmentalAspect before invoking linkEvidence.
  "environmental_aspect",
  // Operational-control review evidence (task T33). Callers resolve the
  // check in the tenant repository before linking.
  "control_check",
  // Environmental monitoring and calibration evidence (task T34). Callers
  // resolve each target through its tenant-scoped domain service first.
  "monitoring_result",
  "equipment_calibration",
  // External providers, communications and emergency preparedness (task
  // T35). Callers resolve each record in the tenant repository before
  // linking.
  "external_provider_evaluation",
  "communication_record",
  "emergency_exercise",
  // Applicability workflow (task T43). Callers resolve the assessment in
  // the tenant repository before linking.
  "applicability_assessment",
  // Compliance evaluation (task T45). Callers resolve the item in the
  // tenant repository before linking.
  "compliance_evaluation_item",
  // Other requirements and manual legal sources (task T46). Callers
  // resolve the source in the tenant repository before linking.
  "other_requirement_source",
  // Action programmes and reminders (task T52). Callers resolve the action
  // item in the tenant repository before linking — used for completion
  // evidence.
  "action_item",
  // Audit programme and audit execution (task T60). Callers resolve the
  // audit/team member in the tenant repository before linking — used for
  // criteria references and auditor competence/independence evidence.
  "ems_audit",
  "audit_team_member",
  // Checklists, evidence, findings and frozen report (task T61). Callers
  // resolve the response/finding in the tenant repository before linking —
  // objective evidence gathered while answering a checklist item, and
  // supporting evidence for a finding.
  "audit_question_response",
  "audit_finding",
  // Environmental incident intake (task T62). Callers resolve the incident
  // in the tenant repository, and re-check restricted-incident clearance,
  // before invoking linkEvidence.
  "environmental_incident",
  // Nonconformity workflow (task T63). Callers resolve the nonconformity/
  // containment record in the tenant repository before linking.
  "nonconformity",
  "containment_record",
  // Root cause, corrective action and effectiveness (task T64). Callers
  // resolve the corrective action in the tenant repository before linking.
  "corrective_action",
  // Training, evidence, assessment and expiry (task T71). Callers resolve
  // the CompetenceEvidence row in the tenant repository before linking —
  // the underlying training/qualification/licence file.
  "competence_evidence",
  // Licensed standard and competent review checklist (task T84). Callers
  // resolve the StandardRequirementMap row in the tenant repository before
  // linking — evidence supporting an implemented control against a
  // requirement key.
  "standard_requirement_map",
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

/**
 * Organisation-scoped evidence hub listing (task UI03). Filename search is
 * an optional `contains` filter — this never returns another organisation's
 * rows, matching every other tenant-scoped list in this module.
 */
export async function listEvidenceObjects(
  context: OrganisationContext,
  options?: { search?: string },
) {
  const ctx = toTenantRepositoryContext(context);
  const search = options?.search?.trim();
  return prisma.evidenceObject.findMany({
    where: tenantWhere(ctx, search ? { filename: { contains: search, mode: "insensitive" as const } } : {}),
    include: { _count: { select: { links: true } } },
    orderBy: { uploadedAt: "desc" },
  });
}

/** Every EvidenceLink pointing at one evidence object, tenant-scoped — shows the hub which resource(s) an object is attached to. */
export async function listLinksForEvidenceObject(context: OrganisationContext, evidenceId: string) {
  const ctx = toTenantRepositoryContext(context);
  await findTenantEvidenceObject(ctx, evidenceId);
  return prisma.evidenceLink.findMany({
    where: tenantWhere(ctx, { evidenceId }),
    orderBy: { linkedAt: "desc" },
  });
}

/**
 * The name of the storage provider currently serving new evidence uploads
 * (e.g. `"database"`). A future SharePoint provider (SP01+) registers under
 * its own name and this same call surfaces it — the evidence hub's provider
 * badge reads this rather than hardcoding "database", so no page rewrite is
 * needed once SharePoint is wired up.
 */
export function activeEvidenceStorageProviderName(): string {
  return documentEvidenceStorage.active().name;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Safe removal — the evidence hub's "no removal action at all" gap.
// `EvidenceObject` metadata/checksum rows are never physically deleted
// wholesale by this module: `unlinkEvidence` only removes the application
// link, and `discardUnlinkedEvidenceObject` is limited to an upload that
// was never linked to anything. Neither ever calls the storage provider's
// delete path in a way that removes real SharePoint bytes — the SharePoint
// provider's `remove()` only unpins the app-side reference
// (`storage/sharepoint-provider.ts`), matching "do not physically delete
// SharePoint content".
// ---------------------------------------------------------------------------

export class EvidenceLifecycleError extends Error {}

/**
 * Removes one `EvidenceLink` — the application's pointer from a resource to
 * an evidence object — without touching the `EvidenceObject` itself. Use
 * this to correct a mistaken attachment; the evidence upload, its checksum,
 * and any other link it still has remain intact.
 */
export async function unlinkEvidence(context: OrganisationContext, linkId: string, actorUserId: string) {
  requirePermission(context, "ems.evidence.manage");
  const ctx = toTenantRepositoryContext(context);
  const link = await findTenantEvidenceLink(ctx, linkId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.evidenceLink.delete({ where: { id: link.id, organisationId: txCtx.organisationId } });
    await recordAuditEvent(tx, txCtx, {
      eventType: "evidence_link.unlinked",
      resourceType: "evidence_link",
      resourceId: link.id,
      summary: `Evidence link to ${link.resourceType} removed.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { resourceType: link.resourceType, resourceId: link.resourceId },
    });
    return { id: link.id };
  });
}

/**
 * Discards an evidence upload that was never linked to anything — the
 * accidental/duplicate-upload case. Blocked once any `EvidenceLink` exists,
 * once it is a controlled-document revision's content, once it is under
 * legal hold, or once it has already been retention-tombstoned. This is a
 * distinct, immediate eligibility path from the scheduled
 * `previewRetention`/`executeRetention` flow (`src/lib/retention/
 * retention-service.ts`) — that flow governs *linked, retention-scheduled*
 * evidence; this one is for evidence with no governance history at all yet.
 * Only the `EvidenceObjectBlob`/storage bytes are removed (via the same
 * provider `remove()` the retention tombstone uses, which never deletes
 * real SharePoint content) — the metadata row, including its checksum, is
 * kept, so an audit event recorded at upload time keeps resolving.
 */
export async function discardUnlinkedEvidenceObject(context: OrganisationContext, evidenceId: string, actorUserId: string) {
  requirePermission(context, "ems.evidence.manage");
  const ctx = toTenantRepositoryContext(context);
  const evidence = await findTenantEvidenceObject(ctx, evidenceId);

  if (evidence.retentionTombstonedAt) {
    throw new EvidenceLifecycleError("This evidence has already been discarded.");
  }
  if (evidence.legalHold || (await isUnderLegalHold(ctx, "evidence_object", evidence.id))) {
    throw new EvidenceLifecycleError("This evidence is under legal hold and cannot be discarded.");
  }
  const [linkCount, revision] = await Promise.all([
    prisma.evidenceLink.count({ where: { evidenceId: evidence.id } }),
    prisma.controlledDocumentRevision.findFirst({ where: { evidenceObjectId: evidence.id } }),
  ]);
  if (linkCount > 0) {
    throw new EvidenceLifecycleError(
      `This evidence is linked to ${linkCount} record${linkCount === 1 ? "" : "s"} and cannot be discarded. Unlink it first.`,
    );
  }
  if (revision) {
    throw new EvidenceLifecycleError("This evidence is a controlled-document revision's content and cannot be discarded here.");
  }

  if (evidence.storageKey) {
    const provider = documentEvidenceStorage.forKey(evidence.storageProvider) ?? documentEvidenceStorage.active();
    await provider.remove(evidence.storageKey);
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.evidenceObjectBlob.deleteMany({ where: { evidenceObjectId: evidence.id } });
    const updated = await tx.evidenceObject.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: evidence.id } },
      data: { retentionTombstonedAt: new Date(), storageKey: null },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "evidence_object.discarded",
      resourceType: "evidence_object",
      resourceId: evidence.id,
      summary: `Unlinked evidence upload "${evidence.filename}" discarded.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { filename: evidence.filename },
    });
    return updated;
  });
}

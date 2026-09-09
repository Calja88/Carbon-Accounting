/**
 * Evidence storage.
 *
 * The platform has no object-storage credentials configured, and inventing a
 * dependency on one would leave evidence upload as a button that does nothing.
 * Instead the storage backend sits behind an interface with a working built-in
 * default — bytes in their own table, kept out of every listing query — so
 * evidence genuinely works today, and pointing it at S3, Azure Blob or
 * Vercel Blob later is one provider implementation, not a redesign.
 *
 * External links are supported alongside uploads, for evidence that already
 * lives in a document management system.
 */

import { createHash } from "node:crypto";
import { LcaEvidenceKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "./audit-service";
import type { OrganisationContext } from "@/lib/organisation/context";
import { findTenantEvidence, requireAssessmentInScope, toTenantRepositoryContext } from "@/lib/repositories/lca-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  createEvidenceStorageRegistry,
  type EvidenceStorageProvider,
  type StoredEvidenceBytes,
} from "@/lib/documents/storage/provider";

export type { EvidenceStorageProvider, StoredEvidenceBytes };

/** Guard against a single upload filling the database. */
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
 * The built-in provider. Bytes live in LcaEvidenceBlob, a table nothing but
 * the download route ever selects from, so evidence listings stay cheap.
 *
 * Implements the shared `EvidenceStorageProvider` contract (T22,
 * src/lib/documents/storage/provider.ts) — LCA's evidence bytes are not
 * migrated into the new shared EvidenceObject table, but the interface and
 * the register/active/forKey registry behaviour are now shared, so a real
 * object-storage provider registered here works the same way it would for
 * the shared documents module.
 */
const databaseProvider: EvidenceStorageProvider = {
  name: "database",
  async put({ evidenceId, bytes }) {
    // Prisma's Bytes column takes a Uint8Array backed by a plain ArrayBuffer;
    // Node's Buffer can sit on a SharedArrayBuffer, so copy rather than cast.
    const data = Uint8Array.from(bytes);
    await prisma.lcaEvidenceBlob.upsert({
      where: { evidenceId },
      create: { evidenceId, data },
      update: { data },
    });
    return { storageProvider: "database", storageKey: evidenceId };
  },
  async get(storageKey) {
    const blob = await prisma.lcaEvidenceBlob.findUnique({ where: { evidenceId: storageKey } });
    return blob ? Buffer.from(blob.data) : null;
  },
  async remove(storageKey) {
    await prisma.lcaEvidenceBlob.deleteMany({ where: { evidenceId: storageKey } });
  },
};

const registry = createEvidenceStorageRegistry("LCA_EVIDENCE_STORAGE", databaseProvider);

/** Registration point for an external provider, once credentials exist. */
export function registerEvidenceStorageProvider(provider: EvidenceStorageProvider): void {
  registry.register(provider);
}

export function activeEvidenceStorageProvider(): EvidenceStorageProvider {
  return registry.active();
}

export function providerForKey(name: string | null): EvidenceStorageProvider | null {
  return registry.forKey(name);
}

// ---------------------------------------------------------------------------
// Linking
// ---------------------------------------------------------------------------

/** Every record type evidence can be attached to. */
export interface EvidenceTarget {
  processId?: string | null;
  inventoryItemId?: string | null;
  emissionFactorId?: string | null;
  supplierPcfId?: string | null;
  assumptionId?: string | null;
  exclusionId?: string | null;
  verificationId?: string | null;
}

export interface CreateEvidenceInput extends EvidenceTarget {
  assessmentId: string;
  title: string;
  description?: string | null;
  actorUserId: string;
  externalUrl?: string | null;
  file?: { fileName: string; mimeType: string; bytes: Buffer } | null;
}

export class EvidenceError extends Error {}

export async function createEvidence(context: OrganisationContext, input: CreateEvidenceInput) {
  const assessment = await requireAssessmentInScope(context, input.assessmentId);

  // Every optional target is a child of the same assessment — a foreign id
  // here would attach A's evidence metadata to B's process/item/PCF/register
  // row (PHASE1_ADVERSARIAL_TEST_MATRIX.md §4: "B evidence attached to A
  // assessment"), so each supplied target is verified before the row exists.
  const [process, item, supplierPcf, assumption, exclusion, verification] = await Promise.all([
    input.processId ? prisma.lcaProcess.findUnique({ where: { id: input.processId }, select: { assessmentId: true } }) : null,
    input.inventoryItemId ? prisma.lcaInventoryItem.findUnique({ where: { id: input.inventoryItemId }, select: { assessmentId: true } }) : null,
    input.supplierPcfId ? prisma.lcaSupplierPcf.findUnique({ where: { id: input.supplierPcfId }, select: { organisationId: true } }) : null,
    input.assumptionId ? prisma.lcaAssumption.findUnique({ where: { id: input.assumptionId }, select: { assessmentId: true } }) : null,
    input.exclusionId ? prisma.lcaExclusion.findUnique({ where: { id: input.exclusionId }, select: { assessmentId: true } }) : null,
    input.verificationId ? prisma.lcaVerification.findUnique({ where: { id: input.verificationId }, select: { assessmentId: true } }) : null,
  ]);
  if (input.processId && process?.assessmentId !== assessment.id) throw new TenantOwnershipError();
  if (input.inventoryItemId && item?.assessmentId !== assessment.id) throw new TenantOwnershipError();
  if (input.supplierPcfId && supplierPcf?.organisationId !== assessment.organisationId) throw new TenantOwnershipError();
  if (input.assumptionId && assumption?.assessmentId !== assessment.id) throw new TenantOwnershipError();
  if (input.exclusionId && exclusion?.assessmentId !== assessment.id) throw new TenantOwnershipError();
  if (input.verificationId && verification?.assessmentId !== assessment.id) throw new TenantOwnershipError();

  if (!input.externalUrl && !input.file) {
    throw new EvidenceError("Attach a file or record a link — evidence needs one or the other.");
  }
  if (input.file) {
    if (input.file.bytes.byteLength === 0) {
      throw new EvidenceError("The uploaded file is empty.");
    }
    if (input.file.bytes.byteLength > MAX_EVIDENCE_BYTES) {
      throw new EvidenceError(
        `The file is ${(input.file.bytes.byteLength / (1024 * 1024)).toFixed(1)} MB. The limit is ${MAX_EVIDENCE_BYTES / (1024 * 1024)} MB — link to it instead, or upload a smaller extract.`,
      );
    }
    const allowed = ALLOWED_EVIDENCE_MIME_PREFIXES.some((prefix) => input.file?.mimeType.startsWith(prefix));
    if (!allowed) {
      throw new EvidenceError(`Files of type "${input.file.mimeType}" are not accepted as evidence.`);
    }
  }
  if (input.externalUrl && !/^https?:\/\//i.test(input.externalUrl)) {
    throw new EvidenceError("An evidence link must be an http or https URL.");
  }

  const evidence = await prisma.lcaEvidence.create({
    data: {
      assessmentId: input.assessmentId,
      organisationId: context.organisationId,
      title: input.title,
      description: input.description ?? null,
      kind: input.file ? LcaEvidenceKind.UPLOADED_FILE : LcaEvidenceKind.EXTERNAL_LINK,
      externalUrl: input.externalUrl ?? null,
      fileName: input.file?.fileName ?? null,
      mimeType: input.file?.mimeType ?? null,
      sizeBytes: input.file?.bytes.byteLength ?? null,
      checksumSha256: input.file ? createHash("sha256").update(input.file.bytes).digest("hex") : null,
      uploadedByUserId: input.actorUserId,
      processId: input.processId ?? null,
      inventoryItemId: input.inventoryItemId ?? null,
      emissionFactorId: input.emissionFactorId ?? null,
      supplierPcfId: input.supplierPcfId ?? null,
      assumptionId: input.assumptionId ?? null,
      exclusionId: input.exclusionId ?? null,
      verificationId: input.verificationId ?? null,
    },
  });

  if (input.file) {
    const provider = activeEvidenceStorageProvider();
    const stored = await provider.put({
      evidenceId: evidence.id,
      fileName: input.file.fileName,
      mimeType: input.file.mimeType,
      bytes: input.file.bytes,
    });
    await prisma.lcaEvidence.update({
      where: { id: evidence.id },
      data: { storageProvider: stored.storageProvider, storageKey: stored.storageKey },
    });
  }

  await recordAuditEvent({
    assessmentId: input.assessmentId,
    entityType: "evidence",
    entityId: evidence.id,
    action: "created",
    actorUserId: input.actorUserId,
    summary: `Evidence "${input.title}" attached${input.file ? ` (${input.file.fileName}, ${(input.file.bytes.byteLength / 1024).toFixed(0)} kB)` : " as a link"}${describeTarget(input)}.`,
    after: {
      title: input.title,
      kind: input.file ? "UPLOADED_FILE" : "EXTERNAL_LINK",
      checksumSha256: evidence.checksumSha256,
    },
  });

  return evidence;
}

function describeTarget(target: EvidenceTarget): string {
  if (target.inventoryItemId) return ", linked to an inventory item";
  if (target.processId) return ", linked to a process";
  if (target.supplierPcfId) return ", linked to a supplier PCF";
  if (target.assumptionId) return ", linked to an assumption";
  if (target.exclusionId) return ", linked to an exclusion";
  if (target.verificationId) return ", linked to a verification record";
  if (target.emissionFactorId) return ", linked to an emission factor";
  return ", linked to the assessment";
}

export async function readEvidenceBytes(
  context: OrganisationContext,
  evidenceId: string,
  expectedAssessmentId?: string,
): Promise<{ bytes: Buffer; evidence: NonNullable<Awaited<ReturnType<typeof getEvidence>>> } | null> {
  const evidence = await getEvidence(context, evidenceId, expectedAssessmentId);
  if (!evidence || evidence.kind !== LcaEvidenceKind.UPLOADED_FILE || !evidence.storageKey) return null;
  const provider = providerForKey(evidence.storageProvider) ?? activeEvidenceStorageProvider();
  const bytes = await provider.get(evidence.storageKey);
  if (!bytes) return null;
  return { bytes, evidence };
}

/**
 * Loads an evidence row's full detail, scoped to the caller's Organisation
 * and (when `expectedAssessmentId` is supplied, as the evidence download
 * route and detail page always do) verified to belong to that exact
 * assessment — the nested-parent-substitution guard named in the T17
 * acceptance criteria for the evidence path.
 */
export async function getEvidence(context: OrganisationContext, evidenceId: string, expectedAssessmentId?: string) {
  const ctx = toTenantRepositoryContext(context);
  const scoped = await findTenantEvidence(ctx, evidenceId, expectedAssessmentId);
  if (!scoped) return null;
  await requireAssessmentInScope(context, scoped.assessmentId);
  return prisma.lcaEvidence.findUnique({
    where: { id: evidenceId },
    include: {
      uploadedBy: true,
      assessment: { select: { id: true, reference: true, title: true } },
      inventoryItem: { select: { id: true, name: true } },
      process: { select: { id: true, name: true } },
      supplierPcf: { select: { id: true, productName: true } },
      assumption: { select: { id: true, assumption: true } },
      exclusion: { select: { id: true, excludedItem: true } },
      verification: { select: { id: true, organisation: true } },
      emissionFactor: { select: { id: true, category: true, subtypeKey: true } },
    },
  });
}

export async function listEvidence(assessmentId: string) {
  return prisma.lcaEvidence.findMany({
    where: { assessmentId },
    include: {
      uploadedBy: true,
      inventoryItem: { select: { id: true, name: true } },
      process: { select: { id: true, name: true } },
      supplierPcf: { select: { id: true, productName: true } },
      assumption: { select: { id: true, assumption: true } },
      exclusion: { select: { id: true, excludedItem: true } },
      verification: { select: { id: true, organisation: true } },
    },
    orderBy: { uploadedAt: "desc" },
  });
}

export async function deleteEvidence(context: OrganisationContext, evidenceId: string, actorUserId: string) {
  const ctx = toTenantRepositoryContext(context);
  const scoped = await findTenantEvidence(ctx, evidenceId);
  if (!scoped) throw new TenantOwnershipError();
  const evidence = await prisma.lcaEvidence.findUniqueOrThrow({ where: { id: evidenceId } });
  if (evidence.storageKey) {
    const provider = providerForKey(evidence.storageProvider) ?? activeEvidenceStorageProvider();
    await provider.remove(evidence.storageKey);
  }
  await prisma.lcaEvidence.delete({ where: { id: evidenceId } });

  await recordAuditEvent({
    assessmentId: evidence.assessmentId,
    entityType: "evidence",
    entityId: evidenceId,
    action: "deleted",
    actorUserId,
    summary: `Evidence "${evidence.title}" removed.`,
    before: { title: evidence.title, fileName: evidence.fileName, checksumSha256: evidence.checksumSha256 },
  });
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type EvidenceListItem = Prisma.LcaEvidenceGetPayload<{
  include: {
    uploadedBy: true;
    inventoryItem: { select: { id: true; name: true } };
    process: { select: { id: true; name: true } };
    supplierPcf: { select: { id: true; productName: true } };
    assumption: { select: { id: true; assumption: true } };
    exclusion: { select: { id: true; excludedItem: true } };
    verification: { select: { id: true; organisation: true } };
  };
}>;

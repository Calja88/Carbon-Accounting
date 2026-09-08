/**
 * Retention service (task T81, Docs/PHASE8_HARDENING_READINESS_SPEC.md §4:
 * "Implement retention as preview → approval → queued execution →
 * deletion/tombstone event. Preview reports IDs/counts/classes only to
 * authorised users. Holds always win.").
 *
 * Only the EVIDENCE record class is wired to execution
 * (`src/lib/retention/record-classification.ts` explains why the others
 * are not); calling preview/execute for any other class throws
 * `RetentionError` naming the refusal reason rather than silently doing
 * nothing.
 *
 * "Deletion" for EVIDENCE is a tombstone, not a row delete: the storage
 * provider's bytes and the `EvidenceObjectBlob` row are removed, and
 * `retentionTombstonedAt` is stamped, but the `EvidenceObject` metadata row
 * (filename, checksum, classification, links) is kept — so an
 * `EvidenceLink`, an audit event, or an organisation export that already
 * references this evidence id keeps resolving, matching the "audit-event
 * immutability and traceability" requirement even after the bytes are gone.
 */

import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext, tenantWhere } from "@/lib/repositories/carbon-repository";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { documentEvidenceStorage } from "@/lib/documents/storage/provider";
import { isUnderLegalHold } from "@/lib/retention/legal-hold-service";
import { RECORD_CLASSIFICATION, type RecordClass } from "@/lib/retention/record-classification";

export class RetentionError extends Error {}

function assertExecutable(recordClass: RecordClass): void {
  const definition = RECORD_CLASSIFICATION[recordClass];
  if (!definition.retentionExecutable) {
    throw new RetentionError(
      `Retention is not configured for record class "${recordClass}": ${definition.refusalReason}`,
    );
  }
}

export interface RetentionPreviewItem {
  id: string;
  resourceType: "evidence_object";
  retentionUntil: Date;
}

export interface RetentionPreview {
  recordClass: RecordClass;
  count: number;
  items: RetentionPreviewItem[];
}

/**
 * Lists EvidenceObject rows eligible for retention execution right now:
 * `retentionUntil` in the past, not flagged `legalHold`, not tombstoned
 * already, and not covered by an active `LegalHold` row (resource-specific
 * or organisation-wide). Requires `organisation.retention.manage` — preview
 * is restricted to authorised users, per the spec, even though it performs
 * no write.
 */
export async function previewRetention(context: OrganisationContext, recordClass: RecordClass): Promise<RetentionPreview> {
  requirePermission(context, "organisation.retention.manage");
  assertExecutable(recordClass);

  const ctx = toTenantRepositoryContext(context);
  const candidates = await prisma.evidenceObject.findMany({
    where: tenantWhere(ctx, {
      retentionUntil: { lt: new Date() },
      legalHold: false,
      retentionTombstonedAt: null,
    }),
    select: { id: true, retentionUntil: true },
    orderBy: { retentionUntil: "asc" },
  });

  const eligible: RetentionPreviewItem[] = [];
  for (const candidate of candidates) {
    if (await isUnderLegalHold(ctx, "evidence_object", candidate.id)) continue;
    eligible.push({ id: candidate.id, resourceType: "evidence_object", retentionUntil: candidate.retentionUntil as Date });
  }

  await runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await recordAuditEvent(tx, txCtx, {
      eventType: "evidence_object.retention_previewed",
      resourceType: "evidence_object",
      resourceId: null,
      summary: `Retention preview for record class "${recordClass}": ${eligible.length} evidence object(s) eligible.`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { recordClass, count: eligible.length },
    });
  });

  return { recordClass, count: eligible.length, items: eligible };
}

export interface RetentionExecutionResult {
  recordClass: RecordClass;
  tombstonedIds: string[];
  skippedHeldIds: string[];
}

/**
 * Executes retention for the given evidence ids (normally the ids returned
 * by a prior `previewRetention` call). Every id is re-checked for hold/
 * eligibility at execution time — "holds always win" is enforced here, not
 * only at preview time, so a hold placed between preview and execution
 * still blocks deletion (TOCTOU-safe). Ids that fail the re-check are
 * skipped, not treated as an error, so one late hold never aborts an
 * otherwise-valid batch. Idempotent: an already-tombstoned id is silently
 * skipped, so calling execute twice with the same id list is safe.
 */
export async function executeRetention(
  context: OrganisationContext,
  recordClass: RecordClass,
  evidenceIds: string[],
  actorUserId: string,
): Promise<RetentionExecutionResult> {
  requirePermission(context, "organisation.retention.manage");
  assertExecutable(recordClass);

  const ctx = toTenantRepositoryContext(context);
  const tombstonedIds: string[] = [];
  const skippedHeldIds: string[] = [];

  for (const evidenceId of evidenceIds) {
    const eligible = await reCheckEligibility(ctx, evidenceId);
    if (!eligible) {
      skippedHeldIds.push(evidenceId);
      continue;
    }
    await tombstoneOne(ctx, evidenceId, actorUserId);
    tombstonedIds.push(evidenceId);
  }

  return { recordClass, tombstonedIds, skippedHeldIds };
}

async function reCheckEligibility(ctx: TenantRepositoryContext, evidenceId: string): Promise<boolean> {
  const evidence = await prisma.evidenceObject.findFirst({
    where: tenantWhere(ctx, { id: evidenceId }),
    select: { id: true, retentionUntil: true, legalHold: true, retentionTombstonedAt: true },
  });
  if (!evidence) return false;
  if (evidence.retentionTombstonedAt) return false;
  if (evidence.legalHold) return false;
  if (!evidence.retentionUntil || evidence.retentionUntil > new Date()) return false;
  if (await isUnderLegalHold(ctx, "evidence_object", evidenceId)) return false;
  return true;
}

async function tombstoneOne(ctx: TenantRepositoryContext, evidenceId: string, actorUserId: string): Promise<void> {
  const evidence = await prisma.evidenceObject.findFirst({ where: tenantWhere(ctx, { id: evidenceId }) });
  if (!evidence) return;

  if (evidence.storageKey) {
    const provider = documentEvidenceStorage.forKey(evidence.storageProvider) ?? documentEvidenceStorage.active();
    await provider.remove(evidence.storageKey);
  }

  await runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.evidenceObjectBlob.deleteMany({ where: { evidenceObjectId: evidenceId } });
    await tx.evidenceObject.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: evidenceId } },
      data: { retentionTombstonedAt: new Date(), storageKey: null },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "evidence_object.retention_executed",
      resourceType: "evidence_object",
      resourceId: evidenceId,
      summary: `Evidence object "${evidence.filename}" tombstoned by retention (past retentionUntil).`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { retentionUntil: evidence.retentionUntil?.toISOString() ?? null },
      after: { retentionTombstonedAt: new Date().toISOString() },
    });
  });
}

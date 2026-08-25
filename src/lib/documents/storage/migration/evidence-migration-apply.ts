/**
 * SP07 — apply path for the dry-run-first evidence migration (Docs/
 * SHAREPOINT_AND_EMS_UI_CLAUDE_DELIVERY_PACK.md §"SP07 - Dry-run-first
 * evidence migration").
 *
 * Scope for this task: `EvidenceObject` only. LCA evidence and
 * `ControlledDocumentRevision` are reported by
 * `evidence-migration-plan.ts` (dry-run only, `applySupported: false`) but
 * not migrated here — controlled-document revisions have their own
 * issue-time pin flow (SP04's `resolveApprovalPin`) that a generic backfill
 * must not bypass, and LCA evidence uses a separate storage registry
 * (`src/lib/lca/evidence-service.ts`). Splitting rather than guessing at
 * both in one pass, per the SP07 brief.
 *
 * Every apply call is:
 *  - organisation-scoped (`TenantRepositoryContext`, never a raw id);
 *  - idempotent — re-running on an already-migrated or already-uploaded
 *    (but not yet repointed) item is a safe no-op / resume, not an error;
 *  - non-destructive — the source `EvidenceObjectBlob` row is never
 *    deleted here; only `T81 retention-service.ts`'s separately authorised
 *    cleanup stage removes bytes;
 *  - refused outright for anything under legal hold, tombstoned, with a
 *    missing checksum, or with a malware scan status other than CLEAN.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { EvidenceStorageProvider } from "@/lib/documents/storage/provider";
import { findExternalFileReferenceByEvidenceObjectId } from "@/lib/repositories/storage-connection-repository";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { tenantWhere } from "@/lib/repositories/tenant-scope";

export class EvidenceMigrationApplyError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface ApplySafetyPreconditionsInput {
  organisationId: string | null | undefined;
  storageConnectionStatus: "NOT_CONNECTED" | "CONNECTED" | "SUSPENDED" | "OFFBOARDED" | null;
  activeSiteBindingId: string | null;
  batchSize: number;
  /** Explicit operator confirmation flag distinct from `--apply` itself (SP07: "refuse unless all safety preconditions are met"). */
  confirmed: boolean;
  maxBatchSize?: number;
}

export interface SafetyPreconditionResult {
  ok: boolean;
  reasons: string[];
}

/**
 * Pure safety gate the CLI must pass before any apply call is attempted.
 * Every reason is independent (all are collected, not short-circuited) so a
 * refusal report is complete on the first run rather than trickling out one
 * failure per invocation.
 */
export function assertApplySafetyPreconditions(input: ApplySafetyPreconditionsInput): SafetyPreconditionResult {
  const reasons: string[] = [];
  const maxBatchSize = input.maxBatchSize ?? 500;

  if (!input.organisationId) {
    reasons.push("An explicit --organisation id is required; apply may never target every organisation at once.");
  }
  if (input.storageConnectionStatus !== "CONNECTED") {
    reasons.push(`Organisation storage connection status must be CONNECTED (was "${input.storageConnectionStatus ?? "not_configured"}").`);
  }
  if (!input.activeSiteBindingId) {
    reasons.push("Organisation has no active SharePoint site binding configured.");
  }
  if (!Number.isInteger(input.batchSize) || input.batchSize <= 0) {
    reasons.push("--batch-size must be a positive integer.");
  } else if (input.batchSize > maxBatchSize) {
    reasons.push(`--batch-size ${input.batchSize} exceeds the maximum bounded batch size (${maxBatchSize}).`);
  }
  if (!input.confirmed) {
    reasons.push("Apply requires explicit --confirm in addition to --apply.");
  }

  return { ok: reasons.length === 0, reasons };
}

export type EvidenceMigrationApplyOutcome =
  | { status: "already_migrated"; evidenceObjectId: string }
  | { status: "migrated"; evidenceObjectId: string; checksumSha256: string; byteSize: number }
  | { status: "refused"; evidenceObjectId: string; reason: string };

/**
 * Migrates one `EvidenceObject`'s bytes from the database provider to
 * SharePoint. Resumable: if a prior attempt already uploaded the bytes
 * (an `ExternalFileReference` row exists) but the `EvidenceObject` row was
 * never repointed — e.g. the process died in between — this re-attaches
 * the existing pinned reference instead of re-uploading, so retrying a
 * partially-applied batch never creates a duplicate upload or a second
 * `ExternalFileReference` (the schema's own unique constraint on
 * `evidenceObjectId` would reject that regardless).
 */
export async function applyEvidenceObjectMigration(
  ctx: TenantRepositoryContext,
  evidenceObjectId: string,
  provider: EvidenceStorageProvider,
): Promise<EvidenceMigrationApplyOutcome> {
  const evidence = await prisma.evidenceObject.findFirst({
    where: tenantWhere(ctx, { id: evidenceObjectId }),
    include: { blob: true },
  });
  if (!evidence) {
    return { status: "refused", evidenceObjectId, reason: "not_found_in_organisation" };
  }
  if (evidence.storageProvider === "sharepoint") {
    return { status: "already_migrated", evidenceObjectId };
  }
  if (evidence.legalHold) {
    return { status: "refused", evidenceObjectId, reason: "legal_hold" };
  }
  if (evidence.retentionTombstonedAt) {
    return { status: "refused", evidenceObjectId, reason: "tombstoned" };
  }
  if (!evidence.checksumSha256) {
    return { status: "refused", evidenceObjectId, reason: "missing_checksum" };
  }
  if (evidence.malwareScanStatus !== "CLEAN") {
    return { status: "refused", evidenceObjectId, reason: "malware_not_clean" };
  }
  if (!evidence.blob) {
    return { status: "refused", evidenceObjectId, reason: "missing_bytes" };
  }

  let existingReference = await findExternalFileReferenceByEvidenceObjectId(evidenceObjectId);

  if (!existingReference) {
    const bytes = evidence.blob.data as Buffer;
    const verifiedChecksum = createHash("sha256").update(bytes).digest("hex");
    if (verifiedChecksum !== evidence.checksumSha256) {
      return { status: "refused", evidenceObjectId, reason: "checksum_mismatch_before_upload" };
    }

    await provider.put({
      evidenceId: evidenceObjectId,
      fileName: evidence.filename,
      mimeType: evidence.mimeType,
      bytes,
    });
    existingReference = await findExternalFileReferenceByEvidenceObjectId(evidenceObjectId);
    if (!existingReference) {
      throw new EvidenceMigrationApplyError(
        `SharePoint provider reported success for evidence ${evidenceObjectId} but no ExternalFileReference was created.`,
        "provider_inconsistent_state",
      );
    }
  }

  if (existingReference.checksumSha256 !== evidence.checksumSha256) {
    return { status: "refused", evidenceObjectId, reason: "checksum_mismatch_after_upload" };
  }

  await runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.evidenceObject.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: evidenceObjectId } },
      data: { storageProvider: "sharepoint", storageKey: evidenceObjectId },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "evidence_object.migrated_to_sharepoint",
      resourceType: "evidence_object",
      resourceId: evidenceObjectId,
      summary: `Evidence object database bytes migrated to SharePoint (dry-run-first SP07 migration, batch id ${txCtx.correlationId}).`,
      actorUserId: null,
      actorType: "SYSTEM",
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { storageProvider: "sharepoint" },
    });
  });

  return {
    status: "migrated",
    evidenceObjectId,
    checksumSha256: evidence.checksumSha256,
    byteSize: evidence.byteSize,
  };
}

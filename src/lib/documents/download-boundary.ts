/**
 * Unified evidence and authorised-download boundary (task SP05,
 * Docs/SP00_SHAREPOINT_INTEGRATION_SPEC.md §8: "the client never receives a
 * direct SharePoint/Graph URL or credential ... this is the only path that
 * can be audited, checksum-verified, and rate-limited by Paragon").
 *
 * This is the single choke point every download/preview route (evidence
 * objects, controlled-document revisions, and any resource-scoped evidence
 * route built on top of them) should resolve bytes through, whichever
 * provider actually holds them. It is additive: `evidence-service.ts`'s
 * `readEvidenceObjectBytes`/`hasClassificationClearance` and
 * `controlled-document-link-service.ts`'s pin/approval/drift logic are
 * unchanged — this module composes them and adds the structured failure
 * classification SP05 requires (missing file, revoked access, tenant
 * mismatch, checksum mismatch, tombstoned, legal hold/retention) on top,
 * without altering their existing non-disclosing-null contract for ordinary
 * callers.
 *
 * `webUrl` is never read, returned, or logged here — the pinned
 * `itemId`/`versionId` (SP00 §6-7) is always resolved server-side through
 * the SP02 `GraphClient` boundary, never a browser-facing URL or token.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import type { EvidenceClassification } from "@prisma/client";
import {
  findTenantControlledDocumentRevision,
  findTenantEvidenceObject,
  toTenantRepositoryContext,
} from "@/lib/repositories/documents-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { systemTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import {
  findExternalFileReferenceByEvidenceObjectId,
  findTenantExternalFileReferenceForRevision,
} from "@/lib/repositories/storage-connection-repository";
import { documentEvidenceStorage } from "@/lib/documents/storage/provider";
import { hasClassificationClearance } from "@/lib/documents/evidence-service";
import { isUnderLegalHold } from "@/lib/retention/legal-hold-service";
import { getGraphClient } from "@/lib/documents/storage/graph/registry";
import { resolveGraphSiteTargetForEvidenceProvider } from "@/lib/documents/storage/graph/config";
import { GraphClientError } from "@/lib/documents/storage/graph/types";
import type { GraphClient } from "@/lib/documents/storage/graph/types";

export { TenantOwnershipError };

/**
 * Every reason a download boundary call can fail to return bytes.
 * `not_found` is the deliberately non-disclosing bucket (missing id,
 * foreign-tenant id, no classification clearance) — a caller must never
 * present it any differently from a plain 404. Every other reason is only
 * ever reached *after* organisation/classification authorisation already
 * succeeded, so it is safe to report precisely.
 */
export type EvidenceDownloadFailureReason =
  | "not_found"
  | "malware_infected"
  | "tombstoned"
  | "unpinned"
  | "revoked_access"
  | "tenant_mismatch"
  | "missing_upstream"
  | "checksum_mismatch"
  | "unreachable";

export interface EvidenceDownloadMetadata {
  provider: "database" | "sharepoint";
  filename: string | null;
  mimeType: string | null;
  byteSize: number | null;
  checksumSha256: string | null;
  referenceStatus: "ACTIVE" | "STALE" | "UNREACHABLE" | null;
  legalHold: boolean;
  retentionUntil: string | null;
}

export type EvidenceDownloadResult =
  | { ok: true; metadata: EvidenceDownloadMetadata; bytes: Buffer }
  | { ok: false; reason: EvidenceDownloadFailureReason; metadata: EvidenceDownloadMetadata | null; detail: string | null };

function correlationId(operation: string, id: string): string {
  return `sp05-download-boundary-${operation}-${id}-${Date.now()}`;
}

/** Maps a Graph client failure to the SP05 failure taxonomy — never re-exposes the raw Graph message to a caller outside this module. */
function reasonForGraphError(err: unknown): EvidenceDownloadFailureReason {
  if (err instanceof GraphClientError) {
    switch (err.kind) {
      case "NOT_FOUND":
        return "missing_upstream";
      case "PERMISSION_DENIED":
      case "AUTHENTICATION":
        return "revoked_access";
      case "CONFIGURATION":
        return "tenant_mismatch";
      default:
        return "unreachable";
    }
  }
  return "unreachable";
}

/** Records a checksum-mismatch integrity flag against an ExternalFileReference — same pattern SP04's `readControlledDocumentRevisionBytes` already uses, shared here so both evidence objects and controlled-document revisions mark stale identically. Best-effort: a failure to record the flag never blocks reporting the mismatch to the caller. */
async function markReferenceUnreachable(organisationId: string, referenceId: string, staleReason: string): Promise<void> {
  const sysCtx = systemTenantRepositoryContext(organisationId, "sp05-download-boundary");
  await runInTenantTransaction(sysCtx, prisma, async (tx, txCtx) => {
    const updated = await tx.externalFileReference.update({
      where: { id: referenceId, organisationId: txCtx.organisationId },
      data: { referenceStatus: "UNREACHABLE", staleReason },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "external_file_reference.marked_stale",
      resourceType: "external_file_reference",
      resourceId: updated.id,
      summary: `External file reference marked unreachable: ${staleReason}`,
      actorUserId: null,
      actorType: "SYSTEM",
      correlationId: txCtx.correlationId,
      source: "system",
      after: { referenceStatus: updated.referenceStatus },
    });
  }).catch(() => undefined);
}

/** Resolves the SP00 §8 server-proxied download for one pinned SharePoint reference — resolves the site target, downloads the exact pinned itemId/versionId (never "latest"), and verifies the returned bytes' checksum against the pinned value before ever returning them. */
async function downloadPinnedReference(
  reference: { id: string; organisationId: string; siteBindingId: string; itemId: string; versionId: string; checksumSha256: string },
  graphClient: GraphClient,
  cid: string,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: EvidenceDownloadFailureReason; detail: string | null }> {
  let bytes: Buffer;
  try {
    const resolved = await resolveGraphSiteTargetForEvidenceProvider(reference.organisationId, reference.siteBindingId);
    bytes = await graphClient.downloadContent(resolved.target, reference.itemId, reference.versionId, cid);
  } catch (err) {
    return { ok: false, reason: reasonForGraphError(err), detail: err instanceof Error ? err.message : null };
  }

  const actualChecksum = createHash("sha256").update(bytes).digest("hex");
  if (actualChecksum !== reference.checksumSha256) {
    await markReferenceUnreachable(
      reference.organisationId,
      reference.id,
      "Checksum mismatch detected on read: SharePoint bytes no longer match the pinned checksum.",
    );
    return { ok: false, reason: "checksum_mismatch", detail: null };
  }

  return { ok: true, bytes };
}

/**
 * Resolves a download for one `EvidenceObject`, whichever provider backs it.
 * The single choke point every evidence-download route should call —
 * database-backed evidence is served exactly as `readEvidenceObjectBytes`
 * always has; SharePoint-backed evidence is resolved directly against the
 * SP02 `GraphClient` boundary (rather than through the storage-provider
 * interface, whose `get()` deliberately collapses every failure to `null`)
 * so a missing file, revoked access, a stale/unreachable reference, and a
 * checksum mismatch are reported distinctly instead of all looking like
 * "not found".
 */
export async function resolveEvidenceObjectDownload(
  context: OrganisationContext,
  evidenceId: string,
  graphClient?: GraphClient,
): Promise<EvidenceDownloadResult> {
  const ctx = toTenantRepositoryContext(context);

  let evidence;
  try {
    evidence = await findTenantEvidenceObject(ctx, evidenceId);
  } catch (err) {
    if (err instanceof TenantOwnershipError) return { ok: false, reason: "not_found", metadata: null, detail: null };
    throw err;
  }
  if (!evidence) return { ok: false, reason: "not_found", metadata: null, detail: null };

  if (!hasClassificationClearance(context, evidence.classification as EvidenceClassification)) {
    return { ok: false, reason: "not_found", metadata: null, detail: null };
  }

  const isSharePoint = evidence.storageProvider === "sharepoint";
  const metadata: EvidenceDownloadMetadata = {
    provider: isSharePoint ? "sharepoint" : "database",
    filename: evidence.filename,
    mimeType: evidence.mimeType,
    byteSize: evidence.byteSize,
    checksumSha256: evidence.checksumSha256,
    referenceStatus: null,
    legalHold: evidence.legalHold,
    retentionUntil: evidence.retentionUntil ? evidence.retentionUntil.toISOString() : null,
  };

  if (evidence.retentionTombstonedAt) {
    return { ok: false, reason: "tombstoned", metadata, detail: null };
  }
  if (evidence.malwareScanStatus === "INFECTED") {
    return { ok: false, reason: "malware_infected", metadata, detail: null };
  }
  if (!evidence.storageKey) {
    return { ok: false, reason: "not_found", metadata: null, detail: null };
  }

  if (!isSharePoint) {
    const provider = documentEvidenceStorage.forKey(evidence.storageProvider) ?? documentEvidenceStorage.active();
    const bytes = await provider.get(evidence.storageKey);
    if (!bytes) return { ok: false, reason: "missing_upstream", metadata, detail: null };
    metadata.referenceStatus = "ACTIVE";
    return { ok: true, metadata, bytes };
  }

  const reference = await findExternalFileReferenceByEvidenceObjectId(evidence.storageKey);
  if (!reference) return { ok: false, reason: "missing_upstream", metadata, detail: null };

  metadata.referenceStatus = reference.referenceStatus;
  metadata.byteSize = reference.byteSize ?? metadata.byteSize;
  metadata.checksumSha256 = reference.checksumSha256;
  metadata.mimeType = reference.mimeType ?? metadata.mimeType;

  if (reference.referenceStatus !== "ACTIVE") {
    return { ok: false, reason: "unreachable", metadata, detail: reference.staleReason };
  }

  const client = graphClient ?? getGraphClient();
  const outcome = await downloadPinnedReference(reference, client, correlationId("evidence", evidenceId));
  if (!outcome.ok) return { ok: false, reason: outcome.reason, metadata, detail: outcome.detail };
  return { ok: true, metadata, bytes: outcome.bytes };
}

/**
 * Resolves a download for one `ControlledDocumentRevision`, matching SP04's
 * two-branch behaviour (database-backed via `evidenceObjectId`, or a pinned
 * `ExternalFileReference`) but reported through the same structured
 * taxonomy as `resolveEvidenceObjectDownload`. `expectedDocumentId` carries
 * the nested-parent-substitution guard exactly as `getRevision` does.
 */
export async function resolveControlledDocumentRevisionDownload(
  context: OrganisationContext,
  revisionId: string,
  expectedDocumentId?: string,
  graphClient?: GraphClient,
): Promise<EvidenceDownloadResult> {
  const ctx = toTenantRepositoryContext(context);

  let revision;
  try {
    revision = await findTenantControlledDocumentRevision(ctx, revisionId, expectedDocumentId);
  } catch (err) {
    if (err instanceof TenantOwnershipError) return { ok: false, reason: "not_found", metadata: null, detail: null };
    throw err;
  }
  if (!revision) return { ok: false, reason: "not_found", metadata: null, detail: null };

  if (revision.evidenceObjectId) {
    return resolveEvidenceObjectDownload(context, revision.evidenceObjectId, graphClient);
  }

  if (!hasClassificationClearance(context, revision.classification as EvidenceClassification)) {
    return { ok: false, reason: "not_found", metadata: null, detail: null };
  }

  const reference = await findTenantExternalFileReferenceForRevision(ctx, revision.id);
  if (!reference) return { ok: false, reason: "not_found", metadata: null, detail: null };

  const legalHold = await isUnderLegalHold(ctx, "controlled_document_revision", revision.id);
  const metadata: EvidenceDownloadMetadata = {
    provider: "sharepoint",
    filename: null,
    mimeType: reference.mimeType,
    byteSize: reference.byteSize,
    checksumSha256: reference.checksumSha256,
    referenceStatus: reference.referenceStatus,
    legalHold,
    retentionUntil: revision.retentionUntil ? revision.retentionUntil.toISOString() : null,
  };

  if (!reference.pinnedAt) {
    return { ok: false, reason: "unpinned", metadata, detail: null };
  }
  if (reference.referenceStatus !== "ACTIVE") {
    return { ok: false, reason: "unreachable", metadata, detail: reference.staleReason };
  }

  const client = graphClient ?? getGraphClient();
  const outcome = await downloadPinnedReference(reference, client, correlationId("revision", revisionId));
  if (!outcome.ok) return { ok: false, reason: outcome.reason, metadata, detail: outcome.detail };
  return { ok: true, metadata, bytes: outcome.bytes };
}

/** True if `reason` is safe to disclose beyond a generic 404 — every reason reached only after authorisation already succeeded. */
export function isDisclosableFailure(reason: EvidenceDownloadFailureReason): boolean {
  return reason !== "not_found";
}

export type { TenantRepositoryContext };

/**
 * Controlled-document / SharePoint revision integration (task SP04,
 * Docs/SHAREPOINT_AND_EMS_UI_CLAUDE_DELIVERY_PACK.md "SP04 - Controlled-
 * document SharePoint workflow"; Docs/SP00_SHAREPOINT_INTEGRATION_SPEC.md
 * §7 "draft authoring versus immutable issued revision behaviour"). This
 * connects `ControlledDocumentRevision` to SP01's `ExternalFileReference`
 * (`controlledDocumentRevisionId` variant) and SP02's `GraphClient`
 * boundary — never a direct Graph HTTP call, never the database evidence
 * provider's blob path.
 *
 * Two lifecycle halves, matching SP00 §7's distinction:
 *
 *  - Draft authoring (`linkSharePointFileToRevision`): a DRAFT/IN_REVIEW
 *    revision may point at a SharePoint file and its reference may be
 *    re-synced as the author keeps editing in SharePoint. Nothing here is
 *    "issued" yet.
 *  - Issue (`resolveApprovalPin`, called from
 *    `document-control-service.ts`'s `approveRevision`): the exact version
 *    id and checksum in force at that moment are captured and the
 *    `ExternalFileReference` is pinned — after which SP01's
 *    `connection-service.ts` invariants make the row's identity fields
 *    immutable. A later SharePoint edit never mutates an issued revision;
 *    `checkForSharePointDrift` only ever *reports* that the newest
 *    SharePoint version has moved on, never rewrites the pin.
 *
 * `readControlledDocumentRevisionBytes` is the read-side counterpart of
 * `evidence-service.ts`'s `readEvidenceObjectBytes`, extended to also
 * resolve a revision's pinned SharePoint reference — always the pinned
 * itemId/versionId, never "latest" (SP00 §7/§8) — and to verify the
 * downloaded bytes' checksum against what was pinned, so a changed-bytes
 * condition is a blocking evidence-integrity failure, never a silently
 * served stale/tampered file.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { getGraphClient } from "@/lib/documents/storage/graph/registry";
import { resolveGraphSiteTargetForEvidenceProvider } from "@/lib/documents/storage/graph/config";
import type { GraphClient } from "@/lib/documents/storage/graph/types";
import {
  findTenantExternalFileReferenceForRevision,
  findTenantSiteBinding,
  systemTenantRepositoryContext,
  toTenantRepositoryContext,
} from "@/lib/repositories/storage-connection-repository";
import { findTenantControlledDocumentRevision } from "@/lib/repositories/documents-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { readEvidenceObjectBytes, hasClassificationClearance } from "@/lib/documents/evidence-service";

export { TenantOwnershipError };

/** Raised for a blocking evidence-integrity condition (missing/pruned/inaccessible pinned version, checksum mismatch) — distinct from "not found"/"no clearance", which callers should keep treating as a plain absence. */
export class SharePointLinkError extends Error {}

const MANAGE_PERMISSION = "ems.controlled_document.manage" as const;

function correlationId(operation: string, revisionId: string): string {
  return `sp04-controlled-document-${operation}-${revisionId}-${Date.now()}`;
}

function assertRevisionDraftEditable(revision: { status: string }): void {
  if (revision.status !== "DRAFT" && revision.status !== "IN_REVIEW") {
    throw new SharePointLinkError(
      `Revision is ${revision.status} and can no longer be linked to a SharePoint file. Create a successor revision instead.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Draft authoring
// ---------------------------------------------------------------------------

export interface LinkSharePointFileToRevisionInput {
  revisionId: string;
  siteBindingId: string;
  itemId: string;
  actorUserId: string;
  /** Injectable for tests — defaults to the shared `MicrosoftGraphClient`. */
  graphClient?: GraphClient;
}

/**
 * Points a DRAFT/IN_REVIEW revision at a candidate SharePoint file, or
 * re-syncs an already-linked (still unpinned) reference to the file's
 * current version — SP00 §7's draft-authoring state. Requires
 * `ems.controlled_document.manage` (document-content permission, distinct
 * from `ems.storage_connection.manage` connection administration).
 */
export async function linkSharePointFileToRevision(context: OrganisationContext, input: LinkSharePointFileToRevisionInput) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);

  const revision = await findTenantControlledDocumentRevision(ctx, input.revisionId);
  if (!revision) throw new TenantOwnershipError();
  assertRevisionDraftEditable(revision);

  const binding = await findTenantSiteBinding(ctx, input.siteBindingId);
  if (binding.status !== "CONNECTED") {
    throw new SharePointLinkError("This SharePoint site binding is not connected.");
  }

  const existing = await findTenantExternalFileReferenceForRevision(ctx, revision.id);
  if (existing?.pinnedAt) {
    throw new SharePointLinkError("This revision's SharePoint file reference is already pinned and cannot be relinked.");
  }

  const client = input.graphClient ?? getGraphClient();
  const cid = correlationId("link", revision.id);
  const resolved = await resolveGraphSiteTargetForEvidenceProvider(ctx.organisationId, binding.id);
  const item = await client.getItem(resolved.target, input.itemId, cid);
  const versions = await client.listVersions(resolved.target, input.itemId, cid);
  const newestVersionId = versions[0]?.versionId;
  if (!newestVersionId) {
    throw new SharePointLinkError("Microsoft Graph returned no version history for the selected SharePoint file.");
  }
  if (!item.sha256) {
    throw new SharePointLinkError("The selected SharePoint file has no checksum available yet.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const data = {
      siteBindingId: binding.id,
      itemId: input.itemId,
      versionId: newestVersionId,
      eTag: item.eTag,
      webUrl: item.webUrl,
      checksumSha256: item.sha256 as string,
      byteSize: item.size,
      lastObservedAt: new Date(),
    };

    const reference = existing
      ? await tx.externalFileReference.update({ where: { id: existing.id, organisationId: txCtx.organisationId }, data })
      : await tx.externalFileReference.create({
          data: {
            organisationId: txCtx.organisationId,
            controlledDocumentRevisionId: revision.id,
            ...data,
          },
        });

    await recordAuditEvent(tx, txCtx, {
      eventType: existing ? "external_file_reference.relinked" : "external_file_reference.created",
      resourceType: "controlled_document_revision",
      resourceId: revision.id,
      summary: `Revision linked to SharePoint file (candidate version ${reference.versionId}).`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { itemId: reference.itemId, versionId: reference.versionId },
    });

    return reference;
  });
}

// ---------------------------------------------------------------------------
// Issue-time pin (called from document-control-service.ts's approveRevision)
// ---------------------------------------------------------------------------

export interface ApprovalPinResolution {
  referenceId: string;
  versionId: string;
  checksumSha256: string;
  byteSize: number | null;
  mimeType: string | null;
}

/**
 * Resolves the exact SharePoint version/checksum in force right now for a
 * revision's (still-unpinned) external file reference, so
 * `document-control-service.ts` can pin it atomically with the APPROVED
 * transition. Returns null when the revision has no SharePoint reference at
 * all (ordinary database-evidence or empty revisions proceed unaffected —
 * SP04's "fallback/non-SharePoint behaviour" requirement). Throws
 * `SharePointLinkError` — a blocking evidence-integrity state, never
 * silently skipped — when the reference is already pinned (defensive; the
 * caller should never reach approval twice) or when Microsoft Graph cannot
 * resolve the item/version (missing, pruned, or inaccessible).
 */
export async function resolveApprovalPin(
  organisationId: string,
  revisionId: string,
  graphClient?: GraphClient,
): Promise<ApprovalPinResolution | null> {
  const reference = await prisma.externalFileReference.findFirst({
    where: { organisationId, controlledDocumentRevisionId: revisionId },
  });
  if (!reference) return null;
  if (reference.pinnedAt) {
    throw new SharePointLinkError("This revision's SharePoint file reference is already pinned.");
  }

  const client = graphClient ?? getGraphClient();
  const cid = correlationId("pin", revisionId);
  let resolved;
  try {
    resolved = await resolveGraphSiteTargetForEvidenceProvider(organisationId, reference.siteBindingId);
  } catch {
    throw new SharePointLinkError("This organisation's SharePoint connection could not be resolved for approval.");
  }

  let versions;
  try {
    versions = await client.listVersions(resolved.target, reference.itemId, cid);
  } catch {
    throw new SharePointLinkError("The SharePoint file linked to this revision could not be reached for approval.");
  }
  const newestVersionId = versions[0]?.versionId;
  if (!newestVersionId) {
    throw new SharePointLinkError("The SharePoint file linked to this revision has no accessible version to pin.");
  }

  let downloadMetadata;
  try {
    downloadMetadata = await client.getDownloadMetadata(resolved.target, reference.itemId, newestVersionId, cid);
  } catch {
    throw new SharePointLinkError("The SharePoint version linked to this revision is missing, pruned, or inaccessible.");
  }
  if (!downloadMetadata.sha256) {
    throw new SharePointLinkError("The SharePoint version linked to this revision has no checksum available to pin.");
  }

  return {
    referenceId: reference.id,
    versionId: newestVersionId,
    checksumSha256: downloadMetadata.sha256,
    byteSize: downloadMetadata.sizeBytes,
    mimeType: reference.mimeType,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ControlledDocumentRevisionBytes {
  bytes: Buffer;
  mimeType: string | null;
  checksumSha256: string;
  filename: string | null;
}

/**
 * Loads a controlled-document revision's content, whichever backing it has:
 * the shared database evidence provider (unchanged from T22) when
 * `evidenceObjectId` is set, or the revision's pinned SharePoint reference
 * otherwise. Returns null for an ordinary absence (no content, no
 * clearance, foreign tenant) exactly like `readEvidenceObjectBytes` — but
 * throws `SharePointLinkError` for a blocking evidence-integrity condition
 * (unpinned/inaccessible/pruned pinned version, or a checksum mismatch
 * between the downloaded bytes and what was pinned), so a caller can
 * distinguish "there is nothing to show" from "this record's integrity
 * could not be verified" and must never silently serve changed bytes.
 */
export async function readControlledDocumentRevisionBytes(
  context: OrganisationContext,
  revisionId: string,
  graphClient?: GraphClient,
): Promise<ControlledDocumentRevisionBytes | null> {
  const ctx = toTenantRepositoryContext(context);
  const revision = await findTenantControlledDocumentRevision(ctx, revisionId);
  if (!revision) return null;

  if (revision.evidenceObjectId) {
    const result = await readEvidenceObjectBytes(context, revision.evidenceObjectId);
    if (!result) return null;
    return {
      bytes: result.bytes,
      mimeType: result.evidence.mimeType,
      checksumSha256: result.evidence.checksumSha256,
      filename: result.evidence.filename,
    };
  }

  const reference = await findTenantExternalFileReferenceForRevision(ctx, revision.id);
  if (!reference) return null;
  if (!hasClassificationClearance(context, revision.classification)) return null;
  if (!reference.pinnedAt) {
    throw new SharePointLinkError("This revision's SharePoint file has not been pinned to an issued version yet.");
  }
  if (reference.referenceStatus !== "ACTIVE") {
    throw new SharePointLinkError("This revision's SharePoint file is no longer reachable at its pinned version.");
  }

  const client = graphClient ?? getGraphClient();
  const cid = correlationId("read", revision.id);
  let resolved;
  let bytes: Buffer;
  try {
    resolved = await resolveGraphSiteTargetForEvidenceProvider(reference.organisationId, reference.siteBindingId);
    // Always the pinned itemId/versionId — never "latest" (SP00 §7/§8).
    bytes = await client.downloadContent(resolved.target, reference.itemId, reference.versionId, cid);
  } catch {
    throw new SharePointLinkError("The SharePoint version pinned to this revision is missing, pruned, or inaccessible.");
  }

  const actualChecksum = createHash("sha256").update(bytes).digest("hex");
  if (actualChecksum !== reference.checksumSha256) {
    // Never silently serve changed bytes — flag the reference and block.
    // Uses a system tenant context (not `context`'s own permissions): a
    // document reader without `ems.storage_connection.manage` must still be
    // able to trigger this integrity flag; it is not a connection-admin
    // action, matching SP03's `remove()` system-context write.
    const sysCtx = systemTenantRepositoryContext(reference.organisationId, "sp04-controlled-document-read");
    await runInTenantTransaction(sysCtx, prisma, async (tx, txCtx) => {
      const updated = await tx.externalFileReference.update({
        where: { id: reference.id, organisationId: txCtx.organisationId },
        data: { referenceStatus: "UNREACHABLE", staleReason: "Checksum mismatch detected on read: SharePoint bytes no longer match the pinned checksum." },
      });
      await recordAuditEvent(tx, txCtx, {
        eventType: "external_file_reference.marked_stale",
        resourceType: "external_file_reference",
        resourceId: updated.id,
        summary: "External file reference marked unreachable: checksum mismatch detected on read.",
        actorUserId: null,
        actorType: "SYSTEM",
        correlationId: txCtx.correlationId,
        source: "system",
        after: { referenceStatus: updated.referenceStatus },
      });
    }).catch(() => undefined);
    throw new SharePointLinkError("The SharePoint file's content no longer matches its pinned checksum.");
  }

  return {
    bytes,
    mimeType: reference.mimeType,
    checksumSha256: reference.checksumSha256,
    filename: null,
  };
}

// ---------------------------------------------------------------------------
// Drift visibility (never mutates a pinned reference)
// ---------------------------------------------------------------------------

export interface SharePointDriftResult {
  pinned: boolean;
  pinnedVersionId: string | null;
  currentVersionId: string | null;
  drift: boolean;
}

/**
 * Read-only comparison of a revision's pinned SharePoint version against
 * SharePoint's current newest version — SP04 "a newer SharePoint version
 * must produce a visible drift/new-draft condition, never mutate an
 * approved/effective revision". Never writes to the `ExternalFileReference`
 * row; an unpinned/absent reference reports `pinned: false` rather than
 * drift, since draft authoring is expected to keep changing.
 */
export async function checkForSharePointDrift(
  context: OrganisationContext,
  revisionId: string,
  graphClient?: GraphClient,
): Promise<SharePointDriftResult | null> {
  const ctx = toTenantRepositoryContext(context);
  const revision = await findTenantControlledDocumentRevision(ctx, revisionId);
  if (!revision) return null;

  const reference = await findTenantExternalFileReferenceForRevision(ctx, revision.id);
  if (!reference) return null;
  if (!reference.pinnedAt) {
    return { pinned: false, pinnedVersionId: null, currentVersionId: null, drift: false };
  }

  const client = graphClient ?? getGraphClient();
  const cid = correlationId("drift", revision.id);
  const resolved = await resolveGraphSiteTargetForEvidenceProvider(reference.organisationId, reference.siteBindingId);
  const versions = await client.listVersions(resolved.target, reference.itemId, cid);
  const currentVersionId = versions[0]?.versionId ?? null;

  return {
    pinned: true,
    pinnedVersionId: reference.versionId,
    currentVersionId,
    drift: currentVersionId !== null && currentVersionId !== reference.versionId,
  };
}

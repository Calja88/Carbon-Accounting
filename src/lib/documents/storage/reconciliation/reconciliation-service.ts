/**
 * SharePoint delta reconciliation (task SP06, Docs/SP00_SHAREPOINT_INTEGRATION_SPEC.md
 * §9). Turns one organisation's `StorageSiteBinding` into a bounded,
 * idempotent walk of Microsoft Graph's `/drive/root/delta` feed through the
 * existing T21 outbox/job framework, updating each linked
 * `ExternalFileReference`'s tracked status without ever touching the
 * identity fields (`itemId`/`versionId`/`checksumSha256`) of a *pinned*
 * (issued) reference — mirrors T42's `legal-sync-worker.ts` shape exactly:
 * a `sharepoint.reconcile` outbox job identifies one site binding to walk,
 * `runReconciliationCycle` pages through Graph delta from a persisted
 * cursor, and each page's writes plus the cursor advance share one
 * transaction (`applyReconciliationBatch`) so a crash mid-run leaves the
 * cursor at the last page that actually committed.
 *
 * Fixed decisions this module enforces (SP00 §9, SP06 scope):
 *  - every Graph fetch (the delta page itself, and any per-item detail
 *    fetch a draft-reference update needs) happens before that page's
 *    transaction opens, so a fetch failure never leaves a half-written
 *    page and the cursor is provably untouched on failure;
 *  - a reference with `pinnedAt` set (an issued revision or an
 *    already-pinned evidence object, SP00 §7) never has its `itemId`,
 *    `versionId`, or `checksumSha256` rewritten by this module under any
 *    circumstance — a detected content change behind a pinned reference is
 *    recorded as `VERSION_DRIFT_BEHIND_ISSUED` and surfaced via an audit
 *    event, never silently applied;
 *  - a reference with no `pinnedAt` (a still-drafting reference) has its
 *    `eTag`/`checksumSha256`/`byteSize`/`versionId` refreshed on a genuine
 *    content change — SP00 §9's "no immutability concern" case;
 *  - a delete/tombstone or an item moved outside the bound drive marks the
 *    reference `UNREACHABLE`/`STALE` — the Neon row itself is never deleted
 *    (T81's "retention never deletes frozen/legal-held records" extends
 *    here: a legal hold or unexpired retention on the owning
 *    EvidenceObject/ControlledDocumentRevision is untouched by anything in
 *    this module, which writes only to ExternalFileReference);
 *  - a rename/move within the bound drive never changes `referenceStatus`
 *    — the item id is unchanged and the pinned reference (if any) still
 *    resolves — only the display-only `lastKnownName`/`lastKnownPath`
 *    cache updates;
 *  - before any Graph call, the connection's current `entraTenantId` is
 *    compared against the cursor's last-known value; a mismatch refuses
 *    the run rather than calling Graph with a site binding that may belong
 *    to a tenant the current credential no longer represents (multi-tenant
 *    isolation) — this is the only condition that skips the Graph call
 *    entirely for a run;
 *  - a page's writes are collapsed on itemId, so replaying the same page
 *    (duplicate delivery, a retried lease) is idempotent: each reference
 *    row's next state depends only on the item's current observed
 *    metadata, never on "was this the first time we saw it".
 */

import { createHash } from "node:crypto";
import type { ExternalFileReconciliationIssue, ExternalFileReferenceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueueTenantJob } from "@/lib/jobs/outbox-service";
import { JobHandlerError, type JobHandler, type OutboxMessageRecord } from "@/lib/jobs/types";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { systemTenantRepositoryContext } from "@/lib/repositories/storage-connection-repository";
import { resolveGraphSiteTargetForEvidenceProvider } from "@/lib/documents/storage/graph/config";
import { getGraphClient } from "@/lib/documents/storage/graph/registry";
import { GraphClient, GraphClientError, GraphDeltaItem, GraphSiteTarget } from "@/lib/documents/storage/graph/types";

export const SHAREPOINT_RECONCILE_JOB_TOPIC = "sharepoint.reconcile";

/** Hard cap on delta pages walked in a single job attempt — bounds one run's Graph call count and DB work even on a very large or freshly-resyncing drive; an unfinished walk simply persists its `nextLink` as the cursor and resumes on the next scheduled attempt (SP06 "bounded full scan when a token is invalid"). */
export const MAX_PAGES_PER_RUN = 20;

type Tx = Prisma.TransactionClient;

export interface SharePointReconcileJobPayload {
  siteBindingId: string;
}

function isSharePointReconcileJobPayload(value: unknown): value is SharePointReconcileJobPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.siteBindingId === "string" && candidate.siteBindingId.length > 0;
}

/**
 * Enqueues a `sharepoint.reconcile` job for one organisation's site binding.
 * Tenant-scoped (unlike `legal.sync`): a site binding is organisation-owned
 * data, so this always carries an explicit `TenantRepositoryContext` and can
 * never enqueue a job that reconciles a different organisation's binding.
 */
export async function enqueueSharePointReconciliationJob(
  tx: Tx,
  ctx: TenantRepositoryContext,
  siteBindingId: string,
  input: { idempotencyKey: string; correlationId: string; source: string },
): Promise<{ id: string }> {
  return enqueueTenantJob(tx, ctx, {
    topic: SHAREPOINT_RECONCILE_JOB_TOPIC,
    payload: { siteBindingId },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    source: input.source,
  });
}

/** Loads (or creates) the per-(organisation, site binding) reconciliation cursor. Mirrors `getOrCreateSyncCursor` (T42). */
export async function getOrCreateReconciliationCursor(client: Tx | typeof prisma, organisationId: string, siteBindingId: string) {
  const existing = await client.storageReconciliationCursor.findUnique({
    where: { organisationId_siteBindingId: { organisationId, siteBindingId } },
  });
  if (existing) return existing;

  try {
    return await client.storageReconciliationCursor.create({ data: { organisationId, siteBindingId } });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002") {
      const raced = await client.storageReconciliationCursor.findUnique({
        where: { organisationId_siteBindingId: { organisationId, siteBindingId } },
      });
      if (raced) return raced;
    }
    throw error;
  }
}

interface ResolvedDraftUpdate {
  itemId: string;
  eTag: string | null;
  checksumSha256: string;
  byteSize: number | null;
  versionId: string | null;
}

/**
 * For a drafting (unpinned) reference whose delta item shows a checksum
 * different from what Neon has recorded, resolves the newest Graph version
 * id so the reference's `versionId` stays meaningful (SP00 §9 "update the
 * draft revision's recorded version ID/eTag"). Called before any
 * transaction opens — same "fetch before write" rule as
 * `legal-sync-worker.ts`'s `resolvePageItems`. A failure here is
 * item-specific and never aborts the whole page: the item is left for the
 * next reconciliation pass instead.
 */
async function resolveDraftVersionUpdates(
  client: GraphClient,
  target: GraphSiteTarget,
  items: { item: GraphDeltaItem; correlationId: string }[],
): Promise<Map<string, ResolvedDraftUpdate>> {
  const resolved = new Map<string, ResolvedDraftUpdate>();
  for (const { item, correlationId } of items) {
    try {
      const versions = await client.listVersions(target, item.itemId, correlationId);
      const newest = versions[0]?.versionId ?? null;
      resolved.set(item.itemId, {
        itemId: item.itemId,
        eTag: item.eTag,
        checksumSha256: item.sha256 ?? "",
        byteSize: item.size,
        versionId: newest,
      });
    } catch {
      // Leave unresolved — the item's checksum drift is picked up again on
      // the next run rather than blocking the rest of this page.
    }
  }
  return resolved;
}

interface ReferenceRow {
  id: string;
  itemId: string;
  checksumSha256: string;
  pinnedAt: Date | null;
  referenceStatus: ExternalFileReferenceStatus;
  reconciliationIssue: ExternalFileReconciliationIssue | null;
  lastKnownName: string | null;
  lastKnownPath: string | null;
}

function severity(issue: ExternalFileReconciliationIssue | null): number {
  // Higher wins when a single page observation could plausibly suggest more
  // than one condition (it should not in practice, but this keeps the
  // outcome deterministic rather than order-dependent).
  const order: Record<string, number> = {
    DELETED: 5,
    MOVED_OUT_OF_SCOPE: 4,
    TENANT_MISMATCH: 4,
    PERMISSION_REVOKED: 4,
    MISSING: 3,
    VERSION_DRIFT_BEHIND_ISSUED: 2,
    CHECKSUM_DRIFT: 2,
    RENAMED: 1,
  };
  return issue ? (order[issue] ?? 0) : 0;
}

/**
 * Applies one delta page's item observations against this site binding's
 * tracked `ExternalFileReference` rows and advances the reconciliation
 * cursor, all inside one transaction (SP06 "commit a cursor only after the
 * corresponding batch commits"). Items with no matching tracked reference
 * are ignored — SP06 reconciles already-linked references, it does not
 * discover/import new ones.
 */
async function applyReconciliationBatch(
  ctx: TenantRepositoryContext,
  siteBinding: { id: string; driveId: string },
  items: GraphDeltaItem[],
  draftVersionUpdates: Map<string, ResolvedDraftUpdate>,
  cursorId: string,
  nextCursorValue: string | null,
  isFinalPage: boolean,
  now: Date,
): Promise<{ itemsFlagged: number }> {
  return prisma.$transaction(async (tx) => {
    let itemsFlagged = 0;
    const itemIds = items.map((i) => i.itemId).filter(Boolean);
    if (itemIds.length > 0) {
      const references = (await tx.externalFileReference.findMany({
        where: { organisationId: ctx.organisationId, siteBindingId: siteBinding.id, itemId: { in: itemIds } },
      })) as ReferenceRow[];
      const byItemId = new Map<string, ReferenceRow[]>();
      for (const ref of references) {
        const list = byItemId.get(ref.itemId) ?? [];
        list.push(ref);
        byItemId.set(ref.itemId, list);
      }

      for (const item of items) {
        const matches = byItemId.get(item.itemId);
        if (!matches || matches.length === 0) continue;

        for (const reference of matches) {
          const outcome = await reconcileOneReference(tx, ctx, siteBinding, reference, item, draftVersionUpdates.get(item.itemId), now);
          if (outcome.flagged) itemsFlagged += 1;
        }
      }
    }

    await tx.storageReconciliationCursor.update({
      where: { id: cursorId },
      data: {
        deltaLink: nextCursorValue,
        status: "ACTIVE",
        lastAttemptAt: now,
        ...(isFinalPage ? { lastSuccessAt: now } : {}),
      },
    });

    return { itemsFlagged };
  });
}

/** Reconciles one tracked reference against one observed delta item. Returns whether the reference's state changed in a way worth counting toward a run's "flagged" total. */
async function reconcileOneReference(
  tx: Tx,
  ctx: TenantRepositoryContext,
  siteBinding: { id: string; driveId: string },
  reference: ReferenceRow,
  item: GraphDeltaItem,
  draftUpdate: ResolvedDraftUpdate | undefined,
  now: Date,
): Promise<{ flagged: boolean }> {
  if (item.deleted) {
    if (reference.referenceStatus === "UNREACHABLE" && reference.reconciliationIssue === "DELETED") {
      return { flagged: false }; // already recorded — idempotent replay
    }
    await tx.externalFileReference.update({
      where: { id: reference.id, organisationId: ctx.organisationId },
      data: {
        referenceStatus: "UNREACHABLE",
        reconciliationIssue: "DELETED",
        staleReason: "SharePoint reconciliation observed this item deleted.",
        lastObservedAt: now,
      },
    });
    await recordAuditEvent(tx, ctx, {
      eventType: "external_file_reference.reconciliation_deleted",
      resourceType: "external_file_reference",
      resourceId: reference.id,
      summary: "External file reference marked unreachable: reconciliation observed the SharePoint item deleted.",
      actorUserId: null,
      actorType: "SYSTEM",
      correlationId: ctx.correlationId,
      source: "system",
      after: { referenceStatus: "UNREACHABLE", reconciliationIssue: "DELETED" },
    });
    return { flagged: true };
  }

  const movedOutOfScope = item.parentDriveId !== null && item.parentDriveId !== siteBinding.driveId;
  const nameChanged = item.name !== null && item.name !== reference.lastKnownName;
  const pathChanged = item.parentPath !== null && item.parentPath !== reference.lastKnownPath;
  const checksumDrift = item.sha256 !== null && item.sha256 !== reference.checksumSha256;

  if (movedOutOfScope) {
    if (reference.referenceStatus === "STALE" && reference.reconciliationIssue === "MOVED_OUT_OF_SCOPE") {
      return { flagged: false };
    }
    await tx.externalFileReference.update({
      where: { id: reference.id, organisationId: ctx.organisationId },
      data: {
        referenceStatus: "STALE",
        reconciliationIssue: "MOVED_OUT_OF_SCOPE",
        staleReason: "SharePoint reconciliation observed this item moved outside the connected drive.",
        lastKnownName: item.name ?? reference.lastKnownName,
        lastKnownPath: item.parentPath ?? reference.lastKnownPath,
        lastObservedAt: now,
      },
    });
    await recordAuditEvent(tx, ctx, {
      eventType: "external_file_reference.reconciliation_moved_out_of_scope",
      resourceType: "external_file_reference",
      resourceId: reference.id,
      summary: "External file reference marked stale: reconciliation observed the item moved outside the connected SharePoint drive.",
      actorUserId: null,
      actorType: "SYSTEM",
      correlationId: ctx.correlationId,
      source: "system",
      after: { referenceStatus: "STALE", reconciliationIssue: "MOVED_OUT_OF_SCOPE" },
    });
    return { flagged: true };
  }

  // In-scope from here — item id resolves within the bound drive, so the
  // pinned reference (if any) is still resolvable regardless of what else
  // changed (SP00 §9 rename/move-within-scope rule).
  let issue: ExternalFileReconciliationIssue | null = null;
  let flagged = false;

  if (checksumDrift) {
    if (reference.pinnedAt) {
      // Never rewritten — SP00 §7/§9's hard invariant. Only the
      // out-of-band `reconciliationIssue`/`staleReason` fields move.
      issue = "VERSION_DRIFT_BEHIND_ISSUED";
      if (reference.reconciliationIssue !== issue) {
        await tx.externalFileReference.update({
          where: { id: reference.id, organisationId: ctx.organisationId },
          data: {
            reconciliationIssue: issue,
            staleReason: "SharePoint reconciliation detected a newer version behind this issued/pinned reference; the pinned version was not changed.",
            lastKnownName: item.name ?? reference.lastKnownName,
            lastKnownPath: item.parentPath ?? reference.lastKnownPath,
            lastObservedAt: now,
          },
        });
        await recordAuditEvent(tx, ctx, {
          eventType: "external_file_reference.reconciliation_version_drift",
          resourceType: "external_file_reference",
          resourceId: reference.id,
          summary: "Reconciliation detected SharePoint content changed behind an issued/pinned reference; pinned version preserved, flagged for a successor-revision decision.",
          actorUserId: null,
          actorType: "SYSTEM",
          correlationId: ctx.correlationId,
          source: "system",
          after: { reconciliationIssue: issue, pinnedVersionId: null },
        });
        flagged = true;
      }
      return { flagged };
    }

    // Drafting reference: SP00 §9 permits updating the recorded
    // version/eTag/checksum directly — no immutability concern yet.
    issue = "CHECKSUM_DRIFT";
    const resolved = draftUpdate;
    await tx.externalFileReference.update({
      where: { id: reference.id, organisationId: ctx.organisationId },
      data: {
        checksumSha256: item.sha256 ?? reference.checksumSha256,
        eTag: item.eTag,
        byteSize: item.size ?? undefined,
        ...(resolved?.versionId ? { versionId: resolved.versionId } : {}),
        reconciliationIssue: null,
        staleReason: null,
        lastKnownName: item.name ?? reference.lastKnownName,
        lastKnownPath: item.parentPath ?? reference.lastKnownPath,
        lastObservedAt: now,
      },
    });
    await recordAuditEvent(tx, ctx, {
      eventType: "external_file_reference.reconciliation_draft_updated",
      resourceType: "external_file_reference",
      resourceId: reference.id,
      summary: "Draft external file reference updated from SharePoint reconciliation (content changed, no issued revision affected).",
      actorUserId: null,
      actorType: "SYSTEM",
      correlationId: ctx.correlationId,
      source: "system",
      after: { checksumSha256: item.sha256 },
    });
    return { flagged: true };
  }

  if (nameChanged || pathChanged) {
    issue = "RENAMED";
    if (reference.lastKnownName !== item.name || reference.lastKnownPath !== item.parentPath) {
      await tx.externalFileReference.update({
        where: { id: reference.id, organisationId: ctx.organisationId },
        data: {
          lastKnownName: item.name ?? reference.lastKnownName,
          lastKnownPath: item.parentPath ?? reference.lastKnownPath,
          // A rename/move-within-scope never breaks the pinned reference
          // (SP00 §9) — only set the informational flag when nothing more
          // severe is already recorded for this reference.
          reconciliationIssue: severity("RENAMED") >= severity(reference.reconciliationIssue) ? issue : reference.reconciliationIssue,
          lastObservedAt: now,
        },
      });
      await recordAuditEvent(tx, ctx, {
        eventType: "external_file_reference.reconciliation_renamed",
        resourceType: "external_file_reference",
        resourceId: reference.id,
        summary: "Reconciliation observed a SharePoint rename/move within the connected drive; the pinned reference is unaffected.",
        actorUserId: null,
        actorType: "SYSTEM",
        correlationId: ctx.correlationId,
        source: "system",
        after: { reconciliationIssue: "RENAMED" },
      });
      return { flagged: false };
    }
  }

  // Item observed matching recorded state — clear a previously-recorded
  // issue if reconciliation now finds none (idempotent recovery, e.g. a
  // transient MISSING from an earlier run that has since resolved).
  if (reference.reconciliationIssue !== null || reference.referenceStatus !== "ACTIVE") {
    await tx.externalFileReference.update({
      where: { id: reference.id, organisationId: ctx.organisationId },
      data: { reconciliationIssue: null, staleReason: null, referenceStatus: "ACTIVE", lastObservedAt: now },
    });
    await recordAuditEvent(tx, ctx, {
      eventType: "external_file_reference.reconciliation_resolved",
      resourceType: "external_file_reference",
      resourceId: reference.id,
      summary: "Reconciliation observed this item matching its recorded state; a previously-recorded issue was cleared.",
      actorUserId: null,
      actorType: "SYSTEM",
      correlationId: ctx.correlationId,
      source: "system",
      after: { referenceStatus: "ACTIVE", reconciliationIssue: null },
    });
    return { flagged: false };
  }

  await tx.externalFileReference.update({
    where: { id: reference.id, organisationId: ctx.organisationId },
    data: { lastObservedAt: now },
  });
  return { flagged: false };
}

/** Marks every non-UNREACHABLE reference under a site binding UNREACHABLE with the given issue and an organisation-level audit event — used when the whole binding, not one item, is unreachable (permission revoked, tenant mismatch, site/drive gone). */
async function markSiteBindingUnreachable(
  ctx: TenantRepositoryContext,
  siteBindingId: string,
  issue: ExternalFileReconciliationIssue,
  reason: string,
  now: Date,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const references = await tx.externalFileReference.findMany({
      where: { organisationId: ctx.organisationId, siteBindingId, referenceStatus: { not: "UNREACHABLE" } },
      select: { id: true },
    });
    if (references.length > 0) {
      await tx.externalFileReference.updateMany({
        where: { organisationId: ctx.organisationId, siteBindingId, referenceStatus: { not: "UNREACHABLE" } },
        data: { referenceStatus: "UNREACHABLE", reconciliationIssue: issue, staleReason: reason, lastObservedAt: now },
      });
    }
    await recordAuditEvent(tx, ctx, {
      eventType: "storage_site_binding.reconciliation_unreachable",
      resourceType: "storage_site_binding",
      resourceId: siteBindingId,
      summary: `Reconciliation marked ${references.length} external file reference(s) unreachable for this site binding: ${reason}`,
      actorUserId: null,
      actorType: "SYSTEM",
      correlationId: ctx.correlationId,
      source: "system",
      after: { reconciliationIssue: issue, affectedCount: references.length },
    });
    return references.length;
  });
}

export interface ReconciliationCycleResult {
  pagesProcessed: number;
  itemsObserved: number;
  itemsFlagged: number;
  cursorAdvancedTo: string | null;
  skippedTenantMismatch: boolean;
}

export interface RunReconciliationCycleInput {
  organisationId: string;
  siteBindingId: string;
  graphClient?: GraphClient;
  now?: Date;
}

function correlationId(organisationId: string, siteBindingId: string): string {
  return `sharepoint-reconcile-${organisationId}-${siteBindingId}-${Date.now()}`;
}

/**
 * Runs one bounded reconciliation attempt for one (organisation, site
 * binding): resolves the Graph target, guards against a tenant mismatch,
 * pages through delta up to `MAX_PAGES_PER_RUN`, and commits each page with
 * its cursor advance. Throws (leaving the cursor at its last successful
 * commit) on an unrecoverable Graph failure, having already recorded the
 * appropriate stale/unreachable marking for anything that failure implies.
 */
export async function runReconciliationCycle(input: RunReconciliationCycleInput): Promise<ReconciliationCycleResult> {
  const now = input.now ?? new Date();
  const client = input.graphClient ?? getGraphClient();
  const ctx = systemTenantRepositoryContext(input.organisationId, "sharepoint-reconciliation");

  const siteBinding = await prisma.storageSiteBinding.findFirst({
    where: { organisationId: input.organisationId, id: input.siteBindingId },
  });
  if (!siteBinding) {
    throw new JobHandlerError("SHAREPOINT_RECONCILE_BINDING_NOT_FOUND", "The site binding for this reconciliation job no longer exists.");
  }

  const cursorRow = await getOrCreateReconciliationCursor(prisma, input.organisationId, input.siteBindingId);

  const resolved = await resolveGraphSiteTargetForEvidenceProvider(input.organisationId, input.siteBindingId);

  if (cursorRow.lastKnownEntraTenantId && cursorRow.lastKnownEntraTenantId !== resolved.target.entraTenantId) {
    await markSiteBindingUnreachable(
      ctx,
      input.siteBindingId,
      "TENANT_MISMATCH",
      "This organisation's storage connection now resolves to a different Microsoft 365 tenant than when this site binding was last reconciled; reconciliation refused to call Graph until this is resolved by an administrator.",
      now,
    );
    await prisma.storageReconciliationCursor.update({
      where: { id: cursorRow.id },
      data: { status: "ERROR", lastAttemptAt: now },
    });
    return { pagesProcessed: 0, itemsObserved: 0, itemsFlagged: 0, cursorAdvancedTo: cursorRow.deltaLink, skippedTenantMismatch: true };
  }

  let pageCursor = cursorRow.deltaLink;
  let lastCommittedCursor = cursorRow.deltaLink;
  let pagesProcessed = 0;
  let itemsObserved = 0;
  let itemsFlagged = 0;

  try {
    do {
      const cid = correlationId(input.organisationId, input.siteBindingId);
      const page = await client.getDelta(resolved.target, pageCursor, cid);

      const draftCandidates = page.items.filter((item) => !item.deleted && item.sha256 !== null);
      const draftUpdates =
        draftCandidates.length > 0
          ? await resolveDraftVersionUpdates(
              client,
              resolved.target,
              draftCandidates.map((item) => ({ item, correlationId: cid })),
            )
          : new Map<string, ResolvedDraftUpdate>();

      const isFinalPage = page.nextLink === null;
      const nextCursorValue = page.nextLink ?? page.deltaLink;

      const { itemsFlagged: pageFlagged } = await applyReconciliationBatch(
        ctx,
        siteBinding,
        page.items,
        draftUpdates,
        cursorRow.id,
        nextCursorValue,
        isFinalPage,
        now,
      );

      pagesProcessed += 1;
      itemsObserved += page.items.length;
      itemsFlagged += pageFlagged;
      lastCommittedCursor = nextCursorValue;
      pageCursor = page.nextLink;
    } while (pageCursor !== null && pagesProcessed < MAX_PAGES_PER_RUN);
  } catch (error) {
    if (error instanceof GraphClientError && error.kind === "GONE") {
      // Expired delta token: force a bounded resync from scratch next run
      // rather than an unbounded full-history scan in this attempt.
      await prisma.storageReconciliationCursor.update({
        where: { id: cursorRow.id },
        data: { deltaLink: null, status: "ERROR", lastAttemptAt: now },
      });
      throw new JobHandlerError("SHAREPOINT_RECONCILE_CURSOR_EXPIRED", "The reconciliation delta cursor expired; a resync has been scheduled.");
    }
    if (error instanceof GraphClientError && (error.kind === "PERMISSION_DENIED" || error.kind === "AUTHENTICATION" || error.kind === "NOT_FOUND" || error.kind === "CONFIGURATION")) {
      const issue: ExternalFileReconciliationIssue = error.kind === "PERMISSION_DENIED" ? "PERMISSION_REVOKED" : "MISSING";
      await markSiteBindingUnreachable(ctx, input.siteBindingId, issue, `SharePoint reconciliation could not reach this site/drive: ${error.kind}.`, now);
      await prisma.storageReconciliationCursor.update({
        where: { id: cursorRow.id },
        data: { status: "ERROR", lastAttemptAt: now },
      });
      throw new JobHandlerError(`SHAREPOINT_RECONCILE_${error.kind}`, error.message);
    }

    await prisma.storageReconciliationCursor.update({
      where: { id: cursorRow.id },
      data: { status: "ERROR", lastAttemptAt: now },
    });
    throw error;
  }

  // Refresh the tenant snapshot only after a successful run — a run that
  // was refused for mismatch (above) or that failed never reaches here, so
  // it never masks the very mismatch it should have been flagging.
  await prisma.storageReconciliationCursor.update({
    where: { id: cursorRow.id },
    data: { lastKnownEntraTenantId: resolved.target.entraTenantId },
  });

  return { pagesProcessed, itemsObserved, itemsFlagged, cursorAdvancedTo: lastCommittedCursor, skippedTenantMismatch: false };
}

/**
 * Builds the `sharepoint.reconcile` outbox `JobHandler` (T21's
 * `runWorkerOnce` registers this under `SHAREPOINT_RECONCILE_JOB_TOPIC`).
 * `resolveGraphClient` is injectable so tests can hand it a fake
 * `GraphClient` instead of the real Microsoft Graph one.
 */
export function makeSharePointReconciliationJobHandler(resolveGraphClient: () => GraphClient = getGraphClient): JobHandler {
  return async (message: OutboxMessageRecord) => {
    if (!isSharePointReconcileJobPayload(message.payload)) {
      throw new JobHandlerError("SHAREPOINT_RECONCILE_INVALID_PAYLOAD", "sharepoint.reconcile job payload is missing a valid siteBindingId.");
    }
    if (!message.organisationId) {
      throw new JobHandlerError("SHAREPOINT_RECONCILE_MISSING_ORGANISATION", "sharepoint.reconcile is a tenant-scoped job and requires an organisationId.");
    }
    await runReconciliationCycle({
      organisationId: message.organisationId,
      siteBindingId: message.payload.siteBindingId,
      graphClient: resolveGraphClient(),
    });
  };
}

/** Stable content hash helper, exported for tests that need to construct a synthetic checksum matching what `sharepoint-provider.ts`/Graph would report. */
export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

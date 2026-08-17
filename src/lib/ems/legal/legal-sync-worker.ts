/**
 * Legal sync worker (task T42, Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md
 * §§4,8-9, P4-03). Turns a `LegalContentProvider` (T41) into upserted
 * instruments/versions/change-events (T40) through the T21 job framework: a
 * `legal.sync` outbox job identifies one (provider, stream, filterKey) to
 * poll, and this module's handler does the actual work. Retry/backoff and
 * dead-letter status for a failing sync attempt are the existing outbox
 * machinery (`runWorkerOnce`, `failJob`) — nothing here reinvents them.
 *
 * Fixed decisions this module enforces (spec §§1,4,9):
 *  - a page's instrument/version/event writes and its cursor advance share
 *    T40's `applyLegalSyncBatch` transaction — this worker only decides
 *    *what* to write per page, never advances a cursor itself, and one page
 *    is one committed unit so a crash mid-run leaves the cursor at the last
 *    page that actually committed rather than losing or duplicating a run;
 *  - every provider fetch (discovery, then per-item `getInstrument`/
 *    `getVersionMetadata`) happens before the page's transaction opens, so a
 *    fetch failure — including `RATE_LIMITED` — is provably thrown before
 *    any write, and the cursor is provably untouched;
 *  - a permanent, item-specific provider error (`retryable: false`, e.g.
 *    `NOT_FOUND`) skips that one item and continues the page; a transient,
 *    systemic error (`retryable: true`, e.g. `TIMEOUT`/`RATE_LIMITED`/
 *    `CIRCUIT_OPEN`) aborts the whole page — "malformed/partial responses
 *    fail safely" (T41) without ever advancing the cursor past a systemic
 *    failure;
 *  - `LegalChangeEvent.status` moves DETECTED -> TRIAGED once its batch
 *    commits (the schema's own comment: "T40 only ever writes DETECTED;
 *    later transitions are T42's triage worker") — this is intake triage
 *    only, never organisation-specific matching/review-candidate creation
 *    (spec §7's fan-out is a later task's scope, not attempted here);
 *  - a disappearing/withdrawn upstream item is never a local delete — this
 *    module has no delete path over `LegalInstrument`/`LegalInstrumentVersion`/
 *    `LegalChangeEvent` at all;
 *  - never decides applicability — see the T40 module for the same rule.
 */

import type { LegalSyncStream, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enqueuePlatformJob } from "@/lib/jobs/outbox-service";
import { JobHandlerError, type JobHandler, type OutboxMessageRecord } from "@/lib/jobs/types";
import {
  applyLegalSyncBatch,
  getOrCreateSyncCursor,
  recordLegalChangeEvent,
  recordLegalInstrumentVersion,
  upsertLegalInstrument,
} from "./legal-source-service";
import { getLegalContentProvider } from "./provider/registry";
import {
  LegalContentProviderError,
  type DiscoveryInput,
  type DiscoveryItem,
  type DiscoveryPage,
  type LegalContentProvider,
  type LegalDiscoveryStream,
  type ProviderInstrument,
  type ProviderVersion,
} from "./provider/types";

export const LEGAL_SYNC_JOB_TOPIC = "legal.sync";

/** Delayed-effect tolerance: a poll's first page re-requests this far back, so an item slow to appear upstream is still picked up next cycle (spec §4/§9 "poll with overlap"). */
export const DEFAULT_OVERLAP_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
/** A cursor with no prior successful sync has no `overlapStartAt` to work from; bound the first-ever backfill window instead of requesting a provider's entire history. */
export const DEFAULT_BOOTSTRAP_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface LegalSyncJobPayload {
  providerKey: string;
  stream: LegalSyncStream;
  filterKey?: string;
}

function isLegalSyncStream(value: unknown): value is LegalSyncStream {
  return value === "PUBLICATIONS" || value === "EFFECTS" || value === "VERSIONS";
}

function isLegalSyncJobPayload(value: unknown): value is LegalSyncJobPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.providerKey === "string" && candidate.providerKey.length > 0 && isLegalSyncStream(candidate.stream);
}

/**
 * Enqueues a `legal.sync` job for one (provider, stream, filter). A platform
 * job because `LegalSourceProvider`/`LegalSyncCursor` are platform-global
 * reference data, not tenant data — same reasoning as `legal-source-service.ts`
 * (T40) has no `TenantRepositoryContext` anywhere in it. The caller supplies
 * `idempotencyKey` (e.g. a time-bucketed value) so a scheduler invoked more
 * than once in the same window collapses onto one enqueued job rather than
 * piling up duplicates.
 */
export async function enqueueLegalSyncJob(
  tx: Prisma.TransactionClient,
  payload: LegalSyncJobPayload,
  input: { idempotencyKey: string; correlationId: string; source: string },
): Promise<{ id: string }> {
  return enqueuePlatformJob(tx, {
    topic: LEGAL_SYNC_JOB_TOPIC,
    payload: { providerKey: payload.providerKey, stream: payload.stream, filterKey: payload.filterKey ?? "" },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    source: input.source,
  });
}

/**
 * `LegalSyncStream` (schema) has a third member, `VERSIONS`, that
 * `LegalContentProvider` (T41) has no discovery method for — this worker
 * only ever polls `PUBLICATIONS`/`EFFECTS`. Narrows to the two streams this
 * worker actually supports and returns the matching bound discovery method.
 */
function discoveryFn(
  provider: LegalContentProvider,
  stream: LegalSyncStream,
): { stream: LegalDiscoveryStream; discover: (input: DiscoveryInput) => Promise<DiscoveryPage> } {
  if (stream === "PUBLICATIONS") return { stream, discover: provider.discoverPublications.bind(provider) };
  if (stream === "EFFECTS") return { stream, discover: (input: DiscoveryInput) => provider.discoverEffects({ ...input, stream: "EFFECTS" }) };
  throw new JobHandlerError("LEGAL_SYNC_UNSUPPORTED_STREAM", `legal.sync does not poll the "${stream}" stream directly.`);
}

interface ResolvedItem {
  item: DiscoveryItem;
  instrument: ProviderInstrument;
  version: ProviderVersion;
}

/**
 * Fetches full instrument/version detail for each discovered item. A
 * permanent, item-specific failure (`retryable: false`) is dropped — one bad
 * item never blocks the rest of a page's worth of good ones; a transient,
 * systemic failure (`retryable: true`) propagates to abort the page.
 */
async function resolvePageItems(
  provider: LegalContentProvider,
  items: DiscoveryItem[],
): Promise<{ resolved: ResolvedItem[]; skipped: number }> {
  const resolved: ResolvedItem[] = [];
  let skipped = 0;
  for (const item of items) {
    try {
      const [instrument, version] = await Promise.all([
        provider.getInstrument(item.canonicalId),
        provider.getVersionMetadata(item.canonicalId),
      ]);
      resolved.push({ item, instrument, version });
    } catch (error) {
      if (error instanceof LegalContentProviderError && !error.retryable) {
        skipped += 1;
        continue;
      }
      throw error;
    }
  }
  return { resolved, skipped };
}

/** Writes one page's resolved items and triages their newly-recorded change events, all inside the caller's `applyLegalSyncBatch` transaction. */
async function writeResolvedItems(
  tx: Prisma.TransactionClient,
  providerId: string,
  providerKey: string,
  resolved: ResolvedItem[],
): Promise<void> {
  const newEventIds: string[] = [];

  for (const { item, instrument: providerInstrument, version: providerVersion } of resolved) {
    const instrument = await upsertLegalInstrument(tx, {
      providerKey,
      canonicalId: providerInstrument.canonicalId,
      instrumentType: providerInstrument.instrumentType,
      title: providerInstrument.title,
      year: providerInstrument.year ?? undefined,
      number: providerInstrument.number ?? undefined,
      madeAt: providerInstrument.madeAt ?? undefined,
      publishedAt: providerInstrument.publishedAt ?? undefined,
      commencementAt: providerInstrument.commencementAt ?? undefined,
      status: providerInstrument.status,
    });

    const version = await recordLegalInstrumentVersion(tx, instrument.id, {
      providerVersionId: providerVersion.providerVersionId,
      retrievedAt: providerVersion.retrievedAt,
      metadata: providerVersion.metadata,
      checksum: providerVersion.checksum,
      sourceUrl: providerVersion.sourceUrl,
    });

    const event = await recordLegalChangeEvent(tx, providerId, {
      providerEventId: item.providerItemId ?? "",
      eventType: item.itemType,
      sourceInstrumentId: instrument.id,
      sourceVersionId: version.id,
      sourceHash: providerVersion.checksum,
      detectedAt: item.detectedAt,
      effectiveAt: item.effectiveAt ?? undefined,
      rawEvidence: item.raw,
    });
    newEventIds.push(event.id);
  }

  if (newEventIds.length > 0) {
    // Only flips rows still at DETECTED — replaying an already-triaged (or
    // further along, human-reviewed) event never regresses its status.
    await tx.legalChangeEvent.updateMany({
      where: { id: { in: newEventIds }, status: "DETECTED" },
      data: { status: "TRIAGED" },
    });
  }
}

export interface LegalSyncCycleResult {
  pagesProcessed: number;
  itemsWritten: number;
  itemsSkipped: number;
  cursorAdvancedTo: string | null;
}

export interface RunLegalSyncCycleInput {
  providerKey: string;
  stream: LegalSyncStream;
  filterKey?: string;
  provider: LegalContentProvider;
  now?: Date;
  overlapMs?: number;
  bootstrapMs?: number;
}

/**
 * Runs one full poll cycle for one (provider, stream, filter): pages through
 * discovery from a fresh overlap window until the provider reports no more
 * pages, writing and committing each page as it goes. Throws (never writes
 * anything for the failing page) on the first unrecoverable provider error,
 * having already marked the cursor `ERROR` with `lastAttemptAt` set — the
 * "stale-cursor/dead-letter alert" surface `legal-sync-health.ts` reads.
 */
export async function runLegalSyncCycle(input: RunLegalSyncCycleInput): Promise<LegalSyncCycleResult> {
  const filterKey = input.filterKey ?? "";
  const now = input.now ?? new Date();
  const overlapMs = input.overlapMs ?? DEFAULT_OVERLAP_MS;
  const bootstrapMs = input.bootstrapMs ?? DEFAULT_BOOTSTRAP_MS;

  const providerRow = await prisma.legalSourceProvider.findUnique({ where: { key: input.providerKey } });
  if (!providerRow) {
    throw new JobHandlerError("LEGAL_SOURCE_UNKNOWN", `Unknown legal source provider "${input.providerKey}".`);
  }
  if (providerRow.status === "DISABLED") {
    throw new JobHandlerError("LEGAL_SOURCE_DISABLED", `Legal source provider "${input.providerKey}" is disabled.`);
  }

  const cursorRow = await getOrCreateSyncCursor(prisma, providerRow.id, input.stream, filterKey);
  const { stream: discoveryStream, discover } = discoveryFn(input.provider, input.stream);
  const overlapStartAt = cursorRow.overlapStartAt ?? new Date(now.getTime() - bootstrapMs);

  let cursor: string | null = null; // always restart from page 1 of a fresh overlap window — see module doc comment
  let pagesProcessed = 0;
  let itemsWritten = 0;
  let itemsSkipped = 0;

  try {
    let page: DiscoveryPage;
    do {
      page = await discover({ stream: discoveryStream, cursor, overlapStartAt });
      const { resolved, skipped } = await resolvePageItems(input.provider, page.items);
      const isLastPage = page.nextCursor === null;

      await applyLegalSyncBatch(
        {
          providerKey: input.providerKey,
          stream: input.stream,
          filterKey,
          nextCursor: page.nextCursor,
          // Only the run's final commit rolls the overlap window forward;
          // every earlier page must leave it untouched, or a run that dies
          // partway through a long feed would narrow next run's overlap
          // before this one actually finished.
          overlapStartAt: isLastPage ? new Date(now.getTime() - overlapMs) : undefined,
        },
        (tx) => writeResolvedItems(tx, providerRow.id, input.providerKey, resolved),
      );

      pagesProcessed += 1;
      itemsWritten += resolved.length;
      itemsSkipped += skipped;
      cursor = page.nextCursor;
    } while (cursor !== null);
  } catch (error) {
    await prisma.legalSyncCursor.update({
      where: { id: cursorRow.id },
      data: { lastAttemptAt: now, status: "ERROR" },
    });
    if (error instanceof LegalContentProviderError) {
      throw new JobHandlerError(`LEGAL_SOURCE_${error.code}`, error.message);
    }
    throw error;
  }

  return { pagesProcessed, itemsWritten, itemsSkipped, cursorAdvancedTo: cursor };
}

/**
 * Builds the `legal.sync` outbox `JobHandler` (T21's `runWorkerOnce`
 * registers this under `LEGAL_SYNC_JOB_TOPIC`). `resolveProvider` is
 * injectable so tests can hand it a fake `LegalContentProvider` instead of
 * the real `legislation-gov-uk` client.
 */
export function makeLegalSyncJobHandler(resolveProvider: (key: string) => LegalContentProvider = getLegalContentProvider): JobHandler {
  return async (message: OutboxMessageRecord) => {
    if (!isLegalSyncJobPayload(message.payload)) {
      throw new JobHandlerError("LEGAL_SYNC_INVALID_PAYLOAD", "legal.sync job payload is missing a valid providerKey/stream.");
    }
    const provider = resolveProvider(message.payload.providerKey);
    await runLegalSyncCycle({
      providerKey: message.payload.providerKey,
      stream: message.payload.stream,
      filterKey: message.payload.filterKey,
      provider,
    });
  };
}

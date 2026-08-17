/**
 * Provider-neutral legal source persistence (task T40,
 * Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md §§1-3). Everything here is
 * platform-global authoritative reference data, not tenant data — no
 * `TenantRepositoryContext`, no `organisationId` — same as the AI model
 * catalogue (`src/lib/ai/catalog-store.ts`, T18). Per-Organisation review
 * state (`LegalReviewCandidate`) is a later task (T42).
 *
 * Fixed decisions this module enforces directly (spec §1):
 *  - detecting a change never decides applicability — there is no function
 *    here that sets anything resembling an applicability/compliance
 *    decision, only recording what a provider reported;
 *  - `LegalInstrumentVersion` rows are append-only (never updated/deleted
 *    by this module; the migration's trigger is defence-in-depth) — the
 *    "source provenance immutable" acceptance criterion;
 *  - `LegalChangeEvent` rows are idempotent on `(providerId, dedupeKey)` —
 *    replaying a provider's feed, or an overlapping poll window, collapses
 *    onto the existing row instead of creating a duplicate;
 *  - `applyLegalSyncBatch` is the only way a `LegalSyncCursor` advances: the
 *    cursor update runs in the same transaction as the caller's batch
 *    writes, after they succeed, so a failed batch never leaves the cursor
 *    pointing past work that was rolled back.
 */

import { createHash } from "node:crypto";
import type { LegalSyncStream, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canonicalStringify } from "@/lib/audit/integrity";
import {
  type RecordLegalChangeEventInput,
  type RecordLegalInstrumentVersionInput,
  type RecordLegalProvisionReferenceInput,
  type RegisterJurisdictionInput,
  type RegisterLegalSourceProviderInput,
  type RegisterLegalTopicInput,
  type UpsertLegalInstrumentInput,
} from "./schemas";

export class LegalSourceError extends Error {}

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof prisma;

/** Prisma's unique-constraint violation code — used to collapse a racing idempotent insert onto the row the other writer created. */
const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNIQUE_CONSTRAINT_VIOLATION
  );
}

function toJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

// ---------------------------------------------------------------------------
// Reference data — jurisdictions, topics, providers
// ---------------------------------------------------------------------------

export async function registerJurisdiction(input: RegisterJurisdictionInput, client: Client = prisma) {
  return client.jurisdiction.upsert({
    where: { code: input.code },
    create: {
      code: input.code,
      name: input.name,
      country: input.country,
      subdivision: input.subdivision ?? null,
      active: input.active ?? true,
    },
    update: {
      name: input.name,
      country: input.country,
      subdivision: input.subdivision ?? null,
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
}

export async function listJurisdictions(client: Client = prisma) {
  return client.jurisdiction.findMany({ orderBy: { code: "asc" } });
}

export async function registerLegalTopic(input: RegisterLegalTopicInput, client: Client = prisma) {
  return client.legalTopic.upsert({
    where: { key: input.key },
    create: {
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      active: input.active ?? true,
    },
    update: {
      name: input.name,
      description: input.description ?? null,
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
}

export async function listLegalTopics(client: Client = prisma) {
  return client.legalTopic.findMany({ orderBy: { key: "asc" } });
}

export async function registerLegalSourceProvider(input: RegisterLegalSourceProviderInput, client: Client = prisma) {
  return client.legalSourceProvider.upsert({
    where: { key: input.key },
    create: {
      key: input.key,
      name: input.name,
      authorityType: input.authorityType,
      configReference: input.configReference ?? null,
      status: input.status ?? "ENABLED",
    },
    update: {
      name: input.name,
      authorityType: input.authorityType,
      configReference: input.configReference ?? null,
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
}

export async function listLegalSourceProviders(client: Client = prisma) {
  return client.legalSourceProvider.findMany({ orderBy: { key: "asc" } });
}

async function getProviderByKeyOrThrow(client: Client, providerKey: string) {
  const provider = await client.legalSourceProvider.findUnique({ where: { key: providerKey } });
  if (!provider) throw new LegalSourceError(`Unknown legal source provider "${providerKey}".`);
  return provider;
}

// ---------------------------------------------------------------------------
// Sync cursors
// ---------------------------------------------------------------------------

export async function getOrCreateSyncCursor(
  client: Client,
  providerId: string,
  stream: LegalSyncStream,
  filterKey = "",
) {
  const existing = await client.legalSyncCursor.findUnique({
    where: { providerId_stream_filterKey: { providerId, stream, filterKey } },
  });
  if (existing) return existing;

  try {
    return await client.legalSyncCursor.create({ data: { providerId, stream, filterKey } });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      const raced = await client.legalSyncCursor.findUnique({
        where: { providerId_stream_filterKey: { providerId, stream, filterKey } },
      });
      if (raced) return raced;
    }
    throw error;
  }
}

export interface LegalSyncBatchOptions {
  providerKey: string;
  stream: LegalSyncStream;
  filterKey?: string;
  /** Cursor value after this batch. `null` leaves the cursor unset (e.g. a first run that found nothing to record yet). */
  nextCursor: string | null;
  overlapStartAt?: Date | null;
}

/**
 * Runs `writeBatch` and advances the provider/stream's cursor in one
 * transaction — the T40 acceptance criterion "cursors advance
 * transactionally only after batch commit". If `writeBatch` throws, the
 * whole transaction rolls back, including the cursor row: the cursor never
 * moves past work that didn't commit. `writeBatch` receives the same
 * transaction client so every instrument/version/event write it performs is
 * part of the same atomic unit as the cursor advance.
 */
export async function applyLegalSyncBatch<T>(
  options: LegalSyncBatchOptions,
  writeBatch: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const provider = await getProviderByKeyOrThrow(tx, options.providerKey);
    const cursor = await getOrCreateSyncCursor(tx, provider.id, options.stream, options.filterKey ?? "");

    const result = await writeBatch(tx);

    const now = new Date();
    await tx.legalSyncCursor.update({
      where: { id: cursor.id },
      data: {
        cursor: options.nextCursor,
        overlapStartAt: options.overlapStartAt ?? cursor.overlapStartAt,
        lastSuccessAt: now,
        lastAttemptAt: now,
        status: "ACTIVE",
      },
    });

    return result;
  });
}

// ---------------------------------------------------------------------------
// Instruments, versions, provision references
// ---------------------------------------------------------------------------

/** Idempotent by `(providerId, canonicalId)`: a repeat call updates the mutable summary fields rather than creating a duplicate instrument. */
export async function upsertLegalInstrument(client: Client, input: UpsertLegalInstrumentInput) {
  const provider = await getProviderByKeyOrThrow(client, input.providerKey);

  const instrument = await client.legalInstrument.upsert({
    where: { providerId_canonicalId: { providerId: provider.id, canonicalId: input.canonicalId } },
    create: {
      providerId: provider.id,
      canonicalId: input.canonicalId,
      instrumentType: input.instrumentType,
      title: input.title,
      year: input.year ?? null,
      number: input.number ?? null,
      madeAt: input.madeAt ?? null,
      publishedAt: input.publishedAt ?? null,
      commencementAt: input.commencementAt ?? null,
      status: input.status ?? "ACTIVE",
      latestSourceHash: input.latestSourceHash ?? null,
      lastCheckedAt: new Date(),
    },
    update: {
      instrumentType: input.instrumentType,
      title: input.title,
      year: input.year ?? null,
      number: input.number ?? null,
      madeAt: input.madeAt ?? null,
      publishedAt: input.publishedAt ?? null,
      commencementAt: input.commencementAt ?? null,
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.latestSourceHash !== undefined ? { latestSourceHash: input.latestSourceHash } : {}),
      lastCheckedAt: new Date(),
    },
  });

  for (const code of input.jurisdictionCodes ?? []) {
    const jurisdiction = await client.jurisdiction.findUnique({ where: { code } });
    if (!jurisdiction) throw new LegalSourceError(`Unknown jurisdiction code "${code}".`);
    await client.legalInstrumentJurisdiction.upsert({
      where: { instrumentId_jurisdictionId: { instrumentId: instrument.id, jurisdictionId: jurisdiction.id } },
      create: { instrumentId: instrument.id, jurisdictionId: jurisdiction.id },
      update: {},
    });
  }

  for (const key of input.topicKeys ?? []) {
    const topic = await client.legalTopic.findUnique({ where: { key } });
    if (!topic) throw new LegalSourceError(`Unknown legal topic key "${key}".`);
    await client.legalInstrumentTopic.upsert({
      where: { instrumentId_topicId: { instrumentId: instrument.id, topicId: topic.id } },
      create: { instrumentId: instrument.id, topicId: topic.id },
      update: {},
    });
  }

  return instrument;
}

/**
 * Idempotent by `(instrumentId, providerVersionId)`: a repeat retrieval of
 * the same provider version returns the existing row unchanged — this
 * table is append-only (see migration trigger), so there is deliberately no
 * update path here at all.
 */
export async function recordLegalInstrumentVersion(
  client: Client,
  instrumentId: string,
  input: RecordLegalInstrumentVersionInput,
) {
  const existing = await client.legalInstrumentVersion.findUnique({
    where: { instrumentId_providerVersionId: { instrumentId, providerVersionId: input.providerVersionId } },
  });
  if (existing) return existing;

  try {
    return await client.legalInstrumentVersion.create({
      data: {
        instrumentId,
        providerVersionId: input.providerVersionId,
        retrievedAt: input.retrievedAt,
        metadata: toJson(input.metadata),
        documentStorageRef: input.documentStorageRef ?? null,
        checksum: input.checksum,
        sourceUrl: input.sourceUrl,
      },
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      const raced = await client.legalInstrumentVersion.findUnique({
        where: { instrumentId_providerVersionId: { instrumentId, providerVersionId: input.providerVersionId } },
      });
      if (raced) return raced;
    }
    throw error;
  }
}

/** Upserted (not append-only, unlike versions): a provider may correct a provision's label/URI without that being a new provenance snapshot. Never stores provision text — see schema comment. */
export async function recordLegalProvisionReference(
  client: Client,
  instrumentId: string,
  input: RecordLegalProvisionReferenceInput,
) {
  return client.legalProvisionReference.upsert({
    where: { instrumentId_providerProvisionId: { instrumentId, providerProvisionId: input.providerProvisionId } },
    create: {
      instrumentId,
      versionId: input.versionId ?? null,
      providerProvisionId: input.providerProvisionId,
      label: input.label ?? null,
      uri: input.uri ?? null,
    },
    update: {
      versionId: input.versionId ?? null,
      label: input.label ?? null,
      uri: input.uri ?? null,
    },
  });
}

/** Deterministic fallback dedupe key for a provider that supplies no stable event id of its own. */
function deriveDedupeKey(providerEventId: string, input: RecordLegalChangeEventInput): string {
  if (providerEventId) return providerEventId;
  return createHash("sha256")
    .update(
      canonicalStringify({
        eventType: input.eventType,
        sourceInstrumentId: input.sourceInstrumentId,
        detectedAt: input.detectedAt.toISOString(),
        sourceHash: input.sourceHash ?? null,
      }),
    )
    .digest("hex");
}

/**
 * Idempotent by `(providerId, dedupeKey)`: replaying a provider's feed, or
 * an overlapping poll window, returns the existing row instead of creating
 * a duplicate — the T40 acceptance criterion "unique idempotency
 * constraints prevent duplicate events". Recording a change never decides
 * applicability; that is Organisation-owned state a later task adds.
 */
export async function recordLegalChangeEvent(client: Client, providerId: string, input: RecordLegalChangeEventInput) {
  const dedupeKey = input.dedupeKey?.trim() || deriveDedupeKey(input.providerEventId, input);

  const existing = await client.legalChangeEvent.findUnique({
    where: { providerId_dedupeKey: { providerId, dedupeKey } },
  });
  if (existing) return existing;

  try {
    return await client.legalChangeEvent.create({
      data: {
        providerId,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        sourceInstrumentId: input.sourceInstrumentId,
        affectedInstrumentId: input.affectedInstrumentId ?? null,
        affectedProvisionId: input.affectedProvisionId ?? null,
        sourceVersionId: input.sourceVersionId ?? null,
        sourceHash: input.sourceHash ?? null,
        detectedAt: input.detectedAt,
        effectiveAt: input.effectiveAt ?? null,
        rawEvidence: toJson(input.rawEvidence),
        dedupeKey,
      },
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      const raced = await client.legalChangeEvent.findUnique({
        where: { providerId_dedupeKey: { providerId, dedupeKey } },
      });
      if (raced) return raced;
    }
    throw error;
  }
}

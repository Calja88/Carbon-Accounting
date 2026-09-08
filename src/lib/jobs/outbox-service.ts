/**
 * Transactional outbox service (task T21, Docs/PHASE2_EMS_FOUNDATION_SPEC.md
 * §§1,3). Two enqueue entry points, deliberately kept separate rather than
 * one function with an optional `organisationId`:
 *
 *  - `enqueueTenantJob` always takes a `TenantRepositoryContext` and always
 *    writes a non-null `organisationId` — the T21 acceptance criterion
 *    "tenant context is explicit on tenant jobs" is a type-level guarantee,
 *    not a convention.
 *  - `enqueuePlatformJob` takes no tenant context and only accepts a topic
 *    from the declared `PLATFORM_JOB_TOPICS` allowlist.
 *
 * Both take a `Prisma.TransactionClient` so the outbox row commits in the
 * same transaction as the domain write it describes — the "database outbox
 * is the reliability boundary" fixed decision (Phase 2 spec §1).
 *
 * Leasing uses one raw SQL statement (`SELECT ... FOR UPDATE SKIP LOCKED`
 * folded into an `UPDATE`) so two concurrent workers can never both claim
 * the same row: Postgres row-level locking during the UPDATE serialises the
 * claim, and `SKIP LOCKED` lets a second worker move on to a different row
 * instead of blocking.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { tenantWhere, assertOwned, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  isPlatformJobTopic,
  isReservedPlatformNamespace,
  type EnqueueJobInput,
  type JobError,
  type OutboxMessageRecord,
} from "./types";

export { TenantOwnershipError };

type Tx = Prisma.TransactionClient;

export class OutboxTopicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboxTopicError";
  }
}

function toJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Prisma's unique-constraint violation code — used to detect a duplicate (topic, idempotencyKey) enqueue. */
const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNIQUE_CONSTRAINT_VIOLATION
  );
}

async function findByIdempotencyKey(tx: Tx, topic: string, idempotencyKey: string) {
  return tx.outboxMessage.findFirst({ where: { topic, idempotencyKey } });
}

async function insertMessage(tx: Tx, organisationId: string | null, input: EnqueueJobInput) {
  return tx.outboxMessage.create({
    data: {
      organisationId,
      topic: input.topic,
      payload: toJson(input.payload),
      idempotencyKey: input.idempotencyKey,
      availableAt: input.availableAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 8,
      correlationId: input.correlationId,
      source: input.source,
    },
  });
}

/**
 * Enqueues a tenant-scoped job inside the caller's transaction.
 * `ctx.organisationId` is what lands in the row — a caller cannot enqueue
 * for a different organisation, and `input` has no `organisationId` field
 * to override it with.
 */
export async function enqueueTenantJob(
  tx: Tx,
  ctx: TenantRepositoryContext,
  input: EnqueueJobInput,
): Promise<{ id: string }> {
  if (isReservedPlatformNamespace(input.topic)) {
    throw new OutboxTopicError(`Topic "${input.topic}" is reserved for platform jobs and cannot be tenant-scoped.`);
  }

  const existing = await findByIdempotencyKey(tx, input.topic, input.idempotencyKey);
  if (existing) {
    assertOwned(ctx, existing);
    return { id: existing.id };
  }

  try {
    const created = await insertMessage(tx, ctx.organisationId, input);
    return { id: created.id };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      const raced = await findByIdempotencyKey(tx, input.topic, input.idempotencyKey);
      return { id: assertOwned(ctx, raced).id };
    }
    throw error;
  }
}

/**
 * Enqueues a platform job (no tenant) inside the caller's transaction.
 * Only topics in `PLATFORM_JOB_TOPICS` are accepted — an unlisted topic
 * cannot be enqueued without a tenant context, by design.
 */
export async function enqueuePlatformJob(tx: Tx, input: EnqueueJobInput): Promise<{ id: string }> {
  if (!isPlatformJobTopic(input.topic)) {
    throw new OutboxTopicError(`Topic "${input.topic}" is not a declared platform job topic.`);
  }

  const existing = await findByIdempotencyKey(tx, input.topic, input.idempotencyKey);
  if (existing) return { id: existing.id };

  try {
    const created = await insertMessage(tx, null, input);
    return { id: created.id };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      const raced = await findByIdempotencyKey(tx, input.topic, input.idempotencyKey);
      if (raced) return { id: raced.id };
    }
    throw error;
  }
}

export interface LeaseBatchOptions {
  topics: string[];
  leaseOwner: string;
  leaseDurationSeconds: number;
  batchSize: number;
}

/**
 * Atomically claims up to `batchSize` due messages for `leaseOwner`.
 * Candidates are `PENDING`/`RETRY`/`LEASED`, due (`availableAt <= now()`),
 * and either never leased or past a stale `leaseUntil` — a crashed worker's
 * lease expires and the message becomes claimable again without any
 * recovery step (task T83 fix: `LEASED` was missing from this list, so a
 * message whose worker crashed after claiming it — never reaching
 * `completeJob`/`failJob` — stayed `LEASED` forever once its lease expired,
 * silently violating that exact guarantee; found by the T83 resume-after-
 * crash load test, `scripts/load-test/outbox-throughput.ts`).
 * `attempts` increments as part of the same claim, so a message that
 * is leased but never completed still counts toward `maxAttempts`.
 */
export async function leaseNextBatch(options: LeaseBatchOptions): Promise<OutboxMessageRecord[]> {
  if (options.topics.length === 0) return [];

  const topicsList = Prisma.join(options.topics);
  const rows = await prisma.$queryRaw<OutboxMessageRecord[]>(Prisma.sql`
    WITH candidate AS (
      SELECT "id" FROM "OutboxMessage"
      WHERE "status" IN ('PENDING', 'RETRY', 'LEASED')
        AND "availableAt" <= now()
        AND ("leaseUntil" IS NULL OR "leaseUntil" < now())
        AND "topic" IN (${topicsList})
      ORDER BY "availableAt" ASC
      LIMIT ${options.batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "OutboxMessage" m
    SET "status" = 'LEASED',
        "leaseOwner" = ${options.leaseOwner},
        "leaseUntil" = now() + (${options.leaseDurationSeconds}::text || ' seconds')::interval,
        "attempts" = m."attempts" + 1,
        "updatedAt" = now()
    FROM candidate c
    WHERE m."id" = c."id"
    RETURNING m.*;
  `);
  return rows;
}

/** Marks a leased message complete — a no-op if `leaseOwner` no longer matches (the lease expired and was reclaimed by another worker). */
export async function completeJob(messageId: string, leaseOwner: string): Promise<boolean> {
  const result = await prisma.outboxMessage.updateMany({
    where: { id: messageId, leaseOwner, status: "LEASED" },
    data: { status: "COMPLETED", completedAt: new Date(), leaseOwner: null, leaseUntil: null },
  });
  return result.count > 0;
}

export interface FailJobOptions {
  messageId: string;
  leaseOwner: string;
  error: JobError;
  /** Delay before the retried message becomes due again — exponential backoff is the caller's responsibility. */
  retryAfterMs: number;
}

/**
 * Marks a leased message failed. If `attempts` has reached `maxAttempts` the
 * message moves to `DEAD_LETTER` (a poison message that will never be
 * retried again); otherwise it moves to `RETRY` and becomes due again after
 * `retryAfterMs`. A no-op if `leaseOwner` no longer matches.
 */
export async function failJob(options: FailJobOptions): Promise<boolean> {
  const message = await prisma.outboxMessage.findFirst({
    where: { id: options.messageId, leaseOwner: options.leaseOwner, status: "LEASED" },
  });
  if (!message) return false;

  const isPoison = message.attempts >= message.maxAttempts;
  const result = await prisma.outboxMessage.updateMany({
    where: { id: options.messageId, leaseOwner: options.leaseOwner, status: "LEASED" },
    data: isPoison
      ? {
          status: "DEAD_LETTER",
          deadLetteredAt: new Date(),
          lastErrorCode: options.error.code,
          lastErrorMessage: options.error.message,
          leaseOwner: null,
          leaseUntil: null,
        }
      : {
          status: "RETRY",
          availableAt: new Date(Date.now() + options.retryAfterMs),
          lastErrorCode: options.error.code,
          lastErrorMessage: options.error.message,
          leaseOwner: null,
          leaseUntil: null,
        },
  });
  return result.count > 0;
}

/**
 * Requeues a `DEAD_LETTER` message for another attempt (task T83,
 * Docs/PHASE8_HARDENING_READINESS_SPEC.md §6 "outbox backlog/retry/dead-
 * letter/recovery"). Attempts resets to 0 so the message gets a fresh
 * `maxAttempts` budget rather than immediately dead-lettering again on its
 * next failure — an operator requeues a poison message only after fixing
 * whatever made it poison (a bad handler, a since-resolved provider outage),
 * so it deserves a clean slate, not its old attempt count.
 *
 * Scoped by `where: { status: "DEAD_LETTER" }`, so calling this twice on
 * the same message is safe: the first call moves it to `PENDING` and
 * returns `true`; the second finds no matching `DEAD_LETTER` row and
 * returns `false` rather than requeueing an already-requeued message.
 */
async function requeueDeadLetterRow(id: string): Promise<boolean> {
  const result = await prisma.outboxMessage.updateMany({
    where: { id, status: "DEAD_LETTER" },
    data: {
      status: "PENDING",
      attempts: 0,
      availableAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
      deadLetteredAt: null,
    },
  });
  return result.count > 0;
}

/** Tenant-scoped dead-letter requeue — denies a foreign-organisation id identically to a missing one. */
export async function requeueDeadLetterMessage(ctx: TenantRepositoryContext, id: string): Promise<boolean> {
  const message = await prisma.outboxMessage.findFirst({ where: { id } });
  assertOwned(ctx, message);
  return requeueDeadLetterRow(id);
}

/** Platform-operator dead-letter requeue for a platform job (e.g. `legal.sync`) — no tenant context to check. */
export async function requeuePlatformDeadLetterMessage(id: string): Promise<boolean> {
  const message = await prisma.outboxMessage.findFirst({ where: { id } });
  if (!message || message.organisationId !== null) return false;
  return requeueDeadLetterRow(id);
}

/** Tenant-scoped read — a foreign-organisation id is denied identically to a missing one. */
export async function getOutboxMessageForOrganisation(
  ctx: TenantRepositoryContext,
  id: string,
): Promise<OutboxMessageRecord> {
  const message = await prisma.outboxMessage.findFirst({ where: { id } });
  return assertOwned(ctx, message) as unknown as OutboxMessageRecord;
}

export interface ListOutboxMessagesFilter {
  topic?: string;
  status?: OutboxMessageRecord["status"];
  take?: number;
}

export async function listOutboxMessagesForOrganisation(
  ctx: TenantRepositoryContext,
  filter: ListOutboxMessagesFilter = {},
) {
  return prisma.outboxMessage.findMany({
    where: tenantWhere(ctx, {
      ...(filter.topic ? { topic: filter.topic } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    }),
    orderBy: { createdAt: "desc" },
    take: filter.take ?? 200,
  });
}

/**
 * Job worker (task T21). Runs one lease-process-complete/fail cycle over a
 * batch of due messages for a fixed set of topics. Deliberately a plain
 * function, not a long-running process abstraction — "use database-backed
 * jobs initially" (T21 scope) means the caller decides how it's invoked
 * (a cron-triggered route, a script, a queue consumer later).
 *
 * Every processed message gets a `JobRun` row recording what happened, so
 * "worker health" (recent failure rate, stuck workers) is derived from
 * `JobRun` history (see `health.ts`) rather than a separate heartbeat table.
 */

import { prisma } from "@/lib/prisma";
import { completeJob, failJob, leaseNextBatch } from "./outbox-service";
import type { JobError, JobHandler, OutboxMessageRecord } from "./types";
import { JobHandlerError } from "./types";

export interface WorkerHandlerRegistration {
  topic: string;
  handler: JobHandler;
}

export interface RunWorkerOnceOptions {
  handlers: WorkerHandlerRegistration[];
  workerId: string;
  batchSize?: number;
  leaseDurationSeconds?: number;
  /** Backoff for a retried message; a fixed delay is fine — Phase 2 spec does not require exponential backoff for T21. */
  retryAfterMs?: number;
}

export interface WorkerRunSummary {
  leased: number;
  succeeded: number;
  failed: number;
  deadLettered: number;
}

function toJobError(error: unknown): JobError {
  if (error instanceof JobHandlerError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: "HANDLER_ERROR", message: error.message };
  return { code: "HANDLER_ERROR", message: "Unknown handler error." };
}

async function recordJobRun(
  message: OutboxMessageRecord,
  workerId: string,
  outcome: { status: "SUCCEEDED" | "FAILED"; error?: JobError },
): Promise<void> {
  const now = new Date();
  await prisma.jobRun.create({
    data: {
      outboxMessageId: message.id,
      jobType: message.topic,
      organisationId: message.organisationId,
      workerId,
      correlationId: message.correlationId,
      status: outcome.status,
      startedAt: now,
      finishedAt: now,
      errorCode: outcome.error?.code ?? null,
      errorMessage: outcome.error?.message ?? null,
    },
  });
}

/**
 * Leases up to `batchSize` due messages across the registered topics and
 * runs each through its handler. A message whose topic has no registered
 * handler is left leased until its lease expires and is retried later —
 * that is a worker misconfiguration, not a poison message, so it should not
 * burn an attempt silently.
 */
export async function runWorkerOnce(options: RunWorkerOnceOptions): Promise<WorkerRunSummary> {
  const handlerByTopic = new Map(options.handlers.map((h) => [h.topic, h.handler] as const));
  const topics = [...handlerByTopic.keys()];

  const leased = await leaseNextBatch({
    topics,
    leaseOwner: options.workerId,
    leaseDurationSeconds: options.leaseDurationSeconds ?? 60,
    batchSize: options.batchSize ?? 10,
  });

  const summary: WorkerRunSummary = { leased: leased.length, succeeded: 0, failed: 0, deadLettered: 0 };

  for (const message of leased) {
    const handler = handlerByTopic.get(message.topic);
    if (!handler) continue;

    try {
      await handler(message);
      await completeJob(message.id, options.workerId);
      await recordJobRun(message, options.workerId, { status: "SUCCEEDED" });
      summary.succeeded += 1;
    } catch (rawError) {
      const error = toJobError(rawError);
      const wasPoison = message.attempts >= message.maxAttempts;
      await failJob({
        messageId: message.id,
        leaseOwner: options.workerId,
        error,
        retryAfterMs: options.retryAfterMs ?? 30_000,
      });
      await recordJobRun(message, options.workerId, { status: "FAILED", error });
      summary.failed += 1;
      if (wasPoison) summary.deadLettered += 1;
    }
  }

  return summary;
}

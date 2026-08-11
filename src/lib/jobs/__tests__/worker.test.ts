/**
 * Tests for the T21 job worker loop. Mocks `outbox-service` directly (its
 * own leasing/complete/fail semantics are covered by
 * outbox-service.test.ts) so this file only exercises the worker's
 * dispatch-to-handler, success/failure, and JobRun-recording behaviour.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutboxMessageRecord } from "@/lib/jobs/types";
import { JobHandlerError } from "@/lib/jobs/types";

const { jobRunCreate, leaseNextBatch, completeJob, failJob } = vi.hoisted(() => ({
  jobRunCreate: vi.fn(async () => ({ id: "job-run-1" })),
  leaseNextBatch: vi.fn(),
  completeJob: vi.fn(async () => true),
  failJob: vi.fn(async () => true),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { jobRun: { create: jobRunCreate } } }));
vi.mock("@/lib/jobs/outbox-service", () => ({ leaseNextBatch, completeJob, failJob }));

const { runWorkerOnce } = await import("@/lib/jobs/worker");

function message(overrides: Partial<OutboxMessageRecord> = {}): OutboxMessageRecord {
  return {
    id: "outbox-1",
    organisationId: "org-a",
    topic: "legal.sync",
    version: 1,
    payload: {},
    idempotencyKey: "key-1",
    status: "LEASED",
    availableAt: new Date(),
    leaseOwner: "worker-1",
    leaseUntil: new Date(Date.now() + 60_000),
    attempts: 1,
    maxAttempts: 8,
    lastErrorCode: null,
    lastErrorMessage: null,
    correlationId: "corr-1",
    source: "test",
    completedAt: null,
    deadLetteredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("runWorkerOnce", () => {
  beforeEach(() => {
    jobRunCreate.mockClear();
    leaseNextBatch.mockReset();
    completeJob.mockClear();
    failJob.mockClear();
  });

  it("completes a message the handler resolves successfully", async () => {
    leaseNextBatch.mockResolvedValueOnce([message()]);
    const handler = vi.fn(async () => {});

    const summary = await runWorkerOnce({ handlers: [{ topic: "legal.sync", handler }], workerId: "worker-1" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(completeJob).toHaveBeenCalledWith("outbox-1", "worker-1");
    expect(failJob).not.toHaveBeenCalled();
    expect(summary).toEqual({ leased: 1, succeeded: 1, failed: 0, deadLettered: 0 });
    expect(jobRunCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED", outboxMessageId: "outbox-1" }) }),
    );
  });

  it("fails a message whose handler throws a structured JobHandlerError", async () => {
    leaseNextBatch.mockResolvedValueOnce([message({ attempts: 1, maxAttempts: 8 })]);
    const handler = vi.fn(async () => {
      throw new JobHandlerError("LEGAL_SOURCE_UNAVAILABLE", "Upstream source timed out.");
    });

    const summary = await runWorkerOnce({ handlers: [{ topic: "legal.sync", handler }], workerId: "worker-1" });

    expect(completeJob).not.toHaveBeenCalled();
    expect(failJob).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "outbox-1",
        leaseOwner: "worker-1",
        error: { code: "LEGAL_SOURCE_UNAVAILABLE", message: "Upstream source timed out." },
      }),
    );
    expect(summary).toEqual({ leased: 1, succeeded: 0, failed: 1, deadLettered: 0 });
  });

  it("marks the run summary dead-lettered when the failed message had exhausted attempts", async () => {
    leaseNextBatch.mockResolvedValueOnce([message({ attempts: 8, maxAttempts: 8 })]);
    const handler = vi.fn(async () => {
      throw new Error("boom");
    });

    const summary = await runWorkerOnce({ handlers: [{ topic: "legal.sync", handler }], workerId: "worker-1" });

    expect(summary.deadLettered).toBe(1);
    expect(summary.failed).toBe(1);
  });

  it("leaves a message with no registered handler leased rather than burning an attempt", async () => {
    leaseNextBatch.mockResolvedValueOnce([message({ topic: "unregistered.topic" })]);

    const summary = await runWorkerOnce({ handlers: [{ topic: "legal.sync", handler: vi.fn() }], workerId: "worker-1" });

    expect(completeJob).not.toHaveBeenCalled();
    expect(failJob).not.toHaveBeenCalled();
    expect(summary).toEqual({ leased: 1, succeeded: 0, failed: 0, deadLettered: 0 });
  });

  it("only leases topics that have a registered handler", async () => {
    leaseNextBatch.mockResolvedValueOnce([]);
    await runWorkerOnce({
      handlers: [
        { topic: "legal.sync", handler: vi.fn() },
        { topic: "reminder.dispatch", handler: vi.fn() },
      ],
      workerId: "worker-1",
    });

    expect(leaseNextBatch).toHaveBeenCalledWith(
      expect.objectContaining({ topics: expect.arrayContaining(["legal.sync", "reminder.dispatch"]) }),
    );
  });
});

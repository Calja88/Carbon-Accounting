/**
 * Repository-layer tests for the T21 transactional outbox
 * (Docs/PHASE2_EMS_FOUNDATION_SPEC.md §6; T21 acceptance: "two workers
 * cannot process one lease concurrently; retries are idempotent; poison job
 * reaches dead-letter state; tenant context is explicit on tenant jobs").
 * No live database — a synthetic in-memory fake stands in for `prisma`,
 * matching the pattern in audit-repository.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import { contextA, contextB, ORG_A } from "@/lib/__tests__/tenant-fixtures";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";

interface FakeRow {
  id: string;
  organisationId: string | null;
  topic: string;
  version: number;
  payload: unknown;
  idempotencyKey: string;
  status: string;
  availableAt: Date;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  attempts: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  correlationId: string;
  source: string;
  completedAt: Date | null;
  deadLetteredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const { rows, db } = vi.hoisted(() => {
  const rows: FakeRow[] = [];
  let nextId = 1;

  function matches(row: FakeRow, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value && typeof value === "object" && "lt" in (value as Record<string, unknown>)) {
        const rowValue = (row as unknown as Record<string, unknown>)[key];
        return rowValue instanceof Date && rowValue < (value as { lt: Date }).lt;
      }
      return (row as unknown as Record<string, unknown>)[key] === value;
    });
  }

  const outboxMessage = {
    create: vi.fn(async ({ data }: { data: Partial<FakeRow> }) => {
      const existingDuplicate = rows.find((r) => r.topic === data.topic && r.idempotencyKey === data.idempotencyKey);
      if (existingDuplicate) {
        const err = new Error("Unique constraint failed") as Error & { code: string };
        err.code = "P2002";
        throw err;
      }
      const now = new Date();
      const row: FakeRow = {
        id: `outbox-${nextId++}`,
        organisationId: data.organisationId ?? null,
        topic: data.topic!,
        version: 1,
        payload: data.payload ?? {},
        idempotencyKey: data.idempotencyKey!,
        status: "PENDING",
        availableAt: data.availableAt ?? now,
        leaseOwner: null,
        leaseUntil: null,
        attempts: 0,
        maxAttempts: data.maxAttempts ?? 8,
        lastErrorCode: null,
        lastErrorMessage: null,
        correlationId: data.correlationId!,
        source: data.source!,
        completedAt: null,
        deadLetteredAt: null,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(row);
      return row;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return rows.find((r) => matches(r, where)) ?? null;
    }),
    findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
      const found = rows.filter((r) => matches(r, where));
      return take ? found.slice(0, take) : found;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<FakeRow> }) => {
      const targets = rows.filter((r) => matches(r, where));
      for (const row of targets) Object.assign(row, data);
      return { count: targets.length };
    }),
  };

  const jobRun = { create: vi.fn(async () => ({ id: "job-run-1" })) };

  const db = { outboxMessage, jobRun, $queryRaw: vi.fn() };
  return { rows, db };
});

vi.mock("@/lib/prisma", () => ({ prisma: db }));

const {
  enqueueTenantJob,
  enqueuePlatformJob,
  completeJob,
  failJob,
  getOutboxMessageForOrganisation,
  listOutboxMessagesForOrganisation,
  requeueDeadLetterMessage,
  requeuePlatformDeadLetterMessage,
  OutboxTopicError,
} = await import("@/lib/jobs/outbox-service");

function baseInput(overrides: Partial<Parameters<typeof enqueueTenantJob>[2]> = {}) {
  return {
    topic: "legal.sync",
    payload: { sourceId: "source-1" },
    idempotencyKey: "sync-1",
    correlationId: "corr-1",
    source: "test",
    ...overrides,
  };
}

describe("enqueueTenantJob", () => {
  it("writes the caller's organisationId, never an override", async () => {
    rows.length = 0;
    const { id } = await enqueueTenantJob(db as never, contextA, baseInput());
    const row = rows.find((r) => r.id === id)!;
    expect(row.organisationId).toBe(ORG_A);
  });

  it("is idempotent: re-enqueueing the same (topic, idempotencyKey) returns the existing message", async () => {
    rows.length = 0;
    const first = await enqueueTenantJob(db as never, contextA, baseInput());
    const second = await enqueueTenantJob(db as never, contextA, baseInput());
    expect(second.id).toBe(first.id);
    expect(rows).toHaveLength(1);
  });

  it("rejects a reserved platform.* topic", async () => {
    rows.length = 0;
    await expect(
      enqueueTenantJob(db as never, contextA, baseInput({ topic: "platform.outbox_backlog_sweep" })),
    ).rejects.toThrow(OutboxTopicError);
  });

  it("denies reading another organisation's idempotency-key match", async () => {
    rows.length = 0;
    await enqueueTenantJob(db as never, contextA, baseInput());
    await expect(enqueueTenantJob(db as never, contextB, baseInput())).rejects.toThrow(TenantOwnershipError);
  });
});

describe("enqueuePlatformJob", () => {
  it("accepts a declared platform topic with no organisationId", async () => {
    rows.length = 0;
    const { id } = await enqueuePlatformJob(db as never, baseInput({ topic: "platform.outbox_backlog_sweep" }));
    const row = rows.find((r) => r.id === id)!;
    expect(row.organisationId).toBeNull();
  });

  it("rejects an undeclared topic", async () => {
    rows.length = 0;
    await expect(enqueuePlatformJob(db as never, baseInput({ topic: "not.declared" }))).rejects.toThrow(
      OutboxTopicError,
    );
  });
});

describe("completeJob / failJob", () => {
  async function leasedMessage(overrides: Partial<FakeRow> = {}) {
    const { id } = await enqueueTenantJob(db as never, contextA, baseInput());
    const row = rows.find((r) => r.id === id)!;
    Object.assign(row, { status: "LEASED", leaseOwner: "worker-1", attempts: 1, ...overrides });
    return row;
  }

  it("completes only when leaseOwner matches", async () => {
    rows.length = 0;
    const row = await leasedMessage();
    const wrongOwner = await completeJob(row.id, "worker-2");
    expect(wrongOwner).toBe(false);
    expect(row.status).toBe("LEASED");

    const rightOwner = await completeJob(row.id, "worker-1");
    expect(rightOwner).toBe(true);
    expect(row.status).toBe("COMPLETED");
    expect(row.leaseOwner).toBeNull();
  });

  it("moves to RETRY with a later availableAt when attempts remain", async () => {
    rows.length = 0;
    const row = await leasedMessage({ attempts: 1, maxAttempts: 8 });
    const before = row.availableAt.getTime();

    const ok = await failJob({ messageId: row.id, leaseOwner: "worker-1", error: { code: "E1", message: "boom" }, retryAfterMs: 5000 });
    expect(ok).toBe(true);
    expect(row.status).toBe("RETRY");
    expect(row.availableAt.getTime()).toBeGreaterThan(before);
    expect(row.lastErrorCode).toBe("E1");
  });

  it("moves a poison job to DEAD_LETTER once attempts reach maxAttempts", async () => {
    rows.length = 0;
    const row = await leasedMessage({ attempts: 8, maxAttempts: 8 });

    await failJob({ messageId: row.id, leaseOwner: "worker-1", error: { code: "E1", message: "boom" }, retryAfterMs: 5000 });
    expect(row.status).toBe("DEAD_LETTER");
    expect(row.deadLetteredAt).not.toBeNull();
  });

  it("is a no-op when the lease was reclaimed by another worker", async () => {
    rows.length = 0;
    const row = await leasedMessage({ leaseOwner: "worker-2" });
    const ok = await failJob({ messageId: row.id, leaseOwner: "worker-1", error: { code: "E1", message: "boom" }, retryAfterMs: 5000 });
    expect(ok).toBe(false);
    expect(row.status).toBe("LEASED");
  });
});

describe("requeueDeadLetterMessage / requeuePlatformDeadLetterMessage (T83)", () => {
  async function deadLetteredTenantMessage() {
    const { id } = await enqueueTenantJob(db as never, contextA, baseInput());
    const row = rows.find((r) => r.id === id)!;
    Object.assign(row, {
      status: "DEAD_LETTER",
      attempts: 8,
      maxAttempts: 8,
      lastErrorCode: "E1",
      lastErrorMessage: "boom",
      deadLetteredAt: new Date(),
    });
    return row;
  }

  it("moves a tenant DEAD_LETTER message back to PENDING with a reset attempt count", async () => {
    rows.length = 0;
    const row = await deadLetteredTenantMessage();

    const ok = await requeueDeadLetterMessage(contextA, row.id);
    expect(ok).toBe(true);
    expect(row.status).toBe("PENDING");
    expect(row.attempts).toBe(0);
    expect(row.lastErrorCode).toBeNull();
    expect(row.deadLetteredAt).toBeNull();
  });

  it("is idempotent: requeueing an already-requeued message is a no-op", async () => {
    rows.length = 0;
    const row = await deadLetteredTenantMessage();

    expect(await requeueDeadLetterMessage(contextA, row.id)).toBe(true);
    expect(await requeueDeadLetterMessage(contextA, row.id)).toBe(false);
    expect(row.status).toBe("PENDING");
  });

  it("denies requeueing another organisation's dead-lettered message", async () => {
    rows.length = 0;
    const row = await deadLetteredTenantMessage();
    await expect(requeueDeadLetterMessage(contextB, row.id)).rejects.toThrow(TenantOwnershipError);
    expect(row.status).toBe("DEAD_LETTER");
  });

  it("requeues a dead-lettered platform job with no organisationId", async () => {
    rows.length = 0;
    const { id } = await enqueuePlatformJob(db as never, baseInput({ topic: "legal.sync" }));
    const row = rows.find((r) => r.id === id)!;
    Object.assign(row, { status: "DEAD_LETTER", attempts: 8, maxAttempts: 8, deadLetteredAt: new Date() });

    const ok = await requeuePlatformDeadLetterMessage(row.id);
    expect(ok).toBe(true);
    expect(row.status).toBe("PENDING");
    expect(row.attempts).toBe(0);
  });

  it("refuses to requeue a tenant message through the platform entry point", async () => {
    rows.length = 0;
    const row = await deadLetteredTenantMessage();
    const ok = await requeuePlatformDeadLetterMessage(row.id);
    expect(ok).toBe(false);
    expect(row.status).toBe("DEAD_LETTER");
  });
});

describe("tenant-scoped reads", () => {
  it("denies a foreign-organisation message id identically to a missing one", async () => {
    rows.length = 0;
    const { id } = await enqueueTenantJob(db as never, contextA, baseInput());
    await expect(getOutboxMessageForOrganisation(contextB, id)).rejects.toThrow(TenantOwnershipError);
    await expect(getOutboxMessageForOrganisation(contextB, "does-not-exist")).rejects.toThrow(TenantOwnershipError);
  });

  it("scopes listOutboxMessagesForOrganisation to the caller's organisation only", async () => {
    rows.length = 0;
    await enqueueTenantJob(db as never, contextA, baseInput());
    await enqueueTenantJob(db as never, contextB, baseInput({ idempotencyKey: "sync-2" }));

    const forA = await listOutboxMessagesForOrganisation(contextA);
    expect(forA).toHaveLength(1);
    expect(forA[0].organisationId).toBe(ORG_A);
  });
});

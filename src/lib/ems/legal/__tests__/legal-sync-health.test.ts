/**
 * Tests for the T42 legal sync health snapshot
 * (Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md §9 "provider health and
 * stale-cursor alerts"). No live database — a synthetic in-memory fake
 * stands in for `prisma`, matching the pattern in `legal-sync-worker.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface ProviderRow {
  key: string;
  name: string;
  status: string;
  cursors: CursorRow[];
}

interface CursorRow {
  id: string;
  stream: string;
  filterKey: string;
  status: string;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  overlapStartAt: Date | null;
}

interface OutboxRow {
  topic: string;
  status: string;
}

interface JobRunRow {
  jobType: string;
  status: string;
  startedAt: Date;
}

const { providerRows, outboxRows, jobRunRows, db } = vi.hoisted(() => {
  const providerRows: ProviderRow[] = [];
  const outboxRows: OutboxRow[] = [];
  const jobRunRows: JobRunRow[] = [];

  function matchesGte(rows: JobRunRow[], where: Record<string, unknown>) {
    return rows.filter((row) => {
      if (where.jobType !== undefined && row.jobType !== where.jobType) return false;
      if (where.status !== undefined && row.status !== where.status) return false;
      const startedAt = where.startedAt as { gte?: Date } | undefined;
      if (startedAt?.gte && row.startedAt < startedAt.gte) return false;
      return true;
    });
  }

  const db = {
    legalSourceProvider: {
      findMany: vi.fn(async () => providerRows.map((p) => ({ ...p, cursors: [...p.cursors] }))),
    },
    outboxMessage: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        outboxRows.filter((row) => (where.topic === undefined || row.topic === where.topic) && (where.status === undefined || row.status === where.status)).length,
      ),
    },
    jobRun: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => matchesGte(jobRunRows, where).length),
    },
  };

  return { providerRows, outboxRows, jobRunRows, db };
});

vi.mock("@/lib/prisma", () => ({ prisma: db }));

const { getLegalSyncHealth, DEFAULT_STALE_AFTER_MS } = await import("@/lib/ems/legal/legal-sync-health");
const { LEGAL_SYNC_JOB_TOPIC } = await import("@/lib/ems/legal/legal-sync-worker");

function resetAll() {
  providerRows.length = 0;
  outboxRows.length = 0;
  jobRunRows.length = 0;
}

describe("getLegalSyncHealth", () => {
  beforeEach(() => resetAll());

  it("marks a cursor with no successful sync as stale, with a diagnostic", async () => {
    providerRows.push({
      key: "legislation-gov-uk",
      name: "legislation.gov.uk",
      status: "ENABLED",
      cursors: [
        { id: "cursor-1", stream: "PUBLICATIONS", filterKey: "", status: "ACTIVE", lastSuccessAt: null, lastAttemptAt: null, overlapStartAt: null },
      ],
    });

    const health = await getLegalSyncHealth(new Date("2026-01-10T00:00:00Z"));

    expect(health.providers).toHaveLength(1);
    const cursor = health.providers[0].cursors[0];
    expect(cursor.isStale).toBe(true);
    expect(cursor.diagnostic).toMatch(/never synced/i);
  });

  it("marks a recently-successful cursor as healthy with no diagnostic", async () => {
    const now = new Date("2026-01-10T00:00:00Z");
    providerRows.push({
      key: "legislation-gov-uk",
      name: "legislation.gov.uk",
      status: "ENABLED",
      cursors: [
        {
          id: "cursor-1",
          stream: "PUBLICATIONS",
          filterKey: "",
          status: "ACTIVE",
          lastSuccessAt: new Date(now.getTime() - 60_000),
          lastAttemptAt: new Date(now.getTime() - 60_000),
          overlapStartAt: new Date(now.getTime() - 60_000),
        },
      ],
    });

    const health = await getLegalSyncHealth(now);
    const cursor = health.providers[0].cursors[0];
    expect(cursor.isStale).toBe(false);
    expect(cursor.diagnostic).toBeNull();
  });

  it("marks a cursor stale once its last success is older than the staleness threshold", async () => {
    const now = new Date("2026-01-10T00:00:00Z");
    providerRows.push({
      key: "legislation-gov-uk",
      name: "legislation.gov.uk",
      status: "ENABLED",
      cursors: [
        {
          id: "cursor-1",
          stream: "PUBLICATIONS",
          filterKey: "",
          status: "ACTIVE",
          lastSuccessAt: new Date(now.getTime() - DEFAULT_STALE_AFTER_MS - 1),
          lastAttemptAt: new Date(now.getTime() - DEFAULT_STALE_AFTER_MS - 1),
          overlapStartAt: null,
        },
      ],
    });

    const health = await getLegalSyncHealth(now);
    expect(health.providers[0].cursors[0].isStale).toBe(true);
  });

  it("surfaces an ERROR-status cursor with an error diagnostic regardless of staleness", async () => {
    const now = new Date("2026-01-10T00:00:00Z");
    providerRows.push({
      key: "legislation-gov-uk",
      name: "legislation.gov.uk",
      status: "ENABLED",
      cursors: [
        {
          id: "cursor-1",
          stream: "EFFECTS",
          filterKey: "",
          status: "ERROR",
          lastSuccessAt: new Date(now.getTime() - 60_000),
          lastAttemptAt: now,
          overlapStartAt: null,
        },
      ],
    });

    const health = await getLegalSyncHealth(now);
    expect(health.providers[0].cursors[0].diagnostic).toMatch(/failed/i);
  });

  it("counts legal.sync jobs by status, ignoring other topics", async () => {
    outboxRows.push(
      { topic: LEGAL_SYNC_JOB_TOPIC, status: "PENDING" },
      { topic: LEGAL_SYNC_JOB_TOPIC, status: "DEAD_LETTER" },
      { topic: LEGAL_SYNC_JOB_TOPIC, status: "DEAD_LETTER" },
      { topic: "reminder.dispatch", status: "DEAD_LETTER" },
    );
    const now = new Date("2026-01-10T00:00:00Z");
    jobRunRows.push(
      { jobType: LEGAL_SYNC_JOB_TOPIC, status: "SUCCEEDED", startedAt: new Date(now.getTime() - 30_000) },
      { jobType: LEGAL_SYNC_JOB_TOPIC, status: "FAILED", startedAt: new Date(now.getTime() - 30_000) },
      { jobType: "reminder.dispatch", status: "FAILED", startedAt: new Date(now.getTime() - 30_000) },
    );

    const health = await getLegalSyncHealth(now);

    expect(health.pendingJobs).toBe(1);
    expect(health.deadLetteredJobs).toBe(2);
    expect(health.recentJobRuns).toBe(2);
    expect(health.recentJobFailures).toBe(1);
  });
});

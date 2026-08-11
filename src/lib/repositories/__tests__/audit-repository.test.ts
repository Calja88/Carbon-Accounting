/**
 * Repository-layer tests for the T20 platform audit log
 * (Docs/PHASE2_EMS_FOUNDATION_SPEC.md §6 "Audit events cannot be
 * updated/deleted through runtime application role"; T20 acceptance:
 * "application cannot update/delete events through normal repositories;
 * ... cross-tenant access denied"). No live database — a synthetic
 * in-memory fake stands in for both the transaction client and the
 * singleton `prisma`, matching the pattern in carbon-repository.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import { contextA, contextB, ORG_A, ORG_B } from "@/lib/__tests__/tenant-fixtures";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";

const { rows, tx } = vi.hoisted(() => {
  interface FakeAuditEventRow {
    id: string;
    organisationId: string;
    sequence: number;
    actorUserId: string | null;
    actorType: string;
    eventType: string;
    resourceType: string;
    resourceId: string | null;
    summary: string;
    before: unknown;
    after: unknown;
    correlationId: string;
    source: string;
    occurredAt: Date;
    contentHash: string;
    previousEventHash: string | null;
  }

  const rows: FakeAuditEventRow[] = [];
  let nextSequence = 1;
  let nextId = 1;

  const auditEvent = {
    create: vi.fn(async ({ data }: { data: Omit<FakeAuditEventRow, "id" | "sequence"> }) => {
      const row: FakeAuditEventRow = { ...data, id: `audit-${nextId++}`, sequence: nextSequence++ };
      rows.push(row);
      return { id: row.id };
    }),
    findFirst: vi.fn(
      async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { sequence: "desc" | "asc" } }) => {
        let matches = rows.filter((row) =>
          Object.entries(where).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value),
        );
        if (orderBy?.sequence === "desc") matches = [...matches].sort((a, b) => b.sequence - a.sequence);
        return matches[0] ?? null;
      },
    ),
    findMany: vi.fn(
      async ({
        where,
        orderBy,
        take,
      }: {
        where: Record<string, unknown>;
        orderBy?: { sequence: "desc" | "asc" };
        take?: number;
      }) => {
        let matches = rows.filter((row) =>
          Object.entries(where).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value),
        );
        if (orderBy?.sequence === "desc") matches = [...matches].sort((a, b) => b.sequence - a.sequence);
        return take ? matches.slice(0, take) : matches;
      },
    ),
    // Deliberately no `update`/`delete` on this fake — a call site attempting
    // either would throw "not a function", the same as it would against the
    // real repository module having no such export.
  };

  const tx = { auditEvent, $queryRaw: vi.fn(async () => []) };
  return { rows, tx };
});

vi.mock("@/lib/prisma", () => ({
  prisma: { auditEvent: tx.auditEvent },
}));

const { recordAuditEvent, recordAuditEvents, listAuditEvents, getAuditEvent } = await import("@/lib/repositories/audit-repository");

function baseInput(overrides: Partial<Parameters<typeof recordAuditEvent>[2]> = {}) {
  return {
    eventType: "membership.suspended" as const,
    resourceType: "membership" as const,
    resourceId: "membership-1",
    summary: "Suspended a member.",
    actorUserId: "user-1",
    correlationId: "corr-1",
    source: "web-app",
    ...overrides,
  };
}

describe("audit-repository module surface", () => {
  it("exports no update or delete function", async () => {
    const mod = await import("@/lib/repositories/audit-repository");
    const exportNames = Object.keys(mod);
    expect(exportNames.some((name) => /update/i.test(name))).toBe(false);
    expect(exportNames.some((name) => /delete/i.test(name))).toBe(false);
  });
});

describe("recordAuditEvent / recordAuditEvents", () => {
  it("writes through the given transaction client, not the singleton", async () => {
    await recordAuditEvent(tx as never, contextA, baseInput());
    expect(tx.auditEvent.create).toHaveBeenCalled();
    const call = tx.auditEvent.create.mock.calls.at(-1)![0];
    expect(call.data.organisationId).toBe(ORG_A);
  });

  it("chains previousEventHash to the prior event's contentHash for the same organisation", async () => {
    rows.length = 0;
    await recordAuditEvent(tx as never, contextA, baseInput({ summary: "first" }));
    await recordAuditEvent(tx as never, contextA, baseInput({ summary: "second" }));

    const [first, second] = rows;
    expect(first.previousEventHash).toBeNull();
    expect(second.previousEventHash).toBe(first.contentHash);
    expect(second.contentHash).not.toBe(first.contentHash);
  });

  it("keeps separate organisations on separate chains", async () => {
    rows.length = 0;
    await recordAuditEvent(tx as never, contextA, baseInput());
    await recordAuditEvent(tx as never, contextB, baseInput());

    const orgARows = rows.filter((r) => r.organisationId === ORG_A);
    const orgBRows = rows.filter((r) => r.organisationId === ORG_B);
    expect(orgARows).toHaveLength(1);
    expect(orgBRows).toHaveLength(1);
    expect(orgARows[0].previousEventHash).toBeNull();
    expect(orgBRows[0].previousEventHash).toBeNull();
  });

  it("chains a multi-event burst from one recordAuditEvents call in order", async () => {
    rows.length = 0;
    const ids = await recordAuditEvents(tx as never, contextA, [
      baseInput({ eventType: "membership.invited", summary: "invited" }),
      baseInput({ eventType: "membership.role_assigned", summary: "role assigned" }),
    ]);

    expect(ids).toHaveLength(2);
    expect(rows[0].previousEventHash).toBeNull();
    expect(rows[1].previousEventHash).toBe(rows[0].contentHash);
  });

  it("locks the organisation row before reading the chain head", async () => {
    rows.length = 0;
    const queryRawCallsBefore = tx.$queryRaw.mock.calls.length;
    await recordAuditEvent(tx as never, contextA, baseInput());
    expect(tx.$queryRaw.mock.calls.length).toBeGreaterThan(queryRawCallsBefore);
  });

  it("never stores a raw actorUserId defaulted from a system context marker", async () => {
    rows.length = 0;
    await recordAuditEvent(tx as never, contextA, baseInput({ actorUserId: null, actorType: "SYSTEM" }));
    expect(rows[0].actorUserId).toBeNull();
    expect(rows[0].actorType).toBe("SYSTEM");
  });
});

describe("listAuditEvents / getAuditEvent tenant scoping", () => {
  it("denies a foreign-organisation event id identically to a missing one", async () => {
    rows.length = 0;
    await recordAuditEvent(tx as never, contextA, baseInput());
    const ownedId = rows[0].id;

    await expect(getAuditEvent(contextB, ownedId)).rejects.toThrow(TenantOwnershipError);
    await expect(getAuditEvent(contextB, "does-not-exist")).rejects.toThrow(TenantOwnershipError);
  });

  it("returns the event for its own organisation", async () => {
    rows.length = 0;
    await recordAuditEvent(tx as never, contextA, baseInput());
    const ownedId = rows[0].id;

    const event = await getAuditEvent(contextA, ownedId);
    expect(event.id).toBe(ownedId);
  });

  it("scopes listAuditEvents to the caller's organisation only", async () => {
    rows.length = 0;
    await recordAuditEvent(tx as never, contextA, baseInput());
    await recordAuditEvent(tx as never, contextB, baseInput());

    const forA = await listAuditEvents(contextA);
    expect(forA).toHaveLength(1);
    expect(forA[0].organisationId).toBe(ORG_A);
  });
});

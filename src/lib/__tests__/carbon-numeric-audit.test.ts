/**
 * Carbon Phase 4-i: the corporate carbon numeric write paths must emit
 * hash-chained audit events, and must do so without moving a single figure
 * (Docs/CARBON_PHASE4_I_NUMERIC_AUDIT.md).
 *
 * No live database — Prisma is replaced with an in-memory fake that records
 * the audit rows the production code writes. Synthetic fixtures only.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { ORG_A, makeTenantContext } from "@/lib/__tests__/tenant-fixtures";
import { calculateEmission } from "@/lib/calc-engine";

type Row = Record<string, unknown>;

const tables = vi.hoisted(() => ({
  entries: [] as Row[],
  calculations: [] as Row[],
  factorSets: [] as Row[],
  factors: [] as Row[],
  audit: [] as Row[],
  sites: [] as Row[],
  dataPoints: [] as Row[],
  nextId: 1,
}));

vi.mock("@/lib/rbac/authorize", () => ({
  requirePermission: vi.fn(),
  PermissionDeniedError: class extends Error {},
}));

vi.mock("@/lib/prisma", () => {
  const auditEvent = {
    findFirst: vi.fn(async () => tables.audit[tables.audit.length - 1] ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `audit-${tables.nextId++}`, ...data };
      tables.audit.push(row);
      return row;
    }),
  };
  const activityEntry = {
    // Hydrates the relations the calculation path `include`s, so the fake
    // row looks like what Prisma would hand back.
    findFirst: vi.fn(async ({ where }: { where: Row }) => {
      if (!where.id) return null;
      const row = tables.entries.find((e) => e.id === where.id);
      if (!row) return null;
      return {
        ...row,
        activityDataPoint: tables.dataPoints.find((d) => d.id === row.activityDataPointId) ?? null,
        factorOption: null,
        site: tables.sites.find((s) => s.id === row.siteId) ?? null,
      };
    }),
    findMany: vi.fn(async ({ where }: { where: Row }) =>
      tables.entries.filter((e) => e.status === where.status && e.organisationId === where.organisationId),
    ),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `entry-${tables.nextId++}`, ...data };
      tables.entries.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const row = tables.entries.find((e) => e.id === where.id);
      Object.assign(row!, data);
      return row;
    }),
  };
  const calculation = {
    findMany: vi.fn(async ({ where }: { where: Row }) =>
      tables.calculations.filter((c) => c.activityEntryId === where.activityEntryId && c.derivedFromCalculationId == null),
    ),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `calc-${tables.nextId++}`, ...data };
      tables.calculations.push(row);
      return row;
    }),
  };

  const prismaClient: Row = {
    auditEvent,
    activityEntry,
    calculation,
    site: { findFirst: vi.fn(async () => tables.sites[0] ?? null) },
    activityDataPoint: { findUniqueOrThrow: vi.fn(async () => tables.dataPoints[0]) },
    emissionFactorSet: { findFirst: vi.fn(async () => tables.factorSets[0] ?? null) },
    emissionFactor: { findFirst: vi.fn(async () => tables.factors[0] ?? null) },
    $queryRaw: vi.fn(async () => [{ id: "locked" }]),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ ...prismaClient, $queryRaw: vi.fn(async () => [{ id: "locked" }]) }),
    ),
  };
  return { prisma: prismaClient };
});

const { createActivityEntryWithCalculations, runCalculationsForEntry, recalculatePendingEntries, prepareReportingData } =
  await import("@/lib/entries-service");

const ctx = makeTenantContext(ORG_A, { userId: "user-1", correlationId: "corr-user-1" });

const DATA_POINT: Row = {
  id: "dp-1",
  code: "S1-01",
  scope: "SCOPE_1",
  factorCategory: "stationary_combustion_diesel",
  scope3Category: null,
  formType: "QUANTITY",
  defaultTier: "TIER_2",
  frequency: "Monthly",
  factorOptions: [],
};

const FACTOR_SET: Row = { id: "set-1", name: "DEFRA 2024", vintageYear: 2024, isPlaceholder: false };
const FACTOR: Row = { id: "factor-1", basis: "STANDARD", unit: "litres", co2eFactor: "2.5", factorSetId: "set-1" };

function resetTables(withFactor: boolean) {
  tables.entries.length = 0;
  tables.calculations.length = 0;
  tables.audit.length = 0;
  tables.sites.length = 0;
  tables.dataPoints.length = 0;
  tables.factorSets.length = 0;
  tables.factors.length = 0;
  tables.nextId = 1;
  tables.sites.push({ id: "site-1", organisationId: ORG_A });
  tables.dataPoints.push(DATA_POINT);
  if (withFactor) {
    tables.factorSets.push(FACTOR_SET);
    tables.factors.push(FACTOR);
  }
}

const eventsOfType = (type: string) => tables.audit.filter((e) => e.eventType === type);

const createInput = {
  activityDataPointId: "dp-1",
  siteId: "site-1",
  periodStart: new Date(Date.UTC(2026, 0, 1)),
  periodEnd: new Date(Date.UTC(2026, 0, 31)),
  rawValue: 100,
  rawUnit: "litres",
  enteredByUserId: "user-1",
};

describe("Phase 4-i: activity entry creation is audited", () => {
  beforeEach(() => resetTables(true));

  it("emits activity_entry.created naming the entry, site, period and value", async () => {
    const { entry } = await createActivityEntryWithCalculations(ctx, createInput);

    const [event] = eventsOfType("activity_entry.created");
    expect(event).toBeDefined();
    expect(event.resourceType).toBe("activity_entry");
    expect(event.resourceId).toBe(entry.id);
    expect(event.organisationId).toBe(ORG_A);

    const after = event.after as Row;
    expect(after.siteId).toBe("site-1");
    expect(after.activityDataPointCode).toBe("S1-01");
    expect(after.periodStart).toBe("2026-01-01T00:00:00.000Z");
    expect(after.periodEnd).toBe("2026-01-31T00:00:00.000Z");
    expect(after.canonicalValue).toBe("100");
    expect(after.status).toBe("SUBMITTED");
  });

  it("emits calculation.created carrying the factor identifiers and the result", async () => {
    await createActivityEntryWithCalculations(ctx, createInput);

    const [event] = eventsOfType("calculation.created");
    expect(event).toBeDefined();
    expect(event.resourceType).toBe("calculation");
    expect(event.resourceId).toBe(tables.calculations[0].id);

    const after = event.after as Row;
    expect(after.scope).toBe("SCOPE_1");
    expect(after.basis).toBe("STANDARD");
    expect(after.emissionFactorId).toBe("factor-1");
    expect(after.factorSourceSnapshot).toBe("DEFRA 2024");
    expect(after.factorVintageSnapshot).toBe("2024");
    expect(after.resultKgCo2e).toBe(String(tables.calculations[0].resultKgCo2e));
  });

  it("chains every event of one operation onto one correlation id and one hash chain", async () => {
    await createActivityEntryWithCalculations(ctx, createInput);

    expect(tables.audit.length).toBeGreaterThanOrEqual(2);
    expect(tables.audit.every((e) => e.correlationId === "corr-user-1")).toBe(true);
    // Each event links to the one before it; the first opens the chain.
    expect(tables.audit[0].previousEventHash).toBeNull();
    for (let i = 1; i < tables.audit.length; i++) {
      expect(tables.audit[i].previousEventHash).toBe(tables.audit[i - 1].contentHash);
    }
  });

  it("records a real user as the actor, never a system marker", async () => {
    await createActivityEntryWithCalculations(ctx, createInput);
    expect(tables.audit.every((e) => e.actorType === "USER")).toBe(true);
    expect(tables.audit.every((e) => e.actorUserId === "user-1")).toBe(true);
  });
});

describe("Phase 4-i: a missing factor is audited, never silent", () => {
  beforeEach(() => resetTables(false));

  it("emits calculation.awaiting_factor with the before/after status and a reason", async () => {
    const { calculations } = await createActivityEntryWithCalculations(ctx, createInput);
    expect(calculations).toEqual([]);

    const [event] = eventsOfType("calculation.awaiting_factor");
    expect(event).toBeDefined();
    expect(event.resourceType).toBe("activity_entry");
    expect(event.before).toEqual({ status: "SUBMITTED" });

    const after = event.after as Row;
    expect(after.status).toBe("AWAITING_FACTOR");
    expect(after.factorCategory).toBe("stationary_combustion_diesel");
    expect(after.scope).toBe("SCOPE_1");
    expect(String(after.reason)).toMatch(/factor/i);
    expect(eventsOfType("calculation.created")).toHaveLength(0);
  });
});

describe("Phase 4-i: the factor-import backfill is auditable and marked system-triggered", () => {
  beforeEach(async () => {
    resetTables(false);
    await createActivityEntryWithCalculations(ctx, createInput);
    // The factor arrives after the entry was already parked.
    tables.factorSets.push(FACTOR_SET);
    tables.factors.push(FACTOR);
    tables.audit.length = 0;
  });

  it("emits a batch calculation.backfilled event with counts, not a per-entry id list", async () => {
    const result = await recalculatePendingEntries(ORG_A);
    expect(result).toEqual({ checked: 1, recalculated: 1 });

    const [batch] = eventsOfType("calculation.backfilled");
    expect(batch).toBeDefined();
    expect(batch.after).toEqual({
      trigger: "factor_set_import",
      checked: 1,
      backfilled: 1,
      stillAwaitingFactor: 0,
    });
  });

  it("marks the whole batch SYSTEM with no actor user, and correlates the child trail to it", async () => {
    await recalculatePendingEntries(ORG_A);

    expect(tables.audit.length).toBeGreaterThan(1);
    expect(tables.audit.every((e) => e.actorType === "SYSTEM")).toBe(true);
    expect(tables.audit.every((e) => e.actorUserId === null)).toBe(true);
    // A system context marker is never recorded as if it were a User row.
    expect(tables.audit.every((e) => e.actorUserId !== "system")).toBe(true);

    const correlationIds = new Set(tables.audit.map((e) => e.correlationId));
    expect(correlationIds.size).toBe(1);
    expect(String([...correlationIds][0])).toMatch(/^system-factor-import-backfill-/);
    expect(tables.audit.every((e) => e.source === "system")).toBe(true);
  });

  it("audits the recovery out of AWAITING_FACTOR with both statuses", async () => {
    await recalculatePendingEntries(ORG_A);

    const [event] = eventsOfType("activity_entry.status_changed");
    expect(event).toBeDefined();
    expect(event.before).toEqual({ status: "AWAITING_FACTOR" });
    expect(event.after).toEqual({ status: "SUBMITTED", reason: "emission_factor_available" });
    expect(eventsOfType("calculation.created")).toHaveLength(1);
  });

  it("writes no batch event when there was nothing awaiting a factor", async () => {
    await recalculatePendingEntries(ORG_A);
    tables.audit.length = 0;

    const result = await recalculatePendingEntries(ORG_A);
    expect(result).toEqual({ checked: 0, recalculated: 0 });
    expect(tables.audit).toHaveLength(0);
  });
});

describe("Phase 4-i: reporting-data preparation is audited", () => {
  beforeEach(() => resetTables(true));

  it("emits report_data.prepared carrying the period and the skipped-for-want-of-a-factor count", async () => {
    const orgContext = {
      organisationId: ORG_A,
      userId: "user-1",
      correlationId: "corr-user-1",
      permissions: new Set<string>(),
    };
    const periodStart = new Date(Date.UTC(2026, 0, 1));
    const periodEnd = new Date(Date.UTC(2026, 0, 31));

    // No Scope 1/2 source rows in the period, so nothing is derived —
    // the disclosure counts are still recorded.
    const result = await prepareReportingData(
      orgContext as unknown as Parameters<typeof prepareReportingData>[0],
      periodStart,
      periodEnd,
    );
    expect(result).toEqual({ created: 0, skippedNoFactor: 0 });

    const [event] = eventsOfType("report_data.prepared");
    expect(event).toBeDefined();
    expect(event.after).toEqual({
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-01-31T00:00:00.000Z",
      created: 0,
      skippedNoFactor: 0,
    });
  });
});

describe("Phase 4-i is observational: no figure moves", () => {
  beforeEach(() => resetTables(true));

  it("stores exactly what the calculation engine returns, unchanged by auditing", async () => {
    await createActivityEntryWithCalculations(ctx, createInput);

    // Independently recompute from the same inputs the engine saw.
    const expected = calculateEmission(100, "litres", {
      id: "factor-1",
      basis: "STANDARD",
      unit: "litres",
      co2eFactor: 2.5,
      factorSetName: "DEFRA 2024",
      vintageYear: 2024,
      isPlaceholder: false,
    });

    expect(tables.calculations).toHaveLength(1);
    const stored = tables.calculations[0];
    expect(stored.resultKgCo2e).toBe(expected.resultKgCo2e);
    expect(stored.inputValue).toBe(expected.inputValue);
    expect(stored.inputUnit).toBe(expected.inputUnit);
    expect(stored.factorValueSnapshot).toBe(expected.factorValueSnapshot);
    expect(stored.factorUnitSnapshot).toBe(expected.factorUnitSnapshot);
    expect(stored.factorSourceSnapshot).toBe(expected.factorSourceSnapshot);
    expect(stored.factorVintageSnapshot).toBe(expected.factorVintageSnapshot);
    expect(stored.formulaApplied).toBe(expected.formulaApplied);
    expect(stored.emissionFactorId).toBe(expected.emissionFactorId);
  });

  it("still returns the existing rows on replay, creating no new calculation and no duplicate figure", async () => {
    const { entry } = await createActivityEntryWithCalculations(ctx, createInput);
    const firstResult = tables.calculations[0].resultKgCo2e;
    tables.audit.length = 0;

    const replay = await runCalculationsForEntry(ctx, entry.id);

    expect(replay).toHaveLength(1);
    expect(tables.calculations).toHaveLength(1);
    expect(tables.calculations[0].resultKgCo2e).toBe(firstResult);
    // A no-op replay is not an accounting event and writes no audit row.
    expect(tables.audit).toHaveLength(0);
  });
});

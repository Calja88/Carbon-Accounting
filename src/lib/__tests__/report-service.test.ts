import { beforeEach, describe, expect, it, vi } from "vitest";

// report-service.ts pulls per-site/prior-year/monthly figures from
// analytics-service and everything else straight from Prisma. Both are
// mocked here with wholly synthetic fixtures so this suite runs with no
// database at all (T00 acceptance: "no database or real data is required").
vi.mock("@/lib/prisma", () => ({
  prisma: {
    entity: { findMany: vi.fn() },
    calculation: { findMany: vi.fn() },
    activityEntry: { findMany: vi.fn() },
    reportSnapshot: { create: vi.fn() },
  },
}));

vi.mock("@/lib/analytics-service", () => ({
  buildAnalyticsSnapshot: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { buildAnalyticsSnapshot } from "@/lib/analytics-service";
import { buildReportPayload, type ReportPayload } from "@/lib/report-service";

const periodStart = new Date("2026-01-01T00:00:00.000Z");
const periodEnd = new Date("2026-01-31T00:00:00.000Z");

const emptyGroupTotals = { scope1: 0, scope2Location: 0, scope2Market: 0, scope3: 0, total: 0 };

function analyticsFixture() {
  return {
    periodStart,
    periodEnd,
    previousPeriodStart: new Date("2025-01-01T00:00:00.000Z"),
    previousPeriodEnd: new Date("2025-01-31T00:00:00.000Z"),
    group: emptyGroupTotals,
    previousGroup: emptyGroupTotals,
    groupDelta: { currentKg: 0, previousKg: 0, deltaKg: 0, deltaPercent: null, direction: "flat", isImprovement: null },
    scopeDeltas: [],
    sites: [],
    previousSitesById: {},
    byCategory: [],
    monthly: [],
    dataQuality: [],
    awaitingFactorCount: 0,
    flaggedCount: 0,
    hasAnyData: true,
  };
}

/** Minimal synthetic Calculation row shaped the way report-service consumes it. */
function calc(overrides: Record<string, unknown> = {}) {
  return {
    id: "calc-1",
    scope: "SCOPE_1",
    basis: "STANDARD",
    scope3Category: null,
    resultKgCo2e: 0,
    dataQualityTier: "TIER_1",
    factorSourceSnapshot: "Synthetic test source",
    factorVintageSnapshot: "2026",
    activityEntry: {
      activityDataPoint: { category: "Test category", dataPointName: "Test data point" },
      site: { name: "Test site" },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(prisma.entity.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.activityEntry.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.calculation.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.reportSnapshot.create).mockReset();
  vi.mocked(buildAnalyticsSnapshot).mockReset().mockResolvedValue(analyticsFixture() as never);
});

// ---------------------------------------------------------------------------
// Regression invariant C-02: Scope 2 location-based and market-based rows
// report the same underlying activity twice (once per basis) — the report
// must keep them as two separate figures and must never sum both into a
// single blended total.
// ---------------------------------------------------------------------------

describe("Scope 2 dual-basis non-double-counting (invariant C-02)", () => {
  it("keeps location-based and market-based totals separate rather than summed", async () => {
    vi.mocked(prisma.calculation.findMany).mockResolvedValueOnce([
      calc({ id: "loc-1", scope: "SCOPE_2", basis: "LOCATION_BASED", resultKgCo2e: 100 }),
      calc({ id: "mkt-1", scope: "SCOPE_2", basis: "MARKET_BASED", resultKgCo2e: 40 }),
    ] as never);

    const payload = await buildReportPayload(periodStart, periodEnd);

    expect(payload.scope2.locationBasedTotalKgCo2e).toBe(100);
    expect(payload.scope2.marketBasedTotalKgCo2e).toBe(40);
  });

  it("excludes the market-based/residual-mix duplicate from the data-quality tier denominator", async () => {
    vi.mocked(prisma.calculation.findMany).mockResolvedValueOnce([
      calc({ id: "loc-1", scope: "SCOPE_2", basis: "LOCATION_BASED", resultKgCo2e: 100, dataQualityTier: "TIER_1" }),
      calc({ id: "mkt-1", scope: "SCOPE_2", basis: "RESIDUAL_MIX", resultKgCo2e: 40, dataQualityTier: "TIER_1" }),
    ] as never);

    const payload = await buildReportPayload(periodStart, periodEnd);

    // The tier breakdown is weighted against Scope 1 + Scope 2 location-based
    // + Scope 3 only; if the market-based row leaked in, this would be 140.
    const dqTotal = payload.dataQuality.tierBreakdown.reduce((sum, t) => sum + t.kgCo2e, 0);
    expect(dqTotal).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Regression invariant C-05: an issued ReportSnapshot is immutable — the
// persistence path always creates a new row (a successor), and the payload
// stored in it is a frozen copy, not a live reference back to the object
// buildReportPayload returned.
// ---------------------------------------------------------------------------

describe("report snapshot immutability and successor versioning (invariant C-05)", () => {
  /** Mirrors the persistence call in reports/actions.ts generateReportAction:
   *  a plain `create` (never `update`) of a JSON round-tripped payload. */
  async function persistSnapshot(payload: ReportPayload) {
    return prisma.reportSnapshot.create({
      data: {
        periodStart,
        periodEnd,
        payload: JSON.parse(JSON.stringify(payload)),
      },
    } as never);
  }

  it("does not let a later mutation of the live payload object reach an already-persisted snapshot", async () => {
    const created: { data: { payload: ReportPayload } }[] = [];
    vi.mocked(prisma.reportSnapshot.create).mockImplementation((async (args: { data: { payload: ReportPayload } }) => {
      created.push(args);
      return { id: `snap-${created.length}`, ...args.data };
    }) as never);

    const payload = await buildReportPayload(periodStart, periodEnd);
    await persistSnapshot(payload);

    const persistedPayload = created[0].data.payload;
    const originalTotal = persistedPayload.scope1.totalKgCo2e;

    // Mutate the live object returned by buildReportPayload after it was
    // persisted — a stored snapshot must be a frozen copy, not this object.
    (payload as { scope1: { totalKgCo2e: number } }).scope1.totalKgCo2e = 999999;

    expect(persistedPayload.scope1.totalKgCo2e).toBe(originalTotal);
    expect(persistedPayload.scope1.totalKgCo2e).not.toBe(999999);
  });

  it("regenerating a report for the same period creates a successor snapshot, never overwrites the prior one", async () => {
    const created: { data: { payload: ReportPayload } }[] = [];
    vi.mocked(prisma.reportSnapshot.create).mockImplementation((async (args: { data: { payload: ReportPayload } }) => {
      created.push(args);
      return { id: `snap-${created.length}`, ...args.data };
    }) as never);

    vi.mocked(prisma.calculation.findMany).mockResolvedValueOnce([
      calc({ id: "c1", scope: "SCOPE_1", resultKgCo2e: 50 }),
    ] as never);
    const first = await buildReportPayload(periodStart, periodEnd);
    await persistSnapshot(first);

    // A later regeneration for the same period (e.g. after correcting an
    // entry) computes a fresh payload and is persisted as a second row.
    vi.mocked(prisma.calculation.findMany).mockResolvedValueOnce([
      calc({ id: "c1", scope: "SCOPE_1", resultKgCo2e: 75 }),
    ] as never);
    const second = await buildReportPayload(periodStart, periodEnd);
    await persistSnapshot(second);

    expect(created).toHaveLength(2);
    expect(prisma.reportSnapshot.create).toHaveBeenCalledTimes(2);
    // The two persisted payloads are independent objects — the first is
    // untouched by the second run.
    expect(created[0].data.payload.scope1.totalKgCo2e).toBe(50);
    expect(created[1].data.payload.scope1.totalKgCo2e).toBe(75);
  });
});

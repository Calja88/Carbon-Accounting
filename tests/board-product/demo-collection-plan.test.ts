/**
 * The BOARD demo's synthetic collection plan.
 *
 * The plan's shape is asserted here, and the requirements and statuses it
 * implies are derived with the platform's own `enumeratePeriods` and
 * `deriveCollectionStatus` — not a copy of them — so a change to the real
 * collection logic shows up as a failure here rather than as a surprise on
 * the demo screen. No database is touched; the live figures are verified
 * separately by `scripts/board-demo/verify-collection-plan.ts`.
 */
import { describe, expect, it } from "vitest";
import { CarbonCollectionDecision } from "@prisma/client";
import { COLLECTION_PLAN, EFFECTIVE_FROM, reportingWindow } from "../../scripts/board-demo/collection-plan-fixture";
import { deriveCollectionStatus, enumeratePeriods } from "../../src/lib/carbon/collection-plan-service";

/** The BOARD-1 fixture: three sites, eight catalogue sources, monthly entries. */
const FIXTURE_SITES = ["North Works", "East Cards", "Central Digital"];
const FIXTURE_SOURCE_CODES = [
  "BOARD1-stationary_combustion_natural_gas",
  "BOARD1-grid_electricity",
  "BOARD1-mobile_combustion_fuel",
  "BOARD1-board1_purchased_goods",
  "BOARD1-board1_purchased_services",
  "BOARD1-board1_purchased_consumables",
  "BOARD1-board1_business_travel",
  "BOARD1-board1_employee_commuting",
];
/** Months the fixture actually carries activity for, verified against the demo database. */
const FIXTURE_MONTHS = new Set([
  ...["01", "02", "03", "04", "05", "06", "07", "08"].map((m) => `2025-${m}`),
  ...["01", "02", "03", "04", "05", "06", "07", "08"].map((m) => `2026-${m}`),
]);

/** Mid-September 2026 — the demo's "today", with August the last complete month. */
const NOW = new Date(Date.UTC(2026, 8, 16));

describe("the demo collection plan's shape", () => {
  it("only names sites and sources the BOARD-1 fixture has", () => {
    for (const row of COLLECTION_PLAN) {
      expect(FIXTURE_SITES).toContain(row.site);
      expect(FIXTURE_SOURCE_CODES).toContain(row.sourceCode);
    }
  });

  it("configures each site/source pair at most once", () => {
    const keys = COLLECTION_PLAN.map((row) => `${row.site}|${row.sourceCode}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stays well short of every possible combination", () => {
    // The minimum-data principle: a plan, not a grid.
    expect(COLLECTION_PLAN.length).toBeLessThan(FIXTURE_SITES.length * FIXTURE_SOURCE_CODES.length);
  });

  it("covers every site, and more than one cadence", () => {
    expect(new Set(COLLECTION_PLAN.map((r) => r.site))).toEqual(new Set(FIXTURE_SITES));
    expect(new Set(COLLECTION_PLAN.map((r) => r.frequency))).toEqual(new Set(["MONTHLY", "QUARTERLY"]));
  });

  it("uses no AD_HOC cadence, which would silently generate nothing", () => {
    expect(COLLECTION_PLAN.some((r) => r.frequency === "AD_HOC")).toBe(false);
  });

  it("starts no later than the fixture's own history", () => {
    // generateCollectionPlan skips any period ending before effectiveFrom, so
    // a later date would drop the months the demo has data for.
    expect(EFFECTIVE_FROM.getTime()).toBeLessThanOrEqual(Date.UTC(2025, 0, 1));
  });
});

/** Requirements the real generator would produce for the plan over the window. */
function plannedRequirements(now: Date) {
  const window = reportingWindow(now);
  return COLLECTION_PLAN.flatMap((row) =>
    enumeratePeriods(row.frequency, window.periodStart, window.periodEnd, now)
      .filter((period) => period.periodEnd >= EFFECTIVE_FROM)
      .map((period) => ({ ...row, period })),
  );
}

/** A period is satisfied when the fixture has an entry in any month it overlaps. */
function fixtureEntriesFor(period: { periodStart: Date; periodEnd: Date }) {
  const months: string[] = [];
  const cursor = new Date(period.periodStart);
  while (cursor <= period.periodEnd) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
    if (FIXTURE_MONTHS.has(key)) months.push(key);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  // Every fixture entry is SUBMITTED and carries at least one calculation.
  return months.map((month) => ({ id: month, status: "SUBMITTED", canonicalValue: "1", canonicalUnit: "kWh" }));
}

describe("the requirements the plan generates", () => {
  it("produces the demo's expected requirement count over the default window", () => {
    // Seven monthly sources x nine year-to-date months, plus three quarters
    // of travel = 66, which is what the demo database actually holds.
    expect(plannedRequirements(NOW)).toHaveLength(66);
  });

  it("asks for the current, in-progress month but never a future one", () => {
    const keys = plannedRequirements(NOW).map((r) => r.period.periodKey);
    expect(keys).toContain("2026-09");
    expect(keys).not.toContain("2026-10");
    expect(keys).not.toContain("2026-Q4");
  });

  it("generates the same set again, so a rerun inserts nothing new", () => {
    const key = (r: ReturnType<typeof plannedRequirements>[number]) =>
      `${r.site}|${r.sourceCode}|${r.period.periodKey}`;
    const first = plannedRequirements(NOW).map(key);
    const second = plannedRequirements(NOW).map(key);
    // The unique key is (organisation, site, source, periodKey); a duplicate
    // within one run would mean createMany silently dropped a requirement.
    expect(new Set(first).size).toBe(first.length);
    expect(second).toEqual(first);
  });
});

describe("the statuses the demo will show", () => {
  const statuses = plannedRequirements(NOW).map((row) => {
    const entries = fixtureEntriesFor(row.period);
    return deriveCollectionStatus({
      requirement: { decision: CarbonCollectionDecision.PENDING, reviewFingerprint: null },
      hasEnabledConfig: true,
      entries,
      calculationsByEntryId: new Map(entries.map((e) => [e.id, [{ id: `c-${e.id}`, basis: "LOCATION", resultKgCo2e: "1" }]])),
    });
  });
  const count = (status: string) => statuses.filter((s) => s === status).length;

  it("is mostly received, with the current month outstanding", () => {
    expect(count("submitted")).toBe(59);
    expect(count("missing")).toBe(7);
  });

  it("gives a completeness that is meaningful rather than 0% or a bare 100%", () => {
    const percent = (count("submitted") / statuses.length) * 100;
    expect(percent).toBeGreaterThan(70);
    expect(percent).toBeLessThan(100);
    expect(percent).toBeCloseTo(89.4, 1);
  });

  it("invents no status the fixture's data does not support", () => {
    // Every fixture entry is SUBMITTED with a calculation, so there is
    // honestly nothing awaiting a factor and nothing excluded. Those states
    // stay empty rather than being manufactured.
    expect(new Set(statuses)).toEqual(new Set(["submitted", "missing"]));
  });
});

import { describe, expect, it } from "vitest";
import {
  activityDrilldownHref,
  buildManagementReport,
  summarisePeriodStates,
  UNATTRIBUTED_SITE_NAME,
} from "../management-report";
import type { CollectionStatus } from "../collection-plan-service";
import { CAT1, CAT6, input } from "./management-report-fixture";

const kpi = (report: ReturnType<typeof buildManagementReport>, key: string) => report.kpis.find((k) => k.key === key)!;
const comparison = (report: ReturnType<typeof buildManagementReport>, key: string) => report.comparison.find((r) => r.key === key)!;

describe("headline totals use authoritative results", () => {
  it("takes the total straight from the authoritative snapshot rather than re-adding it", () => {
    const report = buildManagementReport(input());
    expect(kpi(report, "total").kgCo2e).toBe(8000);
    expect(kpi(report, "total").note).toBe("Scope 1 + Scope 2 (location-based) + Scope 3");
  });

  it("reports each scope's authoritative total", () => {
    const report = buildManagementReport(input());
    expect(kpi(report, "scope1").kgCo2e).toBe(1500);
    expect(kpi(report, "scope2Location").kgCo2e).toBe(2500);
    expect(kpi(report, "scope3").kgCo2e).toBe(4000);
  });

  it("refuses a headline that does not reconcile with its own scope split", () => {
    const data = input();
    data.group = { ...data.group, total: 9999 };
    expect(() => buildManagementReport(data)).toThrow("Headline total does not reconcile");
  });
});

describe("Scope 2 dual reporting", () => {
  it("shows market-based separately and keeps it out of the headline addition", () => {
    const report = buildManagementReport(input());
    const market = kpi(report, "scope2Market");
    expect(market.kgCo2e).toBe(1900);
    expect(market.inHeadline).toBe(false);
    const headlineKpis = report.kpis.filter((k) => k.inHeadline && k.key !== "total");
    expect(headlineKpis.reduce((sum, k) => sum + (k.kgCo2e ?? 0), 0)).toBe(kpi(report, "total").kgCo2e);
  });

  it("never invents a market-based figure when no companion rows exist", () => {
    const report = buildManagementReport(input({ marketBasedAvailable: false }));
    expect(kpi(report, "scope2Market").kgCo2e).toBeNull();
    expect(comparison(report, "scope2Market").delta).toBeNull();
  });
});

describe("prior-period comparison", () => {
  it("compares the equivalent window a year earlier and states both", () => {
    const report = buildManagementReport(input());
    const total = comparison(report, "total");
    expect(total.currentKg).toBe(8000);
    expect(total.previousKg).toBe(6200);
    expect(total.delta?.deltaKg).toBe(1800);
    expect(total.delta?.deltaPercent).toBeCloseTo(29.03, 1);
    expect(total.delta?.isImprovement).toBe(false);
    expect(report.previousPeriodLabel).toBe("Jan 2025 – Feb 2025");
    expect(report.comparisonNote).toBeNull();
  });

  it("never manufactures a percentage against a zero prior figure", () => {
    const data = input();
    data.previousGroup = { scope1: 0, scope2Location: 0, scope2Market: 0, scope3: 6200, total: 6200 };
    const report = buildManagementReport(data);
    const scope1 = comparison(report, "scope1");
    expect(scope1.previousKg).toBe(0);
    expect(scope1.delta?.deltaPercent).toBeNull();
    expect(scope1.note).toMatch(/no percentage change can be stated/);
  });

  it("states no change at all when the comparison period holds no data", () => {
    const report = buildManagementReport(input({ previousMonthsWithData: [] }));
    expect(report.comparable).toBe(false);
    expect(report.comparisonNote).toMatch(/No activity data was recorded for Jan 2025 – Feb 2025/);
    expect(report.comparison.every((row) => row.delta === null)).toBe(true);
    expect(comparison(report, "total").previousKg).toBeNull();
  });

  it("does not report missing current data as a reduction", () => {
    const report = buildManagementReport(input({ monthsWithData: [] }));
    expect(kpi(report, "total").kgCo2e).toBeNull();
    expect(comparison(report, "total").delta).toBeNull();
    expect(report.comparisonNote).toMatch(/would reflect missing data, not a reduction/);
  });

  it("flags a comparison against a period that is only partly reported", () => {
    const report = buildManagementReport(input({ previousMonthsWithData: ["2025-01"] }));
    expect(report.comparable).toBe(true);
    expect(report.comparisonNote).toMatch(/only partly reported \(1 of 2 months\)/);
    expect(comparison(report, "total").delta).not.toBeNull();
  });

  // A window longer than a year makes "the same window one year earlier"
  // overlap it, so the change is partly this period against itself. The live
  // demo reported +80% on Jan 2025 - Sept 2026 while the true year-on-year
  // movement across that data was -20%.
  it("states no year-on-year change when the prior window overlaps this one", () => {
    const report = buildManagementReport(input({ previousMonthsInRange: 13 }));
    expect(report.comparable).toBe(false);
    expect(report.comparisonNote).toMatch(/longer than twelve months/);
    expect(comparison(report, "total").currentKg).toBe(8000);
    expect(comparison(report, "total").previousKg).toBeNull();
    expect(report.comparison.every((row) => row.delta === null)).toBe(true);
    expect(report.sites.every((site) => site.delta === null)).toBe(true);
  });

  it("still compares a window of exactly twelve months", () => {
    const report = buildManagementReport(input({ previousMonthsInRange: 12, previousMonthsWithData: ["2025-01"] }));
    expect(report.comparable).toBe(true);
    expect(comparison(report, "total").delta).not.toBeNull();
  });
});

describe("site breakdown", () => {
  it("reconciles site totals with the headline and states each share", () => {
    const report = buildManagementReport(input());
    expect(report.sites.map((s) => s.siteName)).toEqual(["Alpha Works", "Beta Depot"]);
    expect(report.sites.reduce((sum, s) => sum + s.total, 0)).toBe(kpi(report, "total").kgCo2e);
    expect(report.sites[0].sharePercent).toBeCloseTo(75, 6);
    expect(report.sites[1].sharePercent).toBeCloseTo(25, 6);
  });

  it("gives an unattributed remainder its own row rather than spreading it over the sites", () => {
    const data = input();
    // A result whose site is no longer listed: the group still carries it.
    data.group = { scope1: 1600, scope2Location: 2500, scope2Market: 1900, scope3: 4000, total: 8100 };
    data.sourceRows = [...data.sourceRows, { siteId: "gone", siteName: "Retired Site", scope: "SCOPE_1", category: "Natural gas", kgCo2e: 100 }];
    const report = buildManagementReport(data);
    const unattributed = report.sites.find((s) => s.siteName === UNATTRIBUTED_SITE_NAME);
    expect(unattributed?.total).toBeCloseTo(100, 6);
    expect(report.sites.reduce((sum, s) => sum + s.total, 0)).toBeCloseTo(8100, 6);
  });

  it("does not claim a share of an absent total", () => {
    const report = buildManagementReport(input({ monthsWithData: [] }));
    expect(report.sites.every((s) => s.sharePercent === null)).toBe(true);
  });
});

describe("Scope 3 categories", () => {
  it("reconciles quantified categories with the Scope 3 total", () => {
    const report = buildManagementReport(input());
    const quantified = report.scope3Categories.filter((c) => c.state === "quantified");
    expect(quantified.reduce((sum, c) => sum + (c.kgCo2e ?? 0), 0)).toBe(kpi(report, "scope3").kgCo2e);
  });

  it("distinguishes a genuine zero from a category with no data this period", () => {
    const data = input();
    data.scope3Totals = { [CAT1]: 4000, [CAT6]: 0 };
    const report = buildManagementReport(data);
    expect(report.scope3Categories.find((c) => c.category === CAT6)?.state).toBe("zero");
    expect(report.scope3Categories.find((c) => c.category === CAT6)?.kgCo2e).toBe(0);

    const without = buildManagementReport(input());
    const cat6 = without.scope3Categories.find((c) => c.category === CAT6)!;
    expect(cat6.state).toBe("no_data");
    expect(cat6.kgCo2e).toBeNull();
  });

  it("counts the categories the platform does not model as not assessed, never as zero", () => {
    const report = buildManagementReport(input());
    expect(report.scope3Categories).toHaveLength(2);
    expect(report.scope3NotAssessed).toBe(13);
    expect(report.methodology.scope3Note).toMatch(/not assessed rather than as zero/);
  });
});

describe("largest sources", () => {
  it("ranks authoritative contributions largest first with their share", () => {
    const report = buildManagementReport(input());
    expect(report.topSources.map((s) => s.kgCo2e)).toEqual([3000, 2000, 1000, 1000, 500]);
    expect(report.topSources[0].category).toBe(CAT1);
    expect(report.topSources[0].siteName).toBe("Alpha Works");
    expect(report.topSources[0].scopeLabel).toBe("Scope 3");
    expect(report.topSources[0].sharePercent).toBeCloseTo(37.5, 6);
    expect(report.topSources).toHaveLength(5);
  });

  it("refuses to rank sources that disagree with the authoritative total", () => {
    const data = input();
    data.sourceRows = data.sourceRows.slice(0, 2);
    expect(() => buildManagementReport(data)).toThrow("Top sources do not reconcile");
  });
});

describe("monthly trend", () => {
  it("aggregates each month on the headline basis and adds back to the total", () => {
    const report = buildManagementReport(input());
    expect(report.trend.map((m) => m.totalKg)).toEqual([4800, 3200]);
    expect(report.trend.reduce((sum, m) => sum + (m.totalKg ?? 0), 0)).toBe(kpi(report, "total").kgCo2e);
    expect(report.trend[0].scope2Location).toBe(1500);
  });

  it("never treats a month nobody reported as a genuine zero", () => {
    const report = buildManagementReport(input({ monthsWithData: ["2026-01"] }));
    const february = report.trend.find((m) => m.month === "2026-02")!;
    expect(february.reported).toBe(false);
    expect(february.totalKg).toBeNull();
    expect(february.scope1).toBeNull();
  });

  it("keeps a genuine zero month distinguishable from a missing one", () => {
    const data = input();
    data.monthly = [
      { month: "2026-01", label: "Jan 26", scope1: 1500, scope2Location: 2500, scope3: 4000, total: 8000 },
      { month: "2026-02", label: "Feb 26", scope1: 0, scope2Location: 0, scope3: 0, total: 0 },
    ];
    const report = buildManagementReport(data);
    const february = report.trend.find((m) => m.month === "2026-02")!;
    expect(february.reported).toBe(true);
    expect(february.totalKg).toBe(0);
  });
});

describe("reporting period state", () => {
  it("labels a wholly open range open and a wholly closed range closed", () => {
    expect(summarisePeriodStates([{ state: "OPEN" }, { state: "OPEN" }]).kind).toBe("OPEN");
    expect(summarisePeriodStates([{ state: "CLOSED" }, { state: "CLOSED" }]).kind).toBe("CLOSED");
  });

  it("never labels a partly closed range CLOSED", () => {
    const summary = summarisePeriodStates([{ state: "CLOSED" }, { state: "OPEN" }, { state: "OPEN" }]);
    expect(summary.kind).toBe("MIXED");
    expect(summary.label).toBe("Partly closed — 1 of 3 site-months closed");
  });

  it("keeps a closed period fully readable", () => {
    const data = input();
    data.reportingPeriods = data.reportingPeriods.map((p) => ({ ...p, state: "CLOSED" as const }));
    const report = buildManagementReport(data);
    expect(report.periodState.kind).toBe("CLOSED");
    expect(kpi(report, "total").kgCo2e).toBe(8000);
    expect(report.sites).toHaveLength(2);
    expect(report.topSources).toHaveLength(5);
    expect(report.empty).toBe(false);
  });

  it("summarises each site's own months, not the whole range", () => {
    const data = input();
    data.reportingPeriods = [
      { siteId: "alpha", month: "2026-01", state: "CLOSED" },
      { siteId: "alpha", month: "2026-02", state: "CLOSED" },
      { siteId: "beta", month: "2026-01", state: "OPEN" },
      { siteId: "beta", month: "2026-02", state: "OPEN" },
    ];
    const report = buildManagementReport(data);
    expect(report.periodState.kind).toBe("MIXED");
    expect(report.sites.find((s) => s.siteId === "alpha")?.periodState.kind).toBe("CLOSED");
    expect(report.sites.find((s) => s.siteId === "beta")?.periodState.kind).toBe("OPEN");
  });
});

describe("completeness and outstanding data", () => {
  it("counts real collection-plan states and excludes 'not required' from the denominator", () => {
    const report = buildManagementReport(input());
    // reviewed, submitted, awaiting_factor, missing, excluded => 5 required.
    expect(report.completeness.required).toBe(5);
    expect(report.completeness.excluded).toBe(1);
    expect(report.completeness.received).toBe(3);
    expect(report.completeness.missing).toBe(1);
    // 3 received of (5 required - 1 authorised exclusion).
    expect(report.completeness.receivedPercent).toBeCloseTo(75, 6);
    // awaiting_factor is received but not yet in the totals above.
    expect(report.completeness.countedInTotals).toBe(2);
    expect(report.completeness.rows.some((r) => r.status === "not_required")).toBe(false);
  });

  it("states no percentage at all when nothing is required, rather than 0% or 100%", () => {
    const report = buildManagementReport(input({ collectionStatuses: ["not_required", "not_required"] }));
    expect(report.completeness.receivedPercent).toBeNull();
    expect(report.completeness.required).toBe(0);
  });

  it("surfaces only genuine outstanding states, largest first", () => {
    const statuses: CollectionStatus[] = ["missing", "missing", "awaiting_factor", "changed_since_review", "reviewed"];
    const report = buildManagementReport(input({ collectionStatuses: statuses, flaggedCount: 3 }));
    expect(report.outstanding.map((o) => [o.kind, o.count])).toEqual([
      ["flagged", 3],
      ["missing", 2],
      ["awaiting_factor", 1],
      ["changed_since_review", 1],
    ]);
  });

  it("fabricates no alert when nothing is outstanding", () => {
    const report = buildManagementReport(input({ collectionStatuses: ["reviewed", "reviewed"], flaggedCount: 0 }));
    expect(report.outstanding).toEqual([]);
  });
});

describe("drill-down links", () => {
  it("resolves every link to a real route carrying the period and scope", () => {
    const report = buildManagementReport(input());
    for (const href of [
      ...report.sites.map((s) => s.href),
      ...report.topSources.map((s) => s.href),
      ...report.scope3Categories.map((c) => c.href),
      ...report.outstanding.map((o) => o.href),
      ...report.trend.map((m) => m.href),
    ]) {
      expect(href.startsWith("/")).toBe(true);
      expect(href).toContain("from=");
      expect(href).toContain("to=");
    }
    // A site, a scope or a source leads to the underlying records themselves.
    expect(report.sites[0].href).toContain("/activity?");
    expect(report.sites[0].href).toContain("siteId=alpha");
    expect(report.topSources[0].href).toContain("/activity?");
    expect(report.topSources[0].href).toContain("scope=SCOPE_3");
    expect(report.scope3Categories[0].href).toContain("/activity?");
    expect(report.trend[0].href).toContain("from=2026-01&to=2026-01");
  });

  it("sends an entry-level state to the register, in the register's own vocabulary", () => {
    const report = buildManagementReport(input({ collectionStatuses: ["awaiting_factor"], flaggedCount: 1 }));
    // EntryStatus, not CollectionStatus — the register filters on the former.
    expect(report.outstanding.find((o) => o.kind === "awaiting_factor")?.href).toBe(
      "/activity?from=2026-01&to=2026-02&status=AWAITING_FACTOR",
    );
    expect(report.outstanding.find((o) => o.kind === "flagged")?.href).toBe("/activity?from=2026-01&to=2026-02&status=FLAGGED");
  });

  it("keeps a collection-plan-only state on the collection plan", () => {
    const report = buildManagementReport(input({ collectionStatuses: ["missing", "changed_since_review"], flaggedCount: 0 }));
    // Neither describes a record that exists, so neither has an entry to open.
    expect(report.outstanding.find((o) => o.kind === "missing")?.href).toBe("/data?from=2026-01&to=2026-02&status=missing");
    expect(report.outstanding.find((o) => o.kind === "changed_since_review")?.href).toBe(
      "/data?from=2026-01&to=2026-02&status=changed_since_review",
    );
  });

  it("builds every drill-down through the one helper that decides the destination", () => {
    expect(activityDrilldownHref({ from: "2026-01", to: "2026-02", siteId: "alpha" }, { scope: "SCOPE_1", status: "flagged" })).toBe(
      "/activity?from=2026-01&to=2026-02&siteId=alpha&scope=SCOPE_1&status=FLAGGED",
    );
    expect(activityDrilldownHref({ from: "2026-01", to: "2026-02", siteId: "alpha" }, { scope: "SCOPE_1", status: "missing" })).toBe(
      "/data?from=2026-01&to=2026-02&siteId=alpha&scope=SCOPE_1&status=missing",
    );
    expect(activityDrilldownHref({ from: "2026-01", to: "2026-02", siteId: "alpha" })).toBe(
      "/activity?from=2026-01&to=2026-02&siteId=alpha",
    );
  });
});

describe("methodology and assurance language", () => {
  it("never claims verification, and says so when factors are placeholders", () => {
    const report = buildManagementReport(
      input({ factorSources: [{ source: "Placeholder set", vintage: "2024", scope: "SCOPE_1", placeholder: true }] }),
    );
    expect(report.methodology.placeholderFactorsUsed).toBe(true);
    expect(report.methodology.assurance).toMatch(/not suitable for formal or assured disclosure/);
  });

  it("still claims no assurance when every factor set is imported", () => {
    const report = buildManagementReport(input());
    expect(report.methodology.placeholderFactorsUsed).toBe(false);
    expect(report.methodology.assurance).toMatch(/No independent verification or assurance decision is recorded/);
  });

  it("never states the report is verified, assured, approved or final either way", () => {
    for (const placeholder of [true, false]) {
      const report = buildManagementReport(
        input({ factorSources: [{ source: "Set", vintage: "2024", scope: "SCOPE_1", placeholder }] }),
      );
      // A positive claim — "is verified", "has been assured" — is what must
      // never appear. An explicit denial of one is exactly what should.
      expect(report.methodology.assurance).not.toMatch(/\b(is|are|has been|have been|was|were)\s+(verified|assured|approved|final)\b/i);
      expect(report.methodology.assurance.startsWith("Management information.")).toBe(true);
    }
  });
});

describe("empty period", () => {
  it("reports an honest empty state rather than a zero inventory", () => {
    const report = buildManagementReport(input({ monthsWithData: [], previousMonthsWithData: [] }));
    expect(report.empty).toBe(true);
    expect(report.kpis.every((k) => k.kgCo2e === null)).toBe(true);
    expect(report.trend.every((m) => m.totalKg === null)).toBe(true);
  });
});

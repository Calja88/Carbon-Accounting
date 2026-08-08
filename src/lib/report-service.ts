import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { buildAnalyticsSnapshot } from "@/lib/analytics-service";

export interface CategoryBreakdown {
  category: string;
  kgCo2e: number;
}

/** Per-site totals, added post-v2. Optional on the payload so snapshots
 *  generated before this existed still render (see the report page's
 *  fallbacks). */
export interface SiteBreakdown {
  siteId: string;
  siteName: string;
  entityName: string;
  scope1: number;
  scope2Location: number;
  scope2Market: number;
  scope3: number;
  total: number;
}

export interface PeriodTotals {
  scope1: number;
  scope2Location: number;
  scope2Market: number;
  scope3: number;
  total: number;
}

/** Same calendar window shifted back one year — "the same dates last year". */
export interface PeriodComparison {
  previousPeriodStart: string;
  previousPeriodEnd: string;
  current: PeriodTotals;
  previous: PeriodTotals;
  bySite: { siteId: string; currentTotal: number; previousTotal: number }[];
}

export interface MonthlyPoint {
  month: string;
  label: string;
  total: number;
}

export interface TierBreakdown {
  tier: "TIER_1" | "TIER_2" | "TIER_3";
  kgCo2e: number;
  percent: number;
}

export interface FactorSourceUsed {
  source: string;
  vintage: string;
  scope: string;
}

export interface ExcludedEntry {
  site: string;
  dataPoint: string;
  periodLabel: string;
  reason: string | null;
}

export interface ReportPayload {
  periodStart: string;
  periodEnd: string;
  entity: {
    name: string;
    boundaryApproach: string;
    entitiesIncluded: string[];
  };
  scope1: {
    totalKgCo2e: number;
    byCategory: CategoryBreakdown[];
  };
  scope2: {
    locationBasedTotalKgCo2e: number;
    marketBasedTotalKgCo2e: number;
    byCategory: { category: string; locationKgCo2e: number; marketKgCo2e: number }[];
  };
  scope3: {
    totalKgCo2e: number;
    byCategory: CategoryBreakdown[];
  };
  dataQuality: {
    tierBreakdown: TierBreakdown[];
    /** Basis note: weighted against Scope 1 + Scope 2 location-based + all
     *  Scope 3, so a Scope 2 entry isn't counted twice via its market-based
     *  duplicate. */
  };
  factorSources: FactorSourceUsed[];
  excludedFlaggedEntries: ExcludedEntry[];
  /** Real activity data captured but not yet counted in any total above —
   *  no matching emission factor has been imported yet (EntryStatus.
   *  AWAITING_FACTOR). Disclosed, never silently dropped. */
  awaitingFactorEntries: ExcludedEntry[];
  executiveSummary: string;
  generatedAt: string;
  calculationIds: string[];
  /** All optional — snapshots predating these fields still render. */
  bySite?: SiteBreakdown[];
  comparison?: PeriodComparison;
  monthly?: MonthlyPoint[];
}

function toNum(d: Prisma.Decimal | number): number {
  return typeof d === "number" ? d : Number(d);
}

export async function buildReportPayload(periodStart: Date, periodEnd: Date): Promise<ReportPayload> {
  // Per-site, prior-year and monthly figures come from the same aggregation
  // the dashboard uses, so a report and the dashboard can never disagree
  // about the same period.
  const analytics = await buildAnalyticsSnapshot(periodStart, periodEnd);

  const [entities, includedCalculations, flaggedEntries, awaitingFactorEntriesRaw] = await Promise.all([
    prisma.entity.findMany({ orderBy: { name: "asc" } }),
    prisma.calculation.findMany({
      where: {
        activityEntry: {
          periodStart: { gte: periodStart, lte: periodEnd },
          // Withdrawn entries (REJECTED) are excluded alongside flagged ones —
          // both are kept on file, neither is reportable.
          status: { notIn: ["FLAGGED", "REJECTED"] },
        },
      },
      include: { activityEntry: { include: { activityDataPoint: true, site: true } } },
    }),
    prisma.activityEntry.findMany({
      where: { periodStart: { gte: periodStart, lte: periodEnd }, status: "FLAGGED" },
      include: { activityDataPoint: true, site: true },
    }),
    prisma.activityEntry.findMany({
      where: { periodStart: { gte: periodStart, lte: periodEnd }, status: "AWAITING_FACTOR" },
      include: { activityDataPoint: true, site: true },
    }),
  ]);

  const scope1Calcs = includedCalculations.filter((c) => c.scope === "SCOPE_1");
  const scope2Calcs = includedCalculations.filter((c) => c.scope === "SCOPE_2");
  const scope2Location = scope2Calcs.filter((c) => c.basis === "LOCATION_BASED");
  const scope2Market = scope2Calcs.filter((c) => c.basis === "MARKET_BASED" || c.basis === "RESIDUAL_MIX");
  const scope3Calcs = includedCalculations.filter((c) => c.scope === "SCOPE_3");

  const scope1Total = scope1Calcs.reduce((sum, c) => sum + toNum(c.resultKgCo2e), 0);
  const scope2LocationTotal = scope2Location.reduce((sum, c) => sum + toNum(c.resultKgCo2e), 0);
  const scope2MarketTotal = scope2Market.reduce((sum, c) => sum + toNum(c.resultKgCo2e), 0);
  const scope3Total = scope3Calcs.reduce((sum, c) => sum + toNum(c.resultKgCo2e), 0);

  const scope1ByCategory = groupSum(scope1Calcs, (c) => c.activityEntry.activityDataPoint.category);

  const scope2CategoryKeys = new Set(scope2Calcs.map((c) => c.activityEntry.activityDataPoint.category));
  const scope2ByCategory = Array.from(scope2CategoryKeys).map((category) => ({
    category,
    locationKgCo2e: sumWhere(scope2Location, (c) => c.activityEntry.activityDataPoint.category === category),
    marketKgCo2e: sumWhere(scope2Market, (c) => c.activityEntry.activityDataPoint.category === category),
  }));

  // scope3Category is set on every Scope 3 Calculation directly (not read
  // through the source ActivityDataPoint) since Cat 3 rows are derived and
  // have no data point of their own — see Calculation.scope3Category.
  const scope3ByCategory = groupSum(scope3Calcs, (c) => c.scope3Category ?? "Uncategorised");

  // Data-quality tier weighting uses Scope 1 + Scope 2 location-based +
  // all Scope 3, so a Scope 2 entry's market-based duplicate figure isn't
  // double-counted (v2: extended to include Scope 3, per brief item 4).
  const dqBasisCalcs = [...scope1Calcs, ...scope2Location, ...scope3Calcs];
  const dqTotal = dqBasisCalcs.reduce((sum, c) => sum + toNum(c.resultKgCo2e), 0);
  const tierBreakdown: TierBreakdown[] = (["TIER_1", "TIER_2", "TIER_3"] as const).map((tier) => {
    const kgCo2e = sumWhere(dqBasisCalcs, (c) => c.dataQualityTier === tier);
    return { tier, kgCo2e, percent: dqTotal > 0 ? (kgCo2e / dqTotal) * 100 : 0 };
  });

  const factorSourceMap = new Map<string, FactorSourceUsed>();
  for (const c of includedCalculations) {
    const key = `${c.factorSourceSnapshot}|${c.factorVintageSnapshot}|${c.scope}`;
    if (!factorSourceMap.has(key)) {
      factorSourceMap.set(key, { source: c.factorSourceSnapshot, vintage: c.factorVintageSnapshot, scope: c.scope });
    }
  }

  const excludedFlaggedEntries: ExcludedEntry[] = flaggedEntries.map((e) => ({
    site: e.site.name,
    dataPoint: e.activityDataPoint.dataPointName,
    periodLabel: e.periodStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    reason: e.plausibilityReason,
  }));

  const awaitingFactorEntries: ExcludedEntry[] = awaitingFactorEntriesRaw.map((e) => ({
    site: e.site.name,
    dataPoint: e.activityDataPoint.dataPointName,
    periodLabel: e.periodStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    reason: "No emission factor imported yet for this category.",
  }));

  const executiveSummary = buildExecutiveSummary({
    periodStart,
    periodEnd,
    scope1Total,
    scope2LocationTotal,
    scope2MarketTotal,
    scope3Total,
    tierBreakdown,
    excludedCount: excludedFlaggedEntries.length,
    awaitingFactorCount: awaitingFactorEntries.length,
    previousTotal: analytics.previousGroup.total,
    currentTotal: analytics.group.total,
  });

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    entity: {
      name: "Paragon ID UK (Group)",
      boundaryApproach: "Operational control (methodology Section 3) — recommended, not yet formally confirmed",
      entitiesIncluded: entities.map((e) => e.name),
    },
    scope1: { totalKgCo2e: scope1Total, byCategory: scope1ByCategory },
    scope2: {
      locationBasedTotalKgCo2e: scope2LocationTotal,
      marketBasedTotalKgCo2e: scope2MarketTotal,
      byCategory: scope2ByCategory,
    },
    scope3: { totalKgCo2e: scope3Total, byCategory: scope3ByCategory },
    dataQuality: { tierBreakdown },
    factorSources: Array.from(factorSourceMap.values()),
    excludedFlaggedEntries,
    awaitingFactorEntries,
    executiveSummary,
    generatedAt: new Date().toISOString(),
    calculationIds: includedCalculations.map((c) => c.id),
    bySite: analytics.sites.map((s) => ({
      siteId: s.siteId,
      siteName: s.siteName,
      entityName: s.entityName,
      scope1: s.totals.scope1,
      scope2Location: s.totals.scope2Location,
      scope2Market: s.totals.scope2Market,
      scope3: s.totals.scope3,
      total: s.totals.total,
    })),
    comparison: {
      previousPeriodStart: analytics.previousPeriodStart.toISOString(),
      previousPeriodEnd: analytics.previousPeriodEnd.toISOString(),
      current: {
        scope1: analytics.group.scope1,
        scope2Location: analytics.group.scope2Location,
        scope2Market: analytics.group.scope2Market,
        scope3: analytics.group.scope3,
        total: analytics.group.total,
      },
      previous: {
        scope1: analytics.previousGroup.scope1,
        scope2Location: analytics.previousGroup.scope2Location,
        scope2Market: analytics.previousGroup.scope2Market,
        scope3: analytics.previousGroup.scope3,
        total: analytics.previousGroup.total,
      },
      bySite: analytics.sites.map((s) => ({
        siteId: s.siteId,
        currentTotal: s.totals.total,
        previousTotal: analytics.previousSitesById[s.siteId]?.total ?? 0,
      })),
    },
    monthly: analytics.monthly.map((m) => ({ month: m.month, label: m.label, total: m.total })),
  };
}

function groupSum<T extends { resultKgCo2e: Prisma.Decimal }>(items: T[], keyFn: (item: T) => string): CategoryBreakdown[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, (map.get(key) ?? 0) + toNum(item.resultKgCo2e));
  }
  return Array.from(map.entries()).map(([category, kgCo2e]) => ({ category, kgCo2e }));
}

function sumWhere<T extends { resultKgCo2e: Prisma.Decimal }>(items: T[], predicate: (item: T) => boolean): number {
  return items.filter(predicate).reduce((sum, item) => sum + toNum(item.resultKgCo2e), 0);
}

function buildExecutiveSummary(args: {
  periodStart: Date;
  periodEnd: Date;
  scope1Total: number;
  scope2LocationTotal: number;
  scope2MarketTotal: number;
  scope3Total: number;
  tierBreakdown: TierBreakdown[];
  excludedCount: number;
  awaitingFactorCount: number;
  previousTotal: number;
  currentTotal: number;
}): string {
  const periodLabel = `${args.periodStart.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} to ${args.periodEnd.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
  const totalLocationTonnes = (args.scope1Total + args.scope2LocationTotal) / 1000;
  const scope3Tonnes = args.scope3Total / 1000;
  const tier1Pct = args.tierBreakdown.find((t) => t.tier === "TIER_1")?.percent ?? 0;

  const parts = [
    `Between ${periodLabel}, Paragon ID UK's day-to-day operations (Paragon ID, RFID Discovery and Thames Technology) produced an estimated ${totalLocationTonnes.toFixed(1)} tonnes of CO2-equivalent, covering fuel and refrigerants used on site and in company vehicles, and electricity bought in.`,
    `Of that, ${(args.scope1Total / 1000).toFixed(1)} tonnes came directly from burning fuel or topping up refrigerant equipment.`,
    `The rest — purchased electricity — comes to ${(args.scope2LocationTotal / 1000).toFixed(1)} tonnes based on the average UK grid mix, or ${(args.scope2MarketTotal / 1000).toFixed(1)} tonnes once the Group's actual electricity contracts and any renewable certificates are taken into account. Both figures are reported side by side, as required.`,
    `Beyond the Group's own operations, purchased goods and services, business travel and employee commuting add a further estimated ${scope3Tonnes.toFixed(1)} tonnes this period.`,
    `${tier1Pct.toFixed(0)}% of this figure is built from directly metered or invoiced data — the most reliable kind — with the remainder calculated or estimated from the next-best available records.`,
  ];

  // Only make a year-on-year claim when there's a real prior-year figure to
  // compare against — otherwise the "change" would just be the absence of data.
  if (args.previousTotal > 0) {
    const changePct = ((args.currentTotal - args.previousTotal) / args.previousTotal) * 100;
    const direction = Math.abs(changePct) < 0.05 ? "level with" : changePct > 0 ? "above" : "below";
    const magnitude = Math.abs(changePct).toFixed(Math.abs(changePct) < 10 ? 1 : 0);
    parts.push(
      direction === "level with"
        ? `That is level with the same period last year (${(args.previousTotal / 1000).toFixed(1)} tonnes).`
        : `That is ${magnitude}% ${direction} the same period last year, when the equivalent figure was ${(args.previousTotal / 1000).toFixed(1)} tonnes.`,
    );
  } else {
    parts.push(
      "There is no comparable figure for the same period last year, so no year-on-year change is stated here.",
    );
  }

  if (args.excludedCount > 0) {
    parts.push(
      `${args.excludedCount} submission${args.excludedCount === 1 ? "" : "s"} for this period looked unusual and ${args.excludedCount === 1 ? "has" : "have"} been held back for review rather than included here — see the data quality section.`,
    );
  }

  if (args.awaitingFactorCount > 0) {
    parts.push(
      `${args.awaitingFactorCount} submission${args.awaitingFactorCount === 1 ? "" : "s"} ${args.awaitingFactorCount === 1 ? "has" : "have"} been recorded but ${args.awaitingFactorCount === 1 ? "isn't" : "aren't"} yet reflected in the totals above, pending an emission factor import.`,
    );
  }

  return parts.join(" ");
}

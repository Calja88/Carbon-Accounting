import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export interface CategoryBreakdown {
  category: string;
  kgCo2e: number;
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
  dataQuality: {
    tierBreakdown: TierBreakdown[];
    /** Basis note: weighted against Scope 1 + Scope 2 location-based, so a
     *  Scope 2 entry isn't counted twice via its market-based duplicate. */
  };
  factorSources: FactorSourceUsed[];
  excludedFlaggedEntries: ExcludedEntry[];
  executiveSummary: string;
  generatedAt: string;
  calculationIds: string[];
}

function toNum(d: Prisma.Decimal | number): number {
  return typeof d === "number" ? d : Number(d);
}

export async function buildReportPayload(periodStart: Date, periodEnd: Date): Promise<ReportPayload> {
  const [entities, includedCalculations, flaggedEntries] = await Promise.all([
    prisma.entity.findMany({ orderBy: { name: "asc" } }),
    prisma.calculation.findMany({
      where: {
        activityEntry: {
          periodStart: { gte: periodStart, lte: periodEnd },
          status: { not: "FLAGGED" },
        },
      },
      include: { activityEntry: { include: { activityDataPoint: true, site: true } } },
    }),
    prisma.activityEntry.findMany({
      where: { periodStart: { gte: periodStart, lte: periodEnd }, status: "FLAGGED" },
      include: { activityDataPoint: true, site: true },
    }),
  ]);

  const scope1Calcs = includedCalculations.filter((c) => c.scope === "SCOPE_1");
  const scope2Calcs = includedCalculations.filter((c) => c.scope === "SCOPE_2");
  const scope2Location = scope2Calcs.filter((c) => c.basis === "LOCATION_BASED");
  const scope2Market = scope2Calcs.filter((c) => c.basis === "MARKET_BASED" || c.basis === "RESIDUAL_MIX");

  const scope1Total = scope1Calcs.reduce((sum, c) => sum + toNum(c.resultKgCo2e), 0);
  const scope2LocationTotal = scope2Location.reduce((sum, c) => sum + toNum(c.resultKgCo2e), 0);
  const scope2MarketTotal = scope2Market.reduce((sum, c) => sum + toNum(c.resultKgCo2e), 0);

  const scope1ByCategory = groupSum(scope1Calcs, (c) => c.activityEntry.activityDataPoint.category);

  const scope2CategoryKeys = new Set(scope2Calcs.map((c) => c.activityEntry.activityDataPoint.category));
  const scope2ByCategory = Array.from(scope2CategoryKeys).map((category) => ({
    category,
    locationKgCo2e: sumWhere(scope2Location, (c) => c.activityEntry.activityDataPoint.category === category),
    marketKgCo2e: sumWhere(scope2Market, (c) => c.activityEntry.activityDataPoint.category === category),
  }));

  // Data-quality tier weighting uses Scope 1 + Scope 2 location-based only,
  // so a Scope 2 entry's market-based duplicate figure isn't double-counted.
  const dqBasisCalcs = [...scope1Calcs, ...scope2Location];
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

  const executiveSummary = buildExecutiveSummary({
    periodStart,
    periodEnd,
    scope1Total,
    scope2LocationTotal,
    scope2MarketTotal,
    tierBreakdown,
    excludedCount: excludedFlaggedEntries.length,
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
    dataQuality: { tierBreakdown },
    factorSources: Array.from(factorSourceMap.values()),
    excludedFlaggedEntries,
    executiveSummary,
    generatedAt: new Date().toISOString(),
    calculationIds: includedCalculations.map((c) => c.id),
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
  tierBreakdown: TierBreakdown[];
  excludedCount: number;
}): string {
  const periodLabel = `${args.periodStart.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} to ${args.periodEnd.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
  const totalLocationTonnes = (args.scope1Total + args.scope2LocationTotal) / 1000;
  const tier1Pct = args.tierBreakdown.find((t) => t.tier === "TIER_1")?.percent ?? 0;

  const parts = [
    `Between ${periodLabel}, Paragon ID UK's day-to-day operations (Paragon ID, RFID Discovery and Thames Technology) produced an estimated ${totalLocationTonnes.toFixed(1)} tonnes of CO2-equivalent, covering fuel and refrigerants used on site and in company vehicles, and electricity bought in.`,
    `Of that, ${(args.scope1Total / 1000).toFixed(1)} tonnes came directly from burning fuel or topping up refrigerant equipment.`,
    `The rest — purchased electricity — comes to ${(args.scope2LocationTotal / 1000).toFixed(1)} tonnes based on the average UK grid mix, or ${(args.scope2MarketTotal / 1000).toFixed(1)} tonnes once the Group's actual electricity contracts and any renewable certificates are taken into account. Both figures are reported side by side, as required.`,
    `${tier1Pct.toFixed(0)}% of this figure is built from directly metered or invoiced data — the most reliable kind — with the remainder calculated or estimated from the next-best available records.`,
  ];

  if (args.excludedCount > 0) {
    parts.push(
      `${args.excludedCount} submission${args.excludedCount === 1 ? "" : "s"} for this period looked unusual and ${args.excludedCount === 1 ? "has" : "have"} been held back for review rather than included here — see the data quality section.`,
    );
  }

  return parts.join(" ");
}

/**
 * Read-only aggregation over Calculation rows for the emissions dashboard
 * and the report's charts. Deliberately reuses the same inclusion rules as
 * report-service.ts so a dashboard figure and a report figure for the same
 * period can never disagree:
 *
 *  - FLAGGED entries are excluded (held back pending review).
 *  - Scope 2 contributes its LOCATION_BASED figure to headline totals, so
 *    the MARKET_BASED/RESIDUAL_MIX companion row isn't double-counted. The
 *    market-based figure is carried alongside, never summed into the total.
 *
 * Nothing here writes, derives, or invents a figure — it only groups
 * Calculations that already exist.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export interface ScopeTotals {
  scope1: number;
  /** Location-based (grid average) — the figure used in headline totals. */
  scope2Location: number;
  /** Market-based/residual-mix — reported alongside, never added to `total`. */
  scope2Market: number;
  scope3: number;
  /** scope1 + scope2Location + scope3 */
  total: number;
}

export interface NamedTotal {
  key: string;
  label: string;
  kgCo2e: number;
}

export interface SiteEmissions {
  siteId: string;
  siteName: string;
  entityName: string;
  totals: ScopeTotals;
  /** Scope 3 GHG Protocol category label, or the data point's own category for Scope 1/2. */
  byCategory: NamedTotal[];
}

export interface MonthPoint {
  /** YYYY-MM */
  month: string;
  label: string;
  scope1: number;
  scope2Location: number;
  scope3: number;
  total: number;
}

export interface Delta {
  currentKg: number;
  previousKg: number;
  deltaKg: number;
  /** null when there's no prior-period figure to compare against (division by zero). */
  deltaPercent: number | null;
  /** For emissions, down is good — this encodes that, so the UI never has to. */
  direction: "up" | "down" | "flat";
  isImprovement: boolean | null;
}

export interface AnalyticsSnapshot {
  periodStart: Date;
  periodEnd: Date;
  previousPeriodStart: Date;
  previousPeriodEnd: Date;
  group: ScopeTotals;
  previousGroup: ScopeTotals;
  groupDelta: Delta;
  scopeDeltas: { scope: "Scope 1" | "Scope 2" | "Scope 3"; delta: Delta }[];
  sites: SiteEmissions[];
  previousSitesById: Record<string, ScopeTotals>;
  byCategory: NamedTotal[];
  monthly: MonthPoint[];
  dataQuality: { tier: string; kgCo2e: number; percent: number }[];
  /** Entries captured but not in any total yet — surfaced, never silently dropped. */
  awaitingFactorCount: number;
  flaggedCount: number;
  hasAnyData: boolean;
}

function toNum(d: Prisma.Decimal | number): number {
  return typeof d === "number" ? d : Number(d);
}

const EMPTY_TOTALS: ScopeTotals = {
  scope1: 0,
  scope2Location: 0,
  scope2Market: 0,
  scope3: 0,
  total: 0,
};

/** The same calendar window shifted back exactly one year — "the same dates in the previous reporting period". */
export function previousYearPeriod(periodStart: Date, periodEnd: Date): { start: Date; end: Date } {
  const start = new Date(periodStart);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const end = new Date(periodEnd);
  end.setUTCFullYear(end.getUTCFullYear() - 1);
  return { start, end };
}

type CalcWithEntry = Prisma.CalculationGetPayload<{
  include: { activityEntry: { include: { activityDataPoint: true; site: { include: { entity: true } } } } };
}>;

async function loadCalculations(periodStart: Date, periodEnd: Date): Promise<CalcWithEntry[]> {
  return prisma.calculation.findMany({
    where: {
      activityEntry: {
        periodStart: { gte: periodStart, lte: periodEnd },
        status: { not: "FLAGGED" },
        retractedAt: null,
      },
    },
    include: {
      activityEntry: { include: { activityDataPoint: true, site: { include: { entity: true } } } },
    },
  });
}

function totalsFor(calcs: CalcWithEntry[]): ScopeTotals {
  let scope1 = 0;
  let scope2Location = 0;
  let scope2Market = 0;
  let scope3 = 0;

  for (const c of calcs) {
    const v = toNum(c.resultKgCo2e);
    if (c.scope === "SCOPE_1") scope1 += v;
    else if (c.scope === "SCOPE_2") {
      if (c.basis === "LOCATION_BASED") scope2Location += v;
      else if (c.basis === "MARKET_BASED" || c.basis === "RESIDUAL_MIX") scope2Market += v;
    } else if (c.scope === "SCOPE_3") scope3 += v;
  }

  return { scope1, scope2Location, scope2Market, scope3, total: scope1 + scope2Location + scope3 };
}

export function buildDelta(currentKg: number, previousKg: number): Delta {
  const deltaKg = currentKg - previousKg;
  const deltaPercent = previousKg > 0 ? (deltaKg / previousKg) * 100 : null;
  // A sub-0.05% move is noise, not a trend — don't dress it up as one.
  const isFlat = previousKg > 0 ? Math.abs(deltaPercent ?? 0) < 0.05 : deltaKg === 0;
  const direction: Delta["direction"] = isFlat ? "flat" : deltaKg > 0 ? "up" : "down";
  return {
    currentKg,
    previousKg,
    deltaKg,
    deltaPercent,
    direction,
    // For emissions, down is the good direction. No prior figure => no judgement.
    isImprovement: previousKg === 0 ? null : isFlat ? null : deltaKg < 0,
  };
}

/** Scope 3 rows carry their GHG Protocol category directly; Scope 1/2 use the data point's category. */
function categoryLabel(c: CalcWithEntry): string {
  if (c.scope === "SCOPE_3") return c.scope3Category ?? "Uncategorised";
  return c.activityEntry.activityDataPoint.category;
}

/** Excludes market-based Scope 2 so category totals sum to the headline total. */
function groupByCategory(calcs: CalcWithEntry[]): NamedTotal[] {
  const map = new Map<string, number>();
  for (const c of calcs) {
    if (c.scope === "SCOPE_2" && c.basis !== "LOCATION_BASED") continue;
    const key = categoryLabel(c);
    map.set(key, (map.get(key) ?? 0) + toNum(c.resultKgCo2e));
  }
  return Array.from(map.entries())
    .map(([key, kgCo2e]) => ({ key, label: key, kgCo2e }))
    .sort((a, b) => b.kgCo2e - a.kgCo2e);
}

function buildMonthly(calcs: CalcWithEntry[], periodStart: Date, periodEnd: Date): MonthPoint[] {
  // Seed every month in the window so gaps render as real zeros rather than
  // silently collapsing the x-axis.
  const months = new Map<string, MonthPoint>();
  const cursor = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), 1));
  const last = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), 1));
  while (cursor <= last) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
    months.set(key, {
      month: key,
      label: cursor.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }),
      scope1: 0,
      scope2Location: 0,
      scope3: 0,
      total: 0,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  for (const c of calcs) {
    const d = c.activityEntry.periodStart;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const point = months.get(key);
    if (!point) continue;
    const v = toNum(c.resultKgCo2e);
    if (c.scope === "SCOPE_1") {
      point.scope1 += v;
      point.total += v;
    } else if (c.scope === "SCOPE_2" && c.basis === "LOCATION_BASED") {
      point.scope2Location += v;
      point.total += v;
    } else if (c.scope === "SCOPE_3") {
      point.scope3 += v;
      point.total += v;
    }
  }

  return Array.from(months.values());
}

export async function buildAnalyticsSnapshot(periodStart: Date, periodEnd: Date): Promise<AnalyticsSnapshot> {
  const previous = previousYearPeriod(periodStart, periodEnd);

  const [currentCalcs, previousCalcs, sites, awaitingFactorCount, flaggedCount] = await Promise.all([
    loadCalculations(periodStart, periodEnd),
    loadCalculations(previous.start, previous.end),
    prisma.site.findMany({ where: { isActive: true }, include: { entity: true }, orderBy: [{ entity: { name: "asc" } }, { name: "asc" }] }),
    prisma.activityEntry.count({ where: { periodStart: { gte: periodStart, lte: periodEnd }, status: "AWAITING_FACTOR" } }),
    prisma.activityEntry.count({ where: { periodStart: { gte: periodStart, lte: periodEnd }, status: "FLAGGED" } }),
  ]);

  const group = totalsFor(currentCalcs);
  const previousGroup = totalsFor(previousCalcs);

  const bySiteCurrent = new Map<string, CalcWithEntry[]>();
  for (const c of currentCalcs) {
    const list = bySiteCurrent.get(c.activityEntry.siteId) ?? [];
    list.push(c);
    bySiteCurrent.set(c.activityEntry.siteId, list);
  }
  const bySitePrevious = new Map<string, CalcWithEntry[]>();
  for (const c of previousCalcs) {
    const list = bySitePrevious.get(c.activityEntry.siteId) ?? [];
    list.push(c);
    bySitePrevious.set(c.activityEntry.siteId, list);
  }

  const siteEmissions: SiteEmissions[] = sites.map((site) => {
    const calcs = bySiteCurrent.get(site.id) ?? [];
    return {
      siteId: site.id,
      siteName: site.name,
      entityName: site.entity.name,
      totals: totalsFor(calcs),
      byCategory: groupByCategory(calcs),
    };
  });

  const previousSitesById: Record<string, ScopeTotals> = {};
  for (const site of sites) {
    previousSitesById[site.id] = totalsFor(bySitePrevious.get(site.id) ?? []);
  }

  // Data-quality weighting matches report-service: Scope 1 + Scope 2
  // location-based + all Scope 3, so market-based isn't counted twice.
  const dqCalcs = currentCalcs.filter(
    (c) => c.scope === "SCOPE_1" || c.scope === "SCOPE_3" || (c.scope === "SCOPE_2" && c.basis === "LOCATION_BASED"),
  );
  const dqTotal = dqCalcs.reduce((sum, c) => sum + toNum(c.resultKgCo2e), 0);
  const dataQuality = (["TIER_1", "TIER_2", "TIER_3"] as const).map((tier) => {
    const kgCo2e = dqCalcs.filter((c) => c.dataQualityTier === tier).reduce((s, c) => s + toNum(c.resultKgCo2e), 0);
    return { tier, kgCo2e, percent: dqTotal > 0 ? (kgCo2e / dqTotal) * 100 : 0 };
  });

  return {
    periodStart,
    periodEnd,
    previousPeriodStart: previous.start,
    previousPeriodEnd: previous.end,
    group,
    previousGroup,
    groupDelta: buildDelta(group.total, previousGroup.total),
    scopeDeltas: [
      { scope: "Scope 1", delta: buildDelta(group.scope1, previousGroup.scope1) },
      { scope: "Scope 2", delta: buildDelta(group.scope2Location, previousGroup.scope2Location) },
      { scope: "Scope 3", delta: buildDelta(group.scope3, previousGroup.scope3) },
    ],
    sites: siteEmissions,
    previousSitesById,
    byCategory: groupByCategory(currentCalcs),
    monthly: buildMonthly(currentCalcs, periodStart, periodEnd),
    dataQuality,
    awaitingFactorCount,
    flaggedCount,
    hasAnyData: currentCalcs.length > 0,
  };
}

export { EMPTY_TOTALS };

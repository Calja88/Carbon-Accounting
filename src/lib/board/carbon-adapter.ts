import type { CarbonMetric, CarbonTotals, Coverage, LocalHref, OverviewModel } from "./contracts";
import { assertCoverage, isComplete } from "./metrics";
import { carbonHref } from "./navigation";

/** Mirrors the existing analytics-service ScopeTotals/SiteEmissions/MonthPoint fields in kg. */
export interface AuthorizedAnalyticsWindow {
  group: CarbonTotals;
  sites: { siteId: string; siteName: string; entityName: string; totals: CarbonTotals }[];
  monthly: { month: string; label: string; total: number }[];
}
export interface WindowCoverage {
  group: Coverage; sites: Record<string, Coverage>; months: Record<string, Coverage>;
}
export interface CarbonAdapterInput {
  current: AuthorizedAnalyticsWindow; previous: AuthorizedAnalyticsWindow;
  currentCoverage: WindowCoverage; previousCoverage: WindowCoverage;
  from: string; to: string; previousFrom: string; previousTo: string;
  /** Resolved effective site intersection, not every site from a raw query parameter. */
  permittedSiteIds: readonly string[];
  selectedSiteId?: string;
  /** Reviewed same-scope/source/method keys. Different keys explicitly prevent a comparison. */
  currentComparisonKey: string; previousComparisonKey: string;
  quantifiedCategories: number; screenedCategories: number; asOf: string;
  /** True only when the actual selected electricity companion rows/instrument checks are available. */
  marketBasedAvailable: boolean;
}
const unknownCoverage = (): Coverage => ({ expected: null, received: 0, reviewed: 0, excluded: 0, awaitingFactor: 0, flagged: 0 });
function metric(value: number, coverage: Coverage, comparisonKey: string, href: LocalHref): CarbonMetric {
  assertCoverage(coverage);
  if (!Number.isFinite(value)) throw new Error("Invalid analytics number");
  const missing = coverage.received === 0;
  const result: CarbonMetric = { kgCO2e: missing ? null : value, state: missing ? "missing" : "complete", coverage, comparisonKey, source: { href, label: "View source inventory" } };
  if (!missing && !isComplete(result)) { result.state = "partial"; result.reason = "Partial or unreviewed coverage"; }
  return result;
}
function assertWindow(window: AuthorizedAnalyticsWindow, permitted: readonly string[]) {
  const allowed = new Set(permitted);
  if (new Set(window.sites.map(s => s.siteId)).size !== window.sites.length || window.sites.some(s => !allowed.has(s.siteId))) throw new Error("Analytics site scope mismatch");
  for (const totals of [window.group, ...window.sites.map(s => s.totals)]) {
    if (Object.values(totals).some(v => !Number.isFinite(v))) throw new Error("Non-finite analytics");
    if (Math.abs(totals.total - totals.scope1 - totals.scope2Location - totals.scope3) > .01) throw new Error("Location-based headline does not reconcile");
  }
  for (const key of ["scope1", "scope2Location", "scope2Market", "scope3", "total"] as const) {
    if (Math.abs(window.group[key] - window.sites.reduce((sum,s) => sum+s.totals[key],0)) > .01) throw new Error("Site and group totals do not reconcile");
  }
  if (Math.abs(window.group.total - window.monthly.reduce((sum,m) => sum+m.total,0)) > .01) throw new Error("Monthly and group totals do not reconcile");
}
function assertCoverageWindow(window: AuthorizedAnalyticsWindow, coverage: WindowCoverage) {
  assertCoverage(coverage.group);
  const groups = [window.sites.map(s => coverage.sites[s.siteId]), window.monthly.map(m => coverage.months[m.month])];
  for (const rows of groups) {
    if (rows.some(row => !row)) throw new Error("Missing site/month coverage metadata");
    rows.forEach(assertCoverage);
    for (const key of ["expected", "received", "reviewed", "excluded", "awaitingFactor", "flagged"] as const) {
      if (key === "expected" && (coverage.group.expected === null || rows.some(row => row.expected === null))) {
        if (coverage.group.expected !== null) throw new Error("Group coverage claims a known denominator over unknown sources");
        continue;
      }
      if (rows.reduce((sum,row) => sum + (row[key] ?? 0), 0) !== coverage.group[key]) throw new Error("Site/month coverage does not reconcile with group");
    }
  }
}
/** No queries, fixture data, new arithmetic methodology or database writes. Call AFTER tenant-aware query selection. */
export function buildCarbonSection(input: CarbonAdapterInput): OverviewModel["carbon"] {
  assertWindow(input.current, input.permittedSiteIds); assertWindow(input.previous, input.permittedSiteIds);
  assertCoverageWindow(input.current, input.currentCoverage); assertCoverageWindow(input.previous, input.previousCoverage);
  if (!Number.isInteger(input.quantifiedCategories) || !Number.isInteger(input.screenedCategories) || input.quantifiedCategories < 0 || input.quantifiedCategories > input.screenedCategories || input.screenedCategories > 15) throw new Error("Invalid Scope 3 coverage");
  const currentHref = carbonHref("/carbon", { ...input, siteId: input.selectedSiteId }), previousHref = carbonHref("/carbon", { from: input.previousFrom, to: input.previousTo, siteId: input.selectedSiteId });
  const current = metric(input.current.group.total, input.currentCoverage.group, input.currentComparisonKey, currentHref);
  const previous = metric(input.previous.group.total, input.previousCoverage.group, input.previousComparisonKey, previousHref);
  const previousSites = new Map(input.previous.sites.map(s => [s.siteId,s]));
  const sites = input.current.sites.map(site => {
    const prior = previousSites.get(site.siteId), coverage = input.currentCoverage.sites[site.siteId] ?? unknownCoverage();
    const current = metric(site.totals.total, coverage, `${input.currentComparisonKey}:${site.siteId}`, carbonHref("/carbon", { ...input, siteId: site.siteId }));
    const previous = metric(prior?.totals.total ?? 0, input.previousCoverage.sites[site.siteId] ?? unknownCoverage(), `${input.previousComparisonKey}:${site.siteId}`, carbonHref("/carbon", { from: input.previousFrom, to: input.previousTo, siteId: site.siteId }));
    return { id: site.siteId, name: site.siteName, entity: site.entityName, current, previous, scope1Kg: current.kgCO2e === null ? null : site.totals.scope1, scope2LocationKg: current.kgCO2e === null ? null : site.totals.scope2Location, scope3Kg: current.kgCO2e === null ? null : site.totals.scope3 };
  });
  const priorMonths = new Map(input.previous.monthly.map(m => [m.month,m]));
  const trend = input.current.monthly.map(month => {
    const previousMonth = `${Number(month.month.slice(0,4))-1}${month.month.slice(4)}`;
    const prior = priorMonths.get(previousMonth), currentCoverage = input.currentCoverage.months[month.month] ?? unknownCoverage();
    const previousCoverage = input.previousCoverage.months[previousMonth] ?? unknownCoverage();
    return { month: month.month, label: month.label, currentKg: currentCoverage.received ? month.total : null, previousKg: previousCoverage.received && prior ? prior.total : null, href: carbonHref("/carbon", { from: month.month, to: month.month, siteId: input.selectedSiteId }) };
  });
  return { state: "ready", asOf: input.asOf, data: { current, previous, marketBasedKg: current.kgCO2e === null || !input.marketBasedAvailable ? null : input.current.group.scope2Market, quantifiedCategories: input.quantifiedCategories, screenedCategories: input.screenedCategories, sites, trend } };
}

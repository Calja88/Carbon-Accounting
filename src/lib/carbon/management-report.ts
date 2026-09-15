/**
 * Phase 5A — the Management Carbon Report's read model.
 *
 * Pure: no Prisma, no dates resolved from the clock, no arithmetic
 * methodology of its own. Everything here is a *presentation* of figures the
 * existing authoritative services already produced —
 * `buildAnalyticsSnapshot` for emissions, `getCollectionMatrix` for
 * completeness, `getReportingPeriod` for OPEN/CLOSED — so a management
 * figure and the dashboard figure for the same period can never disagree.
 * Same split as the board sprint's carbon-adapter.ts (pure) /
 * live-overview.ts (queries), and for the same reason: every rule below is
 * exhaustively testable without a database.
 *
 * Two honesty rules run through the whole file, because a management report
 * that gets them wrong misstates an inventory:
 *
 *  1. Missing is never zero. A month nobody submitted data for carries
 *     `null`, not `0`; a share of an absent total is `null`, not `0%`; a
 *     Scope 3 category nobody assessed is "not assessed", not "0 tCO₂e".
 *  2. Scope 2 location-based and market-based are companion views of the
 *     same electricity, never addends. The headline total is
 *     Scope 1 + Scope 2 location-based + Scope 3, and says so.
 */
import { buildDelta, type Delta, type ScopeTotals } from "@/lib/analytics-service";
import type { CollectionStatus } from "@/lib/carbon/collection-plan-service";
import type { LocalHref } from "@/lib/board/contracts";
import { carbonHref, localHref } from "@/lib/board/navigation";

/** Headline basis, stated on the report rather than left to be inferred. */
export const HEADLINE_BASIS = "Scope 1 + Scope 2 (location-based) + Scope 3";

/**
 * The state of the Phase 4-ii reporting periods underneath a selection.
 * A range covers one period per site per month, so a single OPEN/CLOSED
 * label is usually a lie — `MIXED` is the truthful answer and carries its
 * own counts.
 */
export type PeriodStateKind = "OPEN" | "CLOSED" | "MIXED" | "NONE";
export interface PeriodStateSummary {
  kind: PeriodStateKind;
  closed: number;
  total: number;
  label: string;
}

export type Scope3CategoryState = "quantified" | "zero" | "no_data";

export interface ManagementKpi {
  key: "total" | "scope1" | "scope2Location" | "scope2Market" | "scope3";
  label: string;
  kgCo2e: number | null;
  /** Companion figures sit outside the headline addition. */
  inHeadline: boolean;
  note?: string;
}

export interface ComparisonRow {
  key: ManagementKpi["key"];
  label: string;
  currentKg: number | null;
  previousKg: number | null;
  /** Null when the two periods are not comparable — never a manufactured percentage. */
  delta: Delta | null;
  note: string | null;
}

export interface ManagementSiteRow {
  siteId: string;
  siteName: string;
  entityName: string;
  scope1: number;
  scope2Location: number;
  scope2Market: number;
  total: number;
  scope3: number;
  /** Null when the group total is absent or zero — a share of nothing is not 0%. */
  sharePercent: number | null;
  delta: Delta;
  periodState: PeriodStateSummary;
  href: LocalHref;
}

export interface Scope3CategoryRow {
  category: string;
  kgCo2e: number | null;
  sharePercent: number | null;
  state: Scope3CategoryState;
  href: LocalHref;
}

export interface TopSourceRow {
  key: string;
  category: string;
  siteName: string;
  scopeLabel: "Scope 1" | "Scope 2" | "Scope 3";
  kgCo2e: number;
  sharePercent: number | null;
  href: LocalHref;
}

export interface TrendMonth {
  month: string;
  label: string;
  /** Null when no activity data was received for this month — distinct from a genuine 0. */
  totalKg: number | null;
  scope1: number | null;
  scope2Location: number | null;
  scope3: number | null;
  reported: boolean;
  href: LocalHref;
}

export interface CompletenessRow {
  status: CollectionStatus;
  label: string;
  count: number;
}

export interface CompletenessSummary {
  rows: CompletenessRow[];
  /** Cells an enabled source genuinely requires for this window. */
  required: number;
  /** Authorised exclusions — removed from the denominator, never counted as received. */
  excluded: number;
  received: number;
  missing: number;
  /** Received of (required − excluded). Null when nothing is required, never 0%. */
  receivedPercent: number | null;
  /** Received *and* already carried into the totals above (not awaiting a factor). */
  countedInTotals: number;
  basis: string;
}

export type OutstandingKind = "missing" | "awaiting_factor" | "flagged" | "changed_since_review";
export interface OutstandingRow {
  kind: OutstandingKind;
  label: string;
  detail: string;
  count: number;
  href: LocalHref;
}

export interface FactorSourceRow {
  source: string;
  vintage: string;
  scope: string;
  /** EmissionFactorSet.isPlaceholder — true until a real official file is imported. */
  placeholder: boolean;
}

export interface MethodologyView {
  boundary: string;
  scope2Basis: string;
  headlineBasis: string;
  factorSources: FactorSourceRow[];
  placeholderFactorsUsed: boolean;
  engineVersions: string[];
  /** Deliberately never "verified"/"assured" unless the domain records it — nothing here does yet. */
  assurance: string;
  scope3Note: string;
}

export interface ManagementReport {
  organisationName: string;
  periodLabel: string;
  previousPeriodLabel: string;
  siteFilterName: string | null;
  periodState: PeriodStateSummary;
  kpis: ManagementKpi[];
  comparison: ComparisonRow[];
  comparisonNote: string | null;
  comparable: boolean;
  sites: ManagementSiteRow[];
  scope3Categories: Scope3CategoryRow[];
  scope3NotAssessed: number;
  topSources: TopSourceRow[];
  trend: TrendMonth[];
  completeness: CompletenessSummary;
  outstanding: OutstandingRow[];
  methodology: MethodologyView;
  dataQuality: { tier: string; kgCo2e: number; percent: number }[];
  /** Nothing at all has been recorded for either period — an honest empty state, not a failure. */
  empty: boolean;
  capturedAt: string;
}

/**
 * The GHG Protocol Scope 3 categories this platform actually represents.
 * The other eleven are not modelled, so they are reported as "not assessed"
 * rather than as eleven zeroes — there is no Scope 3 screening record
 * anywhere in this codebase to claim otherwise.
 */
export const GHG_SCOPE3_CATEGORY_COUNT = 15;

const COMPLETENESS_LABEL: Record<CollectionStatus, string> = {
  reviewed: "Reviewed",
  submitted: "Submitted",
  awaiting_factor: "Awaiting emission factor",
  changed_since_review: "Changed since review",
  missing: "Not yet received",
  excluded: "Excluded (authorised)",
  not_required: "Not required",
};

/** Received means a submission exists for the cell, whatever its downstream state. */
const RECEIVED_STATUSES: readonly CollectionStatus[] = ["reviewed", "submitted", "awaiting_factor", "changed_since_review"];
/** Received *and* already contributing a figure to the totals above. */
const COUNTED_STATUSES: readonly CollectionStatus[] = ["reviewed", "submitted", "changed_since_review"];

const OUTSTANDING_LABEL: Record<OutstandingKind, { label: string; detail: string }> = {
  missing: { label: "Activity data not yet received", detail: "A required source has no submission for its period, so its emissions are absent from the figures above." },
  awaiting_factor: { label: "Awaiting an emission factor", detail: "Real activity data is recorded but no matching factor has been imported, so it is not in the totals yet." },
  flagged: { label: "Held back for review", detail: "A submission looked implausible and is excluded from the figures until somebody reviews it." },
  changed_since_review: { label: "Changed since it was reviewed", detail: "The submission or its calculation moved after review, so the review no longer covers what is in the figures." },
};

function share(part: number | null, total: number | null): number | null {
  if (part === null || total === null || !Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  return (part / total) * 100;
}

/**
 * The Activity Data Register's own filter vocabulary is `EntryStatus`, so
 * only the states a real `ActivityEntry` actually carries can be handed to
 * it. `missing` and `changed_since_review` are collection-plan facts about a
 * *requirement* — one nobody submitted against, and one whose submission
 * moved after it was reviewed — and have no entry to point at.
 */
const ENTRY_STATUS_FOR: Partial<Record<OutstandingKind, "AWAITING_FACTOR" | "FLAGGED">> = {
  awaiting_factor: "AWAITING_FACTOR",
  flagged: "FLAGGED",
};

/**
 * Every drill-down out of this report goes through here, so there is exactly
 * one place that decides where a figure leads.
 *
 * A site, a scope, or a state a real entry carries goes to the Activity Data
 * Register (`/activity`), which lists the underlying records themselves. A
 * collection-plan-only state stays on the Data Collection plan (`/data`),
 * because that is where the requirement it describes actually lives. Both
 * routes take `from`/`to`/`siteId`/`scope`/`status`, so the period and the
 * filter the reader clicked survive the jump either way.
 */
export function activityDrilldownHref(
  scope: { from: string; to: string; siteId?: string },
  filter: { scope?: "SCOPE_1" | "SCOPE_2" | "SCOPE_3"; status?: OutstandingKind } = {},
): LocalHref {
  const entryStatus = filter.status ? ENTRY_STATUS_FOR[filter.status] : undefined;
  const planOnly = filter.status !== undefined && entryStatus === undefined;
  const base = carbonHref(planOnly ? "/data" : "/activity", scope);
  const status = entryStatus ?? (planOnly ? filter.status : undefined);
  const extra = [
    filter.scope ? `scope=${filter.scope}` : null,
    status ? `status=${status}` : null,
  ].filter((part): part is string => part !== null);
  return extra.length ? localHref(`${base}&${extra.join("&")}`) : base;
}

function summarisePeriodStates(states: readonly { state: "OPEN" | "CLOSED" }[]): PeriodStateSummary {
  const total = states.length;
  const closed = states.filter((s) => s.state === "CLOSED").length;
  if (total === 0) return { kind: "NONE", closed: 0, total: 0, label: "No reporting periods in this selection" };
  if (closed === 0) return { kind: "OPEN", closed, total, label: total === 1 ? "Open" : `Open — all ${total} site-months` };
  if (closed === total) return { kind: "CLOSED", closed, total, label: total === 1 ? "Closed" : `Closed — all ${total} site-months` };
  return { kind: "MIXED", closed, total, label: `Partly closed — ${closed} of ${total} site-months closed` };
}

export interface ManagementReportInput {
  organisationName: string;
  periodLabel: string;
  previousPeriodLabel: string;
  /** YYYY-MM bounds of the selection, used to build drill-down links. */
  from: string;
  to: string;
  selectedSiteId?: string;
  siteFilterName?: string | null;
  group: ScopeTotals;
  previousGroup: ScopeTotals;
  sites: {
    siteId: string;
    siteName: string;
    entityName: string;
    totals: ScopeTotals;
  }[];
  previousSitesById: Record<string, ScopeTotals>;
  monthly: { month: string; label: string; scope1: number; scope2Location: number; scope3: number; total: number }[];
  /** Months (YYYY-MM) that actually received activity data. A month absent here is a gap, not a zero. */
  monthsWithData: readonly string[];
  /** Same, for the comparison window — a comparison against a period with no data is not a reduction. */
  previousMonthsWithData: readonly string[];
  previousMonthsInRange: number;
  /** Authoritative Calculation rows grouped by site × scope × category, location-based Scope 2 only. */
  sourceRows: { siteId: string; siteName: string; scope: "SCOPE_1" | "SCOPE_2" | "SCOPE_3"; category: string; kgCo2e: number }[];
  /** Canonical Scope 3 categories this platform represents (from the factor catalogue). */
  scope3Catalogue: readonly string[];
  /** Scope 3 totals actually calculated this period, by canonical category. */
  scope3Totals: Record<string, number>;
  /** One entry per (site, month) reporting period in the selection. */
  reportingPeriods: { siteId: string; month: string; state: "OPEN" | "CLOSED" }[];
  collectionStatuses: readonly CollectionStatus[];
  flaggedCount: number;
  factorSources: FactorSourceRow[];
  engineVersions: readonly string[];
  boundary: string;
  dataQuality: { tier: string; kgCo2e: number; percent: number }[];
  /** True only when real market-based/residual-mix companion rows exist — never assumed. */
  marketBasedAvailable: boolean;
  capturedAt: string;
  topSourceLimit?: number;
}

/**
 * Guards the one thing a second grouping of the same Calculation rows could
 * get wrong: drifting away from the authoritative headline. If the ranked
 * source rows do not add back up to Scope 1 + Scope 2 location-based +
 * Scope 3, the report refuses to render rather than showing a hotspot list
 * that quietly disagrees with its own total.
 */
function assertSourcesReconcile(input: ManagementReportInput): void {
  const sum = input.sourceRows.reduce((total, row) => total + row.kgCo2e, 0);
  if (Math.abs(sum - input.group.total) > 0.01) {
    throw new Error("Top sources do not reconcile with the headline total");
  }
}

function assertHeadlineReconciles(group: ScopeTotals): void {
  if (Math.abs(group.total - group.scope1 - group.scope2Location - group.scope3) > 0.01) {
    throw new Error("Headline total does not reconcile with its scope split");
  }
}

export const UNATTRIBUTED_SITE_NAME = "Not attributed to an active site";

/**
 * The site table must add up to the report total, and the way to guarantee
 * that is to show the remainder rather than to hide it. A result whose site
 * is no longer active still counts towards the organisation's emissions, so
 * it gets its own honest row instead of being silently dropped — or worse,
 * spread across the sites that happen to be listed.
 */
function withUnattributedRemainder(input: ManagementReportInput): ManagementReportInput["sites"] {
  const keys = ["scope1", "scope2Location", "scope2Market", "scope3", "total"] as const;
  const short = (key: (typeof keys)[number]) => input.group[key] - input.sites.reduce((sum, site) => sum + site.totals[key], 0);
  if (keys.every((key) => Math.abs(short(key)) <= 0.01)) return input.sites;
  const remainder: ScopeTotals = {
    scope1: short("scope1"),
    scope2Location: short("scope2Location"),
    scope2Market: short("scope2Market"),
    scope3: short("scope3"),
    total: short("total"),
  };
  return [
    ...input.sites,
    { siteId: "", siteName: UNATTRIBUTED_SITE_NAME, entityName: "Unattributed", totals: remainder },
  ];
}

export function buildManagementReport(input: ManagementReportInput): ManagementReport {
  assertHeadlineReconciles(input.group);
  assertSourcesReconcile(input);
  const siteRows = withUnattributedRemainder(input);

  const reportedMonths = new Set(input.monthsWithData);
  const anyCurrentData = reportedMonths.size > 0;
  const anyPreviousData = input.previousMonthsWithData.length > 0;
  const scope = { from: input.from, to: input.to, siteId: input.selectedSiteId };

  // A period nobody submitted anything for has no total — showing 0 tCO₂e
  // would read as "we emitted nothing", which is a different claim.
  const totalKg = anyCurrentData ? input.group.total : null;

  const kpis: ManagementKpi[] = [
    { key: "total", label: "Total emissions", kgCo2e: totalKg, inHeadline: true, note: HEADLINE_BASIS },
    { key: "scope1", label: "Scope 1 — direct", kgCo2e: anyCurrentData ? input.group.scope1 : null, inHeadline: true },
    { key: "scope2Location", label: "Scope 2 — location-based", kgCo2e: anyCurrentData ? input.group.scope2Location : null, inHeadline: true, note: "In the headline total" },
    {
      key: "scope2Market",
      label: "Scope 2 — market-based",
      kgCo2e: anyCurrentData && input.marketBasedAvailable ? input.group.scope2Market : null,
      inHeadline: false,
      note: input.marketBasedAvailable
        ? "Companion view of the same electricity — never added to the total"
        : "No market-based contract or residual-mix figure recorded for this period",
    },
    { key: "scope3", label: "Scope 3 — value chain", kgCo2e: anyCurrentData ? input.group.scope3 : null, inHeadline: true },
  ];

  // Comparability is decided once, here, and every row honours it. The
  // failure this prevents is the worst one a carbon report can make:
  // announcing a 100% reduction that is really an empty current period.
  const comparable = anyCurrentData && anyPreviousData;
  const comparisonNote = !anyPreviousData
    ? `No activity data was recorded for ${input.previousPeriodLabel}, so no change is stated.`
    : !anyCurrentData
      ? `No activity data has been recorded for ${input.periodLabel} yet. The difference against ${input.previousPeriodLabel} would reflect missing data, not a reduction, so no change is stated.`
      : input.previousMonthsWithData.length < input.previousMonthsInRange
        ? `${input.previousPeriodLabel} is only partly reported (${input.previousMonthsWithData.length} of ${input.previousMonthsInRange} months), so the change below compares against an incomplete period.`
        : null;

  const comparisonRows: { key: ComparisonRow["key"]; label: string; current: number; previous: number; companion?: boolean }[] = [
    { key: "scope1", label: "Scope 1 — direct", current: input.group.scope1, previous: input.previousGroup.scope1 },
    { key: "scope2Location", label: "Scope 2 — location-based", current: input.group.scope2Location, previous: input.previousGroup.scope2Location },
    { key: "scope2Market", label: "Scope 2 — market-based (companion)", current: input.group.scope2Market, previous: input.previousGroup.scope2Market, companion: true },
    { key: "scope3", label: "Scope 3 — value chain", current: input.group.scope3, previous: input.previousGroup.scope3 },
    { key: "total", label: `Total (${HEADLINE_BASIS})`, current: input.group.total, previous: input.previousGroup.total },
  ];

  const comparison: ComparisonRow[] = comparisonRows.map((row) => {
    const companionUnavailable = row.companion && !input.marketBasedAvailable;
    const currentKg = anyCurrentData && !companionUnavailable ? row.current : null;
    const previousKg = anyPreviousData && !companionUnavailable ? row.previous : null;
    if (currentKg === null || previousKg === null) {
      return {
        key: row.key,
        label: row.label,
        currentKg,
        previousKg,
        delta: null,
        note: companionUnavailable ? "No market-based figure recorded" : comparisonNote,
      };
    }
    // buildDelta already returns a null percentage against a zero prior
    // figure, so a zero denominator can never become a percentage here.
    const delta = buildDelta(currentKg, previousKg);
    return {
      key: row.key,
      label: row.label,
      currentKg,
      previousKg,
      delta,
      note: delta.deltaPercent === null ? `Nothing was recorded for this line in ${input.previousPeriodLabel}, so no percentage change can be stated.` : null,
    };
  });

  const periodsBySite = new Map<string, { state: "OPEN" | "CLOSED" }[]>();
  for (const period of input.reportingPeriods) {
    const list = periodsBySite.get(period.siteId);
    if (list) list.push({ state: period.state });
    else periodsBySite.set(period.siteId, [{ state: period.state }]);
  }

  const sites: ManagementSiteRow[] = siteRows
    .map((site) => ({
      siteId: site.siteId,
      siteName: site.siteName,
      entityName: site.entityName,
      scope1: site.totals.scope1,
      scope2Location: site.totals.scope2Location,
      scope2Market: site.totals.scope2Market,
      scope3: site.totals.scope3,
      total: site.totals.total,
      sharePercent: share(site.totals.total, totalKg),
      delta: buildDelta(site.totals.total, input.previousSitesById[site.siteId]?.total ?? 0),
      periodState: summarisePeriodStates(periodsBySite.get(site.siteId) ?? []),
      href: activityDrilldownHref({ from: input.from, to: input.to, siteId: site.siteId }),
    }))
    .sort((a, b) => b.total - a.total);

  const scope3Categories: Scope3CategoryRow[] = [...input.scope3Catalogue]
    .map((category) => {
      const raw = input.scope3Totals[category];
      // A category the platform models but this period produced no
      // calculation for is "no data" — never a zero, which would claim the
      // activity happened and emitted nothing.
      const quantified = raw !== undefined;
      const kgCo2e = quantified ? raw : null;
      return {
        category,
        kgCo2e,
        sharePercent: share(kgCo2e, totalKg),
        state: (!quantified ? "no_data" : raw === 0 ? "zero" : "quantified") as Scope3CategoryState,
        href: activityDrilldownHref(scope, { scope: "SCOPE_3" }),
      };
    })
    .sort((a, b) => (b.kgCo2e ?? -1) - (a.kgCo2e ?? -1));

  const topSources: TopSourceRow[] = [...input.sourceRows]
    .filter((row) => row.kgCo2e > 0)
    .sort((a, b) => b.kgCo2e - a.kgCo2e || a.siteName.localeCompare(b.siteName) || a.category.localeCompare(b.category))
    .slice(0, input.topSourceLimit ?? 5)
    .map((row) => ({
      key: `${row.siteId}:${row.scope}:${row.category}`,
      category: row.category,
      siteName: row.siteName,
      scopeLabel: (row.scope === "SCOPE_1" ? "Scope 1" : row.scope === "SCOPE_2" ? "Scope 2" : "Scope 3") as TopSourceRow["scopeLabel"],
      kgCo2e: row.kgCo2e,
      sharePercent: share(row.kgCo2e, totalKg),
      href: activityDrilldownHref({ from: input.from, to: input.to, siteId: row.siteId }, { scope: row.scope }),
    }));

  const trend: TrendMonth[] = input.monthly.map((month) => {
    const reported = reportedMonths.has(month.month);
    return {
      month: month.month,
      label: month.label,
      totalKg: reported ? month.total : null,
      scope1: reported ? month.scope1 : null,
      scope2Location: reported ? month.scope2Location : null,
      scope3: reported ? month.scope3 : null,
      reported,
      href: carbonHref("/", { from: month.month, to: month.month, siteId: input.selectedSiteId }),
    };
  });

  const counts = new Map<CollectionStatus, number>();
  for (const status of input.collectionStatuses) counts.set(status, (counts.get(status) ?? 0) + 1);
  const countOf = (statuses: readonly CollectionStatus[]) => statuses.reduce((sum, s) => sum + (counts.get(s) ?? 0), 0);
  const required = input.collectionStatuses.length - (counts.get("not_required") ?? 0);
  const excludedCells = counts.get("excluded") ?? 0;
  const receivedCells = countOf(RECEIVED_STATUSES);
  const denominator = required - excludedCells;
  const completeness: CompletenessSummary = {
    rows: (Object.keys(COMPLETENESS_LABEL) as CollectionStatus[])
      .filter((status) => status !== "not_required" && (counts.get(status) ?? 0) > 0)
      .map((status) => ({ status, label: COMPLETENESS_LABEL[status], count: counts.get(status) ?? 0 })),
    required,
    excluded: excludedCells,
    received: receivedCells,
    missing: counts.get("missing") ?? 0,
    // No required sources means there is no denominator to report against —
    // an honest blank, never a 0% or a 100% invented from an empty plan.
    receivedPercent: denominator > 0 ? (receivedCells / denominator) * 100 : null,
    countedInTotals: countOf(COUNTED_STATUSES),
    basis: "Each required site, source and period in the collection plan counts once. Authorised exclusions are removed from the denominator rather than counted as received.",
  };

  const outstanding: OutstandingRow[] = (
    [
      ["missing", counts.get("missing") ?? 0],
      ["awaiting_factor", counts.get("awaiting_factor") ?? 0],
      ["changed_since_review", counts.get("changed_since_review") ?? 0],
      // `flagged` is an ActivityEntry QA state rather than a collection-plan
      // cell state, which is exactly why it resolves to the register.
      ["flagged", input.flaggedCount],
    ] as [OutstandingKind, number][]
  )
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => ({ kind, count, ...OUTSTANDING_LABEL[kind], href: activityDrilldownHref(scope, { status: kind }) }))
    .sort((a, b) => b.count - a.count);

  const placeholderFactorsUsed = input.factorSources.some((f) => f.placeholder);

  return {
    organisationName: input.organisationName,
    periodLabel: input.periodLabel,
    previousPeriodLabel: input.previousPeriodLabel,
    siteFilterName: input.siteFilterName ?? null,
    periodState: summarisePeriodStates(input.reportingPeriods),
    kpis,
    comparison,
    comparisonNote,
    comparable,
    sites,
    scope3Categories,
    scope3NotAssessed: Math.max(0, GHG_SCOPE3_CATEGORY_COUNT - input.scope3Catalogue.length),
    topSources,
    trend,
    completeness,
    outstanding,
    methodology: {
      boundary: input.boundary,
      scope2Basis: "Dual-reported. Location-based is used in the headline total; market-based is shown alongside it.",
      headlineBasis: HEADLINE_BASIS,
      factorSources: input.factorSources,
      placeholderFactorsUsed,
      engineVersions: [...input.engineVersions],
      // The platform records no verification, approval or assurance
      // decision for an inventory, so this never claims one. Phase 3-vii
      // factor publication is deferred, and a placeholder factor set is
      // not a published one.
      assurance: placeholderFactorsUsed
        ? "Management information. Some figures use placeholder emission factors that have not been replaced with an imported official dataset, so this is not suitable for formal or assured disclosure."
        : "Management information. No independent verification or assurance decision is recorded for this inventory.",
      scope3Note: "Scope 3 screening is not recorded for this reporting boundary, so categories this platform does not model are reported as not assessed rather than as zero.",
    },
    dataQuality: input.dataQuality,
    empty: !anyCurrentData && !anyPreviousData,
    capturedAt: input.capturedAt,
  };
}

export { summarisePeriodStates, share as sharePercent };
export type { Delta };

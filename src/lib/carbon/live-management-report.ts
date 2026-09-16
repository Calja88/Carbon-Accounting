/**
 * Phase 5A — the Management Carbon Report's one read path.
 *
 * This module does the querying; `management-report.ts` does the reasoning.
 * Nothing here recalculates an emission: every figure comes from
 * `buildAnalyticsSnapshot` (the same aggregation the dashboard and the
 * frozen report already use) or from rows the calculation engine wrote.
 * The extra reads below exist only to answer questions the dashboard
 * doesn't ask — which months genuinely received data, which reporting
 * periods are closed, which factor sets are still placeholders, and how the
 * collection plan says complete the period is.
 *
 * Authorization is this module's responsibility, exactly as in
 * live-overview.ts: `requireCarbonView` first, every query tenant-scoped,
 * and an explicitly selected site re-checked with `requireSiteInScope` so a
 * foreign id is rejected rather than quietly widened.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatFactorSource } from "@/lib/format";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requireCarbonView } from "@/lib/rbac/carbon-access";
import { accessibleActivityEntryFilter, requireSiteInScope, toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { buildAnalyticsSnapshot, previousYearPeriod } from "@/lib/analytics-service";
import { formatRangeLabel, resolveMonthRange } from "@/lib/report-period";
import { getCollectionMatrix, type CollectionStatus } from "@/lib/carbon/collection-plan-service";
import { buildManagementReport, type FactorSourceRow, type ManagementReport } from "@/lib/carbon/management-report";

export interface ManagementReportSearchParams {
  from?: string;
  to?: string;
  siteId?: string;
}

function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthKeysInRange(periodStart: Date, periodEnd: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), 1));
  const last = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), 1));
  while (cursor <= last) {
    keys.push(monthKeyOf(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

function toNum(value: Prisma.Decimal | number): number {
  return typeof value === "number" ? value : Number(value);
}

/**
 * Months that actually received activity data, from ActivityEntry rows
 * rather than from calculations: an entry awaiting a factor is a month
 * somebody reported, even though it contributes nothing to the totals yet.
 * A month missing from this set is a gap in reporting; a month in it whose
 * emissions come to zero is a genuine zero.
 */
async function monthsWithData(
  context: OrganisationContext,
  periodStart: Date,
  periodEnd: Date,
  restrictToSiteIds: readonly string[] | undefined,
  db: Prisma.TransactionClient,
): Promise<string[]> {
  const ctx = toTenantRepositoryContext(context);
  const rows = await db.activityEntry.findMany({
    where: tenantWhere<Prisma.ActivityEntryWhereInput>(ctx, {
      periodStart: { gte: periodStart, lte: periodEnd },
      ...accessibleActivityEntryFilter(context),
      ...(restrictToSiteIds ? { siteId: { in: [...restrictToSiteIds] } } : {}),
    }),
    select: { periodStart: true },
  });
  return [...new Set(rows.map((row) => monthKeyOf(row.periodStart)))];
}

export async function loadManagementReport(
  context: OrganisationContext,
  searchParams: ManagementReportSearchParams,
  db: Prisma.TransactionClient = prisma,
  now: Date = new Date(),
): Promise<ManagementReport> {
  requireCarbonView(context); // a denial fails here, never as an empty report
  const ctx = toTenantRepositoryContext(context);
  const range = resolveMonthRange(searchParams.from, searchParams.to, now);
  const selectedSiteId = searchParams.siteId?.trim() || undefined;
  // Rejects a foreign or out-of-scope site rather than broadening to all sites.
  const selectedSite = selectedSiteId ? await requireSiteInScope(context, selectedSiteId, db) : null;
  const restrictToSiteIds = selectedSite ? [selectedSite.id] : undefined;
  const prior = previousYearPeriod(range.periodStart, range.periodEnd);

  const analytics = await buildAnalyticsSnapshot(context, range.periodStart, range.periodEnd, restrictToSiteIds, db);

  const accessibleSiteIds = analytics.sites.map((site) => site.siteId);
  const months = monthKeysInRange(range.periodStart, range.periodEnd);

  const [current, previous, calculations, scope3Catalogue, reportingPeriodRows, matrix] = await Promise.all([
    monthsWithData(context, range.periodStart, range.periodEnd, restrictToSiteIds, db),
    monthsWithData(context, prior.start, prior.end, restrictToSiteIds, db),
    // The same Calculation rows the analytics snapshot summed, read once
    // more so they can be ranked by site × scope × category. Identical
    // inclusion rule (FLAGGED excluded); the adapter refuses to render if
    // the ranking does not add back up to the authoritative total.
    db.calculation.findMany({
      where: tenantWhere<Prisma.CalculationWhereInput>(ctx, {
        activityEntry: {
          periodStart: { gte: range.periodStart, lte: range.periodEnd },
          status: { not: "FLAGGED" },
          ...accessibleActivityEntryFilter(context),
          ...(restrictToSiteIds ? { siteId: { in: [...restrictToSiteIds] } } : {}),
        },
      }),
      select: {
        scope: true,
        basis: true,
        scope3Category: true,
        resultKgCo2e: true,
        engineVersion: true,
        factorSourceSnapshot: true,
        factorVintageSnapshot: true,
        emissionFactor: { select: { factorSet: { select: { isPlaceholder: true } } } },
        activityEntry: { select: { siteId: true, site: { select: { name: true } }, activityDataPoint: { select: { category: true } } } },
      },
    }),
    // The canonical Scope 3 categories this platform models at all. Read
    // from the catalogue, plus the categories the Cat 3 derivation writes
    // straight onto a calculation without a data point of its own.
    db.activityDataPoint.findMany({ where: { scope3Category: { not: null } }, select: { scope3Category: true }, distinct: ["scope3Category"] }),
    db.reportingPeriod.findMany({
      where: tenantWhere<Prisma.ReportingPeriodWhereInput>(ctx, {
        siteId: { in: accessibleSiteIds },
        monthStart: { gte: new Date(Date.UTC(range.periodStart.getUTCFullYear(), range.periodStart.getUTCMonth(), 1)), lte: range.periodEnd },
      }),
      select: { siteId: true, monthStart: true, state: true },
    }),
    getCollectionMatrix(context, { periodStart: range.periodStart, periodEnd: range.periodEnd, siteId: selectedSite?.id }, db, now),
  ]);

  // Location-based Scope 2 only, so the ranked sources sum to the same
  // headline the KPIs show — the market-based companion is not an addend.
  const sourceTotals = new Map<string, { siteId: string; siteName: string; scope: "SCOPE_1" | "SCOPE_2" | "SCOPE_3"; category: string; kgCo2e: number }>();
  const scope3Totals: Record<string, number> = {};
  const factorSourceMap = new Map<string, FactorSourceRow>();
  const engineVersions = new Set<string>();
  let marketBasedRows = 0;

  for (const calc of calculations) {
    engineVersions.add(calc.engineVersion);
    const factorKey = `${calc.factorSourceSnapshot}|${calc.factorVintageSnapshot}|${calc.scope}`;
    if (!factorSourceMap.has(factorKey)) {
      factorSourceMap.set(factorKey, {
        source: formatFactorSource(calc.factorSourceSnapshot),
        vintage: calc.factorVintageSnapshot,
        scope: calc.scope,
        placeholder: calc.emissionFactor?.factorSet?.isPlaceholder ?? false,
      });
    }
    if (calc.scope === "SCOPE_2" && calc.basis !== "LOCATION_BASED") {
      marketBasedRows += 1;
      continue;
    }
    const category = calc.scope === "SCOPE_3" ? calc.scope3Category ?? "Uncategorised" : calc.activityEntry.activityDataPoint.category;
    const value = toNum(calc.resultKgCo2e);
    const key = `${calc.activityEntry.siteId}|${calc.scope}|${category}`;
    const existing = sourceTotals.get(key);
    if (existing) existing.kgCo2e += value;
    else
      sourceTotals.set(key, {
        siteId: calc.activityEntry.siteId,
        siteName: calc.activityEntry.site.name,
        scope: calc.scope as "SCOPE_1" | "SCOPE_2" | "SCOPE_3",
        category,
        kgCo2e: value,
      });
    if (calc.scope === "SCOPE_3") scope3Totals[category] = (scope3Totals[category] ?? 0) + value;
  }

  const catalogue = [
    ...new Set([
      ...scope3Catalogue.map((row) => row.scope3Category).filter((c): c is string => c !== null),
      ...Object.keys(scope3Totals),
    ]),
  ].sort();

  const reportingPeriodByKey = new Map(reportingPeriodRows.map((row) => [`${row.siteId}|${monthKeyOf(row.monthStart)}`, row.state]));
  // Phase 4-ii: a month with no row has never been closed, so it is OPEN.
  // Every site-month in the selection is represented, so "partly closed"
  // can be stated truthfully instead of labelling a whole range CLOSED.
  const reportingPeriods = accessibleSiteIds.flatMap((siteId) =>
    months.map((month) => ({ siteId, month, state: (reportingPeriodByKey.get(`${siteId}|${month}`) ?? "OPEN") as "OPEN" | "CLOSED" })),
  );

  const organisation = await db.organisation.findUnique({ where: { id: context.organisationId }, select: { name: true } });
  const organisationName = organisation?.name ?? context.organisationSlug;

  return buildManagementReport({
    organisationName,
    periodLabel: formatRangeLabel(range.periodStart, range.periodEnd),
    previousPeriodLabel: formatRangeLabel(prior.start, prior.end),
    from: range.startMonth,
    to: range.endMonth,
    selectedSiteId: selectedSite?.id,
    siteFilterName: selectedSite?.name ?? null,
    group: analytics.group,
    previousGroup: analytics.previousGroup,
    sites: analytics.sites.map((site) => ({ siteId: site.siteId, siteName: site.siteName, entityName: site.entityName, totals: site.totals })),
    previousSitesById: analytics.previousSitesById,
    monthly: analytics.monthly,
    monthsWithData: current,
    previousMonthsWithData: previous,
    previousMonthsInRange: months.length,
    sourceRows: [...sourceTotals.values()],
    scope3Catalogue: catalogue,
    scope3Totals,
    reportingPeriods,
    collectionStatuses: matrix.map((row) => row.status as CollectionStatus),
    flaggedCount: analytics.flaggedCount,
    factorSources: [...factorSourceMap.values()].sort((a, b) => a.scope.localeCompare(b.scope) || a.source.localeCompare(b.source)),
    engineVersions: [...engineVersions].sort(),
    boundary: `${organisationName} — operational control. ${selectedSite ? `Narrowed to ${selectedSite.name}.` : "All sites you have access to."}`,
    dataQuality: analytics.dataQuality,
    marketBasedAvailable: marketBasedRows > 0,
    capturedAt: now.toISOString(),
  });
}

export { monthKeysInRange };

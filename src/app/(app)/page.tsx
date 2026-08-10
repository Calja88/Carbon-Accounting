import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, FlagTriangleRight } from "lucide-react";
import { getSiteQuantityStatus } from "@/lib/entry-status";
import { buildAnalyticsSnapshot, buildDelta } from "@/lib/analytics-service";
import { formatRangeLabel, resolveMonthRange } from "@/lib/report-period";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { accessibleSiteFilter, toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ENTITY_LOGOS } from "@/lib/entity-logos";
import { PeriodSelector } from "./period-selector";
import { StackedBarChart } from "@/components/charts/stacked-bar-chart";
import { GroupedColumnChart } from "@/components/charts/grouped-column-chart";
import { TrendLineChart } from "@/components/charts/trend-line-chart";
import { DeltaBadge } from "@/components/charts/chart-parts";
import { PERIOD_COLORS, SCOPE_COLORS, SCOPE_SERIES, formatTonnes } from "@/components/charts/palette";

const SCOPE_LEGEND = SCOPE_SERIES.map((s) => ({ label: s.label, color: s.color }));

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  let context;
  try {
    context = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    throw err;
  }

  const { from, to } = await searchParams;
  const range = resolveMonthRange(from, to);
  const analytics = await buildAnalyticsSnapshot(context, range.periodStart, range.periodEnd);

  const tenantCtx = toTenantRepositoryContext(context);
  const sites = await prisma.site.findMany({
    where: tenantWhere(tenantCtx, { isActive: true, ...accessibleSiteFilter(context) }),
    include: { entity: true },
    orderBy: [{ entity: { name: "asc" } }, { name: "asc" }],
  });

  const siteSummaries = await Promise.all(
    sites.map(async (site) => {
      const statuses = await getSiteQuantityStatus(context, site.id);
      return {
        site,
        missing: statuses.filter((s) => s.status === "missing").length,
        flagged: statuses.filter((s) => s.status === "flagged").length,
        awaitingFactor: statuses.filter((s) => s.status === "awaiting_factor").length,
      };
    }),
  );
  const totalOutstanding = siteSummaries.reduce((sum, s) => sum + s.missing + s.flagged + s.awaitingFactor, 0);

  const sitesWithData = analytics.sites.filter((s) => s.totals.total > 0);

  const siteRows = analytics.sites.map((site) => ({
    label: site.siteName,
    sublabel: site.entityName,
    segments: [
      { label: "Scope 1", value: site.totals.scope1, color: SCOPE_COLORS.scope1 },
      { label: "Scope 2", value: site.totals.scope2Location, color: SCOPE_COLORS.scope2 },
      { label: "Scope 3", value: site.totals.scope3, color: SCOPE_COLORS.scope3 },
    ],
  }));

  const yoyGroups = analytics.sites.map((site) => ({
    label: site.siteName,
    values: [
      { seriesLabel: "This period", value: site.totals.total, color: PERIOD_COLORS.current },
      {
        seriesLabel: "Same period last year",
        value: analytics.previousSitesById[site.siteId]?.total ?? 0,
        color: PERIOD_COLORS.previous,
      },
    ],
  }));

  const scopeCards = [
    { label: "Scope 1 — direct", value: analytics.group.scope1, color: SCOPE_COLORS.scope1, delta: analytics.scopeDeltas[0].delta },
    { label: "Scope 2 — electricity", value: analytics.group.scope2Location, color: SCOPE_COLORS.scope2, delta: analytics.scopeDeltas[1].delta },
    { label: "Scope 3 — value chain", value: analytics.group.scope3, color: SCOPE_COLORS.scope3, delta: analytics.scopeDeltas[2].delta },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Emissions dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatRangeLabel(range.periodStart, range.periodEnd)} · compared with{" "}
            {formatRangeLabel(analytics.previousPeriodStart, analytics.previousPeriodEnd)}
          </p>
        </div>
        <PeriodSelector action="/" startMonth={range.startMonth} endMonth={range.endMonth} />
      </div>

      {!analytics.hasAnyData && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="text-sm text-amber-900">
              <p className="font-medium">No calculated emissions in this period yet.</p>
              <p className="mt-1 text-amber-800">
                Figures appear here once activity data is entered and matched to an emission factor.{" "}
                <Link href="/entry" className="font-medium underline">
                  Enter activity data
                </Link>{" "}
                to get started, or widen the period above.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hero figure — exactly one per view. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-1">
          <CardContent>
            <div className="text-sm font-medium text-slate-600">Total emissions</div>
            <div className="mt-1 text-5xl font-semibold leading-none text-slate-900">
              {formatTonnes(analytics.group.total)}
            </div>
            <div className="mt-1 text-sm text-slate-500">tonnes CO2e</div>
            <div className="mt-3">
              <DeltaBadge delta={analytics.groupDelta} />
            </div>
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
              Scope 1 + Scope 2 (location-based) + Scope 3. Market-based Scope 2 is{" "}
              {formatTonnes(analytics.group.scope2Market)} t, reported alongside rather than added in.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-3">
          {scopeCards.map((card) => (
            <Card key={card.label}>
              <CardContent>
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: card.color }} />
                  <span className="text-sm font-medium text-slate-600">{card.label}</span>
                </div>
                <div className="mt-2 text-3xl font-semibold text-slate-900">{formatTonnes(card.value)}</div>
                <div className="text-xs text-slate-400">tonnes CO2e</div>
                <div className="mt-2">
                  <DeltaBadge delta={card.delta} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Emissions makeup by site</CardTitle>
          <p className="mt-1 text-sm text-slate-500">
            Each site&apos;s split across the three scopes, on one shared scale so sites are directly comparable.
          </p>
        </CardHeader>
        <CardContent>
          <StackedBarChart rows={siteRows} legend={SCOPE_LEGEND} />

          {/* Table view — the figures are never available only as a chart. */}
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <caption className="sr-only">Emissions by site and scope, in tonnes CO2e</caption>
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th scope="col" className="pb-2 font-medium">Site</th>
                  <th scope="col" className="pb-2 text-right font-medium">Scope 1</th>
                  <th scope="col" className="pb-2 text-right font-medium">Scope 2</th>
                  <th scope="col" className="pb-2 text-right font-medium">Scope 3</th>
                  <th scope="col" className="pb-2 text-right font-medium">Total</th>
                  <th scope="col" className="pb-2 text-right font-medium">vs last year</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {analytics.sites.map((site) => {
                  const prev = analytics.previousSitesById[site.siteId]?.total ?? 0;
                  return (
                    <tr key={site.siteId} className="border-b border-slate-100 last:border-0">
                      <th scope="row" className="py-2 text-left font-medium text-slate-800">
                        {site.siteName}
                        <span className="block text-xs font-normal text-slate-500">{site.entityName}</span>
                      </th>
                      <td className="py-2 text-right text-slate-700">{formatTonnes(site.totals.scope1)}</td>
                      <td className="py-2 text-right text-slate-700">{formatTonnes(site.totals.scope2Location)}</td>
                      <td className="py-2 text-right text-slate-700">{formatTonnes(site.totals.scope3)}</td>
                      <td className="py-2 text-right font-semibold text-slate-900">{formatTonnes(site.totals.total)}</td>
                      <td className="py-2 text-right">
                        <DeltaBadge delta={buildDelta(site.totals.total, prev)} />
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-slate-200 font-semibold">
                  <th scope="row" className="py-2 text-left text-slate-900">Group total</th>
                  <td className="py-2 text-right text-slate-900">{formatTonnes(analytics.group.scope1)}</td>
                  <td className="py-2 text-right text-slate-900">{formatTonnes(analytics.group.scope2Location)}</td>
                  <td className="py-2 text-right text-slate-900">{formatTonnes(analytics.group.scope3)}</td>
                  <td className="py-2 text-right text-slate-900">{formatTonnes(analytics.group.total)}</td>
                  <td className="py-2 text-right">
                    <DeltaBadge delta={analytics.groupDelta} />
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-400">All figures in tonnes CO2e. Scope 2 shown location-based.</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>This period vs the same period last year</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              {formatRangeLabel(range.periodStart, range.periodEnd)} against{" "}
              {formatRangeLabel(analytics.previousPeriodStart, analytics.previousPeriodEnd)}. For emissions, lower is
              better.
            </p>
          </CardHeader>
          <CardContent>
            <GroupedColumnChart
              groups={yoyGroups}
              legend={[
                { label: "This period", color: PERIOD_COLORS.current },
                { label: "Same period last year", color: PERIOD_COLORS.previous },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Monthly trend</CardTitle>
            <p className="mt-1 text-sm text-slate-500">Total group emissions per month across the selected period.</p>
          </CardHeader>
          <CardContent>
            <TrendLineChart points={analytics.monthly.map((m) => ({ label: m.label, value: m.total }))} />
          </CardContent>
        </Card>
      </div>

      {sitesWithData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Where the emissions come from</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Group emissions by activity category, largest first.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <caption className="sr-only">Group emissions by category, in tonnes CO2e</caption>
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th scope="col" className="pb-2 font-medium">Category</th>
                  <th scope="col" className="pb-2 text-right font-medium">tCO2e</th>
                  <th scope="col" className="pb-2 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {analytics.byCategory.map((c) => (
                  <tr key={c.key} className="border-b border-slate-100 last:border-0">
                    <th scope="row" className="py-2 text-left font-normal text-slate-700">{c.label}</th>
                    <td className="py-2 text-right text-slate-900">{formatTonnes(c.kgCo2e)}</td>
                    <td className="py-2 text-right text-slate-500">
                      {analytics.group.total > 0 ? `${((c.kgCo2e / analytics.group.total) * 100).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Data completeness</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Outstanding submissions for the current reporting period, by site.
            </p>
          </div>
          <Link href="/entry" className="flex shrink-0 items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-800">
            Enter data
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </CardHeader>
        <CardContent className="space-y-2">
          {totalOutstanding === 0 && (
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Everything for the current period has been submitted.
            </p>
          )}
          {siteSummaries.map(({ site, missing, flagged, awaitingFactor }) => {
            const issues = missing + flagged + awaitingFactor;
            return (
              <div key={site.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
                <div className="flex items-center gap-2">
                  {ENTITY_LOGOS[site.entity.name] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- small static brand asset
                    <img src={ENTITY_LOGOS[site.entity.name]} alt="" className="h-3.5 w-auto" />
                  ) : null}
                  <span className="text-sm font-medium text-slate-800">{site.name}</span>
                  <span className="text-xs text-slate-500">{site.entity.name}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {issues === 0 ? (
                    <Badge tone="success">
                      <CheckCircle2 className="h-3 w-3" />
                      Complete
                    </Badge>
                  ) : (
                    <>
                      {missing > 0 && <Badge tone="neutral">{missing} not submitted</Badge>}
                      {flagged > 0 && (
                        <Badge tone="warning">
                          <FlagTriangleRight className="h-3 w-3" />
                          {flagged} flagged
                        </Badge>
                      )}
                      {awaitingFactor > 0 && (
                        <Badge tone="warning">
                          <Clock className="h-3 w-3" />
                          {awaitingFactor} awaiting factor
                        </Badge>
                      )}
                    </>
                  )}
                  <Link href={`/entry/${site.id}`} className="text-sm font-medium text-blue-700 hover:text-blue-800">
                    Open
                  </Link>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

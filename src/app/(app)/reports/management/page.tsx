import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Download } from "lucide-react";
import { OrganisationAccessError, requireOrganisationContext } from "@/lib/organisation/session";
import { hasPermission, PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { logEvent } from "@/lib/observability/logger";
import { loadManagementReport, type ManagementReportSearchParams } from "@/lib/carbon/live-management-report";
import { SCOPE3_STATE_LABEL, type ManagementReport, type PeriodStateKind } from "@/lib/carbon/management-report";
import { TONNES_CO2E, formatTonnesCO2e } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AsyncBoundary, PageHeader, SetupState } from "@/components/ui/primitives";
import { StackedBarChart } from "@/components/charts/stacked-bar-chart";
import { TrendLineChart } from "@/components/charts/trend-line-chart";
import { DeltaBadge } from "@/components/charts/chart-parts";
import { SCOPE_COLORS, SCOPE_SERIES } from "@/components/charts/palette";
import { PrintButton } from "../print-button";
import { PeriodControls } from "./period-controls";

const SCOPE_LEGEND = SCOPE_SERIES.map((s) => ({ label: s.label, color: s.color }));

const PERIOD_TONE: Record<PeriodStateKind, "neutral" | "success" | "warning" | "info"> = {
  OPEN: "info",
  CLOSED: "success",
  MIXED: "warning",
  NONE: "neutral",
};

const TIER_LABELS: Record<string, string> = {
  TIER_1: "Tier 1 — primary, measured",
  TIER_2: "Tier 2 — primary, calculated",
  TIER_3: "Tier 3 — secondary, estimated",
};

/** tCO₂e everywhere on this page; an absent figure reads as "Not available", never 0. */
function t(kg: number | null | undefined) {
  return formatTonnesCO2e(kg, { missing: "inline" });
}
function pct(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

export default async function ManagementReportPage({ searchParams }: { searchParams: Promise<ManagementReportSearchParams> }) {
  let context;
  try {
    context = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    if (err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  const params = await searchParams;
  let report: ManagementReport;
  try {
    report = await loadManagementReport(context, params);
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    if (err instanceof PermissionDeniedError) redirect("/");
    // A site selection that isn't the reader's to see is a correctable
    // selection, not a fault — send them back to the unfiltered report
    // rather than silently widening the scope they asked for.
    if (err instanceof TenantOwnershipError) redirect("/reports/management");
    // The real exception is what makes a failure fixable; the browser only
    // ever sees the generic message below.
    logEvent({
      level: "error",
      message: "management report load failed",
      organisationId: context.organisationId,
      correlationId: context.correlationId,
      fields: {
        errorName: err instanceof Error ? err.name : typeof err,
        errorMessage: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
    });
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Management reporting" title="Carbon management report" />
        <AsyncBoundary
          state="error"
          message="This report could not be built. That is a fault, not an empty period — reload, and report it if it persists."
        />
      </div>
    );
  }

  const headline = report.kpis.find((k) => k.key === "total") ?? null;
  const totalKg = headline?.kgCo2e ?? null;
  const unreportedMonths = report.trend.filter((m) => !m.reported);
  const reportedTrend = report.trend.filter((m) => m.reported);
  const siteRows = report.sites.filter((s) => s.total !== 0 || s.scope2Market !== 0);
  const selectableSites = report.sites.filter((s) => s.siteId !== "").map((s) => ({ id: s.siteId, name: s.siteName }));
  // The resolved window, not the raw query string: an absent or malformed
  // `from`/`to` falls back to a default range on screen, and the export has to
  // be the period the reader is actually looking at.
  const exportParams = new URLSearchParams({
    from: report.trend[0]?.month ?? "",
    to: report.trend[report.trend.length - 1]?.month ?? "",
  });
  if (params.siteId) exportParams.set("siteId", params.siteId);
  const exportHref = `/reports/management/export.xlsx?${exportParams.toString()}`;
  // Presentation only — the route enforces this itself, so a reader without
  // the permission gains nothing by typing the URL.
  const canExport = hasPermission(context, "carbon.report.export");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link href="/reports" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-3.5 w-3.5" />
          All reports
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {/* Phase 5B. A plain link, so the export carries the reader's current
              period and site filter in the URL and needs no client state —
              and so the server, not the presence of this control, decides
              whether the reader may have the file. */}
          {canExport && (
            <a
              href={exportHref}
              download
              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[var(--bd-radius-sm)] bg-[var(--bd-teal)] px-3 py-1.5 text-xs font-semibold text-white shadow-[var(--bd-shadow)] transition-colors duration-150 hover:bg-[var(--bd-teal-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bd-focus)] focus-visible:ring-offset-2"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export Excel
            </a>
          )}
          <PrintButton />
        </div>
      </div>

      <PageHeader
        eyebrow="Management reporting"
        title="Carbon management report"
        description={
          <>
            {report.organisationName} · {report.periodLabel}
            {report.siteFilterName ? ` · ${report.siteFilterName}` : ""}
          </>
        }
      />

      <PeriodControls sites={selectableSites} from={report.trend[0]?.month ?? ""} to={report.trend[report.trend.length - 1]?.month ?? ""} siteId={params.siteId} />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={PERIOD_TONE[report.periodState.kind]}>Reporting period: {report.periodState.label}</Badge>
        {report.periodState.kind === "MIXED" && (
          <span className="text-xs text-slate-500">
            Closing is per site and per month, so this range is neither wholly open nor wholly closed.
          </span>
        )}
        {report.periodState.kind === "CLOSED" && (
          <span className="text-xs text-slate-500">Closed periods stay readable; the figures below are unchanged by closing.</span>
        )}
      </div>

      {report.empty ? (
        <SetupState
          title="Nothing has been recorded for this period"
          detail={`Neither ${report.periodLabel} nor ${report.previousPeriodLabel} has any activity data yet. Record activity data for a site, or widen the period above — nothing is being hidden and no figure is being shown as zero.`}
          actions={[
            { label: "Enter activity data", href: "/entry" },
            { label: "Open the collection plan", href: "/data" },
          ]}
        />
      ) : (
        <>
          {/* Headline KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {report.kpis.map((kpi) => (
              <Card key={kpi.key} className={kpi.key === "total" ? "sm:col-span-2 lg:col-span-1" : undefined}>
                <CardContent>
                  <div className="flex items-center gap-2">
                    {kpi.key !== "total" && (
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                        style={{
                          backgroundColor:
                            kpi.key === "scope1" ? SCOPE_COLORS.scope1 : kpi.key === "scope3" ? SCOPE_COLORS.scope3 : SCOPE_COLORS.scope2,
                          opacity: kpi.inHeadline ? 1 : 0.45,
                        }}
                      />
                    )}
                    <span className="text-xs font-medium text-slate-600">{kpi.label}</span>
                  </div>
                  <div
                    className={`mt-1 font-semibold leading-none text-slate-900 ${kpi.key === "total" ? "text-4xl" : "text-2xl"}`}
                    data-kpi={kpi.key}
                    data-value={kpi.kgCo2e ?? undefined}
                  >
                    {t(kpi.kgCo2e)}
                  </div>
                  <div className="mt-1 text-xs text-[var(--bd-muted)]">{TONNES_CO2E}</div>
                  {kpi.note && <p className="mt-2 text-xs text-slate-500">{kpi.note}</p>}
                  {!kpi.inHeadline && (
                    <Badge tone="neutral">
                      <span className="text-[0.65rem]">Companion — not in the total</span>
                    </Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <p className="text-xs text-slate-500">
            Headline basis: <strong>{report.methodology.headlineBasis}</strong>. {report.methodology.scope2Basis} Location-based and
            market-based are two views of the same purchased electricity and are never added together.
          </p>

          {/* Comparison */}
          <Card className="break-inside-avoid">
            <CardHeader>
              <CardTitle>Against {report.previousPeriodLabel}</CardTitle>
              <p className="mt-1 text-sm text-slate-500">
                The same calendar window one year earlier: {report.periodLabel} against {report.previousPeriodLabel}. For emissions, lower
                is better.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {report.comparisonNote && (
                <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-slate-700" data-testid="comparison-note">
                  {report.comparisonNote}
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <caption className="sr-only">This period against the same period one year earlier, in tonnes CO2e</caption>
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th scope="col" className="pb-2 font-medium">Measure</th>
                      <th scope="col" className="pb-2 text-right font-medium">{report.periodLabel}</th>
                      <th scope="col" className="pb-2 text-right font-medium">{report.previousPeriodLabel}</th>
                      <th scope="col" className="pb-2 text-right font-medium">Change</th>
                      <th scope="col" className="pb-2 text-right font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {report.comparison.map((row) => (
                      <tr key={row.key} className={`border-b border-slate-100 ${row.key === "total" ? "border-t-2 border-slate-200 font-semibold" : ""}`}>
                        <th scope="row" className={`py-2 text-left ${row.key === "total" ? "text-slate-900" : "font-normal text-slate-700"}`}>
                          {row.label}
                          {row.note && <span className="block text-xs font-normal text-slate-500">{row.note}</span>}
                        </th>
                        <td className="py-2 text-right text-slate-900">{t(row.currentKg)}</td>
                        <td className="py-2 text-right text-slate-600">{t(row.previousKg)}</td>
                        <td className="py-2 text-right text-slate-700">{row.delta ? t(row.delta.deltaKg) : "—"}</td>
                        <td className="py-2 text-right" data-comparison={row.key} data-percent={row.delta?.deltaPercent ?? undefined}>
                          {row.delta ? <DeltaBadge delta={row.delta} /> : <span className="text-xs text-slate-500">Not comparable</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-400">Tonnes CO₂e. A blank change means the two periods are not comparable, not a zero change.</p>
            </CardContent>
          </Card>

          {/* Sites */}
          <Card className="break-inside-avoid">
            <CardHeader>
              <CardTitle>Where emissions come from — by site</CardTitle>
              <p className="mt-1 text-sm text-slate-500">Each site on one shared scale. Open a site to follow its figure back to the underlying data.</p>
            </CardHeader>
            <CardContent>
              {siteRows.length === 0 ? (
                <SetupState
                  title="No site emissions for this period"
                  detail="Emissions are attributed per site. Once activity data in this period has been matched to an emission factor, each site appears here with its own scope split and share."
                  actions={[{ label: "Enter activity data", href: "/entry" }]}
                />
              ) : (
                <>
                  <StackedBarChart
                    rows={siteRows.map((s) => ({
                      label: s.siteName,
                      sublabel: s.entityName,
                      segments: [
                        { label: "Scope 1", value: s.scope1, color: SCOPE_COLORS.scope1 },
                        { label: "Scope 2 (location-based)", value: s.scope2Location, color: SCOPE_COLORS.scope2 },
                        { label: "Scope 3", value: s.scope3, color: SCOPE_COLORS.scope3 },
                      ],
                    }))}
                    legend={SCOPE_LEGEND}
                  />
                  <div className="mt-5 overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <caption className="sr-only">Emissions by site, in tonnes CO2e</caption>
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th scope="col" className="pb-2 font-medium">Site</th>
                          <th scope="col" className="pb-2 text-right font-medium">Scope 1</th>
                          <th scope="col" className="pb-2 text-right font-medium">Scope 2 LB</th>
                          <th scope="col" className="pb-2 text-right font-medium">Scope 3</th>
                          <th scope="col" className="pb-2 text-right font-medium">Total</th>
                          <th scope="col" className="pb-2 text-right font-medium">Share</th>
                          <th scope="col" className="pb-2 text-right font-medium">vs last year</th>
                          <th scope="col" className="pb-2 text-right font-medium">Period</th>
                        </tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {siteRows.map((s) => (
                          <tr key={s.siteId || "unattributed"} className="border-b border-slate-100 last:border-0" data-site={s.siteId || "unattributed"}>
                            <th scope="row" className="py-2 text-left font-medium text-slate-800">
                              <Link href={s.href} className="text-blue-700 hover:text-blue-800">
                                {s.siteName}
                              </Link>
                              <span className="block text-xs font-normal text-slate-500">{s.entityName}</span>
                            </th>
                            <td className="py-2 text-right text-slate-700">{t(s.scope1)}</td>
                            <td className="py-2 text-right text-slate-700">{t(s.scope2Location)}</td>
                            <td className="py-2 text-right text-slate-700">{t(s.scope3)}</td>
                            <td className="py-2 text-right font-semibold text-slate-900">{t(s.total)}</td>
                            <td className="py-2 text-right text-slate-700" data-share={s.sharePercent ?? undefined}>{pct(s.sharePercent)}</td>
                            <td className="py-2 text-right"><DeltaBadge delta={s.delta} /></td>
                            <td className="py-2 text-right text-xs text-slate-500">{s.periodState.kind === "NONE" ? "—" : s.periodState.label}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-slate-200 font-semibold">
                          <th scope="row" className="py-2 text-left text-slate-900">Total</th>
                          <td className="py-2 text-right text-slate-900">{t(report.kpis.find((k) => k.key === "scope1")?.kgCo2e ?? null)}</td>
                          <td className="py-2 text-right text-slate-900">{t(report.kpis.find((k) => k.key === "scope2Location")?.kgCo2e ?? null)}</td>
                          <td className="py-2 text-right text-slate-900">{t(report.kpis.find((k) => k.key === "scope3")?.kgCo2e ?? null)}</td>
                          <td className="py-2 text-right text-slate-900">{t(totalKg)}</td>
                          <td className="py-2 text-right text-slate-600">{totalKg === null ? "—" : "100.0%"}</td>
                          <td />
                          <td />
                        </tr>
                      </tbody>
                    </table>
                    <p className="mt-2 text-xs text-slate-400">
                      Tonnes CO₂e. Scope 2 shown location-based, so the site totals add up to the headline figure.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Largest sources */}
          <Card className="break-inside-avoid">
            <CardHeader>
              <CardTitle>Largest sources</CardTitle>
              <p className="mt-1 text-sm text-slate-500">The biggest single site-and-source contributions in this period, largest first.</p>
            </CardHeader>
            <CardContent>
              {report.topSources.length === 0 ? (
                <AsyncBoundary state="empty" message="No calculated emissions in this period to rank yet." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <caption className="sr-only">Largest emission sources in this period, in tonnes CO2e</caption>
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        <th scope="col" className="pb-2 font-medium">#</th>
                        <th scope="col" className="pb-2 font-medium">Source</th>
                        <th scope="col" className="pb-2 font-medium">Site</th>
                        <th scope="col" className="pb-2 font-medium">Scope</th>
                        <th scope="col" className="pb-2 text-right font-medium">Total</th>
                        <th scope="col" className="pb-2 text-right font-medium">Share</th>
                        <th scope="col" className="pb-2 text-right font-medium" />
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {report.topSources.map((source, index) => (
                        <tr key={source.key} className="border-b border-slate-100 last:border-0" data-source-rank={index + 1}>
                          <td className="py-2 text-slate-400">{index + 1}</td>
                          <th scope="row" className="py-2 text-left font-medium text-slate-800">{source.category}</th>
                          <td className="py-2 text-slate-600">{source.siteName}</td>
                          <td className="py-2 text-slate-600">{source.scopeLabel}</td>
                          <td className="py-2 text-right font-semibold text-slate-900">{t(source.kgCo2e)}</td>
                          <td className="py-2 text-right text-slate-700">{pct(source.sharePercent)}</td>
                          <td className="py-2 text-right">
                            <Link href={source.href} className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800">
                              Open data
                              <ArrowRight className="h-3 w-3" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-slate-400">
                    Tonnes CO₂e, share of {report.methodology.headlineBasis.toLowerCase()}.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Scope 3 */}
          <Card className="break-inside-avoid">
            <CardHeader>
              <CardTitle>Scope 3 by GHG Protocol category</CardTitle>
              <p className="mt-1 text-sm text-slate-500">{report.methodology.scope3Note}</p>
            </CardHeader>
            <CardContent>
              {report.scope3Categories.length === 0 ? (
                <AsyncBoundary state="empty" message="No Scope 3 categories are modelled for this organisation yet." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <caption className="sr-only">Scope 3 emissions by GHG Protocol category, in tonnes CO2e</caption>
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        <th scope="col" className="pb-2 font-medium">Category</th>
                        <th scope="col" className="pb-2 text-right font-medium">Total</th>
                        <th scope="col" className="pb-2 text-right font-medium">Share of inventory</th>
                        <th scope="col" className="pb-2 text-right font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {report.scope3Categories.map((row) => (
                        <tr key={row.category} className="border-b border-slate-100 last:border-0" data-scope3-category={row.category} data-state={row.state}>
                          <th scope="row" className="py-2 text-left font-normal text-slate-700">
                            <Link href={row.href} className="text-blue-700 hover:text-blue-800">{row.category}</Link>
                          </th>
                          <td className="py-2 text-right text-slate-900">{t(row.kgCo2e)}</td>
                          <td className="py-2 text-right text-slate-700">{pct(row.sharePercent)}</td>
                          <td className="py-2 text-right">
                            <Badge tone={row.state === "quantified" ? "success" : row.state === "zero" ? "neutral" : "warning"}>
                              {SCOPE3_STATE_LABEL[row.state]}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {report.scope3NotAssessed > 0 && (
                    <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      {report.scope3Categories.length} of the 15 GHG Protocol Scope 3 categories are modelled here. The remaining{" "}
                      {report.scope3NotAssessed} are <strong>not assessed</strong> — no screening decision is recorded for them, so they
                      are not claimed to be zero and are not in the totals above.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Trend */}
          <Card className="break-inside-avoid">
            <CardHeader>
              <CardTitle>Month by month</CardTitle>
              <p className="mt-1 text-sm text-slate-500">
                Total emissions per month, on the headline basis. A month nobody reported is left out of the line rather than drawn as
                zero.
              </p>
            </CardHeader>
            <CardContent>
              <TrendLineChart
                points={reportedTrend.map((m) => ({ label: m.label, value: m.totalKg ?? 0 }))}
                emptyMessage="No month in this period has reported activity data yet."
              />
              {unreportedMonths.length > 0 && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-slate-700" data-testid="unreported-months">
                  <strong>
                    {unreportedMonths.length} of {report.trend.length} months have no activity data at all
                  </strong>{" "}
                  ({unreportedMonths.map((m) => m.label).join(", ")}). They are absent from the line above — not plotted as zero — so the
                  trend is not read as a fall that never happened.
                </p>
              )}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <caption className="sr-only">Monthly emissions, in tonnes CO2e</caption>
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th scope="col" className="pb-2 font-medium">Month</th>
                      <th scope="col" className="pb-2 text-right font-medium">Scope 1</th>
                      <th scope="col" className="pb-2 text-right font-medium">Scope 2 LB</th>
                      <th scope="col" className="pb-2 text-right font-medium">Scope 3</th>
                      <th scope="col" className="pb-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {report.trend.map((month) => (
                      <tr key={month.month} className="border-b border-slate-100 last:border-0" data-month={month.month} data-reported={month.reported}>
                        <th scope="row" className="py-2 text-left font-normal text-slate-700">
                          <Link href={month.href} className="text-blue-700 hover:text-blue-800">{month.label}</Link>
                        </th>
                        {month.reported ? (
                          <>
                            <td className="py-2 text-right text-slate-700">{t(month.scope1)}</td>
                            <td className="py-2 text-right text-slate-700">{t(month.scope2Location)}</td>
                            <td className="py-2 text-right text-slate-700">{t(month.scope3)}</td>
                            <td className="py-2 text-right font-semibold text-slate-900">{t(month.totalKg)}</td>
                          </>
                        ) : (
                          <td colSpan={4} className="py-2 text-right text-xs text-slate-500">Not reported</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Completeness */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="break-inside-avoid">
              <CardHeader>
                <CardTitle>How complete is this?</CardTitle>
                <p className="mt-1 text-sm text-slate-500">{report.completeness.basis}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                  <div>
                    <div className="text-3xl font-semibold leading-none text-slate-900" data-testid="received-percent" data-value={report.completeness.receivedPercent ?? undefined}>
                      {pct(report.completeness.receivedPercent)}
                    </div>
                    <div className="mt-1 text-xs text-[var(--bd-muted)]">of required sources received</div>
                  </div>
                  <div className="text-sm text-slate-600">
                    <div>
                      <strong>{report.completeness.received}</strong> received of <strong>{report.completeness.required - report.completeness.excluded}</strong> required
                    </div>
                    <div>
                      <strong>{report.completeness.countedInTotals}</strong> already counted in the figures above
                    </div>
                  </div>
                </div>
                {report.completeness.rows.length === 0 ? (
                  <AsyncBoundary state="empty" message="No collection requirements have been generated for this period yet, so completeness cannot be stated." />
                ) : (
                  <table className="w-full text-sm">
                    <caption className="sr-only">Collection plan cells by state</caption>
                    <tbody className="tabular-nums">
                      {report.completeness.rows.map((row) => (
                        <tr key={row.status} className="border-b border-slate-100 last:border-0" data-completeness={row.status}>
                          <th scope="row" className="py-1.5 text-left font-normal text-slate-700">{row.label}</th>
                          <td className="py-1.5 text-right font-medium text-slate-900">{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="text-xs text-slate-400">
                  {report.completeness.excluded} authorised exclusion{report.completeness.excluded === 1 ? "" : "s"} removed from the
                  denominator. A percentage is only stated when the collection plan defines what was required.
                </p>
              </CardContent>
            </Card>

            <Card className="break-inside-avoid">
              <CardHeader>
                <CardTitle>Needs attention</CardTitle>
                <p className="mt-1 text-sm text-slate-500">Conditions that keep real activity out of the figures above.</p>
              </CardHeader>
              <CardContent>
                {report.outstanding.length === 0 ? (
                  <AsyncBoundary state="empty" message="Nothing outstanding for this period in your scope." />
                ) : (
                  <ul className="space-y-3">
                    {report.outstanding.map((item) => (
                      <li key={item.kind} className="flex items-start justify-between gap-3" data-outstanding={item.kind}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge tone="warning">{item.count}</Badge>
                            <span className="text-sm font-medium text-slate-800">{item.label}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
                        </div>
                        <Link href={item.href} className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800">
                          Open
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Data quality */}
          <Card className="break-inside-avoid">
            <CardHeader>
              <CardTitle>Data quality</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="pb-2 font-medium">Tier</th>
                    <th scope="col" className="pb-2 text-right font-medium">Emissions</th>
                    <th scope="col" className="pb-2 text-right font-medium">% of inventory</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {report.dataQuality.map((tier) => (
                    <tr key={tier.tier} className="border-b border-slate-100 last:border-0">
                      <th scope="row" className="py-1.5 text-left font-normal text-slate-700">{TIER_LABELS[tier.tier] ?? tier.tier}</th>
                      <td className="py-1.5 text-right text-slate-900">{t(tier.kgCo2e)}</td>
                      <td className="py-1.5 text-right text-slate-900">{tier.percent.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-400">
                Weighted against {report.methodology.headlineBasis.toLowerCase()}, so the Scope 2 market-based companion is not counted
                twice.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {/* Methodology — shown even for an empty period, because the basis is part of the report */}
      <Card className="break-inside-avoid">
        <CardHeader>
          <CardTitle>Methodology and provenance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="text-slate-500">Reporting boundary</div>
              <div className="font-medium text-slate-900">{report.methodology.boundary}</div>
            </div>
            <div>
              <div className="text-slate-500">Scope 2 accounting</div>
              <div className="font-medium text-slate-900">{report.methodology.scope2Basis}</div>
            </div>
            <div>
              <div className="text-slate-500">Period covered</div>
              <div className="font-medium text-slate-900">{report.periodLabel}</div>
            </div>
            <div>
              <div className="text-slate-500">Calculation engine</div>
              <div className="font-medium text-slate-900">{report.methodology.engineVersions.join(", ") || "No calculations in this period"}</div>
            </div>
          </div>

          {report.methodology.factorSources.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] text-sm">
                <caption className="sr-only">Emission factor datasets used in this period</caption>
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="pb-2 font-medium">Scope</th>
                    <th scope="col" className="pb-2 font-medium">Factor dataset</th>
                    <th scope="col" className="pb-2 font-medium">Vintage</th>
                    <th scope="col" className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.methodology.factorSources.map((f) => (
                    <tr key={`${f.scope}:${f.source}:${f.vintage}`} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 text-slate-700">{f.scope.replace("_", " ")}</td>
                      <td className="py-1.5 text-slate-700">{f.source}</td>
                      <td className="py-1.5 text-slate-700">{f.vintage}</td>
                      <td className="py-1.5">
                        <Badge tone={f.placeholder ? "warning" : "neutral"}>{f.placeholder ? "Placeholder dataset" : "Imported dataset"}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p
            className={`rounded-lg border px-3 py-2 text-sm ${report.methodology.placeholderFactorsUsed ? "border-amber-200 bg-amber-50/60 text-slate-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}
            data-testid="assurance-statement"
          >
            {report.methodology.assurance}
          </p>
          <p className="text-xs text-slate-500">
            Each figure is a stored calculation of activity data × the emission factor in force for its period, not a recalculation done
            for this page.{" "}
            <Link href="/activity" className="font-medium text-blue-700 hover:text-blue-800">
              Open the activity register
            </Link>{" "}
            to follow any figure back to its site, source, submission, factor and evidence.
          </p>
        </CardContent>
      </Card>

      <p className="no-print text-xs text-slate-400">
        Management information, built live from current records — it is not a frozen snapshot. For a permanent, versioned figure, generate
        a report on the{" "}
        <Link href="/reports" className="font-medium text-blue-700 hover:text-blue-800">
          Reports
        </Link>{" "}
        page. Loaded {new Date(report.capturedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })} Europe/London.
      </p>
    </div>
  );
}

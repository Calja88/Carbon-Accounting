import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ReportPayload } from "@/lib/report-service";
import { buildDelta } from "@/lib/analytics-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PrintButton } from "../print-button";
import { StackedBarChart } from "@/components/charts/stacked-bar-chart";
import { GroupedColumnChart } from "@/components/charts/grouped-column-chart";
import { TrendLineChart } from "@/components/charts/trend-line-chart";
import { DeltaBadge } from "@/components/charts/chart-parts";
import { PERIOD_COLORS, SCOPE_COLORS, SCOPE_SERIES, formatTonnes } from "@/components/charts/palette";

const TIER_LABELS: Record<string, string> = {
  TIER_1: "Tier 1 — Primary / measured",
  TIER_2: "Tier 2 — Primary / calculated",
  TIER_3: "Tier 3 — Secondary / estimated",
};

const SCOPE_LEGEND = SCOPE_SERIES.map((s) => ({ label: s.label, color: s.color }));

function kg(n: number) {
  return `${n.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg`;
}
function tonnes(n: number) {
  return `${(n / 1000).toLocaleString("en-GB", { maximumFractionDigits: 2 })} t`;
}
function longDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snapshot = await prisma.reportSnapshot.findUnique({ where: { id }, include: { generatedBy: true } });
  if (!snapshot) notFound();

  const rawPayload = snapshot.payload as unknown as ReportPayload;
  // Snapshots generated before a field existed must still render exactly as
  // the versioned-snapshot design promises — fall back, never crash.
  const payload: ReportPayload = {
    ...rawPayload,
    scope3: rawPayload.scope3 ?? { totalKgCo2e: 0, byCategory: [] },
    awaitingFactorEntries: rawPayload.awaitingFactorEntries ?? [],
  };

  const scope1Total = payload.scope1.totalKgCo2e;
  const scope2Location = payload.scope2.locationBasedTotalKgCo2e;
  const scope2Market = payload.scope2.marketBasedTotalKgCo2e;
  const scope3Total = payload.scope3.totalKgCo2e;
  const grandTotal = scope1Total + scope2Location + scope3Total;

  const bySite = payload.bySite ?? [];
  const comparison = payload.comparison;
  const monthly = payload.monthly ?? [];

  const siteRows = bySite.map((s) => ({
    label: s.siteName,
    sublabel: s.entityName,
    segments: [
      { label: "Scope 1", value: s.scope1, color: SCOPE_COLORS.scope1 },
      { label: "Scope 2", value: s.scope2Location, color: SCOPE_COLORS.scope2 },
      { label: "Scope 3", value: s.scope3, color: SCOPE_COLORS.scope3 },
    ],
  }));

  const yoyGroups =
    comparison && bySite.length > 0
      ? bySite.map((s) => {
          const c = comparison.bySite.find((x) => x.siteId === s.siteId);
          return {
            label: s.siteName,
            values: [
              { seriesLabel: "This period", value: c?.currentTotal ?? s.total, color: PERIOD_COLORS.current },
              { seriesLabel: "Same period last year", value: c?.previousTotal ?? 0, color: PERIOD_COLORS.previous },
            ],
          };
        })
      : [];

  const scopeSummary = [
    { label: "Scope 1 — direct", value: scope1Total, color: SCOPE_COLORS.scope1, previous: comparison?.previous.scope1 },
    { label: "Scope 2 — electricity (location-based)", value: scope2Location, color: SCOPE_COLORS.scope2, previous: comparison?.previous.scope2Location },
    { label: "Scope 3 — value chain", value: scope3Total, color: SCOPE_COLORS.scope3, previous: comparison?.previous.scope3 },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="no-print flex items-center justify-between">
        <Link href="/reports" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-3.5 w-3.5" />
          All reports
        </Link>
        <div className="flex gap-2">
          <a href={`/reports/${id}/audit-trail.csv`}>
            <button className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50">
              <Download className="h-3.5 w-3.5" />
              Audit trail (CSV)
            </button>
          </a>
          <PrintButton />
        </div>
      </div>

      {/* Cover block */}
      <div className="border-b border-slate-200 pb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {payload.entity.name} · Greenhouse gas inventory
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
          {longDate(payload.periodStart)} — {longDate(payload.periodEnd)}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Version {snapshot.version} · generated {snapshot.generatedAt.toLocaleString("en-GB")} by{" "}
          {snapshot.generatedBy.name} · reported under the GHG Protocol Corporate Standard
        </p>
      </div>

      {/* Headline figure */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card className="sm:col-span-1">
          <CardContent>
            <div className="text-sm font-medium text-slate-600">Total</div>
            <div className="mt-1 text-4xl font-semibold leading-none text-slate-900">{formatTonnes(grandTotal)}</div>
            <div className="mt-1 text-xs text-slate-500">tonnes CO2e</div>
            {comparison && comparison.previous.total > 0 && (
              <div className="mt-2">
                <DeltaBadge delta={buildDelta(grandTotal, comparison.previous.total)} />
              </div>
            )}
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 gap-4 sm:col-span-3 sm:grid-cols-3">
          {scopeSummary.map((s) => (
            <Card key={s.label}>
              <CardContent>
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: s.color }} />
                  <span className="text-xs font-medium text-slate-600">{s.label}</span>
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">{formatTonnes(s.value)}</div>
                <div className="text-xs text-slate-400">tCO2e</div>
                {s.previous !== undefined && s.previous > 0 && (
                  <div className="mt-2">
                    <DeltaBadge delta={buildDelta(s.value, s.previous)} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card className="border-emerald-200 bg-emerald-50/40">
        <CardHeader>
          <CardTitle>Plain-English summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-slate-800">{payload.executiveSummary}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reporting boundary</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <div className="text-slate-500">Reporting entity</div>
            <div className="font-medium text-slate-900">{payload.entity.name}</div>
            <div className="text-slate-600">{payload.entity.entitiesIncluded.join(", ")}</div>
          </div>
          <div>
            <div className="text-slate-500">Consolidation approach</div>
            <div className="font-medium text-slate-900">{payload.entity.boundaryApproach}</div>
          </div>
          <div>
            <div className="text-slate-500">Period covered</div>
            <div className="font-medium text-slate-900">
              {longDate(payload.periodStart)} – {longDate(payload.periodEnd)}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Scopes included</div>
            <div className="font-medium text-slate-900">
              Scope 1, Scope 2 (dual-reported) and Scope 3 Categories 1, 3, 6 and 7
            </div>
          </div>
        </CardContent>
      </Card>

      {siteRows.length > 0 && (
        <Card className="break-inside-avoid">
          <CardHeader>
            <CardTitle>Emissions by site</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Each site&apos;s split across the three scopes, on one shared scale.
            </p>
          </CardHeader>
          <CardContent>
            <StackedBarChart rows={siteRows} legend={SCOPE_LEGEND} />
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <caption className="sr-only">Emissions by site and scope, in tonnes CO2e</caption>
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="pb-2 font-medium">Site</th>
                    <th scope="col" className="pb-2 text-right font-medium">Scope 1</th>
                    <th scope="col" className="pb-2 text-right font-medium">Scope 2</th>
                    <th scope="col" className="pb-2 text-right font-medium">Scope 3</th>
                    <th scope="col" className="pb-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {bySite.map((s) => (
                    <tr key={s.siteId} className="border-b border-slate-100 last:border-0">
                      <th scope="row" className="py-2 text-left font-medium text-slate-800">
                        {s.siteName}
                        <span className="block text-xs font-normal text-slate-500">{s.entityName}</span>
                      </th>
                      <td className="py-2 text-right text-slate-700">{formatTonnes(s.scope1)}</td>
                      <td className="py-2 text-right text-slate-700">{formatTonnes(s.scope2Location)}</td>
                      <td className="py-2 text-right text-slate-700">{formatTonnes(s.scope3)}</td>
                      <td className="py-2 text-right font-semibold text-slate-900">{formatTonnes(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-400">Tonnes CO2e. Scope 2 shown location-based.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {comparison && yoyGroups.length > 0 && (
        <Card className="break-inside-avoid">
          <CardHeader>
            <CardTitle>Year-on-year comparison</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Against the same dates one year earlier ({longDate(comparison.previousPeriodStart)} –{" "}
              {longDate(comparison.previousPeriodEnd)}). For emissions, lower is better.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <GroupedColumnChart
              groups={yoyGroups}
              legend={[
                { label: "This period", color: PERIOD_COLORS.current },
                { label: "Same period last year", color: PERIOD_COLORS.previous },
              ]}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] text-sm">
                <caption className="sr-only">This period against the same period last year, in tonnes CO2e</caption>
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="pb-2 font-medium">Scope</th>
                    <th scope="col" className="pb-2 text-right font-medium">This period</th>
                    <th scope="col" className="pb-2 text-right font-medium">Last year</th>
                    <th scope="col" className="pb-2 text-right font-medium">Change</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {[
                    { label: "Scope 1", current: scope1Total, previous: comparison.previous.scope1 },
                    { label: "Scope 2 (location-based)", current: scope2Location, previous: comparison.previous.scope2Location },
                    { label: "Scope 3", current: scope3Total, previous: comparison.previous.scope3 },
                  ].map((r) => (
                    <tr key={r.label} className="border-b border-slate-100">
                      <th scope="row" className="py-2 text-left font-normal text-slate-700">{r.label}</th>
                      <td className="py-2 text-right text-slate-900">{formatTonnes(r.current)}</td>
                      <td className="py-2 text-right text-slate-600">{formatTonnes(r.previous)}</td>
                      <td className="py-2 text-right">
                        <DeltaBadge delta={buildDelta(r.current, r.previous)} />
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-200 font-semibold">
                    <th scope="row" className="py-2 text-left text-slate-900">Total</th>
                    <td className="py-2 text-right text-slate-900">{formatTonnes(grandTotal)}</td>
                    <td className="py-2 text-right text-slate-700">{formatTonnes(comparison.previous.total)}</td>
                    <td className="py-2 text-right">
                      <DeltaBadge delta={buildDelta(grandTotal, comparison.previous.total)} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {monthly.length > 1 && (
        <Card className="break-inside-avoid">
          <CardHeader>
            <CardTitle>Monthly profile</CardTitle>
            <p className="mt-1 text-sm text-slate-500">Total group emissions per month across the reporting period.</p>
          </CardHeader>
          <CardContent>
            <TrendLineChart points={monthly.map((m) => ({ label: m.label, value: m.total }))} />
          </CardContent>
        </Card>
      )}

      <Card className="break-inside-avoid">
        <CardHeader>
          <CardTitle>Emissions totals</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <tbody className="tabular-nums">
              <tr className="border-b border-slate-100">
                <td className="py-2 text-slate-600">Scope 1 (direct emissions)</td>
                <td className="py-2 text-right font-medium text-slate-900">
                  {kg(scope1Total)} ({tonnes(scope1Total)}CO2e)
                </td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-2 text-slate-600">Scope 2 — location-based</td>
                <td className="py-2 text-right font-medium text-slate-900">
                  {kg(scope2Location)} ({tonnes(scope2Location)}CO2e)
                </td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-2 text-slate-600">Scope 2 — market-based</td>
                <td className="py-2 text-right font-medium text-slate-900">
                  {kg(scope2Market)} ({tonnes(scope2Market)}CO2e)
                </td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-2 text-slate-600">Scope 3 (Cat 1, 3, 6, 7)</td>
                <td className="py-2 text-right font-medium text-slate-900">
                  {kg(scope3Total)} ({tonnes(scope3Total)}CO2e)
                </td>
              </tr>
              <tr className="border-t-2 border-slate-200">
                <td className="py-2 font-semibold text-slate-900">
                  Total (Scope 1 + Scope 2 location-based + Scope 3)
                </td>
                <td className="py-2 text-right font-semibold text-slate-900">
                  {kg(grandTotal)} ({tonnes(grandTotal)}CO2e)
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-400">
            Scope 2 is dual-reported as required. The market-based figure is shown alongside, never added to the total,
            so purchased electricity is counted once.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="break-inside-avoid">
          <CardHeader>
            <CardTitle>Scope 1 by category</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody className="tabular-nums">
                {payload.scope1.byCategory.map((c) => (
                  <tr key={c.category} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 text-slate-600">{c.category}</td>
                    <td className="py-1.5 text-right text-slate-900">{kg(c.kgCo2e)}</td>
                  </tr>
                ))}
                {payload.scope1.byCategory.length === 0 && (
                  <tr>
                    <td className="py-1.5 text-slate-400">No Scope 1 activity in this period.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card className="break-inside-avoid">
          <CardHeader>
            <CardTitle>Scope 2 by category (location / market)</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody className="tabular-nums">
                {payload.scope2.byCategory.map((c) => (
                  <tr key={c.category} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 text-slate-600">{c.category}</td>
                    <td className="py-1.5 text-right text-slate-900">
                      {kg(c.locationKgCo2e)} / {kg(c.marketKgCo2e)}
                    </td>
                  </tr>
                ))}
                {payload.scope2.byCategory.length === 0 && (
                  <tr>
                    <td className="py-1.5 text-slate-400">No Scope 2 activity in this period.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card className="break-inside-avoid sm:col-span-2">
          <CardHeader>
            <CardTitle>Scope 3 by category</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody className="tabular-nums">
                {payload.scope3.byCategory.map((c) => (
                  <tr key={c.category} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 text-slate-600">{c.category}</td>
                    <td className="py-1.5 text-right text-slate-900">{kg(c.kgCo2e)}</td>
                  </tr>
                ))}
                {payload.scope3.byCategory.length === 0 && (
                  <tr>
                    <td className="py-1.5 text-slate-400">
                      No Scope 3 activity calculated in this period yet — either nothing was entered, or entries are
                      awaiting an emission factor import (see below).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

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
              {payload.dataQuality.tierBreakdown.map((t) => (
                <tr key={t.tier} className="border-b border-slate-100 last:border-0">
                  <th scope="row" className="py-1.5 text-left font-normal text-slate-700">{TIER_LABELS[t.tier]}</th>
                  <td className="py-1.5 text-right text-slate-900">{kg(t.kgCo2e)}</td>
                  <td className="py-1.5 text-right text-slate-900">{t.percent.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-400">
            Weighted against Scope 1 + Scope 2 (location-based) + Scope 3, so the Scope 2 market-based figure
            isn&apos;t counted twice.
          </p>
        </CardContent>
      </Card>

      <Card className="break-inside-avoid">
        <CardHeader>
          <CardTitle>Methodology & emission factor sources</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th scope="col" className="pb-2 font-medium">Scope</th>
                <th scope="col" className="pb-2 font-medium">Source</th>
                <th scope="col" className="pb-2 font-medium">Vintage</th>
              </tr>
            </thead>
            <tbody>
              {payload.factorSources.map((f, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 text-slate-700">{f.scope}</td>
                  <td className="py-1.5 text-slate-700">{f.source}</td>
                  <td className="py-1.5 text-slate-700">{f.vintage}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">
            Every figure above is calculated as activity data × a published emission factor, using the factor set that
            was in force for the period being reported rather than the latest one — so this report stays reproducible
            after factors are updated. The full calculation audit trail (input, factor, source, vintage, formula,
            calculated-by, timestamp) is available via the CSV export, or{" "}
            <Link href={`/reports/${id}/calculations`} className="font-medium text-brand-700 hover:text-brand-800">
              browse every calculation in this report
            </Link>{" "}
            to see how any single figure was arrived at.
          </p>
        </CardContent>
      </Card>

      {payload.excludedFlaggedEntries.length > 0 && (
        <Card className="break-inside-avoid border-amber-200 bg-amber-50/40">
          <CardHeader>
            <CardTitle>Excluded pending review</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-sm text-slate-600">
              These entries were flagged by the plausibility check and are not included in the totals above until
              reviewed.
            </p>
            <ul className="space-y-1 text-sm">
              {payload.excludedFlaggedEntries.map((e, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {e.site} — {e.dataPoint} ({e.periodLabel})
                  </span>
                  <Badge tone="warning">{e.reason}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {payload.awaitingFactorEntries.length > 0 && (
        <Card className="break-inside-avoid border-amber-200 bg-amber-50/40">
          <CardHeader>
            <CardTitle>Awaiting emission factor</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-sm text-slate-600">
              This activity data has been captured but isn&apos;t included in the totals above yet — no emission factor
              has been imported for its category. Once one is (Admin → Emission factors), these will be calculated
              automatically and included in the next report.
            </p>
            <ul className="space-y-1 text-sm">
              {payload.awaitingFactorEntries.map((e, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {e.site} — {e.dataPoint} ({e.periodLabel})
                  </span>
                  <Badge tone="warning">Awaiting factor</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="no-print text-xs text-slate-400">
        This report is a permanent, versioned snapshot. Regenerating never overwrites it, so the figures above remain
        reproducible even after activity data or emission factors change.
      </p>
    </div>
  );
}

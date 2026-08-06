import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ReportPayload } from "@/lib/report-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PrintButton } from "../print-button";

const TIER_LABELS: Record<string, string> = {
  TIER_1: "Tier 1 — Primary / measured",
  TIER_2: "Tier 2 — Primary / calculated",
  TIER_3: "Tier 3 — Secondary / estimated",
};

function kg(n: number) {
  return `${n.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg`;
}
function tonnes(n: number) {
  return `${(n / 1000).toLocaleString("en-GB", { maximumFractionDigits: 2 })} t`;
}

export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snapshot = await prisma.reportSnapshot.findUnique({ where: { id }, include: { generatedBy: true } });
  if (!snapshot) notFound();

  const payload = snapshot.payload as unknown as ReportPayload;
  const scope1Total = payload.scope1.totalKgCo2e;
  const scope2Location = payload.scope2.locationBasedTotalKgCo2e;
  const scope2Market = payload.scope2.marketBasedTotalKgCo2e;

  return (
    <div className="max-w-4xl">
      <div className="no-print flex items-center justify-between">
        <Link href="/reports" className="text-sm text-emerald-700 hover:underline">
          ← All reports
        </Link>
        <div className="flex gap-2">
          <a href={`/reports/${id}/audit-trail.csv`}>
            <button className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50">
              Download audit trail (CSV)
            </button>
          </a>
          <PrintButton />
        </div>
      </div>

      <div className="mt-4">
        <h1 className="text-2xl font-semibold text-slate-900">GHG Inventory Report</h1>
        <p className="text-sm text-slate-500">
          Version {snapshot.version} · generated {snapshot.generatedAt.toLocaleString("en-GB")} by {snapshot.generatedBy.name}
        </p>
      </div>

      <Card className="mt-4">
        <CardContent className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <div className="text-slate-500">Reporting entity</div>
            <div className="font-medium text-slate-900">{payload.entity.name}</div>
            <div className="text-slate-600">{payload.entity.entitiesIncluded.join(", ")}</div>
          </div>
          <div>
            <div className="text-slate-500">Boundary approach</div>
            <div className="font-medium text-slate-900">{payload.entity.boundaryApproach}</div>
          </div>
          <div>
            <div className="text-slate-500">Period covered</div>
            <div className="font-medium text-slate-900">
              {new Date(payload.periodStart).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} –{" "}
              {new Date(payload.periodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Scope</div>
            <div className="font-medium text-slate-900">Scope 1 and Scope 2 only (MVP) — Scope 3 not yet built</div>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6 border-emerald-200 bg-emerald-50/40">
        <CardHeader>
          <CardTitle>Plain-English summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-slate-800">{payload.executiveSummary}</p>
        </CardContent>
      </Card>

      <h2 className="mt-8 text-lg font-semibold text-slate-900">Technical report</h2>

      <Card className="mt-3">
        <CardHeader>
          <CardTitle>Emissions totals</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <tbody>
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
              <tr>
                <td className="py-2 text-slate-600">Scope 2 — market-based</td>
                <td className="py-2 text-right font-medium text-slate-900">
                  {kg(scope2Market)} ({tonnes(scope2Market)}CO2e)
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Scope 1 by category</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
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
        <Card>
          <CardHeader>
            <CardTitle>Scope 2 by category (location / market)</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
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
      </div>

      <Card className="mt-3">
        <CardHeader>
          <CardTitle>Data quality summary</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2 font-medium">Tier</th>
                <th className="pb-2 text-right font-medium">Emissions</th>
                <th className="pb-2 text-right font-medium">% of inventory</th>
              </tr>
            </thead>
            <tbody>
              {payload.dataQuality.tierBreakdown.map((t) => (
                <tr key={t.tier} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 text-slate-700">{TIER_LABELS[t.tier]}</td>
                  <td className="py-1.5 text-right text-slate-900">{kg(t.kgCo2e)}</td>
                  <td className="py-1.5 text-right text-slate-900">{t.percent.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-400">
            Weighted against Scope 1 + Scope 2 (location-based) so the Scope 2 market-based figure isn&apos;t counted twice.
          </p>
        </CardContent>
      </Card>

      <Card className="mt-3">
        <CardHeader>
          <CardTitle>Methodology & emission factor sources used</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2 font-medium">Scope</th>
                <th className="pb-2 font-medium">Source</th>
                <th className="pb-2 font-medium">Vintage</th>
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
        </CardContent>
      </Card>

      {payload.excludedFlaggedEntries.length > 0 && (
        <Card className="mt-3 border-amber-200 bg-amber-50/40">
          <CardHeader>
            <CardTitle>Excluded pending review</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-sm text-slate-600">
              These entries were flagged by the plausibility check and are not included in the totals above until reviewed.
            </p>
            <ul className="space-y-1 text-sm">
              {payload.excludedFlaggedEntries.map((e, i) => (
                <li key={i} className="flex items-center justify-between">
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

      <p className="no-print mt-6 text-xs text-slate-400">
        Full activity data and calculation audit trail (input, factor, source, vintage, formula, calculated-by,
        timestamp) for every figure in this report is available via the CSV export above.
      </p>
    </div>
  );
}

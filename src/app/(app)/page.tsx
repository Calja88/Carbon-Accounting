import Link from "next/link";
import { ClipboardList, FlagTriangleRight, Clock, CheckCircle2, ArrowRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSiteQuantityStatus } from "@/lib/entry-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ENTITY_LOGOS } from "@/lib/entity-logos";

export default async function DashboardPage() {
  const sites = await prisma.site.findMany({
    where: { isActive: true },
    include: { entity: true },
    orderBy: [{ entity: { name: "asc" } }, { name: "asc" }],
  });

  const siteSummaries = await Promise.all(
    sites.map(async (site) => {
      const statuses = await getSiteQuantityStatus(site.id);
      const missing = statuses.filter((s) => s.status === "missing");
      const flagged = statuses.filter((s) => s.status === "flagged");
      const awaitingFactor = statuses.filter((s) => s.status === "awaiting_factor");
      return { site, missing, flagged, awaitingFactor };
    }),
  );

  const totalMissing = siteSummaries.reduce((sum, s) => sum + s.missing.length, 0);
  const totalFlagged = siteSummaries.reduce((sum, s) => sum + s.flagged.length, 0);
  const totalAwaitingFactor = siteSummaries.reduce((sum, s) => sum + s.awaitingFactor.length, 0);

  const kpis = [
    { label: "Submissions not yet made", sub: "this period, across all sites", value: totalMissing, icon: ClipboardList, tone: totalMissing > 0 ? "text-slate-900" : "text-slate-400" },
    { label: "Entries flagged for review", sub: "excluded from reports until resolved", value: totalFlagged, icon: FlagTriangleRight, tone: totalFlagged > 0 ? "text-amber-600" : "text-slate-400" },
    { label: "Awaiting an emission factor", sub: "saved, not yet calculated", value: totalAwaitingFactor, icon: Clock, tone: totalAwaitingFactor > 0 ? "text-amber-600" : "text-slate-400" },
  ] as const;

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Group-wide submission status, at a glance.</p>
        </div>
        <Link href="/reports" className="flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:text-blue-800">
          Go to reports
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {kpis.map(({ label, sub, value, icon: Icon, tone }) => (
          <Card key={label}>
            <CardContent className="flex items-start justify-between">
              <div>
                <div className={`text-3xl font-semibold tabular-nums ${tone}`}>{value}</div>
                <div className="mt-1 text-sm font-medium text-slate-700">{label}</div>
                <div className="text-xs text-slate-400">{sub}</div>
              </div>
              <Icon className={`h-5 w-5 ${tone}`} />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Sites</h2>
        {siteSummaries.map(({ site, missing, flagged, awaitingFactor }) => {
          const issues = missing.length + flagged.length + awaitingFactor.length;
          return (
            <Card key={site.id}>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  {issues === 0 ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                  ) : (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-800">
                      {issues}
                    </span>
                  )}
                  <div>
                    <CardTitle>{site.name}</CardTitle>
                    <p className="flex items-center gap-1.5 text-xs text-slate-500">
                      {ENTITY_LOGOS[site.entity.name] ? (
                        // eslint-disable-next-line @next/next/no-img-element -- small static brand asset, next/image adds no value here
                        <img src={ENTITY_LOGOS[site.entity.name]} alt="" className="h-3 w-auto" />
                      ) : null}
                      {site.entity.name}
                    </p>
                  </div>
                </div>
                <Link href={`/entry/${site.id}`} className="flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-800">
                  Open
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </CardHeader>
              {issues > 0 && (
                <CardContent className="space-y-2 pt-3">
                  {missing.map((m) => (
                    <div key={m.dataPoint.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">
                        {m.periodLabel} — {m.dataPoint.dataPointName.toLowerCase()} not yet submitted
                      </span>
                      <Badge tone="neutral">Missing</Badge>
                    </div>
                  ))}
                  {flagged.map((f) => (
                    <div key={f.dataPoint.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">
                        {f.periodLabel} — {f.dataPoint.dataPointName.toLowerCase()} needs review
                      </span>
                      <Badge tone="warning">Flagged</Badge>
                    </div>
                  ))}
                  {awaitingFactor.map((a) => (
                    <div key={a.dataPoint.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">
                        {a.periodLabel} — {a.dataPoint.dataPointName.toLowerCase()} awaiting emission factor
                      </span>
                      <Badge tone="warning">Awaiting factor</Badge>
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

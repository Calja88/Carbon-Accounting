import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSiteQuantityStatus } from "@/lib/entry-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
      return { site, missing, flagged };
    }),
  );

  const totalMissing = siteSummaries.reduce((sum, s) => sum + s.missing.length, 0);
  const totalFlagged = siteSummaries.reduce((sum, s) => sum + s.flagged.length, 0);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Dashboard</h1>
        <Link href="/reports" className="text-sm font-medium text-emerald-700 hover:underline">
          Go to reports →
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardContent>
            <div className="text-2xl font-semibold text-slate-900">{totalMissing}</div>
            <div className="text-sm text-slate-500">submissions not yet made, this period</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-2xl font-semibold text-amber-700">{totalFlagged}</div>
            <div className="text-sm text-slate-500">entries flagged for review</div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 space-y-3">
        {siteSummaries.map(({ site, missing, flagged }) => (
          <Card key={site.id}>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <div>
                <CardTitle>{site.name}</CardTitle>
                <p className="text-xs text-slate-500">{site.entity.name}</p>
              </div>
              <Link href={`/entry/${site.id}`} className="text-sm font-medium text-emerald-700 hover:underline">
                Open →
              </Link>
            </CardHeader>
            {(missing.length > 0 || flagged.length > 0) && (
              <CardContent className="space-y-2 pt-3">
                {missing.map((m) => (
                  <div key={m.dataPoint.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">
                      {site.name} — {m.periodLabel} {m.dataPoint.dataPointName.toLowerCase()} not yet submitted
                    </span>
                    <Badge tone="neutral">Missing</Badge>
                  </div>
                ))}
                {flagged.map((f) => (
                  <div key={f.dataPoint.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">
                      {site.name} — {f.periodLabel} {f.dataPoint.dataPointName.toLowerCase()} needs review
                    </span>
                    <Badge tone="warning">Flagged</Badge>
                  </div>
                ))}
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

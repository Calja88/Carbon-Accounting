import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { resolveAiActor } from "@/lib/ai";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Every calculation that went into one report snapshot, each linking to its
 * own "how was this calculated" page. This is the browsable counterpart to
 * the audit-trail CSV export.
 */
export default async function ReportCalculationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const actor = await resolveAiActor();
  if (!actor) redirect("/login");

  const snapshot = await prisma.reportSnapshot.findUnique({
    where: { id },
    select: { id: true, periodStart: true, periodEnd: true },
  });
  if (!snapshot) notFound();

  const links = await prisma.reportSnapshotCalculation.findMany({
    where: {
      reportSnapshotId: id,
      // Scope filter applied here, not after — a calculation outside the
      // caller's scope is never listed, even inside a snapshot they can open.
      calculation: { activityEntry: { siteId: { in: actor.siteIds } } },
    },
    include: {
      calculation: {
        include: {
          activityEntry: {
            include: { activityDataPoint: true, site: { include: { entity: true } } },
          },
        },
      },
    },
  });

  const rows = links
    .map((l) => l.calculation)
    .sort((a, b) => Number(b.resultKgCo2e) - Number(a.resultKgCo2e));

  return (
    <div className="space-y-6">
      <Link href={`/reports/${id}`} className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to the report
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Calculations in this report</h1>
        <p className="mt-1 text-sm text-slate-500">
          {rows.length} calculation{rows.length === 1 ? "" : "s"} for{" "}
          {snapshot.periodStart.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })} to{" "}
          {snapshot.periodEnd.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}. Open any
          one to see the activity data, the exact factor and its source, the equation applied, and any evidence
          document behind it.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((calc) => (
          <Link key={calc.id} href={`/calculations/${calc.id}`}>
            <Card className="transition-all hover:-translate-y-0.5 hover:shadow-md">
              <CardContent className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-slate-900">
                      {calc.activityEntry.activityDataPoint.dataPointName}
                    </span>
                    <Badge tone="info">{calc.scope.replace("_", " ")}</Badge>
                    {calc.basis !== "STANDARD" && (
                      <Badge tone="neutral">{calc.basis.replace(/_/g, " ").toLowerCase()}</Badge>
                    )}
                  </div>
                  <div className="text-sm text-slate-500">
                    {calc.activityEntry.site.name} ({calc.activityEntry.site.entity.name}) ·{" "}
                    {calc.activityEntry.periodStart.toLocaleDateString("en-GB", {
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </div>
                  <div className="text-xs text-slate-400">{calc.formulaApplied}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="tabular-nums text-sm font-medium text-slate-900">
                    {Number(calc.resultKgCo2e).toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-blue-700" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

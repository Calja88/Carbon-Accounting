import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { resolveAiActor } from "@/lib/ai";
import { Badge } from "@/components/ui/badge";
import { DataTable, Td } from "@/components/ui/data-table";
import { RecordList } from "@/components/ui/record-list";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";

/**
 * Every calculation that went into one report snapshot, each linking to its
 * own "how was this calculated" page. This is the browsable counterpart to
 * the audit-trail CSV export.
 *
 * Deliberately calculation-grain, not entry-grain — the historical data
 * explorer (/data/entries) picks one calculation per entry to avoid
 * double-counting a Scope 2 site's location-/market-based pair in a
 * single-figure summary, but a report's audit trail must show every
 * Calculation row that fed the totals, both of that pair included. Reusing
 * the explorer's service here would silently drop rows from an audit
 * export's browsable counterpart, so this page keeps its own calc-grain
 * query and only shares presentation (DataTable, Breadcrumbs) with it.
 */
export default async function ReportCalculationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const actor = await resolveAiActor();
  if (!actor) redirect("/login");

  const snapshot = await prisma.reportSnapshot.findUnique({
    where: { id },
    select: { id: true, version: true, periodStart: true, periodEnd: true },
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

  const rows = links.map((l) => l.calculation).sort((a, b) => Number(b.resultKgCo2e) - Number(a.resultKgCo2e));

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Reports", href: "/reports" },
          { label: `Version ${snapshot.version}`, href: `/reports/${id}` },
          { label: "Calculations" },
        ]}
      />

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

      <RecordList state={rows.length === 0 ? "empty" : "ready"} emptyTitle="No calculations in this report" emptyDescription="Nothing was calculable for this period.">
        <div className="rounded-lg border border-slate-200 bg-white">
          <DataTable
            caption="Calculations included in this report"
            headers={["Data point", "Site", "Period", "Scope", { label: "Result", align: "right" }]}
          >
            {rows.map((calc) => (
              <tr key={calc.id} className="hover:bg-slate-50">
                <Td>
                  <Link href={`/calculations/${calc.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                    {calc.activityEntry.activityDataPoint.dataPointName}
                  </Link>
                  <div className="text-xs text-slate-400">{calc.formulaApplied}</div>
                </Td>
                <Td>
                  <div>{calc.activityEntry.site.name}</div>
                  <div className="text-xs text-slate-500">{calc.activityEntry.site.entity.name}</div>
                </Td>
                <Td>
                  {calc.activityEntry.periodStart.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone="info">{calc.scope.replace("_", " ")}</Badge>
                    {calc.basis !== "STANDARD" && <Badge tone="neutral">{calc.basis.replace(/_/g, " ").toLowerCase()}</Badge>}
                  </div>
                </Td>
                <Td align="right">{Number(calc.resultKgCo2e).toLocaleString("en-GB", { maximumFractionDigits: 1 })} kg</Td>
              </tr>
            ))}
          </DataTable>
        </div>
      </RecordList>
    </div>
  );
}

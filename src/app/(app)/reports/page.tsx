import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GenerateReportForm } from "./generate-report-form";

export default async function ReportsPage() {
  const reports = await prisma.reportSnapshot.findMany({
    include: { generatedBy: true },
    orderBy: { generatedAt: "desc" },
  });

  const now = new Date();
  const defaultEnd = now.toISOString().slice(0, 7);
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString().slice(0, 7);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Reports</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every report is a permanent, versioned snapshot — generating a new one never overwrites an old one, so past
        reports stay reproducible even if data or factors change later.
      </p>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Generate a new report</CardTitle>
        </CardHeader>
        <CardContent>
          <GenerateReportForm defaultStart={startOfYear} defaultEnd={defaultEnd} />
        </CardContent>
      </Card>

      <div className="mt-6 space-y-2">
        {reports.length === 0 && <p className="text-sm text-slate-500">No reports generated yet.</p>}
        {reports.map((r) => (
          <Link key={r.id} href={`/reports/${r.id}`}>
            <Card className="transition-shadow hover:shadow-md">
              <CardContent className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-900">
                    Version {r.version} — {new Date(r.periodStart).toLocaleDateString("en-GB", { month: "short", year: "numeric" })} to{" "}
                    {new Date(r.periodEnd).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                  </div>
                  <div className="text-sm text-slate-500">
                    Generated {r.generatedAt.toLocaleString("en-GB")} by {r.generatedBy.name}
                  </div>
                </div>
                <span className="text-sm font-medium text-emerald-700">View →</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

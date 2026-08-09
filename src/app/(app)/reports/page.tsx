import Link from "next/link";
import { FileText, ArrowRight } from "lucide-react";
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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Reports</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every report is a permanent, versioned snapshot — generating a new one never overwrites an old one, so past
          reports stay reproducible even if data or factors change later.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Generate a new report</CardTitle>
        </CardHeader>
        <CardContent>
          <GenerateReportForm defaultStart={startOfYear} defaultEnd={defaultEnd} />
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Past reports</h2>
        {reports.length === 0 && (
          <p className="text-sm text-slate-500">No reports generated yet.</p>
        )}
        <div className="space-y-2">
          {reports.map((r) => (
            <Link key={r.id} href={`/reports/${r.id}`}>
              <Card className="transition-all hover:-translate-y-0.5 hover:shadow-md">
                <CardContent className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                      <FileText className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="font-medium text-slate-900">
                        Version {r.version} — {new Date(r.periodStart).toLocaleDateString("en-GB", { month: "short", year: "numeric" })} to{" "}
                        {new Date(r.periodEnd).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                      </div>
                      <div className="text-sm text-slate-500">
                        Generated {r.generatedAt.toLocaleString("en-GB")} by {r.generatedBy.name}
                      </div>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-sm font-medium text-brand-700">
                    View
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

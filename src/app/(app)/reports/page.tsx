import Link from "next/link";
import { FileText, Trash2 } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, Td } from "@/components/ui/data-table";
import { RecordList } from "@/components/ui/record-list";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { GenerateReportForm } from "./generate-report-form";
import { deleteReportSnapshotAction } from "./actions";

export default async function ReportsPage() {
  const [reports, session] = await Promise.all([
    prisma.reportSnapshot.findMany({
      include: { generatedBy: true },
      orderBy: { generatedAt: "desc" },
    }),
    auth(),
  ]);
  const isAdmin = session?.user?.role === "ADMIN";

  const now = new Date();
  const defaultEnd = now.toISOString().slice(0, 7);
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString().slice(0, 7);

  return (
    <div className="space-y-6">
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

      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Past reports</h2>
        <RecordList
          state={reports.length === 0 ? "empty" : "ready"}
          emptyTitle="No reports generated yet"
          emptyDescription="Generate one above once activity data has been entered and calculated."
        >
          <div className="rounded-lg border border-slate-200 bg-white">
            <DataTable
              caption="Generated report snapshots"
              headers={["Report", "Period", "Generated", { label: "", align: "right" }]}
            >
              {reports.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/reports/${r.id}`} className="flex items-center gap-2 font-medium text-slate-900 hover:text-brand-700">
                      <FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                      Version {r.version}
                    </Link>
                  </Td>
                  <Td>
                    {new Date(r.periodStart).toLocaleDateString("en-GB", { month: "short", year: "numeric" })} –{" "}
                    {new Date(r.periodEnd).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                  </Td>
                  <Td>
                    <div className="text-slate-700">{r.generatedAt.toLocaleString("en-GB")}</div>
                    <div className="text-xs text-slate-400">by {r.generatedBy.name}</div>
                  </Td>
                  <Td align="right">
                    {isAdmin && (
                      <DestructiveActionDialog
                        triggerLabel={`Delete report version ${r.version}`}
                        triggerIcon={<Trash2 className="h-3.5 w-3.5" />}
                        title={`Permanently delete report version ${r.version}?`}
                        description="Reports are meant to be a permanent, reproducible record. Deleting one removes its frozen snapshot and audit-trail export entirely, with no undo — it does not affect the underlying activity data or calculations, only this generated document."
                        confirmLabel="Permanently delete"
                        formAction={deleteReportSnapshotAction}
                      >
                        <input type="hidden" name="reportSnapshotId" value={r.id} />
                      </DestructiveActionDialog>
                    )}
                  </Td>
                </tr>
              ))}
            </DataTable>
          </div>
        </RecordList>
      </div>
    </div>
  );
}

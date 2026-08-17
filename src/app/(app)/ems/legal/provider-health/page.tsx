import { redirect } from "next/navigation";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { requirePermission, PermissionDeniedError } from "@/lib/rbac/authorize";
import { getLegalSyncHealth, type LegalSyncCursorHealth } from "@/lib/ems/legal/legal-sync-health";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

function cursorTone(cursor: LegalSyncCursorHealth): "success" | "warning" | "danger" {
  if (cursor.status === "ERROR") return "danger";
  if (cursor.isStale) return "warning";
  return "success";
}

function cursorLabel(cursor: LegalSyncCursorHealth): string {
  if (cursor.status === "ERROR") return "ERROR";
  if (cursor.isStale) return "STALE";
  return cursor.status;
}

function formatTimestamp(value: Date | null): string {
  return value ? value.toLocaleString("en-GB") : "never";
}

export default async function LegalProviderHealthPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.legal_source.manage");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const health = await getLegalSyncHealth();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Legal source sync health</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Freshness and error state of the legal-register sync worker for every configured source. This is source
          evidence, not a legal-applicability decision — a stale or errored cursor only means the platform has not
          confirmed it holds the latest upstream data, not that anything is or is not compliant.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>legal.sync job queue</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge tone={health.pendingJobs > 0 ? "info" : "neutral"}>Pending: {health.pendingJobs}</Badge>
          <Badge tone={health.retryingJobs > 0 ? "warning" : "neutral"}>Retrying: {health.retryingJobs}</Badge>
          <Badge tone={health.deadLetteredJobs > 0 ? "danger" : "neutral"}>Dead-lettered: {health.deadLetteredJobs}</Badge>
          <Badge tone={health.recentJobFailures > 0 ? "warning" : "success"}>
            Last hour: {health.recentJobRuns} run{health.recentJobRuns === 1 ? "" : "s"}, {health.recentJobFailures} failed
          </Badge>
          <span className="text-xs text-slate-400">as of {health.generatedAt.toLocaleString("en-GB")}</span>
        </CardContent>
      </Card>

      {health.providers.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-slate-500">No legal source providers registered yet.</CardContent>
        </Card>
      ) : (
        health.providers.map((provider) => (
          <Card key={provider.providerKey}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {provider.providerName}
                <Badge tone={provider.providerStatus === "ENABLED" ? "success" : "neutral"}>{provider.providerStatus}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {provider.cursors.length === 0 ? (
                <p className="text-sm text-slate-500">No sync cursors yet — this source has never been polled.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                        <th className="pb-2 pr-4">Stream</th>
                        <th className="pb-2 pr-4">Filter</th>
                        <th className="pb-2 pr-4">Status</th>
                        <th className="pb-2 pr-4">Last success</th>
                        <th className="pb-2 pr-4">Last attempt</th>
                        <th className="pb-2">Diagnostic</th>
                      </tr>
                    </thead>
                    <tbody>
                      {provider.cursors.map((cursor) => (
                        <tr key={cursor.id} className="border-t border-slate-100">
                          <td className="py-2 pr-4">{cursor.stream}</td>
                          <td className="py-2 pr-4 text-slate-500">{cursor.filterKey || "—"}</td>
                          <td className="py-2 pr-4">
                            <Badge tone={cursorTone(cursor)}>{cursorLabel(cursor)}</Badge>
                          </td>
                          <td className="py-2 pr-4">{formatTimestamp(cursor.lastSuccessAt)}</td>
                          <td className="py-2 pr-4">{formatTimestamp(cursor.lastAttemptAt)}</td>
                          <td className="py-2 text-slate-500">{cursor.diagnostic ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

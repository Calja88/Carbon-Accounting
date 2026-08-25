import { redirect } from "next/navigation";
import Link from "next/link";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission, hasPermission } from "@/lib/rbac/authorize";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getEmsDashboardSummary,
  type DashboardSection,
} from "@/lib/ems/dashboard/dashboard-service";

export const dynamic = "force-dynamic";

export default async function EmsDashboardPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const canExport = hasPermission(context, "ems.export");
  const summary = await getEmsDashboardSummary(context);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">EMS dashboard &amp; reporting</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          A leadership overview across the modules you have access to. Every figure below is a count from that
          module&apos;s own existing records — nothing here decides compliance or ISO conformity. All data shown is
          synthetic.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard title="Compliance obligations" href="/ems/legal/obligations" section={summary.compliance}>
          {(data) => (
            <Stat
              label="Overdue or unevaluated"
              value={data.overdueOrUnevaluatedCount}
              tone={data.overdueOrUnevaluatedCount > 0 ? "warning" : "success"}
            />
          )}
        </SummaryCard>

        <SummaryCard title="Significant aspects &amp; controls" href="/ems/controls" section={summary.aspects}>
          {(data) => (
            <Stat
              label="Significant aspects with no active control"
              value={data.controlGapCount}
              tone={data.controlGapCount > 0 ? "warning" : "success"}
            />
          )}
        </SummaryCard>

        <SummaryCard title="Objectives &amp; actions" href="/ems/actions" section={summary.objectives}>
          {(data) => (
            <div className="flex gap-6">
              <Stat label="Open actions" value={data.openActionCount} tone="neutral" />
              <Stat label="Overdue" value={data.overdueActionCount} tone={data.overdueActionCount > 0 ? "danger" : "success"} />
            </div>
          )}
        </SummaryCard>

        <SummaryCard title="Audit programme" href="/ems/audits" section={summary.audits}>
          {(data) => (
            <div className="space-y-1">
              <Stat label="Total audits" value={data.totalAudits} tone="neutral" />
              <StatusBreakdown byStatus={data.byStatus} />
            </div>
          )}
        </SummaryCard>

        <SummaryCard title="Nonconformities &amp; CAPA" href="/ems/nonconformities" section={summary.nonconformities}>
          {(data) => (
            <div className="space-y-1">
              <Stat label="Open" value={data.openCount} tone={data.openCount > 0 ? "warning" : "success"} />
              <StatusBreakdown byStatus={data.byStatus} />
              <p className="mt-2 text-xs text-slate-400">
                Corrective-action effectiveness is reviewed per nonconformity — open the register for detail.
              </p>
            </div>
          )}
        </SummaryCard>

        <SummaryCard title="Environmental incidents" href="/ems/incidents" section={summary.incidents}>
          {(data) => (
            <div className="space-y-1">
              <Stat label="Open" value={data.openCount} tone={data.openCount > 0 ? "warning" : "success"} />
              <Stat label="Reported in last 90 days" value={data.last90DaysCount} tone="neutral" />
            </div>
          )}
        </SummaryCard>

        <SummaryCard title="Competence" href="/ems/competence/gaps" section={summary.competence}>
          {(data) => (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <Stat label="Gaps" value={data.gapCount} tone={data.gapCount > 0 ? "warning" : "success"} />
              <Stat label="Overdue" value={data.overdueCount} tone={data.overdueCount > 0 ? "danger" : "success"} />
              <Stat label="Expired" value={data.expiredCount} tone={data.expiredCount > 0 ? "danger" : "success"} />
              <Stat label="Expiring within 60 days" value={data.expiringWithin60DaysCount} tone="neutral" />
            </div>
          )}
        </SummaryCard>

        <SummaryCard title="Management review" href="/ems/management-reviews" section={summary.managementReview}>
          {(data) =>
            data.latestStatus ? (
              <div className="space-y-1">
                <p className="text-sm text-slate-700">
                  Latest review: <Badge tone="info">{data.latestStatus}</Badge>
                  {data.latestScheduledDate ? ` — scheduled ${data.latestScheduledDate.toLocaleDateString()}` : ""}
                </p>
                {data.openPriorActionCount !== null && (
                  <Stat label="Open prior actions" value={data.openPriorActionCount} tone={data.openPriorActionCount > 0 ? "warning" : "success"} />
                )}
                {data.latestDecisionCount !== null && <Stat label="Decisions recorded" value={data.latestDecisionCount} tone="neutral" />}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No management review has been scheduled yet.</p>
            )
          }
        </SummaryCard>

        <SummaryCard title="Documents &amp; evidence" href="/ems/documents" section={summary.documents}>
          {(data) => (
            <div className="space-y-1">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <Stat label="Effective documents" value={data.effectiveCount} tone="neutral" />
                <Stat label="Draft / in review" value={data.inReviewOrDraftCount} tone={data.inReviewOrDraftCount > 0 ? "warning" : "success"} />
              </div>
              <p className="text-xs text-slate-400">
                {data.evidenceObjectCount} evidence object{data.evidenceObjectCount === 1 ? "" : "s"} in the hub — active storage
                provider: <span className="font-medium text-slate-500">{data.activeStorageProvider}</span>.
              </p>
            </div>
          )}
        </SummaryCard>

        <SummaryCard title="My work queue" href="/ems/notifications" section={summary.notifications}>
          {(data) => (
            <Stat label="Pending notifications" value={data.pendingCount} tone={data.pendingCount > 0 ? "info" : "success"} />
          )}
        </SummaryCard>
      </div>

      <section aria-labelledby="ems-dashboard-reporting">
        <h2 id="ems-dashboard-reporting" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Reporting &amp; export
        </h2>
        {canExport ? (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            Issued audit reports and compliance evaluation reports are available as downloads from their own record —
            open an audit or evaluation and use its report link. There is no bulk EMS report export yet.
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-400">
            Reporting/export entry points require the &quot;Export EMS records&quot; permission, which your current
            role does not have.
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard<T>({
  title,
  href,
  section,
  children,
}: {
  title: string;
  href: string;
  section: DashboardSection<T>;
  children: (data: T) => React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Link href={href} className="text-xs font-medium text-slate-500 underline-offset-2 hover:underline">
          Open
        </Link>
      </CardHeader>
      <CardContent>
        {section.available ? (
          children(section.data)
        ) : (
          <p className="text-sm text-slate-400">
            {section.reason === "NO_PERMISSION"
              ? "You don't have permission to view this."
              : "Not available for this organisation yet."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "neutral" | "success" | "warning" | "danger" | "info" }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5">
        <Badge tone={tone}>{value}</Badge>
      </p>
    </div>
  );
}

function StatusBreakdown({ byStatus }: { byStatus: Partial<Record<string, number>> }) {
  const entries = Object.entries(byStatus).filter(([, count]) => (count ?? 0) > 0);
  if (entries.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
      {entries.map(([status, count]) => (
        <span key={status}>
          {status}: {count}
        </span>
      ))}
    </p>
  );
}

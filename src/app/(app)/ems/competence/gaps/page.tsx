import { redirect } from "next/navigation";
import Link from "next/link";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { Badge } from "@/components/ui/badge";
import { listCompetenceGaps } from "@/lib/ems/competence/gap-service";

export const dynamic = "force-dynamic";

function severityTone(severity: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (severity === "EXPIRED") return "danger";
  if (severity === "GAP") return "warning";
  return "info";
}

export default async function CompetenceGapsPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.competence.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const gaps = await listCompetenceGaps(context);
  const bySeverity = { GAP: 0, OVERDUE: 0, EXPIRED: 0 } as Record<string, number>;
  for (const gap of gaps) bySeverity[gap.severity] = (bySeverity[gap.severity] ?? 0) + 1;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Competence gaps</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Assignments marked as a gap, expired, or overdue against their due date, scoped to the Entities/Sites you
          can see. This is a read model over existing assignments — resolve a gap from the person or assignment page.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Gap</p>
          <p className="text-2xl font-semibold text-amber-900">{bySeverity.GAP}</p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">Overdue</p>
          <p className="text-2xl font-semibold text-blue-900">{bySeverity.OVERDUE}</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-800">Expired</p>
          <p className="text-2xl font-semibold text-red-900">{bySeverity.EXPIRED}</p>
        </div>
      </div>

      {gaps.length === 0 ? (
        <p className="text-sm text-slate-500">No competence gaps in scope.</p>
      ) : (
        <div className="space-y-2">
          {gaps.map((gap) => (
            <div key={gap.assignmentId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-4">
              <div>
                <Link href={`/ems/competence/people/${gap.personId}`} className="font-medium text-blue-700 hover:underline">
                  {gap.personDisplayName ?? "Unnamed person"}
                </Link>
                <p className="text-sm text-slate-500">
                  {gap.requirementTitle}
                  {gap.dueDate ? ` · due ${gap.dueDate.toISOString().slice(0, 10)}` : ""}
                </p>
                {gap.gapNote && <p className="text-xs text-slate-500">Note: {gap.gapNote}</p>}
              </div>
              <Badge tone={severityTone(gap.severity)}>{gap.severity}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { redirect } from "next/navigation";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission, PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { listActionDashboard, listActionItems, listActionProgrammes } from "@/lib/ems/actions/action-service";
import { listEnvironmentalObjectives } from "@/lib/ems/objectives/objective-service";
import { prisma } from "@/lib/prisma";
import { ActionsWorkspace } from "./action-forms";

export const dynamic = "force-dynamic";

export default async function ActionProgrammesPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const [programmes, actionItems, dashboard, objectives, members] = await Promise.all([
    listActionProgrammes(context),
    listActionItems(context),
    listActionDashboard(context),
    listEnvironmentalObjectives(context),
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  const actionsByProgramme = new Map<string, typeof actionItems>();
  for (const action of actionItems) {
    const list = actionsByProgramme.get(action.programmeId) ?? [];
    list.push(action);
    actionsByProgramme.set(action.programmeId, list);
  }

  const memberOptions = members.map((member) => ({ id: member.id, name: member.user.name ?? member.id }));
  const objectiveOptions = objectives.map((objective) => ({
    id: objective.id,
    name: objective.activeVersion?.title ?? `Objective ${objective.id}`,
  }));

  const overdueCount = dashboard.filter((item) => item.overdue).length;
  const canManage = hasPermission(context, "ems.action.manage");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Action programmes</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Programmes group actions with owners, dependencies, progress and completion evidence. Completing an action
          never marks a linked objective achieved — objective achievement is always a separate, explicit review. A
          closed action (completed, verified or cancelled) is immutable except through an explicit reopen event, and
          every reassignment, status change, completion, verification and reopen is recorded in the audit trail.
          Overdue owners are reminded through the shared in-app notification system; a reassigned or closed action
          stops receiving stale reminders.
        </p>
        <p className="mt-2 text-sm font-medium text-slate-700">
          {overdueCount} of {dashboard.length} open action{dashboard.length === 1 ? "" : "s"} currently overdue (tenant-scoped).
        </p>
      </div>

      {canManage ? (
        <ActionsWorkspace
          programmes={programmes.map((programme) => ({
            id: programme.id,
            title: programme.title,
            status: programme.status,
            ownerName: programme.owner.user.name ?? programme.ownerMembershipId,
            objectiveId: programme.objectiveId,
            actions: (actionsByProgramme.get(programme.id) ?? []).map((action) => ({
              id: action.id,
              title: action.title,
              status: action.status,
              priority: action.priority,
              ownerName: action.owner.user.name ?? action.ownerMembershipId,
              dueDate: action.dueDate.toISOString().slice(0, 10),
              overdue: action.dueDate.getTime() < Date.now() && !["COMPLETED", "VERIFIED", "CANCELLED"].includes(action.status),
              completionCriteria: action.completionCriteria,
              completionEvidenceNote: action.completionEvidenceNote,
              dependsOn: action.dependenciesOn.map((dep) => ({
                id: dep.dependsOnActionItem.id,
                title: dep.dependsOnActionItem.title,
                status: dep.dependsOnActionItem.status,
              })),
            })),
          }))}
          members={memberOptions}
          objectives={objectiveOptions}
        />
      ) : (
        <p className="text-sm text-slate-500">You have read-only access to action programmes.</p>
      )}
    </div>
  );
}

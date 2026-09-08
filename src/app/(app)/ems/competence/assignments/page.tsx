import { redirect } from "next/navigation";
import Link from "next/link";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission, hasPermission } from "@/lib/rbac/authorize";
import { listCompetenceAssignments } from "@/lib/ems/competence/assignment-service";
import { listPersonProfiles } from "@/lib/ems/competence/person-service";
import { listCompetenceRequirements } from "@/lib/ems/competence/requirement-service";
import { CreateAssignmentForm, AssignmentList, type AssignmentRow } from "./assignment-forms";

export const dynamic = "force-dynamic";

export default async function CompetenceAssignmentsPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.competence.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const [assignments, people, requirements] = await Promise.all([
    listCompetenceAssignments(context),
    listPersonProfiles(context, { isActive: true }),
    listCompetenceRequirements(context),
  ]);

  const rows: AssignmentRow[] = assignments.map((assignment) => ({
    id: assignment.id,
    personId: assignment.person.id,
    personName: assignment.person.displayName ?? assignment.person.membership?.user.name ?? "Unnamed person",
    requirementVersionId: assignment.requirementVersion.id,
    requirementTitle: assignment.requirementVersion.title,
    requirementVersion: assignment.requirementVersion.version,
    status: assignment.status,
    dueDate: assignment.dueDate ? assignment.dueDate.toISOString().slice(0, 10) : null,
  }));

  const activeVersions = requirements
    .filter((requirement) => requirement.activeVersion)
    .map((requirement) => ({
      id: requirement.activeVersion!.id,
      name: `${requirement.requirementKey} — ${requirement.activeVersion!.title} (v${requirement.activeVersion!.version})`,
    }));

  const canManage = hasPermission(context, "ems.competence.manage");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Competence assignments</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Which active competence requirement each person has been assigned, and its status. Only an ACTIVE
          requirement version can be assigned; a requirement revision never changes an existing assignment. Open an
          assignment to submit/verify evidence, record an assessment, or see its expiry. See the{" "}
          <Link href="/ems/competence/expiry" className="text-blue-700 underline">
            expiry dashboard
          </Link>{" "}
          for what is expiring or already expired.
        </p>
      </div>

      {canManage && (
        <CreateAssignmentForm
          people={people.map((p) => ({ id: p.id, name: p.displayName ?? p.membership?.user.name ?? "Unnamed person" }))}
          activeVersions={activeVersions}
        />
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Assignments</h2>
        <AssignmentList assignments={rows} />
      </div>
    </div>
  );
}

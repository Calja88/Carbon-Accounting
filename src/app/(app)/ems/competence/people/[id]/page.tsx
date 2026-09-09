import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission, hasPermission } from "@/lib/rbac/authorize";
import { TenantOwnershipError, tenantWhere } from "@/lib/repositories/tenant-scope";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getPersonProfile, getPersonSensitiveProfile, COMPETENCE_SENSITIVE_VIEW_PERMISSION } from "@/lib/ems/competence/person-service";
import { listCompetenceAssignmentsForPerson } from "@/lib/ems/competence/assignment-service";
import { listCompetenceRequirements } from "@/lib/ems/competence/requirement-service";
import { EditPersonForm, SensitiveProfileForm, DeactivatePersonButton, ReactivatePersonButton } from "../people-forms";
import { CreateAssignmentForm, AssignmentList, type AssignmentRow } from "../../assignments/assignment-forms";

export const dynamic = "force-dynamic";

export default async function PersonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.competence.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  let person;
  try {
    person = await getPersonProfile(context, id);
  } catch (error) {
    if (error instanceof TenantOwnershipError) redirect("/ems/competence/people");
    throw error;
  }
  if (!person) redirect("/ems/competence/people");

  const canManage = hasPermission(context, "ems.competence.manage");
  const canViewSensitive = hasPermission(context, COMPETENCE_SENSITIVE_VIEW_PERMISSION);

  const ctx = toTenantRepositoryContext(context);
  const [assignments, requirements, entities, sites, sensitiveProfile] = await Promise.all([
    listCompetenceAssignmentsForPerson(context, id),
    listCompetenceRequirements(context),
    prisma.entity.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    prisma.site.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    canViewSensitive ? getPersonSensitiveProfile(context, id) : Promise.resolve(null),
  ]);

  const displayName = person.displayName ?? person.membership?.user.name ?? "Unnamed person";

  const activeVersions = requirements
    .filter((requirement) => requirement.activeVersion)
    .map((requirement) => ({
      id: requirement.activeVersion!.id,
      name: `${requirement.requirementKey} — ${requirement.activeVersion!.title} (v${requirement.activeVersion!.version})`,
    }));

  const assignmentRows: AssignmentRow[] = assignments.map((assignment) => ({
    id: assignment.id,
    personId: id,
    personName: displayName,
    requirementVersionId: assignment.requirementVersionId,
    requirementTitle: assignment.requirementVersion.title,
    requirementVersion: assignment.requirementVersion.version,
    status: assignment.status,
    dueDate: assignment.dueDate ? assignment.dueDate.toISOString().slice(0, 10) : null,
  }));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{displayName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {person.personType}
            {person.membership ? " · linked login identity" : " · no login identity"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!person.isActive && <Badge tone="neutral">Inactive</Badge>}
        </div>
      </div>

      {canManage && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Profile</h2>
            <EditPersonForm
              personId={id}
              entities={entities.map((e) => ({ id: e.id, name: e.name }))}
              sites={sites.map((s) => ({ id: s.id, name: s.name }))}
              defaultDisplayName={person.displayName}
              hasMembership={Boolean(person.membership)}
              currentEntityId={person.entityId}
              currentSiteId={person.siteId}
            />
            {person.isActive ? <DeactivatePersonButton personId={id} /> : <ReactivatePersonButton personId={id} />}
          </CardContent>
        </Card>
      )}

      {canViewSensitive ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Restricted contact detail</h2>
            <p className="text-sm text-slate-500">Visible only because you hold the sensitive-profile permission.</p>
            {canManage ? (
              <SensitiveProfileForm
                personId={id}
                contactEmail={sensitiveProfile?.contactEmail ?? null}
                contactPhone={sensitiveProfile?.contactPhone ?? null}
                notes={sensitiveProfile?.notes ?? null}
              />
            ) : (
              <dl className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-slate-500">Contact email</dt>
                  <dd>{sensitiveProfile?.contactEmail ?? "—"}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Contact phone</dt>
                  <dd>{sensitiveProfile?.contactPhone ?? "—"}</dd>
                </div>
                {sensitiveProfile?.notes && (
                  <div className="sm:col-span-2">
                    <dt className="font-medium text-slate-500">Notes</dt>
                    <dd className="whitespace-pre-wrap">{sensitiveProfile.notes}</dd>
                  </div>
                )}
              </dl>
            )}
          </CardContent>
        </Card>
      ) : (
        <p className="text-xs text-slate-500">Restricted contact detail is hidden — you do not hold the sensitive-profile permission.</p>
      )}

      {canManage && (
        <CreateAssignmentForm
          people={[{ id, name: displayName }]}
          activeVersions={activeVersions}
          defaultPersonId={id}
        />
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Competence assignments</h2>
        <AssignmentList assignments={assignmentRows} showPersonLink={false} />
      </div>

      <p className="text-sm text-slate-500">
        See the full{" "}
        <Link href="/ems/competence/requirements" className="text-blue-700 hover:underline">
          competence requirement admin
        </Link>{" "}
        for each requirement&apos;s role/process/aspect/control/obligation/emergency scope mapping.
      </p>
    </div>
  );
}

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission, hasPermission } from "@/lib/rbac/authorize";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { listPersonProfiles, COMPETENCE_SENSITIVE_VIEW_PERMISSION } from "@/lib/ems/competence/person-service";
import { CreatePersonForm, PersonList, type PersonListRow } from "./people-forms";

export const dynamic = "force-dynamic";

export default async function CompetencePeoplePage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.competence.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const ctx = toTenantRepositoryContext(context);

  const [people, memberships, entities, sites] = await Promise.all([
    listPersonProfiles(context),
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.entity.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    prisma.site.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
  ]);

  const rows: PersonListRow[] = people.map((person) => ({
    id: person.id,
    name: person.displayName ?? person.membership?.user.name ?? "Unnamed person",
    personType: person.personType,
    isActive: person.isActive,
    entityId: person.entityId,
    siteId: person.siteId,
  }));

  const canManage = hasPermission(context, "ems.competence.manage");
  const canViewSensitive = hasPermission(context, COMPETENCE_SENSITIVE_VIEW_PERMISSION);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Competence people</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          People with competence assignments — employees, contractors and others. A person without a login identity
          carries their own display name; restricted contact detail is visible only with the sensitive-profile
          permission.
        </p>
      </div>

      {canManage && (
        <CreatePersonForm
          memberships={memberships.map((m) => ({ id: m.id, name: m.user.name ?? m.id }))}
          entities={entities.map((e) => ({ id: e.id, name: e.name }))}
          sites={sites.map((s) => ({ id: s.id, name: s.name }))}
          canViewSensitive={canViewSensitive}
        />
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">People</h2>
        <PersonList people={rows} />
      </div>
    </div>
  );
}

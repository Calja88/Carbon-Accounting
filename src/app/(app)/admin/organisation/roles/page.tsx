import { redirect } from "next/navigation";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { requirePermission, PermissionDeniedError } from "@/lib/rbac/authorize";
import { PERMISSION_CATALOGUE } from "@/lib/rbac/permission-catalogue";
import { prisma } from "@/lib/prisma";
import { RolePermissionEditor } from "./role-permission-editor";

export default async function OrganisationRolesPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "organisation.role.manage");
  } catch (err) {
    if (err instanceof OrganisationAccessError || err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  const roles = await prisma.roleDefinition.findMany({
    where: { organisationId: context.organisationId, isActive: true },
    include: { permissions: true },
    orderBy: { name: "asc" },
  });

  const domains = Array.from(new Set(PERMISSION_CATALOGUE.map((p) => p.domain))).sort();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Role configuration</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Grants are explicit — nothing here implies &ldquo;administrator can do everything&rdquo;. Every change shows
          what will be added or revoked before it is saved, and sensitive permissions are flagged.
        </p>
      </div>

      <RolePermissionEditor
        roles={roles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          isSystemSeeded: r.isSystemSeeded,
          grantedCodes: r.permissions.map((p) => p.permissionCode),
        }))}
        catalogue={PERMISSION_CATALOGUE}
        domains={domains}
      />
    </div>
  );
}

import { redirect } from "next/navigation";
import { MembershipStatus } from "@prisma/client";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { requirePermission, PermissionDeniedError, hasPermission } from "@/lib/rbac/authorize";
import { prisma } from "@/lib/prisma";
import { ROLE_MANAGEMENT_PERMISSION } from "@/lib/organisation/membership-guard";
import { MemberManagement } from "./member-management";

export default async function OrganisationMembersPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "organisation.membership.manage");
  } catch (err) {
    if (err instanceof OrganisationAccessError || err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  const [memberships, roles] = await Promise.all([
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: { not: MembershipStatus.REMOVED } },
      include: {
        user: { select: { id: true, name: true, email: true } },
        roles: { include: { role: { include: { permissions: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.roleDefinition.findMany({
      where: { organisationId: context.organisationId, isActive: true },
      include: { permissions: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const rows = memberships.map((m) => {
    const grantedCodes = new Set<string>();
    for (const { role } of m.roles) {
      if (!role.isActive) continue;
      for (const grant of role.permissions) grantedCodes.add(grant.permissionCode);
    }
    return {
      id: m.id,
      email: m.user.email,
      name: m.user.name,
      status: m.status,
      accessMode: m.accessMode,
      invitedAt: m.invitedAt.toISOString(),
      activatedAt: m.activatedAt?.toISOString() ?? null,
      isRoleManager: m.status === MembershipStatus.ACTIVE && grantedCodes.has(ROLE_MANAGEMENT_PERMISSION),
      roles: m.roles.map((r) => ({ id: r.roleId, name: r.role.name })),
    };
  });

  const activeRoleManagerCount = rows.filter((r) => r.isRoleManager).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Organisation members</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Invite, deactivate, and assign roles within this organisation only. Invitations are not emailed — copy the
          link shown after inviting or resending and share it yourself.
        </p>
      </div>

      <MemberManagement
        members={rows}
        roles={roles.map((r) => ({
          id: r.id,
          name: r.name,
          isDangerous: r.permissions.some(
            (p) => p.permissionCode === "organisation.role.manage" || p.permissionCode === "ems.compliance_obligation.approve",
          ),
        }))}
        activeRoleManagerCount={activeRoleManagerCount}
        canManageRoles={hasPermission(context, "organisation.role.manage")}
      />
    </div>
  );
}

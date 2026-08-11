"use server";

/**
 * Phase 1 tenancy (T19) — role/permission configuration for the calling
 * organisation's own role templates.
 *
 * Only ever touches `RoleDefinition`/`RolePermission` rows owned by the
 * caller's organisation (`organisationId` in every query's own `where`) and
 * only ever grants codes drawn from the global, immutable
 * `PermissionDefinition` catalogue — so a role can never end up holding a
 * code that doesn't exist or a role belonging to another tenant. Revoking
 * `organisation.role.manage` from a role is blocked if it would leave the
 * organisation with no one able to manage roles (see membership-guard.ts);
 * that block is unconditional, not a dismissible warning, because it is not
 * recoverable from inside this UI once it happens.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { MembershipStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError, type OrganisationContext } from "@/lib/organisation/session";
import { requirePermission, PermissionDeniedError } from "@/lib/rbac/authorize";
import { isKnownPermissionCode } from "@/lib/rbac/permission-catalogue";
import {
  assertRoleManagerCoverageRemains,
  LastRoleManagerError,
  ROLE_MANAGEMENT_PERMISSION,
  type RoleManagerCandidate,
} from "@/lib/organisation/membership-guard";
import { createTenantRepositoryContext } from "@/lib/repositories/context";
import { recordAuditEvents } from "@/lib/repositories/audit-repository";
import type { RecordAuditEventInput } from "@/lib/audit/types";

export interface RoleActionState {
  error: string | null;
  message: string | null;
}

function friendlyError(err: unknown): string {
  if (err instanceof OrganisationAccessError) return "You must be signed in.";
  if (err instanceof PermissionDeniedError) return "You don't have permission to configure roles.";
  if (err instanceof LastRoleManagerError) return err.message;
  throw err;
}

async function requireRoleManageContext(): Promise<OrganisationContext> {
  const context = await requireOrganisationContext();
  requirePermission(context, "organisation.role.manage");
  return context;
}

async function loadRoleManagerCandidates(organisationId: string): Promise<RoleManagerCandidate[]> {
  const memberships = await prisma.organisationMembership.findMany({
    where: { organisationId, status: MembershipStatus.ACTIVE },
    include: { roles: { include: { role: { include: { permissions: true } } } } },
  });
  return memberships.map((m) => {
    const codes = new Set<string>();
    for (const { role } of m.roles) {
      if (!role.isActive) continue;
      for (const grant of role.permissions) codes.add(grant.permissionCode);
    }
    return { membershipId: m.id, status: m.status, permissionCodes: codes };
  });
}

const updateSchema = z.object({
  roleId: z.string().min(1),
  permissionCodes: z.array(z.string().min(1)),
});

/**
 * Replaces a role's permission grants with exactly the submitted set. The
 * client sends the full desired set (not a delta) because it already showed
 * the admin the added/removed diff as an audit preview before this fires.
 */
export async function updateRolePermissionsAction(_prev: RoleActionState, formData: FormData): Promise<RoleActionState> {
  let context: OrganisationContext;
  try {
    context = await requireRoleManageContext();
  } catch (err) {
    return { error: friendlyError(err), message: null };
  }

  const parsed = updateSchema.safeParse({
    roleId: formData.get("roleId"),
    permissionCodes: formData.getAll("permissionCodes"),
  });
  if (!parsed.success) {
    return { error: "Choose a role and its permissions.", message: null };
  }

  const unknownCode = parsed.data.permissionCodes.find((code) => !isKnownPermissionCode(code));
  if (unknownCode) {
    return { error: `Unknown permission code: ${unknownCode}.`, message: null };
  }

  const role = await prisma.roleDefinition.findFirst({
    where: { organisationId: context.organisationId, id: parsed.data.roleId },
    include: { permissions: true },
  });
  if (!role) {
    return { error: "Role not found in this organisation.", message: null };
  }

  const nextCodes = new Set(parsed.data.permissionCodes);
  const currentCodes = new Set(role.permissions.map((p) => p.permissionCode));
  const losingRoleManagement = currentCodes.has(ROLE_MANAGEMENT_PERMISSION) && !nextCodes.has(ROLE_MANAGEMENT_PERMISSION);

  if (losingRoleManagement) {
    const candidates = await loadRoleManagerCandidates(context.organisationId);
    const projected = candidates.map((c) =>
      c.permissionCodes.has(ROLE_MANAGEMENT_PERMISSION)
        ? { ...c, permissionCodes: new Set([...c.permissionCodes].filter((code) => code !== ROLE_MANAGEMENT_PERMISSION)) }
        : c,
    );
    // Only memberships holding *this* role lose the grant; a membership that
    // also holds a different role granting organisation.role.manage keeps it.
    // Re-add the grant back for any candidate whose coverage came from a
    // role other than the one being edited.
    const roleIdsById = await prisma.membershipRole.findMany({
      where: { organisationId: context.organisationId, roleId: { not: role.id } },
      select: { membershipId: true, role: { select: { permissions: { select: { permissionCode: true } } } } },
    });
    const otherCoverage = new Set(
      roleIdsById
        .filter((mr) => mr.role.permissions.some((p) => p.permissionCode === ROLE_MANAGEMENT_PERMISSION))
        .map((mr) => mr.membershipId),
    );
    const finalProjection = projected.map((c) =>
      otherCoverage.has(c.membershipId) ? { ...c, permissionCodes: new Set([...c.permissionCodes, ROLE_MANAGEMENT_PERMISSION]) } : c,
    );

    try {
      assertRoleManagerCoverageRemains(finalProjection);
    } catch (err) {
      return { error: friendlyError(err), message: null };
    }
  }

  const toAdd = [...nextCodes].filter((code) => !currentCodes.has(code));
  const toRemove = [...currentCodes].filter((code) => !nextCodes.has(code));

  await prisma.$transaction(async (tx) => {
    if (toRemove.length > 0) {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id, permissionCode: { in: toRemove } } });
    }
    if (toAdd.length > 0) {
      await tx.rolePermission.createMany({
        data: toAdd.map((code) => ({
          organisationId: context.organisationId,
          roleId: role.id,
          permissionCode: code,
          grantedByUserId: context.userId,
        })),
      });
    }

    const auditCtx = createTenantRepositoryContext({
      organisationId: context.organisationId,
      userId: context.userId,
      correlationId: context.correlationId,
    });
    const events: RecordAuditEventInput[] = [
      ...toAdd.map(
        (code): RecordAuditEventInput => ({
          eventType: "role.permission_granted",
          resourceType: "role_permission",
          resourceId: role.id,
          summary: `Granted "${code}" on role "${role.name}".`,
          actorUserId: context.userId,
          after: { permissionCode: code },
          correlationId: context.correlationId,
          source: "web-app",
        }),
      ),
      ...toRemove.map(
        (code): RecordAuditEventInput => ({
          eventType: "role.permission_revoked",
          resourceType: "role_permission",
          resourceId: role.id,
          summary: `Revoked "${code}" on role "${role.name}".`,
          actorUserId: context.userId,
          before: { permissionCode: code },
          correlationId: context.correlationId,
          source: "web-app",
        }),
      ),
    ];
    await recordAuditEvents(tx, auditCtx, events);
  });

  revalidatePath("/admin/organisation/roles");
  return {
    error: null,
    message: `Updated ${role.name}: ${toAdd.length} granted, ${toRemove.length} revoked.`,
  };
}

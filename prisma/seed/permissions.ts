import { PrismaClient } from "@prisma/client";
import { PERMISSION_CATALOGUE } from "../../src/lib/rbac/permission-catalogue";
import { SYSTEM_ROLE_TEMPLATES } from "../../src/lib/rbac/role-templates";

/** Idempotent upsert of the global, immutable permission catalogue (T11 §5). */
export async function seedPermissionCatalogue(prisma: PrismaClient) {
  for (const p of PERMISSION_CATALOGUE) {
    await prisma.permissionDefinition.upsert({
      where: { code: p.code },
      update: { domain: p.domain, description: p.description, isSensitive: p.isSensitive },
      create: { code: p.code, domain: p.domain, description: p.description, isSensitive: p.isSensitive },
    });
  }
}

/**
 * Clones the six system role templates into one Organisation as
 * organisation-owned `RoleDefinition` rows (T11 §6). Idempotent: re-running
 * for the same organisation updates grants in place rather than duplicating
 * roles, keyed on the `[organisationId, templateKey]` uniqueness constraint.
 *
 * Not called from the main seed entry point: no Organisation exists until
 * the T12 backfill command (or a future signup flow) creates one. Exported
 * here for T12/T13 to reuse rather than reimplement.
 */
export async function provisionSystemRoleTemplates(prisma: PrismaClient, organisationId: string) {
  for (const template of SYSTEM_ROLE_TEMPLATES) {
    const role = await prisma.roleDefinition.upsert({
      where: { organisationId_templateKey: { organisationId, templateKey: template.templateKey } },
      update: { name: template.name, description: template.description, isSystemSeeded: true, isActive: true },
      create: {
        organisationId,
        name: template.name,
        description: template.description,
        templateKey: template.templateKey,
        isSystemSeeded: true,
      },
    });

    const grantedCodes = new Set(template.permissionCodes);
    const existing = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: { permissionCode: true },
    });
    const existingCodes = new Set(existing.map((e) => e.permissionCode));

    for (const code of grantedCodes) {
      if (!existingCodes.has(code)) {
        await prisma.rolePermission.create({
          data: { organisationId, roleId: role.id, permissionCode: code },
        });
      }
    }
    for (const code of existingCodes) {
      if (!grantedCodes.has(code)) {
        await prisma.rolePermission.delete({
          where: { roleId_permissionCode: { roleId: role.id, permissionCode: code } },
        });
      }
    }
  }
}

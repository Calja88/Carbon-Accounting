/**
 * Phase 1 tenancy (T12) — structural backfill command.
 *
 * Links the existing single-tenant Entities/Sites/Users into one
 * Organisation, per PHASE1_TENANCY_RBAC_SPEC.md §9. Dry-run by default;
 * `--apply` is required to write. Never prints or inspects environmental
 * record values — only IDs and counts.
 *
 * Usage:
 *   tsx scripts/backfill-organisation.ts --name "Paragon Group" --slug paragon-group [--apply]
 */

import { PrismaClient } from "@prisma/client";
import { planBackfill } from "../src/lib/backfill/organisation-backfill";
import { provisionSystemRoleTemplates, seedPermissionCatalogue } from "../prisma/seed/permissions";

interface CliArgs {
  name: string;
  slug: string;
  apply: boolean;
}

// Legacy pre-T1A rows can still have a null `organisationId` in the
// database even though the current schema declares the column
// non-nullable — that's exactly the state this backfill exists to fix.
// Prisma's typed model queries decode every row against the *current*
// schema and throw P2032 the moment they hit one of those legacy nulls,
// so entities/sites are read via raw SQL here to see the column as it
// actually is, null and all, instead of through the non-nullable model type.
interface EntityRow {
  id: string;
  organisationId: string | null;
}

interface SiteRow {
  id: string;
  entityId: string;
  organisationId: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  let name: string | undefined;
  let slug: string | undefined;
  let apply = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--name") {
      name = argv[++i];
    } else if (arg === "--slug") {
      slug = argv[++i];
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--dry-run") {
      // Default behaviour; accepted explicitly for clarity in CI/docs.
    } else {
      throw new Error(`Unrecognised argument: ${arg}`);
    }
  }

  if (!name || !slug) {
    throw new Error("Both --name and --slug are required.");
  }

  return { name, slug, apply };
}

async function run(prisma: PrismaClient, args: CliArgs) {
  const [existingOrganisation, entities, sites, users] = await Promise.all([
    prisma.organisation.findUnique({ where: { slug: args.slug }, select: { id: true } }),
    prisma.$queryRaw<EntityRow[]>`SELECT id, "organisationId" FROM "Entity"`,
    prisma.$queryRaw<SiteRow[]>`SELECT id, "entityId", "organisationId" FROM "Site"`,
    prisma.user.findMany({ select: { id: true, role: true } }),
  ]);

  const [existingMemberships, existingRoleAssignments] = existingOrganisation
    ? await Promise.all([
        prisma.organisationMembership.findMany({
          where: { organisationId: existingOrganisation.id },
          select: { userId: true, status: true },
        }),
        prisma.membershipRole.findMany({
          where: { organisationId: existingOrganisation.id },
          select: {
            role: { select: { templateKey: true } },
            membership: { select: { userId: true } },
          },
        }),
      ])
    : [[], []];

  const plan = planBackfill({
    existingOrganisation,
    entities,
    sites,
    users,
    existingMemberships,
    existingRoleAssignments: (
      existingRoleAssignments as {
        role: { templateKey: string | null };
        membership: { userId: string };
      }[]
    )
      .filter((a) => a.role.templateKey !== null)
      .map((a) => ({
        userId: a.membership.userId,
        templateKey: a.role.templateKey as NonNullable<typeof a.role.templateKey>,
      })) as { userId: string; templateKey: import("@prisma/client").RoleTemplateKey }[],
  });

  if (plan.aborted) {
    console.error("Backfill aborted — ambiguous/conflicting state:");
    for (const reason of plan.conflictReasons) {
      console.error(`  - ${reason}`);
    }
    process.exitCode = 1;
    return;
  }

  const report = {
    mode: args.apply ? "apply" : "dry-run",
    organisationAction: plan.organisationAction,
    slug: args.slug,
    entitiesLinked: plan.counts.entitiesLinked,
    sitesLinked: plan.counts.sitesLinked,
    membershipsCreated: plan.counts.membershipsCreated,
    roleAssignmentsCreated: plan.counts.roleAssignmentsCreated,
    orphanEntities: entities.filter((e) => e.organisationId === null).length,
  };

  if (!args.apply) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  await prisma.$transaction(async (tx) => {
    const organisation = existingOrganisation
      ? existingOrganisation
      : await tx.organisation.create({
          data: { name: args.name, slug: args.slug },
          select: { id: true },
        });

    if (plan.entityIdsToLink.length > 0) {
      await tx.entity.updateMany({
        where: { id: { in: plan.entityIdsToLink } },
        data: { organisationId: organisation.id },
      });
    }

    if (plan.siteIdsToLink.length > 0) {
      await tx.site.updateMany({
        where: { id: { in: plan.siteIdsToLink } },
        data: { organisationId: organisation.id },
      });
    }

    // System role templates grant permission codes that must already exist
    // as PermissionDefinition rows (RolePermission.permissionCode is a FK
    // to PermissionDefinition.code). A partially-migrated database — one
    // that never ran the dev-seed entry point — may not have those rows
    // yet, so seed the catalogue here first. Idempotent upsert, so this is
    // a no-op on a database that already has it.
    await seedPermissionCatalogue(tx as unknown as PrismaClient);
    await provisionSystemRoleTemplates(tx as unknown as PrismaClient, organisation.id);

    const roleDefinitions = await tx.roleDefinition.findMany({
      where: { organisationId: organisation.id },
      select: { id: true, templateKey: true },
    });
    const roleIdByTemplate = new Map(
      roleDefinitions.map((r) => [r.templateKey, r.id] as const),
    );

    const membershipIdByUser = new Map<string, string>();
    for (const userId of plan.userIdsNeedingMembership) {
      const membership = await tx.organisationMembership.upsert({
        where: { organisationId_userId: { organisationId: organisation.id, userId } },
        update: {},
        create: {
          organisationId: organisation.id,
          userId,
          status: "ACTIVE",
          activatedAt: new Date(),
        },
        select: { id: true, userId: true },
      });
      membershipIdByUser.set(membership.userId, membership.id);
    }

    for (const assignment of plan.roleAssignmentsToCreate) {
      let membershipId = membershipIdByUser.get(assignment.userId);
      if (!membershipId) {
        const membership = await tx.organisationMembership.findUnique({
          where: { organisationId_userId: { organisationId: organisation.id, userId: assignment.userId } },
          select: { id: true },
        });
        membershipId = membership?.id;
      }
      const roleId = roleIdByTemplate.get(assignment.templateKey);
      if (!membershipId || !roleId) continue;

      await tx.membershipRole.upsert({
        where: { membershipId_roleId: { membershipId, roleId } },
        update: {},
        create: { organisationId: organisation.id, membershipId, roleId },
      });
    }
  });

  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    await run(prisma, args);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

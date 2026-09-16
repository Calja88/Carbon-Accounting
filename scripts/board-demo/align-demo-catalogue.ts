/**
 * Brings an already-seeded BOARD demo database in line with three fixture
 * corrections made during Phase 6 QA. `live-seed-port.ts` creates these rows
 * with `update: {}`, so re-seeding leaves an existing environment untouched —
 * this is the migration path for the one that already exists.
 *
 * 1. `ActivityDataPoint.unitOptions` was `["kg"]` for every source, including
 *    grid electricity and natural gas, whose activity entries and emission
 *    factors are both in kWh. The entry form offers exactly what is in
 *    `unitOptions`, so filling the demo's missing September electricity would
 *    have recorded kilowatt-hours as kilograms against a per-kWh factor.
 * 2. `ActivityDataPoint.promptTemplate` was the literal string "Synthetic
 *    BOARD-1 fixture input.", which is the heading of the entry form and the
 *    description on /sources.
 * 3. The BOARD-1 sustainability-lead and independent-reviewer roles were
 *    missing `carbon.factor.view`, which the product's own SUSTAINABILITY_LEAD
 *    template grants. Without it every /admin/factors route redirects to the
 *    dashboard with no explanation.
 *
 * Idempotent, and it writes nothing outside these three concerns: no activity
 * entry, calculation, reporting period or collection requirement is touched.
 *
 * Run through the demo-safe wrapper, never directly:
 *   pnpm run db:board-demo:align-catalogue
 */

import { prisma } from "@/lib/prisma";

/** Categories metered in kWh; every other BOARD-1 source is a mass. */
const INPUT_UNIT_BY_CATEGORY: Record<string, string> = {
  grid_electricity: "kWh",
  stationary_combustion_natural_gas: "kWh",
};

const LEAD_ROLE_NAMES = ["BOARD-1 sustainability-lead", "BOARD-1 independent-reviewer"];
const FACTOR_VIEW = "carbon.factor.view";

async function main(): Promise<void> {
  const points = await prisma.activityDataPoint.findMany({
    where: { code: { startsWith: "BOARD1-" } },
    select: { id: true, code: true, factorCategory: true, unitOptions: true, promptTemplate: true },
  });

  let catalogueUpdated = 0;
  for (const point of points) {
    const unit = INPUT_UNIT_BY_CATEGORY[point.factorCategory ?? ""] ?? "kg";
    const prompt = `Enter the ${(point.factorCategory ?? "activity data").replace(/^board1_/, "").replace(/_/g, " ")} recorded for this site and period.`;
    const unitWrong = point.unitOptions.length !== 1 || point.unitOptions[0] !== unit;
    const promptWrong = point.promptTemplate !== prompt;
    if (!unitWrong && !promptWrong) continue;
    await prisma.activityDataPoint.update({
      where: { id: point.id },
      data: { unitOptions: [unit], promptTemplate: prompt },
    });
    catalogueUpdated += 1;
    const changed = [unitWrong ? `unit ${point.unitOptions.join("/") || "(none)"} -> ${unit}` : null, promptWrong ? "prompt" : null];
    console.log(`${point.code}: ${changed.filter(Boolean).join(", ")}`);
  }

  // The permission row has to exist before a role can reference it; the seed
  // upserts its own grants the same way.
  await prisma.permissionDefinition.upsert({
    where: { code: FACTOR_VIEW },
    create: { code: FACTOR_VIEW, domain: "carbon", description: "View the emission factor library" },
    update: {},
  });

  const roles = await prisma.roleDefinition.findMany({
    where: { name: { in: LEAD_ROLE_NAMES } },
    select: { id: true, name: true, organisationId: true, permissions: { select: { permissionCode: true } } },
  });

  let grantsAdded = 0;
  for (const role of roles) {
    if (role.permissions.some((permission) => permission.permissionCode === FACTOR_VIEW)) continue;
    await prisma.rolePermission.create({
      data: { organisationId: role.organisationId, roleId: role.id, permissionCode: FACTOR_VIEW },
    });
    grantsAdded += 1;
    console.log(`${role.name}: granted ${FACTOR_VIEW}`);
  }

  console.log(`\nCatalogue rows updated: ${catalogueUpdated}. Factor-view grants added: ${grantsAdded}.`);
  if (roles.length !== LEAD_ROLE_NAMES.length) {
    console.warn(`Expected ${LEAD_ROLE_NAMES.length} lead roles, found ${roles.length}.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

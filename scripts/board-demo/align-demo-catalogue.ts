/**
 * Brings an already-seeded BOARD demo database in line with fixture
 * corrections made after it was built. `live-seed-port.ts` creates these rows
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
 * 4. The demo's user-facing display labels still read "BOARD-1" — the source
 *    names on the data-entry pages, the display category, the factor-set name,
 *    the EMS/compliance/audit programme names, the audit title, the cited LCA
 *    factor source and the agenda name. Commit 3e94741 changed the seed; this
 *    is the same change for the database that was seeded before it. The rules
 *    live in `demo-label-fixture.ts`, which also records every BOARD-1
 *    identifier that deliberately stays, and the immutable history that does.
 *
 * Idempotent, and it writes nothing outside these four concerns: no activity
 * entry, calculation, quantity, status, reporting period or collection
 * requirement is touched, no row is created except the `carbon.factor.view`
 * grant concern 3 exists to add, and no row is ever deleted. Row counts are
 * captured before and after and the run fails if an accounting table moved.
 *
 * Run through the demo-safe wrapper, never directly:
 *   pnpm run db:board-demo:align-catalogue -- --dry-run
 *   pnpm run db:board-demo:align-catalogue
 */

import { prisma } from "@/lib/prisma";
import { assertDemoDatabaseTarget } from "./db-target-guard";
import { DISPLAY_LITERALS, TRACKED_COUNTS, demoDataPointName, demoDisplayCategory } from "./demo-label-fixture";

/** Categories metered in kWh; every other BOARD-1 source is a mass. */
const INPUT_UNIT_BY_CATEGORY: Record<string, string> = {
  grid_electricity: "kWh",
  stationary_combustion_natural_gas: "kWh",
};

const LEAD_ROLE_NAMES = ["BOARD-1 sustainability-lead", "BOARD-1 independent-reviewer"];
const FACTOR_VIEW = "carbon.factor.view";

async function snapshot(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const model of TRACKED_COUNTS) {
    out[model] = await (prisma[model] as { count: () => Promise<number> }).count();
  }
  return out;
}

interface Planned {
  label: string;
  before: string;
  after: string;
  apply: () => Promise<void>;
}

/**
 * Concerns 1, 2 and 4a, in one pass over the fixture's own catalogue rows.
 * Matched on `code` — the technical identity, which never changes — and every
 * value is re-derived from the row itself, so a second run plans nothing.
 */
async function planCatalogueRows(): Promise<Planned[]> {
  const points = await prisma.activityDataPoint.findMany({
    where: { code: { startsWith: "BOARD1-" } },
    select: { id: true, code: true, factorCategory: true, unitOptions: true, promptTemplate: true, dataPointName: true, category: true },
  });

  const planned: Planned[] = [];
  for (const point of points) {
    const category = point.factorCategory ?? "";
    const unit = INPUT_UNIT_BY_CATEGORY[category] ?? "kg";
    const prompt = `Enter the ${(point.factorCategory ?? "activity data").replace(/^board1_/, "").replace(/_/g, " ")} recorded for this site and period.`;
    const dataPointName = demoDataPointName(point.dataPointName);
    const displayCategory = category ? demoDisplayCategory(category) : point.category;

    const unchanged =
      point.unitOptions.length === 1 && point.unitOptions[0] === unit &&
      point.promptTemplate === prompt &&
      point.dataPointName === dataPointName &&
      point.category === displayCategory;
    if (unchanged) continue;

    planned.push({
      label: `ActivityDataPoint ${point.code}`,
      before: `${point.dataPointName} | ${point.category} | ${point.unitOptions.join("/") || "(none)"} | ${point.promptTemplate}`,
      after: `${dataPointName} | ${displayCategory} | ${unit} | ${prompt}`,
      apply: async () => {
        await prisma.activityDataPoint.update({
          where: { id: point.id },
          // `code`, `factorCategory`, `scope`, `buildPriority` and every
          // scope3Category are untouched: the lookup identity stays put.
          data: { unitOptions: [unit], promptTemplate: prompt, dataPointName, category: displayCategory },
        });
      },
    });
  }
  return planned;
}

/**
 * Concern 4b. Exact-value matches only, on an explicit table/column list —
 * never a pattern sweep, so a row nobody meant cannot be caught, and the
 * immutable tables are absent because they are not in the list.
 */
async function planDisplayLiterals(): Promise<Planned[]> {
  const planned: Planned[] = [];
  for (const { table, column, before, after } of DISPLAY_LITERALS) {
    let rows: { id: string }[];
    try {
      rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "id" FROM "${table}" WHERE "${column}" = $1 ORDER BY "id"`,
        before,
      );
    } catch (error) {
      throw new Error(`Could not read ${table}.${column}: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const row of rows) {
      planned.push({
        label: `${table}.${column} ${row.id}`,
        before,
        after,
        apply: async () => {
          await prisma.$executeRawUnsafe(
            `UPDATE "${table}" SET "${column}" = $1 WHERE "id" = $2 AND "${column}" = $3`,
            after, row.id, before,
          );
        },
      });
    }
  }
  return planned;
}

/** Concern 3. Creates the one row this script is allowed to create. */
async function applyFactorViewGrants(): Promise<number> {
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

  if (roles.length !== LEAD_ROLE_NAMES.length) {
    console.warn(`Expected ${LEAD_ROLE_NAMES.length} lead roles, found ${roles.length}.`);
  }
  return grantsAdded;
}

async function main(): Promise<void> {
  // Belt and braces: the wrapper already verified the configuration, but a
  // direct `tsx` invocation must not be able to skip it.
  assertDemoDatabaseTarget(process.env);
  const [identity] = await prisma.$queryRaw<{ db: string; usr: string }[]>`SELECT current_database() as db, current_user as usr`;
  console.log(`connected: ${identity.db} as ${identity.usr}`);

  const dryRun = process.argv.includes("--dry-run");
  const planned = [...(await planCatalogueRows()), ...(await planDisplayLiterals())];

  const roles = await prisma.roleDefinition.findMany({
    where: { name: { in: LEAD_ROLE_NAMES } },
    select: { name: true, permissions: { select: { permissionCode: true } } },
  });
  const missingGrants = roles.filter((role) => !role.permissions.some((p) => p.permissionCode === FACTOR_VIEW));

  // Recorded before anything is written, in both modes: what the run is about
  // to do, and the figures it must leave exactly where they are.
  const before = await snapshot();
  console.log(`\nBEFORE ${JSON.stringify(before)}`);
  console.log(`\nRecords to change: ${planned.length}`);
  for (const change of planned) {
    console.log(`  ${change.label}\n    - ${change.before.slice(0, 200)}\n    + ${change.after.slice(0, 200)}`);
  }
  if (planned.length === 0) console.log("  (none — already aligned)");
  console.log(`Factor-view grants to add: ${missingGrants.length}${missingGrants.length ? ` (${missingGrants.map((r) => r.name).join(", ")})` : ""}`);

  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  for (const change of planned) await change.apply();
  const grantsAdded = await applyFactorViewGrants();
  const after = await snapshot();

  const moved = TRACKED_COUNTS.filter((model) => before[model] !== after[model]);
  console.log(`\nAFTER  ${JSON.stringify(after)}`);
  if (moved.length > 0) {
    throw new Error(`An alignment changed row counts, which it must never do: ${moved.map((m) => `${m} ${before[m]}->${after[m]}`).join(", ")}`);
  }
  console.log("Row counts unchanged across every tracked table.");
  console.log(`\nRecords aligned: ${planned.length}. Factor-view grants added: ${grantsAdded}.`);
}

main()
  .catch((error: unknown) => {
    console.error("Catalogue alignment failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

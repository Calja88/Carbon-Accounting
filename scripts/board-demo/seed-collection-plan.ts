/**
 * BOARD demo — the synthetic collection plan.
 *
 * The BOARD-1 fixture has activity data but no `OrganisationSourceConfig`,
 * so `generateCollectionPlan` had nothing to generate from and the
 * management report's completeness section was honestly empty. This adds the
 * smallest configuration that makes the plan real: which sources each site is
 * expected to report, and how often.
 *
 * It writes ONLY `OrganisationSourceConfig` rows, then calls the platform's
 * own `generateCollectionPlan` to derive `CarbonCollectionRequirement`. No
 * requirement row is inserted by hand, no activity entry, calculation,
 * factor, reporting period or LCA record is created or altered, and nothing
 * is ever deleted. The completeness figure the demo shows is therefore
 * produced by the real collection-state logic reading the real demo data.
 *
 * WHAT IS REAL AND WHAT IS NOT
 * ----------------------------
 * The *mechanism* is real: statuses are derived live from ActivityEntry and
 * Calculation by `deriveCollectionStatus`, exactly as they would be for a
 * customer. The *plan* is not — it is a synthetic configuration over the
 * synthetic BOARD-1 fixture, chosen to be a plausible shape for the three
 * demonstration sites. It is not Paragon's environmental data and must never
 * be presented as such.
 *
 * Manual only (`pnpm run db:seed:board-demo-collection-plan`), which routes
 * through `with-demo-env.ts` so an ambient production DATABASE_URL cannot
 * decide the target. Idempotent: reruns converge, `createMany` skips
 * duplicates, and no recorded review or exclusion decision is overwritten.
 */

import { prisma } from "../../src/lib/prisma";
import { resolveOrganisationContext } from "../../src/lib/organisation/context";
import { generateCollectionPlan, getCollectionMatrix } from "../../src/lib/carbon/collection-plan-service";
import { assertDemoDatabaseTarget } from "./db-target-guard";
import { FIXTURE_ORGANISATION_SLUG_PREFIX } from "./live-seed-port";
import { COLLECTION_PLAN, EFFECTIVE_FROM, reportingWindow } from "./collection-plan-fixture";

const TRACKED_COUNTS = [
  "organisation", "site", "user", "organisationMembership", "activityEntry", "calculation",
  "emissionFactor", "activityDataPoint", "product", "lcaAssessment", "lcaInventoryItem",
  "lcaCalculationResult", "organisationSourceConfig", "carbonCollectionRequirement",
] as const;

async function snapshot(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const model of TRACKED_COUNTS) {
    out[model] = await (prisma[model] as { count: () => Promise<number> }).count();
  }
  return out;
}

async function main() {
  // Belt and braces: the wrapper already verified the configuration, but a
  // direct `tsx` invocation must not be able to skip it.
  assertDemoDatabaseTarget(process.env);
  const [identity] = await prisma.$queryRaw<{ db: string; usr: string }[]>`SELECT current_database() as db, current_user as usr`;
  console.log(`connected: ${identity.db} as ${identity.usr}`);

  const organisation = await prisma.organisation.findFirstOrThrow({
    where: { slug: { startsWith: FIXTURE_ORGANISATION_SLUG_PREFIX } },
    select: { id: true, slug: true, name: true },
  });
  console.log(`organisation: ${organisation.name} (${organisation.slug})`);

  const sites = await prisma.site.findMany({
    where: { organisationId: organisation.id },
    select: { id: true, name: true },
  });
  const sources = await prisma.activityDataPoint.findMany({ select: { id: true, code: true, dataPointName: true } });
  const siteByName = new Map(sites.map((s) => [s.name, s]));
  const sourceByCode = new Map(sources.map((s) => [s.code, s]));

  // Every row must name something the fixture already has; a typo here would
  // otherwise surface as a foreign-key error halfway through the write.
  const rows = COLLECTION_PLAN.map((row) => {
    const site = siteByName.get(row.site);
    const source = sourceByCode.get(row.sourceCode);
    if (!site) throw new Error(`No such demo site: ${row.site}`);
    if (!source) throw new Error(`No such activity data point: ${row.sourceCode}`);
    return { site, source, frequency: row.frequency };
  });

  const before = await snapshot();
  console.log("BEFORE", JSON.stringify(before));
  console.log("Source configurations to upsert:");
  for (const row of rows) {
    console.log(`  ${row.site.name} / ${row.source.dataPointName} (${row.source.code}) — ${row.frequency}`);
  }

  if (process.argv.includes("--dry-run")) {
    console.log("--dry-run: nothing written.");
    return;
  }

  for (const row of rows) {
    await prisma.organisationSourceConfig.upsert({
      where: {
        organisationSiteSource: {
          organisationId: organisation.id,
          siteId: row.site.id,
          activityDataPointId: row.source.id,
        },
      },
      // Rerunning re-asserts the intended cadence and re-enables a source
      // someone disabled by hand, and nothing else — `effectiveFrom` is
      // pinned rather than refreshed so a rerun cannot retroactively shorten
      // the plan the demo has already generated.
      update: { enabled: true, frequency: row.frequency },
      create: {
        organisationId: organisation.id,
        siteId: row.site.id,
        activityDataPointId: row.source.id,
        enabled: true,
        frequency: row.frequency,
        effectiveFrom: EFFECTIVE_FROM,
      },
    });
  }

  // The plan is generated by the application's own logic, through a real
  // organisation context, so permissions, tenant scoping and the audit
  // record all behave exactly as they do for a user pressing the button.
  const membership = await prisma.organisationMembership.findFirstOrThrow({
    where: {
      organisationId: organisation.id,
      status: "ACTIVE",
      accessMode: "ORGANISATION_WIDE",
      roles: { some: { role: { isActive: true, permissions: { some: { permissionCode: "carbon.entry.review" } } } } },
    },
    select: { userId: true, user: { select: { name: true } } },
  });
  const context = await resolveOrganisationContext(prisma, { userId: membership.userId });
  console.log(`generating as: ${membership.user.name}`);

  const now = new Date();
  const window = reportingWindow(now);
  const generated = await generateCollectionPlan(context, window, prisma, now);
  console.log(
    `generateCollectionPlan(${window.periodStart.toISOString().slice(0, 10)}..${window.periodEnd.toISOString().slice(0, 10)}):`,
    JSON.stringify(generated),
  );

  const matrix = await getCollectionMatrix(context, window, prisma, now);
  const byStatus = matrix.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log("collection statuses:", JSON.stringify(byStatus));

  const after = await snapshot();
  console.log("AFTER", JSON.stringify(after));
  const changed = TRACKED_COUNTS.filter((m) => before[m] !== after[m]);
  console.log("changed tables:", changed.length === 0 ? "(none)" : changed.join(", "));
  const unexpected = changed.filter((m) => m !== "organisationSourceConfig" && m !== "carbonCollectionRequirement");
  if (unexpected.length > 0) throw new Error(`Unexpected table(s) changed: ${unexpected.join(", ")}`);
}

main()
  .catch((error: unknown) => {
    console.error("Collection-plan seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

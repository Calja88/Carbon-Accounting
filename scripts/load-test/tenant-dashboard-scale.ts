/**
 * T83 load test: tenant dashboard aggregate/list query latency at synthetic
 * scale (Docs/PHASE8_HARDENING_READINESS_SPEC.md §6: "dashboard aggregate
 * indexes"; "N+1 and unbounded list/search/report queries").
 *
 * Seeds multiple synthetic organisations, each with thousands of
 * `OutboxMessage` rows (a representative "recent items, ordered by time"
 * dashboard read — deliberately not `AuditEvent`: that table is append-only
 * by DB trigger (T81), so seeded rows could never be cleaned up afterwards)
 * and `ComplianceObligation` rows (a representative per-domain aggregate),
 * then times the tenant-scoped queries a dashboard actually issues. Every
 * row is synthetic and deleted at the end of the run.
 *
 * Run: `DATABASE_URL=postgresql://... npx tsx scripts/load-test/tenant-dashboard-scale.ts`
 */

import { requireLoadTestDb, reportSloLine, summarise } from "./lib/db-guard";

const TENANT_COUNT = 10;
const RECENT_ITEMS_PER_TENANT = 2000;
const OBLIGATIONS_PER_TENANT = 1500;
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TOPIC = "loadtest.dashboard_item";

async function main() {
  requireLoadTestDb("tenant-dashboard-scale");
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  const orgIds = Array.from({ length: TENANT_COUNT }, (_, i) => `loadtest-dash-${RUN_ID}-${i}`);

  try {
    console.log(`Seeding ${TENANT_COUNT} organisations x (${RECENT_ITEMS_PER_TENANT} recent-items rows + ${OBLIGATIONS_PER_TENANT} obligations)...`);
    const seedStart = Date.now();
    for (const orgId of orgIds) {
      await prisma.organisation.create({ data: { id: orgId, name: `Load test dashboard org ${orgId}`, slug: orgId } });

      const recentItemRows = Array.from({ length: RECENT_ITEMS_PER_TENANT }, (_, i) => ({
        organisationId: orgId,
        topic: TOPIC,
        payload: { index: i },
        idempotencyKey: `${orgId}-item-${i}`,
        correlationId: `loadtest-${orgId}-${i}`,
        source: "loadtest",
        status: "COMPLETED" as const,
      }));
      // Batches of 500 keep each INSERT statement within a reasonable size.
      for (let i = 0; i < recentItemRows.length; i += 500) {
        await prisma.outboxMessage.createMany({ data: recentItemRows.slice(i, i + 500) });
      }

      const obligationRows = Array.from({ length: OBLIGATIONS_PER_TENANT }, () => ({ organisationId: orgId }));
      for (let i = 0; i < obligationRows.length; i += 500) {
        await prisma.complianceObligation.createMany({ data: obligationRows.slice(i, i + 500) });
      }
    }
    console.log(`Seeding took ${Date.now() - seedStart}ms.`);

    async function timeQuery(fn: () => Promise<unknown>): Promise<number> {
      const start = Date.now();
      await fn();
      return Date.now() - start;
    }

    const recentActivityDurations: number[] = [];
    const obligationCountDurations: number[] = [];
    const crossTenantIsolationDurations: number[] = [];

    for (const orgId of orgIds) {
      recentActivityDurations.push(
        await timeQuery(() => prisma.outboxMessage.findMany({ where: { organisationId: orgId, topic: TOPIC }, orderBy: { createdAt: "desc" }, take: 50 })),
      );
      obligationCountDurations.push(await timeQuery(() => prisma.complianceObligation.count({ where: { organisationId: orgId } })));
      // "Aggregate stays isolated" (P8-06 observability + T80 adversarial
      // reuse): a dashboard's own-tenant count must never include another
      // tenant's rows even after this script seeds many tenants at once.
      crossTenantIsolationDurations.push(
        await timeQuery(async () => {
          const count = await prisma.complianceObligation.count({ where: { organisationId: orgId } });
          if (count !== OBLIGATIONS_PER_TENANT) {
            throw new Error(`Tenant isolation violation: org ${orgId} expected ${OBLIGATIONS_PER_TENANT} obligations, saw ${count}`);
          }
        }),
      );
    }

    // N+1 guard: a dashboard listing all tenants' obligation counts in one
    // call must be one grouped query, not one query per tenant.
    const groupByStart = Date.now();
    const grouped = await prisma.complianceObligation.groupBy({ by: ["organisationId"], where: { organisationId: { in: orgIds } }, _count: true });
    const groupByDuration = Date.now() - groupByStart;
    const groupByOk = grouped.length === orgIds.length && grouped.every((g) => g._count === OBLIGATIONS_PER_TENANT);
    console.log(`${groupByOk ? "PASS" : "FAIL"}  groupBy aggregate (single query, ${orgIds.length} tenants): ${groupByDuration}ms`);

    // SLO targets from docs/operations/slo-sli.md: dashboard read p95 <= 300ms at this synthetic scale.
    const recentActivityPass = reportSloLine("recent-items feed (take 50, ordered)", summarise(recentActivityDurations), 300);
    const obligationCountPass = reportSloLine("obligation count aggregate", summarise(obligationCountDurations), 300);
    const isolationPass = reportSloLine("tenant isolation re-check", summarise(crossTenantIsolationDurations), 300);

    const overallPass = recentActivityPass && obligationCountPass && isolationPass && groupByOk && groupByDuration <= 500;
    console.log(overallPass ? "\nOverall: PASS" : "\nOverall: FAIL");
    if (!overallPass) process.exitCode = 1;
  } finally {
    console.log("Cleaning up synthetic data...");
    await prisma.complianceObligation.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.outboxMessage.deleteMany({ where: { organisationId: { in: orgIds } } });
    await prisma.organisation.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

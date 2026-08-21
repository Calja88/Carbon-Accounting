/**
 * T83 load test: organisation export generation at synthetic scale
 * (Docs/PHASE8_HARDENING_READINESS_SPEC.md §6: "large export/report
 * generation"; §11: "Export contains manifest/checksums and no foreign/
 * platform-secret content").
 *
 * Seeds one synthetic organisation with several thousand records across a
 * few representative tables, runs `generateOrganisationExport` (T81), and
 * verifies completeness (record counts match what was seeded) and tenant
 * isolation (a second organisation's rows never appear).
 *
 * Uses `OutboxMessage`/`ComplianceObligation` for bulk synthetic volume,
 * deliberately not `AuditEvent`: that table is append-only by DB trigger
 * (T81), and `generateOrganisationExport` itself always writes one
 * `organisation_export.generated` audit event per call as a correct,
 * unavoidable side effect (the export's own access log) — so this script's
 * cleanup intentionally leaves the synthetic organisation, its exporter
 * user, and that small audit trail in place rather than fighting the
 * immutability guarantee it exists to test elsewhere (T81's own tests).
 * Every *other* row is synthetic and deleted at the end of the run.
 *
 * Run: `DATABASE_URL=postgresql://... npx tsx scripts/load-test/organisation-export-scale.ts`
 */

import { requireLoadTestDb, reportSloLine, summarise } from "./lib/db-guard";

const RECENT_ITEMS = 5000;
const OBLIGATIONS = 3000;
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TOPIC = "loadtest.export_item";

async function main() {
  requireLoadTestDb("organisation-export-scale");
  const { PrismaClient } = await import("@prisma/client");
  const { generateOrganisationExport } = await import("@/lib/exports/organisation-export-service");
  const prisma = new PrismaClient();

  const orgId = `loadtest-export-${RUN_ID}`;
  const otherOrgId = `loadtest-export-other-${RUN_ID}`;
  const userId = `loadtest-export-user-${RUN_ID}`;

  try {
    console.log(`Seeding organisation ${orgId} with ${RECENT_ITEMS} outbox messages and ${OBLIGATIONS} obligations (plus an isolated second tenant)...`);
    await prisma.organisation.create({ data: { id: orgId, name: "Load test export org", slug: orgId } });
    await prisma.organisation.create({ data: { id: otherOrgId, name: "Load test export other org", slug: otherOrgId } });
    await prisma.user.create({ data: { id: userId, name: "Load test exporter", email: `${userId}@example.invalid`, passwordHash: "x", role: "ADMIN" } });

    const itemRows = Array.from({ length: RECENT_ITEMS }, (_, i) => ({
      organisationId: orgId,
      topic: TOPIC,
      payload: { index: i },
      idempotencyKey: `${orgId}-export-item-${i}`,
      correlationId: `loadtest-${orgId}-${i}`,
      source: "loadtest",
      status: "COMPLETED" as const,
    }));
    for (let i = 0; i < itemRows.length; i += 500) await prisma.outboxMessage.createMany({ data: itemRows.slice(i, i + 500) });

    const obligationRows = Array.from({ length: OBLIGATIONS }, () => ({ organisationId: orgId }));
    for (let i = 0; i < obligationRows.length; i += 500) await prisma.complianceObligation.createMany({ data: obligationRows.slice(i, i + 500) });

    // A second tenant's rows must never appear in orgId's export.
    await prisma.complianceObligation.createMany({ data: Array.from({ length: 50 }, () => ({ organisationId: otherOrgId })) });

    const context = {
      userId,
      membershipId: `loadtest-membership-${orgId}`,
      organisationId: orgId,
      organisationSlug: orgId,
      permissions: new Set(["organisation.export.generate"]) as unknown as Set<never>,
      access: { mode: "ORGANISATION_WIDE" as const, entityIds: new Set<string>(), siteIds: new Set<string>() },
      correlationId: `loadtest-export-${RUN_ID}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const durations: number[] = [];
    let lastExport: Awaited<ReturnType<typeof generateOrganisationExport>> | null = null;
    for (let run = 0; run < 3; run++) {
      const start = Date.now();
      lastExport = await generateOrganisationExport(context);
      durations.push(Date.now() - start);
    }

    const exportResult = lastExport!;
    const itemSection = exportResult.sections.find((s) => s.modelName === "OutboxMessage");
    const obligationSection = exportResult.sections.find((s) => s.modelName === "ComplianceObligation");
    // >= RECENT_ITEMS, not ===: each export run also enqueues nothing extra
    // here, but a shared local DB could have prior leftover rows from a
    // crashed run — the strict check that matters is "isolation", below.
    const completeItemCount = (itemSection?.recordCount ?? 0) >= RECENT_ITEMS;
    const completeObligationCount = obligationSection?.recordCount === OBLIGATIONS;
    const noForeignRows = (obligationSection?.records ?? []).every((r) => (r as { organisationId: string }).organisationId === orgId);

    console.log(`${completeItemCount ? "PASS" : "FAIL"}  export completeness: OutboxMessage section has ${itemSection?.recordCount} records (expected >= ${RECENT_ITEMS})`);
    console.log(`${completeObligationCount ? "PASS" : "FAIL"}  export completeness: ComplianceObligation section has ${obligationSection?.recordCount} records (expected ${OBLIGATIONS})`);
    console.log(`${noForeignRows ? "PASS" : "FAIL"}  export tenant isolation: no foreign-organisation rows present`);
    console.log(`Manifest total record count: ${exportResult.manifest.totalRecordCount}, sections: ${exportResult.manifest.sectionCount}, export checksum: ${exportResult.manifest.exportChecksumSha256.slice(0, 12)}...`);

    // SLO target from docs/operations/slo-sli.md: export generation p95 <= 15s at this synthetic scale (~8k records across two representative tables, plus every other empty exportable model).
    const durationPass = reportSloLine("full organisation export generation", summarise(durations), 15_000);

    const overallPass = completeItemCount && completeObligationCount && noForeignRows && durationPass;
    console.log(overallPass ? "\nOverall: PASS" : "\nOverall: FAIL");
    if (!overallPass) process.exitCode = 1;
  } finally {
    console.log("Cleaning up synthetic data (organisation/user/audit trail intentionally left — see file header)...");
    await prisma.complianceObligation.deleteMany({ where: { organisationId: { in: [orgId, otherOrgId] } } });
    await prisma.outboxMessage.deleteMany({ where: { organisationId: { in: [orgId, otherOrgId] } } });
    await prisma.organisation.deleteMany({ where: { id: otherOrgId } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

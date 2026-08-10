/**
 * T1A — read-only preflight for the tenant constraint contract migration.
 *
 * Run this before deploying
 * `prisma/migrations/20260810150000_contract_constraints_and_role_retirement`
 * against a real database. It reports the same diagnostic counts that
 * migration's own `DO` block checks (counts only, never row ids or
 * environmental values), so an operator can see whether the migration is
 * ready without relying on a failed-and-rolled-back deploy to find out.
 *
 * Every count below simulates what the migration's own mechanical backfill
 * and guarded single-tenant fallback would resolve, so a clean run here
 * means the migration will succeed; a table/relationship reported here
 * would abort the migration in exactly the same way.
 *
 * Usage:
 *   tsx scripts/contract-migration-preflight.ts
 */

import { PrismaClient } from "@prisma/client";
import {
  checkContractMigrationPreflight,
  type ContractMigrationMismatchCount,
  type ContractMigrationTableCount,
} from "../src/lib/backfill/contract-migration-preflight";

async function countRemainingNull(
  prisma: PrismaClient,
  sql: string,
): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(sql);
  return Number(rows[0]?.count ?? 0);
}

async function run(prisma: PrismaClient) {
  const orgCountRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*) FROM "Organisation"`,
  );
  const singleTenant = Number(orgCountRows[0]?.count ?? 0) === 1;

  // Parent-derived tables: a row is only a genuine problem if both it and
  // its parent are null — the migration's mechanical backfill resolves
  // every other case.
  const parentDerived: { table: ContractMigrationTableCount["table"]; sql: string }[] = [
    {
      table: "SiteEnergyContract",
      sql: `SELECT count(*) FROM "SiteEnergyContract" c JOIN "Site" s ON c."siteId" = s.id WHERE c."organisationId" IS NULL AND s."organisationId" IS NULL`,
    },
    {
      table: "ActivityEntry",
      sql: `SELECT count(*) FROM "ActivityEntry" c JOIN "Site" s ON c."siteId" = s.id WHERE c."organisationId" IS NULL AND s."organisationId" IS NULL`,
    },
    {
      table: "CommutingSurvey",
      sql: `SELECT count(*) FROM "CommutingSurvey" c JOIN "Site" s ON c."siteId" = s.id WHERE c."organisationId" IS NULL AND s."organisationId" IS NULL`,
    },
    {
      table: "Calculation",
      sql: `SELECT count(*) FROM "Calculation" c JOIN "ActivityEntry" e ON c."activityEntryId" = e.id WHERE c."organisationId" IS NULL AND e."organisationId" IS NULL`,
    },
    {
      table: "Supplier",
      sql: `SELECT count(*) FROM "Supplier" sup JOIN "Entity" e ON sup."entityId" = e.id WHERE sup."organisationId" IS NULL AND e."organisationId" IS NULL`,
    },
    {
      table: "Product",
      sql: `SELECT count(*) FROM "Product" p JOIN "Entity" e ON p."entityId" = e.id WHERE p."organisationId" IS NULL AND e."organisationId" IS NULL`,
    },
    {
      table: "LcaAssessment",
      sql: `SELECT count(*) FROM "LcaAssessment" a JOIN "Entity" e ON a."entityId" = e.id WHERE a."organisationId" IS NULL AND e."organisationId" IS NULL`,
    },
    {
      table: "LcaSupplierPcf",
      sql: `SELECT count(*) FROM "LcaSupplierPcf" p JOIN "Entity" e ON p."entityId" = e.id WHERE p."organisationId" IS NULL AND e."organisationId" IS NULL`,
    },
    {
      table: "LcaEvidence",
      sql: `SELECT count(*) FROM "LcaEvidence" ev JOIN "LcaAssessment" a ON ev."assessmentId" = a.id WHERE ev."organisationId" IS NULL AND a."organisationId" IS NULL`,
    },
    {
      table: "LcaAssessmentVersion",
      sql: `SELECT count(*) FROM "LcaAssessmentVersion" v JOIN "LcaAssessment" a ON v."assessmentId" = a.id WHERE v."organisationId" IS NULL AND a."organisationId" IS NULL`,
    },
  ];

  // Entity/Site have no parent within this migration — they must already be
  // fully backfilled by the T12 structural backfill command.
  const noParentToDeriveFrom: { table: ContractMigrationTableCount["table"]; sql: string }[] = [
    { table: "Entity", sql: `SELECT count(*) FROM "Entity" WHERE "organisationId" IS NULL` },
    { table: "Site", sql: `SELECT count(*) FROM "Site" WHERE "organisationId" IS NULL` },
  ];

  // Only resolved by the migration's guarded single-tenant fallback — stays
  // a diagnostic unless exactly one Organisation exists.
  const singleTenantFallbackOnly: { table: ContractMigrationTableCount["table"]; sql: string }[] = [
    { table: "ReportSnapshot", sql: `SELECT count(*) FROM "ReportSnapshot" WHERE "organisationId" IS NULL` },
    { table: "AiInteraction", sql: `SELECT count(*) FROM "AiInteraction" WHERE "organisationId" IS NULL` },
    { table: "AiSuggestion", sql: `SELECT count(*) FROM "AiSuggestion" WHERE "organisationId" IS NULL` },
    {
      table: "SourceDocument",
      sql: `SELECT count(*) FROM "SourceDocument" WHERE "organisationId" IS NULL AND "siteId" IS NULL`,
    },
  ];

  // A SourceDocument with a siteId is parent-derived, same shape as the group above.
  const sourceDocumentWithSite = {
    table: "SourceDocument" as const,
    sql: `SELECT count(*) FROM "SourceDocument" d JOIN "Site" s ON d."siteId" = s.id WHERE d."organisationId" IS NULL AND s."organisationId" IS NULL`,
  };

  // AiSettings: the migration deletes any null row outright (the known
  // pre-tenancy singleton, or any other orphan) rather than backfilling —
  // never a diagnostic.

  const tableCounts: ContractMigrationTableCount[] = [];
  for (const { table, sql } of [...noParentToDeriveFrom, ...parentDerived]) {
    tableCounts.push({ table, nullOrganisationId: await countRemainingNull(prisma, sql) });
  }
  tableCounts.push({
    table: sourceDocumentWithSite.table,
    nullOrganisationId: await countRemainingNull(prisma, sourceDocumentWithSite.sql),
  });
  for (const { table, sql } of singleTenantFallbackOnly) {
    const raw = await countRemainingNull(prisma, sql);
    tableCounts.push({ table, nullOrganisationId: singleTenant ? 0 : raw });
  }

  const mismatchQueries: { relationship: ContractMigrationMismatchCount["relationship"]; sql: string }[] = [
    {
      relationship: "Site/Entity",
      sql: `SELECT count(*) FROM "Site" s JOIN "Entity" e ON s."entityId" = e.id WHERE s."organisationId" IS DISTINCT FROM e."organisationId" AND s."organisationId" IS NOT NULL AND e."organisationId" IS NOT NULL`,
    },
    {
      relationship: "SiteEnergyContract/Site",
      sql: `SELECT count(*) FROM "SiteEnergyContract" c JOIN "Site" s ON c."siteId" = s.id WHERE c."organisationId" IS DISTINCT FROM s."organisationId" AND c."organisationId" IS NOT NULL AND s."organisationId" IS NOT NULL`,
    },
    {
      relationship: "ActivityEntry/Site",
      sql: `SELECT count(*) FROM "ActivityEntry" c JOIN "Site" s ON c."siteId" = s.id WHERE c."organisationId" IS DISTINCT FROM s."organisationId" AND c."organisationId" IS NOT NULL AND s."organisationId" IS NOT NULL`,
    },
    {
      relationship: "CommutingSurvey/Site",
      sql: `SELECT count(*) FROM "CommutingSurvey" c JOIN "Site" s ON c."siteId" = s.id WHERE c."organisationId" IS DISTINCT FROM s."organisationId" AND c."organisationId" IS NOT NULL AND s."organisationId" IS NOT NULL`,
    },
    {
      relationship: "Calculation/ActivityEntry",
      sql: `SELECT count(*) FROM "Calculation" c JOIN "ActivityEntry" e ON c."activityEntryId" = e.id WHERE c."organisationId" IS DISTINCT FROM e."organisationId" AND c."organisationId" IS NOT NULL AND e."organisationId" IS NOT NULL`,
    },
    {
      relationship: "SourceDocument/Site",
      sql: `SELECT count(*) FROM "SourceDocument" d JOIN "Site" s ON d."siteId" = s.id WHERE d."organisationId" IS DISTINCT FROM s."organisationId" AND d."organisationId" IS NOT NULL AND s."organisationId" IS NOT NULL`,
    },
    {
      relationship: "Supplier/Entity",
      sql: `SELECT count(*) FROM "Supplier" sup JOIN "Entity" e ON sup."entityId" = e.id WHERE sup."organisationId" IS DISTINCT FROM e."organisationId" AND sup."organisationId" IS NOT NULL AND e."organisationId" IS NOT NULL`,
    },
    {
      relationship: "Product/Entity",
      sql: `SELECT count(*) FROM "Product" p JOIN "Entity" e ON p."entityId" = e.id WHERE p."organisationId" IS DISTINCT FROM e."organisationId" AND p."organisationId" IS NOT NULL AND e."organisationId" IS NOT NULL`,
    },
    {
      relationship: "LcaAssessment/Entity",
      sql: `SELECT count(*) FROM "LcaAssessment" a JOIN "Entity" e ON a."entityId" = e.id WHERE a."organisationId" IS DISTINCT FROM e."organisationId" AND a."organisationId" IS NOT NULL AND e."organisationId" IS NOT NULL`,
    },
    {
      relationship: "LcaSupplierPcf/Entity",
      sql: `SELECT count(*) FROM "LcaSupplierPcf" p JOIN "Entity" e ON p."entityId" = e.id WHERE p."organisationId" IS DISTINCT FROM e."organisationId" AND p."organisationId" IS NOT NULL AND e."organisationId" IS NOT NULL`,
    },
    {
      relationship: "LcaEvidence/LcaAssessment",
      sql: `SELECT count(*) FROM "LcaEvidence" ev JOIN "LcaAssessment" a ON ev."assessmentId" = a.id WHERE ev."organisationId" IS DISTINCT FROM a."organisationId" AND ev."organisationId" IS NOT NULL AND a."organisationId" IS NOT NULL`,
    },
    {
      relationship: "LcaAssessmentVersion/LcaAssessment",
      sql: `SELECT count(*) FROM "LcaAssessmentVersion" v JOIN "LcaAssessment" a ON v."assessmentId" = a.id WHERE v."organisationId" IS DISTINCT FROM a."organisationId" AND v."organisationId" IS NOT NULL AND a."organisationId" IS NOT NULL`,
    },
  ];

  const mismatchCounts: ContractMigrationMismatchCount[] = [];
  for (const { relationship, sql } of mismatchQueries) {
    mismatchCounts.push({ relationship, mismatched: await countRemainingNull(prisma, sql) });
  }

  const report = checkContractMigrationPreflight({ tableCounts, mismatchCounts });

  console.log(JSON.stringify({ singleTenant, ready: report.ready, diagnostics: report.diagnostics }, null, 2));
  if (!report.ready) process.exitCode = 1;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  run(prisma)
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

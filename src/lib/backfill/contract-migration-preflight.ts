/**
 * T1A — read-only preflight for the tenant constraint contract migration
 * (Docs/PHASE1_TENANCY_RBAC_SPEC.md §9 "Contract migration B").
 *
 * Pure diagnostic logic only — no Prisma import, no I/O — so it can be unit
 * tested against synthetic counts, same convention as
 * `organisation-backfill.ts` (T12). `scripts/contract-migration-preflight.ts`
 * loads the real counts (never row values) and calls `checkContractMigrationPreflight`.
 *
 * This mirrors — and should stay in lockstep with — the preflight `DO` block
 * inside the actual migration
 * (prisma/migrations/20260810150000_contract_constraints_and_role_retirement),
 * which is the real enforcement gate. This module exists so an operator can
 * check readiness *before* attempting the migration, without relying on a
 * failed-and-rolled-back deploy to find out.
 *
 * `LcaMethodologyProfile.organisationId` is deliberately absent from
 * `CONTRACT_TABLES` — it stays nullable (platform-shared profiles), so it is
 * never part of this NOT NULL contract.
 */

/** Tables the contract migration makes `organisationId` NOT NULL on. */
export const CONTRACT_TABLES = [
  "Entity",
  "Site",
  "SiteEnergyContract",
  "ActivityEntry",
  "CommutingSurvey",
  "Calculation",
  "ReportSnapshot",
  "SourceDocument",
  "Supplier",
  "Product",
  "LcaAssessment",
  "LcaSupplierPcf",
  "LcaEvidence",
  "LcaAssessmentVersion",
  "AiSettings",
  "AiInteraction",
  "AiSuggestion",
] as const;

export type ContractTable = (typeof CONTRACT_TABLES)[number];

/** child/parent relationships the migration derives organisationId from, and cross-checks for conflicting rows. */
export const CONTRACT_PARENT_RELATIONSHIPS = [
  "Site/Entity",
  "SiteEnergyContract/Site",
  "ActivityEntry/Site",
  "CommutingSurvey/Site",
  "Calculation/ActivityEntry",
  "SourceDocument/Site",
  "Supplier/Entity",
  "Product/Entity",
  "LcaAssessment/Entity",
  "LcaSupplierPcf/Entity",
  "LcaEvidence/LcaAssessment",
  "LcaAssessmentVersion/LcaAssessment",
] as const;

export type ContractParentRelationship = (typeof CONTRACT_PARENT_RELATIONSHIPS)[number];

export interface ContractMigrationTableCount {
  table: ContractTable;
  /** Rows where organisationId is still null after the migration's own backfill/fallback would run. */
  nullOrganisationId: number;
}

export interface ContractMigrationMismatchCount {
  relationship: ContractParentRelationship;
  /** Rows whose organisationId disagrees with their parent's — cross-tenant/inconsistent, never guessed at. */
  mismatched: number;
}

export interface ContractMigrationPreflightInput {
  tableCounts: ContractMigrationTableCount[];
  mismatchCounts: ContractMigrationMismatchCount[];
}

export interface ContractMigrationPreflightReport {
  ready: boolean;
  /** One line per problem found — counts only, never row ids or environmental values. */
  diagnostics: string[];
}

export function checkContractMigrationPreflight(
  input: ContractMigrationPreflightInput,
): ContractMigrationPreflightReport {
  const diagnostics: string[] = [];

  for (const { table, nullOrganisationId } of input.tableCounts) {
    if (nullOrganisationId > 0) {
      diagnostics.push(`${table}.organisationId null=${nullOrganisationId}`);
    }
  }

  for (const { relationship, mismatched } of input.mismatchCounts) {
    if (mismatched > 0) {
      diagnostics.push(`${relationship} organisationId mismatch=${mismatched}`);
    }
  }

  return { ready: diagnostics.length === 0, diagnostics };
}

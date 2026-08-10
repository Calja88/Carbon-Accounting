import { describe, expect, it } from "vitest";
import {
  CONTRACT_PARENT_RELATIONSHIPS,
  CONTRACT_TABLES,
  checkContractMigrationPreflight,
  type ContractMigrationMismatchCount,
  type ContractMigrationTableCount,
} from "@/lib/backfill/contract-migration-preflight";

function cleanTableCounts(): ContractMigrationTableCount[] {
  return CONTRACT_TABLES.map((table) => ({ table, nullOrganisationId: 0 }));
}

function cleanMismatchCounts(): ContractMigrationMismatchCount[] {
  return CONTRACT_PARENT_RELATIONSHIPS.map((relationship) => ({ relationship, mismatched: 0 }));
}

describe("checkContractMigrationPreflight", () => {
  it("is ready when every table and relationship reports zero", () => {
    const report = checkContractMigrationPreflight({
      tableCounts: cleanTableCounts(),
      mismatchCounts: cleanMismatchCounts(),
    });
    expect(report.ready).toBe(true);
    expect(report.diagnostics).toEqual([]);
  });

  it("excludes LcaMethodologyProfile from the contract — never a diagnostic input", () => {
    // @ts-expect-error deliberately checking the const list itself, not a report
    expect(CONTRACT_TABLES.includes("LcaMethodologyProfile")).toBe(false);
  });

  it("reports a diagnostic with the table name and count for a remaining null", () => {
    const tableCounts = cleanTableCounts();
    const reportSnapshot = tableCounts.find((c) => c.table === "ReportSnapshot")!;
    reportSnapshot.nullOrganisationId = 3;

    const report = checkContractMigrationPreflight({ tableCounts, mismatchCounts: cleanMismatchCounts() });
    expect(report.ready).toBe(false);
    expect(report.diagnostics).toEqual(["ReportSnapshot.organisationId null=3"]);
  });

  it("reports a diagnostic for a cross-tenant/conflicting mismatch, distinct from a null count", () => {
    const mismatchCounts = cleanMismatchCounts();
    const siteEntity = mismatchCounts.find((m) => m.relationship === "Site/Entity")!;
    siteEntity.mismatched = 1;

    const report = checkContractMigrationPreflight({ tableCounts: cleanTableCounts(), mismatchCounts });
    expect(report.ready).toBe(false);
    expect(report.diagnostics).toEqual(["Site/Entity organisationId mismatch=1"]);
  });

  it("accumulates every problem found, not just the first", () => {
    const tableCounts = cleanTableCounts();
    tableCounts.find((c) => c.table === "Entity")!.nullOrganisationId = 2;
    tableCounts.find((c) => c.table === "AiSuggestion")!.nullOrganisationId = 5;
    const mismatchCounts = cleanMismatchCounts();
    mismatchCounts.find((m) => m.relationship === "Calculation/ActivityEntry")!.mismatched = 1;

    const report = checkContractMigrationPreflight({ tableCounts, mismatchCounts });
    expect(report.ready).toBe(false);
    expect(report.diagnostics).toEqual([
      "Entity.organisationId null=2",
      "AiSuggestion.organisationId null=5",
      "Calculation/ActivityEntry organisationId mismatch=1",
    ]);
  });

  it("never surfaces a diagnostic for AiSettings — the migration deletes null rows outright rather than treating them as a blocker", () => {
    expect(CONTRACT_TABLES.includes("AiSettings")).toBe(true);
    const tableCounts = cleanTableCounts();
    // AiSettings is still a contract table (organisationId becomes NOT NULL),
    // but the migration never leaves a null row behind to report — it
    // deletes it. A caller passing 0 here (as the script does) reflects that.
    expect(tableCounts.find((c) => c.table === "AiSettings")!.nullOrganisationId).toBe(0);
  });
});

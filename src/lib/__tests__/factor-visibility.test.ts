/**
 * Phase 1 tenancy (T18), factor administration (Batch I) adversarial tests,
 * per Docs/PHASE1_ADVERSARIAL_TEST_MATRIX.md §7 ("Factor suggestion includes
 * platform factors plus selected Organisation's allowed factor sets, never
 * another tenant's supplier set") and PHASE1_FILE_REFACTOR_MAP.md §10.
 * Synthetic Aster/Birch fixtures only, no real environmental data, no live
 * database.
 */

import { describe, expect, it, vi } from "vitest";
import { FactorSourceType, FactorVisibility, Scope, FactorBasis } from "@prisma/client";
import { ORG_A, ORG_B, orgContextA } from "@/lib/__tests__/tenant-fixtures";
import type { ValidatedFactorRow } from "@/lib/factor-import";

vi.mock("@/lib/entries-service", () => ({
  recalculatePendingEntries: vi.fn(async () => ({ checked: 0, recalculated: 0 })),
}));

const createdSets: Record<string, unknown>[] = [];
let updateManyCount = 1;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        emissionFactorSet: {
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            createdSets.push(data);
            return { id: `set-${createdSets.length}`, ...data };
          }),
          updateMany: vi.fn(async () => ({ count: updateManyCount })),
        },
        emissionFactor: {
          createMany: vi.fn(async () => ({ count: 0 })),
        },
      }),
    ),
  },
}));

const { commitFactorImport, visibleFactorSetFilter } = await import("@/lib/factor-sets-service");

const validRow: ValidatedFactorRow = {
  scope: Scope.SCOPE_1,
  category: "stationary_combustion_natural_gas",
  subtypeKey: null,
  basis: FactorBasis.STANDARD,
  region: "UK",
  unit: "kWh",
  co2eFactor: 0.183,
  notes: null,
  boundary: null,
  gwpBasis: null,
  referenceYear: null,
  lcaDataSource: null,
  uncertaintyPercent: null,
};

function baseInput(sourceType: FactorSourceType, supplierName: string | null = null) {
  return {
    name: "Test set",
    publisher: "DEFRA/DESNZ",
    sourceType,
    supplierName,
    vintageYear: 2026,
    effectiveFrom: new Date("2026-01-01"),
    sourceFileName: "test.csv",
    importedByUserId: "user-1",
    rows: [validRow],
  };
}

describe("visibleFactorSetFilter", () => {
  it("matches PLATFORM sets or the caller's own ORGANISATION sets, never another tenant's", () => {
    const filter = visibleFactorSetFilter(orgContextA);
    expect(filter).toEqual({
      OR: [{ visibility: FactorVisibility.PLATFORM }, { visibility: FactorVisibility.ORGANISATION, ownerOrganisationId: ORG_A }],
    });
  });
});

describe("commitFactorImport: visibility assignment", () => {
  it("assigns official DEFRA/DESNZ imports PLATFORM visibility with no owner", async () => {
    createdSets.length = 0;
    await commitFactorImport(orgContextA, baseInput(FactorSourceType.OFFICIAL_DEFRA_DESNZ));
    expect(createdSets[0].visibility).toBe(FactorVisibility.PLATFORM);
    expect(createdSets[0].ownerOrganisationId).toBeNull();
  });

  it("assigns EEIO spend-based imports PLATFORM visibility too", async () => {
    createdSets.length = 0;
    await commitFactorImport(orgContextA, baseInput(FactorSourceType.EEIO_SPEND_BASED));
    expect(createdSets[0].visibility).toBe(FactorVisibility.PLATFORM);
  });

  it("assigns a supplier-specific import ORGANISATION visibility, owned by the importing request's own Organisation — never form input", async () => {
    createdSets.length = 0;
    await commitFactorImport(orgContextA, baseInput(FactorSourceType.SUPPLIER_SPECIFIC, "Acme Freight"));
    expect(createdSets[0].visibility).toBe(FactorVisibility.ORGANISATION);
    expect(createdSets[0].ownerOrganisationId).toBe(ORG_A);
  });

  it("scopes a supplier-specific import to the Organisation B caller when B imports, not A", async () => {
    createdSets.length = 0;
    const orgContextB = { ...orgContextA, organisationId: ORG_B };
    await commitFactorImport(orgContextB, baseInput(FactorSourceType.SUPPLIER_SPECIFIC, "Acme Freight"));
    expect(createdSets[0].ownerOrganisationId).toBe(ORG_B);
    expect(createdSets[0].ownerOrganisationId).not.toBe(ORG_A);
  });

  it("refuses to supersede a factor set that isn't visible to the caller's Organisation (foreign-tenant supersede attempt)", async () => {
    createdSets.length = 0;
    updateManyCount = 0; // simulates the tenant-scoped updateMany matching zero rows
    await expect(
      commitFactorImport(orgContextA, { ...baseInput(FactorSourceType.OFFICIAL_DEFRA_DESNZ), supersedesSetId: "set-owned-by-birch" }),
    ).rejects.toThrow(/doesn't exist or isn't visible/);
    updateManyCount = 1;
  });
});

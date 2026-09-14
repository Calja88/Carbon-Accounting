/**
 * Phase 0 product reset, item 2: a SUPPLIER_SPECIFIC EmissionFactorSet is
 * ORGANISATION-visibility, owned by the importing tenant only
 * (PHASE1_FILE_REFACTOR_MAP.md §10). Before this fix, `findSupplierFactorSet`
 * matched purely on supplierName + date with no visibility filter — so two
 * organisations naming the same supplier would resolve each other's
 * supplier-specific factors. This proves Organisation B's entry naming the
 * same supplier as Organisation A's imported set never resolves to A's
 * factor. No live database; synthetic Aster/Birch fixtures only.
 */

import { describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, orgContextA } from "@/lib/__tests__/tenant-fixtures";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";

type Row = Record<string, unknown>;

const tables = vi.hoisted(() => ({
  entries: [] as Row[],
  calculations: [] as Row[],
  factorSets: [] as Row[],
  factors: [] as Row[],
  nextId: 1,
}));

function matchesOrOption(set: Row, option: Row): boolean {
  return Object.entries(option).every(([key, value]) => {
    if (value === null) return set[key] == null;
    if (value && typeof value === "object" && "gte" in (value as Row)) {
      const rowValue = set[key] as Date | null;
      return rowValue != null && rowValue >= ((value as Row).gte as Date);
    }
    return set[key] === value;
  });
}

function matchesFactorSetWhere(set: Row, where: Row): boolean {
  if (where.sourceType && set.sourceType !== where.sourceType) return false;
  if ("supplierName" in where && set.supplierName !== where.supplierName) return false;
  const effectiveFrom = where.effectiveFrom as Row | undefined;
  if (effectiveFrom?.lte && !((set.effectiveFrom as Date) <= (effectiveFrom.lte as Date))) return false;
  const and = (where.AND as Row[]) ?? [];
  for (const clause of and) {
    const or = clause.OR as Row[] | undefined;
    if (or && !or.some((option) => matchesOrOption(set, option))) return false;
  }
  return true;
}

vi.mock("@/lib/prisma", () => {
  const prismaClient = {
    activityEntry: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => tables.entries.find((e) => e.id === where.id) ?? null),
      findMany: vi.fn(async ({ where }: { where: Row }) =>
        tables.entries.filter((e) => e.status === where.status && e.organisationId === where.organisationId),
      ),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = tables.entries.find((e) => e.id === where.id);
        Object.assign(row!, data);
        return row;
      }),
    },
    emissionFactorSet: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => tables.factorSets.find((s) => matchesFactorSetWhere(s, where)) ?? null),
    },
    emissionFactor: {
      findFirst: vi.fn(
        async ({ where }: { where: Row }) =>
          tables.factors.find(
            (f) => f.factorSetId === where.factorSetId && f.category === where.category && f.subtypeKey === (where.subtypeKey ?? null) && f.basis === where.basis,
          ) ?? null,
      ),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        ...prismaClient,
        $queryRaw: vi.fn(async () => [{ id: "locked-entry" }]),
        calculation: {
          findMany: vi.fn(async ({ where }: { where: Row }) => tables.calculations.filter((c) => c.activityEntryId === where.activityEntryId && c.derivedFromCalculationId == null)),
          create: vi.fn(async ({ data }: { data: Row }) => {
            const row: Row = { id: `calc-${tables.nextId++}`, ...data };
            tables.calculations.push(row);
            return row;
          }),
        },
        activityEntry: prismaClient.activityEntry,
      };
      return fn(tx);
    }),
  };
  return { prisma: prismaClient };
});

const { runCalculationsForEntry, recalculatePendingEntries } = await import("@/lib/entries-service");

function seedSupplierSet(ownerOrganisationId: string, supplierName: string) {
  tables.factorSets.push({
    id: `supplier-set-${ownerOrganisationId}`,
    sourceType: "SUPPLIER_SPECIFIC",
    supplierName,
    visibility: "ORGANISATION",
    ownerOrganisationId,
    effectiveFrom: new Date("2020-01-01"),
    effectiveTo: null,
  });
  tables.factors.push({
    id: `supplier-factor-${ownerOrganisationId}`,
    factorSetId: `supplier-set-${ownerOrganisationId}`,
    category: "purchased_goods_freight",
    subtypeKey: null,
    basis: "STANDARD",
    unit: "kg",
    co2eFactor: 1.1,
    factorSetName: `${ownerOrganisationId} Acme set`,
    vintageYear: 2026,
    isPlaceholder: false,
  });
}

function seedEntry(overrides: Row = {}): Row {
  const entry: Row = {
    id: `entry-${tables.nextId++}`,
    organisationId: ORG_A,
    activityDataPoint: { scope: "SCOPE_3", factorCategory: "purchased_goods_freight", scope3Category: "CAT_1" },
    canonicalValue: "10",
    canonicalUnit: "kg",
    factorOption: null,
    supplierName: "Acme Freight",
    site: { id: "site-1" },
    status: "SUBMITTED",
    plausibilityFlagged: false,
    dataQualityTier: "TIER_2",
    enteredByUserId: "user-1",
    periodStart: new Date("2026-01-01"),
    ...overrides,
  };
  tables.entries.push(entry);
  return entry;
}

describe("resolveFactorMultiSource: supplier-specific factor isolation", () => {
  it("resolves a supplier-specific factor set for the owning organisation", async () => {
    seedSupplierSet(ORG_A, "Acme Freight");
    const entry = seedEntry({ organisationId: ORG_A });
    const ctx = toTenantRepositoryContext(orgContextA);

    const result = await runCalculationsForEntry(ctx, entry.id as string);

    expect(result).toHaveLength(1);
    expect(result[0].dataQualityTier).toBe("TIER_1"); // TIER_1 override only happens on a supplier-specific match
  });

  it("never resolves another organisation's supplier-specific factor set for the same supplier name", async () => {
    seedSupplierSet(ORG_A, "Acme Freight"); // owned by Organisation A only
    const entry = seedEntry({ organisationId: ORG_B, supplierName: "Acme Freight" });
    const ctxB = toTenantRepositoryContext({ ...orgContextA, organisationId: ORG_B, userId: `user-${ORG_B}` });

    const result = await runCalculationsForEntry(ctxB, entry.id as string);

    // No PLATFORM official/EEIO set exists in this fixture either, so a
    // correctly-isolated resolution finds nothing and the entry is parked
    // awaiting a factor — it must never fall through to Organisation A's set.
    expect(result).toHaveLength(0);
    expect(tables.calculations.filter((c) => c.activityEntryId === entry.id)).toHaveLength(0);
    expect((tables.entries.find((e) => e.id === entry.id) as Row).status).toBe("AWAITING_FACTOR");
  });
});

describe("recalculatePendingEntries: organisation-scoped fan-out", () => {
  it("only recalculates the importing organisation's own AWAITING_FACTOR entries", async () => {
    seedSupplierSet(ORG_A, "Acme Freight");
    const entryA = seedEntry({ organisationId: ORG_A, status: "AWAITING_FACTOR" });
    const entryB = seedEntry({ organisationId: ORG_B, status: "AWAITING_FACTOR", supplierName: "Acme Freight" });

    const result = await recalculatePendingEntries(ORG_A);

    expect(result.checked).toBe(1);
    expect((tables.entries.find((e) => e.id === entryA.id) as Row).status).not.toBe("AWAITING_FACTOR");
    // Organisation B's entry must be untouched by A's factor import fan-out.
    expect((tables.entries.find((e) => e.id === entryB.id) as Row).status).toBe("AWAITING_FACTOR");
  });
});

/**
 * BD03: runCalculationsForEntry must be idempotent (a retry/duplicate call
 * for the same entry never creates duplicate Calculation rows) and atomic
 * (Scope 2's two basis rows commit together or not at all). No live
 * database — Prisma is replaced with an in-memory fake. Synthetic fixtures
 * only.
 */

import { describe, expect, it, vi } from "vitest";
import { ORG_A, orgContextA } from "@/lib/__tests__/tenant-fixtures";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";

type Row = Record<string, unknown>;

const tables = vi.hoisted(() => ({
  entries: [] as Row[],
  calculations: [] as Row[],
  factorSets: [] as Row[],
  factors: [] as Row[],
  nextId: 1,
}));

vi.mock("@/lib/prisma", () => {
  const prismaClient = {
    activityEntry: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => tables.entries.find((e) => e.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = tables.entries.find((e) => e.id === where.id);
        Object.assign(row!, data);
        return row;
      }),
    },
    emissionFactorSet: {
      findFirst: vi.fn(async () => tables.factorSets[0] ?? null),
    },
    emissionFactor: {
      findFirst: vi.fn(
        async ({ where }: { where: Row }) => tables.factors.find((f) => f.factorSetId === where.factorSetId && f.category === where.category && f.basis === where.basis) ?? null,
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

const { runCalculationsForEntry } = await import("@/lib/entries-service");

function seedEntry(overrides: Row = {}) {
  const entry: Row = {
    id: `entry-${tables.nextId++}`,
    organisationId: ORG_A,
    activityDataPoint: { scope: "SCOPE_1", factorCategory: "stationary_combustion_diesel", scope3Category: null },
    canonicalValue: "100",
    canonicalUnit: "litres",
    factorOption: null,
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

function seedFactor() {
  tables.factorSets.push({ id: "set-1", sourceType: "OFFICIAL_DEFRA_DESNZ", effectiveFrom: new Date("2020-01-01"), effectiveTo: null });
  tables.factors.push({
    id: "factor-1",
    factorSetId: "set-1",
    category: "stationary_combustion_diesel",
    subtypeKey: null,
    basis: "STANDARD",
    unit: "litres",
    co2eFactor: 2.5,
    factorSetName: "DEFRA 2026",
    vintageYear: 2026,
    isPlaceholder: false,
  });
}

describe("runCalculationsForEntry — BD03 idempotency and atomicity", () => {
  it("creates exactly one Calculation row on the first call", async () => {
    seedFactor();
    const entry = seedEntry();
    const ctx = toTenantRepositoryContext(orgContextA);
    const result = await runCalculationsForEntry(ctx, entry.id as string);
    expect(result).toHaveLength(1);
    expect(tables.calculations.filter((c) => c.activityEntryId === entry.id)).toHaveLength(1);
  });

  it("a second call for the same entry is a no-op — no duplicate rows, same result returned", async () => {
    seedFactor();
    const entry = seedEntry();
    const ctx = toTenantRepositoryContext(orgContextA);
    const first = await runCalculationsForEntry(ctx, entry.id as string);
    const second = await runCalculationsForEntry(ctx, entry.id as string);
    expect(second).toEqual(first);
    expect(tables.calculations.filter((c) => c.activityEntryId === entry.id)).toHaveLength(1);
  });

  it("parallel retries after an initial calculation return the existing row (not a concurrency proof)", async () => {
    seedFactor();
    const entry = seedEntry();
    const ctx = toTenantRepositoryContext(orgContextA);
    // The mocked $transaction is not truly concurrency-safe (no real
    // Postgres lock), but this proves the code path itself: every call
    // that finds existing rows returns them rather than creating more.
    await runCalculationsForEntry(ctx, entry.id as string);
    await Promise.all([runCalculationsForEntry(ctx, entry.id as string), runCalculationsForEntry(ctx, entry.id as string)]);
    expect(tables.calculations.filter((c) => c.activityEntryId === entry.id)).toHaveLength(1);
  });
});

it("Checkpoint A excludes derived history from primary creation and replay", async () => {
  seedFactor(); const entry = seedEntry(); const ctx = toTenantRepositoryContext(orgContextA);
  tables.calculations.push({ id: "derived-fixture", activityEntryId: entry.id, organisationId: ORG_A, scope: "SCOPE_3", basis: "STANDARD", derivedFromCalculationId: "another-parent" });
  const first = await runCalculationsForEntry(ctx, entry.id as string);
  expect(first).toHaveLength(1); expect(first[0].scope).toBe("SCOPE_1");
  expect(await runCalculationsForEntry(ctx, entry.id as string)).toEqual(first);
  expect(tables.calculations.filter(c => c.activityEntryId === entry.id)).toHaveLength(2);
});
it("Checkpoint A retains and rejects a partial Scope 2 history", async () => {
  const entry = seedEntry({ activityDataPoint: { scope: "SCOPE_2", factorCategory: "grid_electricity" } });
  tables.calculations.push({ id: "partial-fixture", activityEntryId: entry.id, organisationId: ORG_A, scope: "SCOPE_2", basis: "LOCATION_BASED", derivedFromCalculationId: null });
  await expect(runCalculationsForEntry(toTenantRepositoryContext(orgContextA), entry.id as string)).rejects.toThrow("Incomplete");
  expect(tables.calculations.filter(c => c.activityEntryId === entry.id)).toHaveLength(1);
});

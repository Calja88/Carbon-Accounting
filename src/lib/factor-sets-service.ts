import { prisma } from "@/lib/prisma";
import { FactorSourceType } from "@prisma/client";
import { ValidatedFactorRow } from "@/lib/factor-import";
import { recalculatePendingEntries } from "@/lib/entries-service";

export interface CommitFactorImportInput {
  name: string;
  publisher: string;
  sourceType: FactorSourceType;
  supplierName?: string | null;
  vintageYear: number;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  sourceUrl?: string | null;
  notes?: string | null;
  sourceFileName: string;
  importedByUserId: string;
  /** Optional — marks a previous set's effectiveTo as ending right before this one starts, so there's no ambiguous overlap window. The old set's factor rows are never edited or deleted (append-only). */
  supersedesSetId?: string | null;
  rows: ValidatedFactorRow[];
}

/**
 * Creates a brand-new EmissionFactorSet + its EmissionFactor rows in one
 * transaction — never edits an existing set's factors in place (brief item
 * 7). After committing, retries every entry stuck at AWAITING_FACTOR so
 * Scope 3 data collected before this import lands gets calculated
 * immediately, with no separate manual step.
 */
export async function commitFactorImport(input: CommitFactorImportInput) {
  if (input.sourceType === FactorSourceType.SUPPLIER_SPECIFIC && !input.supplierName) {
    throw new Error("Supplier-specific factor sets require a supplier name.");
  }
  if (input.rows.length === 0) {
    throw new Error("No valid factor rows to import.");
  }

  const factorSet = await prisma.$transaction(async (tx) => {
    if (input.supersedesSetId) {
      await tx.emissionFactorSet.update({
        where: { id: input.supersedesSetId },
        data: { effectiveTo: new Date(input.effectiveFrom.getTime() - 1) },
      });
    }

    const set = await tx.emissionFactorSet.create({
      data: {
        name: input.name,
        publisher: input.publisher,
        sourceType: input.sourceType,
        supplierName: input.sourceType === FactorSourceType.SUPPLIER_SPECIFIC ? input.supplierName : null,
        vintageYear: input.vintageYear,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        sourceUrl: input.sourceUrl ?? null,
        isPlaceholder: false,
        notes: input.notes ?? null,
        sourceFileName: input.sourceFileName,
        importedByUserId: input.importedByUserId,
      },
    });

    await tx.emissionFactor.createMany({
      data: input.rows.map((r) => ({
        factorSetId: set.id,
        scope: r.scope,
        category: r.category,
        subtypeKey: r.subtypeKey,
        basis: r.basis,
        region: r.region,
        unit: r.unit,
        co2eFactor: r.co2eFactor,
        notes: r.notes,
        boundary: r.boundary,
        gwpBasis: r.gwpBasis,
        referenceYear: r.referenceYear,
        lcaDataSource: r.lcaDataSource,
        uncertaintyPercent: r.uncertaintyPercent,
      })),
    });

    return set;
  });

  const backfill = await recalculatePendingEntries();

  return { factorSet, backfill };
}

export async function listFactorSets() {
  return prisma.emissionFactorSet.findMany({
    orderBy: { createdAt: "desc" },
    include: { importedBy: true, _count: { select: { factors: true } } },
  });
}

export async function getFactorSetDetail(id: string) {
  return prisma.emissionFactorSet.findUnique({
    where: { id },
    include: { importedBy: true, _count: { select: { factors: true } } },
  });
}

/** Category breakdown for a set — used to show a manageable summary instead
 * of dumping every row when a set holds thousands of factors (e.g. the full
 * DEFRA/DESNZ reference library import, see README). */
export async function getFactorSetCategoryCounts(factorSetId: string) {
  const grouped = await prisma.emissionFactor.groupBy({
    by: ["category"],
    where: { factorSetId },
    _count: { _all: true },
    orderBy: { category: "asc" },
  });
  return grouped.map((g) => ({ category: g.category, count: g._count._all }));
}

/** Factor rows for one category within a set — the drill-down view so the
 * admin UI never has to render thousands of rows at once. */
export async function getFactorSetCategoryRows(factorSetId: string, category: string) {
  return prisma.emissionFactor.findMany({
    where: { factorSetId, category },
    orderBy: [{ subtypeKey: "asc" }, { basis: "asc" }],
  });
}

export class FactorSetInUseError extends Error {}

/**
 * How many of this set's factors have been used anywhere — corporate
 * calculations or any of the several product-LCA relations a factor can be
 * attached to (inventory items, their recycled-content override, transport
 * legs, end-of-life routes, calculation results, evidence). None of those
 * foreign keys cascade (see prisma/schema.prisma), so a used factor set
 * can't be deleted — this is what lets the caller show that count instead
 * of a raw constraint violation.
 */
export async function getFactorSetUsage(factorSetId: string) {
  const [totalFactors, usedFactors] = await Promise.all([
    prisma.emissionFactor.count({ where: { factorSetId } }),
    prisma.emissionFactor.count({
      where: {
        factorSetId,
        OR: [
          { calculations: { some: {} } },
          { lcaInventoryItems: { some: {} } },
          { lcaRecycledInventoryItems: { some: {} } },
          { lcaTransportLegs: { some: {} } },
          { lcaEndOfLifeRoutes: { some: {} } },
          { lcaResults: { some: {} } },
          { lcaEvidence: { some: {} } },
        ],
      },
    }),
  ]);
  return { totalFactors, usedFactors };
}

/**
 * Deletes a factor set. Refused outright if any of its factors have ever
 * been used — this library is deliberately "versioned, never edited in
 * place" (see README/schema comments): a calculation snapshots the factor
 * value it used onto itself, but still keeps a live foreign key back to the
 * EmissionFactor row, and that FK has no cascade, so a used factor set
 * can't be removed without breaking calculations that depend on it being
 * there. An unused set (imported by mistake, or a duplicate) deletes
 * cleanly — its factor rows first, then the set itself, since
 * EmissionFactor.factorSetId has no cascade either.
 */
export async function deleteFactorSet(factorSetId: string) {
  const usage = await getFactorSetUsage(factorSetId);
  if (usage.usedFactors > 0) {
    throw new FactorSetInUseError(
      `${usage.usedFactors} of this set's factors are in use by a calculation, inventory line, transport leg, end-of-life route, result, or piece of evidence. A used factor set can't be deleted.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.emissionFactor.deleteMany({ where: { factorSetId } });
    await tx.emissionFactorSet.delete({ where: { id: factorSetId } });
  });
}

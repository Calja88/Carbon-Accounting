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

export class FactorSetInUseError extends Error {}

/**
 * Deletes a factor set — but only when none of its factors have ever been
 * used. The import path is deliberately append-only (a new import never
 * edits an existing set — see commitFactorImport above) because a
 * Calculation snapshots the factor value it used at the time, but also
 * keeps a live emissionFactorId reference for "how was this calculated?"
 * (see explain-calculation.ts). Removing a factor a real calculation still
 * points at would break that trail, so this only ever removes a set that
 * was imported by mistake and never actually used — anywhere: corporate
 * calculations, LCA inventory items, transport legs, end-of-life routes, or
 * LCA evidence.
 */
export async function deleteFactorSet(factorSetId: string) {
  const factorIds = (await prisma.emissionFactor.findMany({ where: { factorSetId }, select: { id: true } })).map((f) => f.id);

  if (factorIds.length > 0) {
    const [calcCount, inventoryCount, recycledInventoryCount, transportCount, eolCount, evidenceCount] = await Promise.all([
      prisma.calculation.count({ where: { emissionFactorId: { in: factorIds } } }),
      prisma.lcaInventoryItem.count({ where: { emissionFactorId: { in: factorIds } } }),
      prisma.lcaInventoryItem.count({ where: { recycledEmissionFactorId: { in: factorIds } } }),
      prisma.lcaTransportLeg.count({ where: { emissionFactorId: { in: factorIds } } }),
      prisma.lcaEndOfLifeRoute.count({ where: { emissionFactorId: { in: factorIds } } }),
      prisma.lcaEvidence.count({ where: { emissionFactorId: { in: factorIds } } }),
    ]);
    const usageCount = calcCount + inventoryCount + recycledInventoryCount + transportCount + eolCount + evidenceCount;
    if (usageCount > 0) {
      throw new FactorSetInUseError(
        `This factor set is referenced by ${usageCount} calculation(s)/inventory record(s) and can't be deleted — it's part of the audit trail for figures that already exist.`,
      );
    }
  }

  await prisma.$transaction([
    prisma.emissionFactor.deleteMany({ where: { factorSetId } }),
    prisma.emissionFactorSet.delete({ where: { id: factorSetId } }),
  ]);
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

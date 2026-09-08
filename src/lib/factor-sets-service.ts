import { prisma } from "@/lib/prisma";
import { FactorSourceType, FactorVisibility, Prisma } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { ValidatedFactorRow } from "@/lib/factor-import";
import { recalculatePendingEntries } from "@/lib/entries-service";

/**
 * Phase 1 tenancy (T18), factor administration (Batch I —
 * PHASE1_FILE_REFACTOR_MAP.md §10): official/global reference sets
 * (OFFICIAL_DEFRA_DESNZ, EEIO_SPEND_BASED, LCA_SECONDARY) are PLATFORM,
 * visible to every tenant; a SUPPLIER_SPECIFIC set is ORGANISATION, owned by
 * the importing request's own Organisation and invisible to every other
 * tenant. Ownership is always assigned from the caller's OrganisationContext,
 * never from form input.
 */
export function visibleFactorSetFilter(context: OrganisationContext): Prisma.EmissionFactorSetWhereInput {
  return {
    OR: [
      { visibility: FactorVisibility.PLATFORM },
      { visibility: FactorVisibility.ORGANISATION, ownerOrganisationId: context.organisationId },
    ],
  };
}

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
 *
 * `context` decides visibility: a SUPPLIER_SPECIFIC set is owned by the
 * caller's Organisation and invisible to every other tenant; every other
 * source type is a PLATFORM reference set. `supersedesSetId` is re-validated
 * against the same visibility rule so an organisation cannot end another
 * tenant's — or the platform's — factor set's effective period by naming its
 * id.
 */
export async function commitFactorImport(context: OrganisationContext, input: CommitFactorImportInput) {
  if (input.sourceType === FactorSourceType.SUPPLIER_SPECIFIC && !input.supplierName) {
    throw new Error("Supplier-specific factor sets require a supplier name.");
  }
  if (input.rows.length === 0) {
    throw new Error("No valid factor rows to import.");
  }

  const visibility =
    input.sourceType === FactorSourceType.SUPPLIER_SPECIFIC ? FactorVisibility.ORGANISATION : FactorVisibility.PLATFORM;
  const ownerOrganisationId = visibility === FactorVisibility.ORGANISATION ? context.organisationId : null;

  const factorSet = await prisma.$transaction(async (tx) => {
    if (input.supersedesSetId) {
      const { count } = await tx.emissionFactorSet.updateMany({
        where: { id: input.supersedesSetId, ...visibleFactorSetFilter(context) },
        data: { effectiveTo: new Date(input.effectiveFrom.getTime() - 1) },
      });
      if (count === 0) {
        throw new Error("The factor set to supersede doesn't exist or isn't visible to this organisation.");
      }
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
        visibility,
        ownerOrganisationId,
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

export async function listFactorSets(context: OrganisationContext) {
  return prisma.emissionFactorSet.findMany({
    where: visibleFactorSetFilter(context),
    orderBy: { createdAt: "desc" },
    include: { importedBy: true, _count: { select: { factors: true } } },
  });
}

export async function getFactorSetDetail(context: OrganisationContext, id: string) {
  return prisma.emissionFactorSet.findFirst({
    where: { id, ...visibleFactorSetFilter(context) },
    include: { importedBy: true, _count: { select: { factors: true } } },
  });
}

/** Category breakdown for a set — used to show a manageable summary instead
 * of dumping every row when a set holds thousands of factors (e.g. the full
 * DEFRA/DESNZ reference library import, see README). */
export async function getFactorSetCategoryCounts(context: OrganisationContext, factorSetId: string) {
  const grouped = await prisma.emissionFactor.groupBy({
    by: ["category"],
    where: { factorSetId, factorSet: visibleFactorSetFilter(context) },
    _count: { _all: true },
    orderBy: { category: "asc" },
  });
  return grouped.map((g) => ({ category: g.category, count: g._count._all }));
}

/** Factor rows for one category within a set — the drill-down view so the
 * admin UI never has to render thousands of rows at once. */
export async function getFactorSetCategoryRows(context: OrganisationContext, factorSetId: string, category: string) {
  return prisma.emissionFactor.findMany({
    where: { factorSetId, category, factorSet: visibleFactorSetFilter(context) },
    orderBy: [{ subtypeKey: "asc" }, { basis: "asc" }],
  });
}

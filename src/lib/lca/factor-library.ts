/**
 * Searching the shared emission factor library from the product LCA side.
 *
 * There is one factor library. Corporate Scope 1/2/3 factors and life-cycle
 * inventory factors live in the same versioned, append-only tables and are
 * loaded through the same admin importer — this module just queries it with
 * the filters a product modeller needs (category, geography, unit, vintage),
 * and surfaces the lifecycle metadata that corporate reporting doesn't use.
 */

import { LcaFactorBoundary, LcaItemType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lcaFactorCategoriesForItemType, LCA_FACTOR_CATEGORIES } from "./factor-categories";
import { FACTOR_CATEGORIES } from "@/lib/factor-categories";
import { areUnitsCompatible } from "./units";

const include = { factorSet: true } as const;

export type LibraryFactor = Prisma.EmissionFactorGetPayload<{ include: typeof include }>;

export interface FactorSearchOptions {
  /** Restrict to the categories that suit this item type. */
  itemType?: LcaItemType;
  category?: string;
  query?: string;
  region?: string;
  /** Only factors whose unit can be multiplied by activity data in this unit. */
  compatibleWithUnit?: string;
  includePlaceholders?: boolean;
  take?: number;
}

export async function searchFactors(options: FactorSearchOptions = {}): Promise<LibraryFactor[]> {
  const categories = options.category
    ? [options.category]
    : options.itemType
      ? lcaFactorCategoriesForItemType(options.itemType).map((c) => c.key)
      : undefined;

  const where: Prisma.EmissionFactorWhereInput = {
    ...(categories ? { category: { in: categories } } : {}),
    ...(options.region ? { region: { equals: options.region, mode: "insensitive" } } : {}),
    ...(options.includePlaceholders === false ? { factorSet: { isPlaceholder: false } } : {}),
    ...(options.query
      ? {
          OR: [
            { category: { contains: options.query, mode: "insensitive" } },
            { subtypeKey: { contains: options.query, mode: "insensitive" } },
            { notes: { contains: options.query, mode: "insensitive" } },
            { lcaDataSource: { contains: options.query, mode: "insensitive" } },
            { factorSet: { name: { contains: options.query, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const factors = await prisma.emissionFactor.findMany({
    where,
    include,
    orderBy: [{ category: "asc" }, { subtypeKey: "asc" }],
    take: options.take ?? 300,
  });

  if (!options.compatibleWithUnit) return factors;
  // Compatibility is a dimensional question the database can't answer, so it
  // is applied here rather than being left for the modeller to trip over.
  return factors.filter((f) => areUnitsCompatible(f.unit, options.compatibleWithUnit as string));
}

export async function getFactor(factorId: string): Promise<LibraryFactor | null> {
  return prisma.emissionFactor.findUnique({ where: { id: factorId }, include });
}

/** Categories that actually have factors loaded, with counts, for the picker. */
export async function factorCategoriesWithCounts(): Promise<
  { key: string; label: string; count: number; isLca: boolean }[]
> {
  const grouped = await prisma.emissionFactor.groupBy({
    by: ["category"],
    _count: { _all: true },
    orderBy: { category: "asc" },
  });

  const lcaKeys = new Map(LCA_FACTOR_CATEGORIES.map((c) => [c.key, c.label]));
  const corporateKeys = new Map(FACTOR_CATEGORIES.map((c) => [c.key, c.label]));

  return grouped.map((g) => ({
    key: g.category,
    label: lcaKeys.get(g.category) ?? corporateKeys.get(g.category) ?? g.category,
    count: g._count._all,
    isLca: lcaKeys.has(g.category),
  }));
}

export function factorLabel(factor: LibraryFactor): string {
  const parts = [factor.category];
  if (factor.subtypeKey) parts.push(factor.subtypeKey);
  return parts.join(" · ");
}

export function factorSummary(factor: LibraryFactor): string {
  const bits = [
    `${factor.co2eFactor.toString()} kgCO2e per ${factor.unit}`,
    factor.region,
    factor.referenceYear ? `${factor.referenceYear} data` : `${factor.factorSet.vintageYear} vintage`,
    factor.boundary && factor.boundary !== LcaFactorBoundary.UNKNOWN
      ? factor.boundary.replace(/_/g, " ").toLowerCase()
      : "boundary not stated",
  ];
  return bits.filter(Boolean).join(" · ");
}

/** True when nothing in the library is usable for product work yet. */
export async function hasUsableLcaFactors(): Promise<boolean> {
  const count = await prisma.emissionFactor.count({
    where: {
      category: { in: LCA_FACTOR_CATEGORIES.map((c) => c.key) },
      factorSet: { isPlaceholder: false },
    },
  });
  return count > 0;
}

export async function lcaFactorLibraryStatus(): Promise<{
  totalLcaFactors: number;
  realLcaFactors: number;
  placeholderLcaFactors: number;
  sets: { id: string; name: string; publisher: string; vintageYear: number; isPlaceholder: boolean; count: number }[];
}> {
  const lcaCategories = LCA_FACTOR_CATEGORIES.map((c) => c.key);
  const [total, real, sets] = await Promise.all([
    prisma.emissionFactor.count({ where: { category: { in: lcaCategories } } }),
    prisma.emissionFactor.count({ where: { category: { in: lcaCategories }, factorSet: { isPlaceholder: false } } }),
    prisma.emissionFactorSet.findMany({
      where: { factors: { some: { category: { in: lcaCategories } } } },
      select: {
        id: true,
        name: true,
        publisher: true,
        vintageYear: true,
        isPlaceholder: true,
        _count: { select: { factors: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    totalLcaFactors: total,
    realLcaFactors: real,
    placeholderLcaFactors: total - real,
    sets: sets.map((s) => ({
      id: s.id,
      name: s.name,
      publisher: s.publisher,
      vintageYear: s.vintageYear,
      isPlaceholder: s.isPlaceholder,
      count: s._count.factors,
    })),
  };
}

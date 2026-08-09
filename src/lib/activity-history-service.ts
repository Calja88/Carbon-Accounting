/**
 * Read-only history view over ActivityEntry — the same permanent activity
 * records the report generator reads from (see report-service.ts). This
 * module never calculates, recalculates or writes anything; it only lists
 * and filters what is already stored, so opening or filtering this page
 * costs a paginated query and, at most, one small aggregate.
 */

import { EntryStatus, FactorBasis, Prisma, Scope } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export const STATUS_LABELS: Record<EntryStatus, string> = {
  SUBMITTED: "Complete",
  FLAGGED: "Needs review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  AWAITING_FACTOR: "Awaiting emission factor",
};

export const STATUS_TONES: Record<EntryStatus, "neutral" | "success" | "warning" | "danger"> = {
  SUBMITTED: "success",
  FLAGGED: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  AWAITING_FACTOR: "neutral",
};

export const SCOPE_LABELS: Record<Scope, string> = {
  SCOPE_1: "Scope 1",
  SCOPE_2: "Scope 2",
  SCOPE_3: "Scope 3",
};

export type SortField = "date" | "entered" | "updated" | "quantity" | "site" | "category" | "scope";
export type SortDir = "asc" | "desc";

export interface ActivityHistoryFilters {
  search?: string;
  scope?: Scope;
  category?: string;
  siteId?: string;
  status?: EntryStatus;
  from?: Date;
  to?: Date;
  sort?: SortField;
  dir?: SortDir;
  page?: number;
  pageSize?: number;
}

/** Parses raw ?query params into a typed, validated filter set — never trusts the shape it's given. */
export function parseActivityHistoryFilters(params: Record<string, string | undefined>): ActivityHistoryFilters {
  const scope = params.scope && (Object.values(Scope) as string[]).includes(params.scope) ? (params.scope as Scope) : undefined;
  const status =
    params.status && (Object.values(EntryStatus) as string[]).includes(params.status) ? (params.status as EntryStatus) : undefined;
  const sort: SortField | undefined = (
    ["date", "entered", "updated", "quantity", "site", "category", "scope"] as const
  ).includes(params.sort as SortField)
    ? (params.sort as SortField)
    : undefined;
  const dir: SortDir | undefined = params.dir === "asc" ? "asc" : params.dir === "desc" ? "desc" : undefined;

  const from = params.from && !Number.isNaN(Date.parse(params.from)) ? new Date(params.from) : undefined;
  const to = params.to && !Number.isNaN(Date.parse(params.to)) ? new Date(params.to) : undefined;

  const page = params.page ? Math.max(1, Math.trunc(Number(params.page)) || 1) : 1;
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(Number(params.pageSize))
    ? Number(params.pageSize)
    : PAGE_SIZE;

  return {
    search: params.search?.trim() || undefined,
    scope,
    category: params.category?.trim() || undefined,
    siteId: params.siteId?.trim() || undefined,
    status,
    from,
    to,
    sort,
    dir,
    page,
    pageSize,
  };
}

export function buildActivityHistoryWhere(filters: ActivityHistoryFilters): Prisma.ActivityEntryWhereInput {
  const where: Prisma.ActivityEntryWhereInput = {};

  if (filters.scope) where.activityDataPoint = { scope: filters.scope };
  if (filters.category) {
    where.activityDataPoint = { ...(where.activityDataPoint as object), category: filters.category };
  }
  if (filters.siteId) where.siteId = filters.siteId;
  if (filters.status) where.status = filters.status;
  if (filters.from || filters.to) {
    where.periodStart = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  if (filters.search) {
    const q = filters.search;
    where.OR = [
      { notes: { contains: q, mode: "insensitive" } },
      { supplierName: { contains: q, mode: "insensitive" } },
      { activityDataPoint: { dataPointName: { contains: q, mode: "insensitive" } } },
      { activityDataPoint: { code: { contains: q, mode: "insensitive" } } },
      { site: { name: { contains: q, mode: "insensitive" } } },
      { sourceDocument: { filename: { contains: q, mode: "insensitive" } } },
    ];
  }

  return where;
}

function buildOrderBy(sort?: SortField, dir: SortDir = "desc"): Prisma.ActivityEntryOrderByWithRelationInput[] {
  switch (sort) {
    case "entered":
      return [{ enteredAt: dir }];
    case "updated":
      return [{ updatedAt: dir }];
    case "quantity":
      return [{ canonicalValue: dir }];
    case "site":
      return [{ site: { name: dir } }];
    case "category":
      return [{ activityDataPoint: { category: dir } }];
    case "scope":
      return [{ activityDataPoint: { scope: dir } }];
    case "date":
    default:
      // Default ordering per spec: activity date descending, then created
      // date descending as a tie-breaker.
      return [{ periodStart: dir }, { enteredAt: "desc" }];
  }
}

export interface ActivityHistoryRow {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  site: { id: string; name: string; entityName: string };
  scope: Scope;
  category: string;
  dataPointName: string;
  optionLabel: string | null;
  supplierName: string | null;
  rawValue: string;
  rawUnit: string;
  status: EntryStatus;
  dataOrigin: string;
  kgCo2e: number | null;
  hasSourceDocument: boolean;
  sourceDocumentId: string | null;
  primaryCalculationId: string | null;
}

/** Sums only the headline bases (STANDARD / LOCATION_BASED) so a Scope 2
 *  entry's market-based companion row is never double-counted — same rule
 *  analytics-service.ts and report-service.ts use for totals. */
const HEADLINE_BASES: FactorBasis[] = [FactorBasis.STANDARD, FactorBasis.LOCATION_BASED];

export function sumHeadlineKgCo2e(calculations: { basis: FactorBasis; resultKgCo2e: Prisma.Decimal | number }[]): number | null {
  const headline = calculations.filter((c) => HEADLINE_BASES.includes(c.basis));
  if (headline.length === 0) return null;
  return headline.reduce((sum, c) => sum + Number(c.resultKgCo2e), 0);
}

export interface ActivityHistoryPage {
  rows: ActivityHistoryRow[];
  totalCount: number;
  totalKgCo2eFiltered: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * Lists activity entries for the history view: server-side filtered,
 * sorted and paginated, with only the fields the table and summary need —
 * no document bytes, no extraction text, no full calculation snapshots.
 */
export async function listActivityHistory(filters: ActivityHistoryFilters): Promise<ActivityHistoryPage> {
  const where = buildActivityHistoryWhere(filters);
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? PAGE_SIZE;

  const [entries, totalCount, totalAgg] = await Promise.all([
    prisma.activityEntry.findMany({
      where,
      orderBy: buildOrderBy(filters.sort, filters.dir ?? "desc"),
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        rawValue: true,
        rawUnit: true,
        status: true,
        dataOrigin: true,
        supplierName: true,
        sourceDocumentId: true,
        site: { select: { id: true, name: true, entity: { select: { name: true } } } },
        activityDataPoint: { select: { scope: true, category: true, dataPointName: true } },
        factorOption: { select: { label: true } },
        calculations: { select: { id: true, basis: true, resultKgCo2e: true } },
      },
    }),
    prisma.activityEntry.count({ where }),
    prisma.calculation.aggregate({
      _sum: { resultKgCo2e: true },
      where: { basis: { in: HEADLINE_BASES }, activityEntry: where },
    }),
  ]);

  const rows: ActivityHistoryRow[] = entries.map((e) => {
    const headline = e.calculations.filter((c) => HEADLINE_BASES.includes(c.basis));
    return {
      id: e.id,
      periodStart: e.periodStart,
      periodEnd: e.periodEnd,
      site: { id: e.site.id, name: e.site.name, entityName: e.site.entity.name },
      scope: e.activityDataPoint.scope,
      category: e.activityDataPoint.category,
      dataPointName: e.activityDataPoint.dataPointName,
      optionLabel: e.factorOption?.label ?? null,
      supplierName: e.supplierName,
      rawValue: e.rawValue.toString(),
      rawUnit: e.rawUnit,
      status: e.status,
      dataOrigin: e.dataOrigin,
      kgCo2e: sumHeadlineKgCo2e(e.calculations),
      hasSourceDocument: e.sourceDocumentId !== null,
      sourceDocumentId: e.sourceDocumentId,
      primaryCalculationId: headline[0]?.id ?? e.calculations[0]?.id ?? null,
    };
  });

  return {
    rows,
    totalCount,
    totalKgCo2eFiltered: Number(totalAgg._sum.resultKgCo2e ?? 0),
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}

/** kgCO2e for a table cell: tCO2e above 1000kg, kgCO2e below, "Not calculated" when nothing's stored yet. */
export function formatRowEmissions(kgCo2e: number | null): string {
  if (kgCo2e === null) return "Not calculated";
  if (Math.abs(kgCo2e) >= 1000) return `${(kgCo2e / 1000).toLocaleString("en-GB", { maximumFractionDigits: 2 })} tCO2e`;
  return `${kgCo2e.toLocaleString("en-GB", { maximumFractionDigits: 1 })} kgCO2e`;
}

/**
 * Full detail for one entry's row-detail view. Reads only what's already
 * stored — the calculation figures shown here are the ones that were
 * actually calculated, never recomputed for display.
 */
export async function getActivityHistoryDetail(id: string) {
  return prisma.activityEntry.findUnique({
    where: { id },
    include: {
      site: { include: { entity: true } },
      activityDataPoint: true,
      factorOption: true,
      enteredBy: { select: { id: true, name: true } },
      sourceDocument: { select: { id: true, filename: true, kind: true, status: true, uploadedAt: true } },
      acceptedFromExtraction: { select: { id: true, confidence: true, createdAt: true } },
      calculations: {
        include: {
          emissionFactor: { select: { region: true, subtypeKey: true } },
          calculatedBy: { select: { name: true } },
        },
        orderBy: { calculatedAt: "asc" },
      },
    },
  });
}

export async function listActivityHistoryCategories(): Promise<string[]> {
  const rows = await prisma.activityDataPoint.findMany({
    distinct: ["category"],
    select: { category: true },
    orderBy: { category: "asc" },
  });
  return rows.map((r) => r.category);
}

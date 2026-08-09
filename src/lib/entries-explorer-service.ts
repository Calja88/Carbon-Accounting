/**
 * Read-only query layer behind the Historical Data Explorer (/data/entries).
 *
 * Every activity entry the corporate GHG inventory has ever recorded —
 * however it arrived (hand-typed, ExpenseIn import, or an accepted AI
 * document extraction) — becomes an ActivityEntry row through the same
 * pipeline (`createActivityEntryWithCalculations` in entries-service.ts).
 * Until now there was no page that simply lists and filters those rows: the
 * only ways to see one were the *current period's* site checklist
 * (/data/entry/[siteId]) or a generated report. This module adds that list,
 * strictly read-only — it creates no new write path and no new Prisma model.
 *
 * Server-side paginated (never loads the whole table into memory — see
 * docs/ui-overhaul-plan.md §13 Performance strategy) and filters entirely
 * through indexed/filterable columns already on ActivityEntry.
 */

import { prisma } from "@/lib/prisma";
import { DataOrigin, EntryStatus, Prisma, Scope } from "@prisma/client";

export const ENTRIES_PAGE_SIZE = 25;

export interface EntriesExplorerFilters {
  siteId?: string;
  entityId?: string;
  scope?: Scope;
  status?: EntryStatus;
  dataOrigin?: DataOrigin;
  /** Matched against data point name, site name, and supplier name (case-insensitive contains). */
  q?: string;
  /** Inclusive period-start bounds, both optional. */
  periodFrom?: Date;
  periodTo?: Date;
}

export type EntriesSortField = "period" | "enteredAt";
export type EntriesSortDir = "asc" | "desc";

export interface EntriesExplorerQuery extends EntriesExplorerFilters {
  page?: number;
  sort?: EntriesSortField;
  dir?: EntriesSortDir;
}

function buildWhere(filters: EntriesExplorerFilters): Prisma.ActivityEntryWhereInput {
  const where: Prisma.ActivityEntryWhereInput = {};

  if (filters.siteId) where.siteId = filters.siteId;
  if (filters.entityId) where.site = { entityId: filters.entityId };
  if (filters.scope) where.activityDataPoint = { scope: filters.scope };
  if (filters.status) where.status = filters.status;
  if (filters.dataOrigin) where.dataOrigin = filters.dataOrigin;

  if (filters.periodFrom || filters.periodTo) {
    where.periodStart = {
      ...(filters.periodFrom ? { gte: filters.periodFrom } : {}),
      ...(filters.periodTo ? { lte: filters.periodTo } : {}),
    };
  }

  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { activityDataPoint: { dataPointName: { contains: q, mode: "insensitive" } } },
      { site: { name: { contains: q, mode: "insensitive" } } },
      { supplierName: { contains: q, mode: "insensitive" } },
    ];
  }

  return where;
}

function buildOrderBy(sort: EntriesSortField = "period", dir: EntriesSortDir = "desc"): Prisma.ActivityEntryOrderByWithRelationInput {
  if (sort === "enteredAt") return { enteredAt: dir };
  return { periodStart: dir };
}

export async function listActivityEntries(query: EntriesExplorerQuery) {
  const page = Math.max(1, query.page ?? 1);
  const where = buildWhere(query);
  const orderBy = buildOrderBy(query.sort, query.dir);

  const [rows, total] = await Promise.all([
    prisma.activityEntry.findMany({
      where,
      orderBy,
      skip: (page - 1) * ENTRIES_PAGE_SIZE,
      take: ENTRIES_PAGE_SIZE,
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        rawValue: true,
        rawUnit: true,
        status: true,
        dataOrigin: true,
        dataQualityTier: true,
        supplierName: true,
        enteredAt: true,
        sourceDocumentId: true,
        activityDataPoint: { select: { code: true, dataPointName: true, scope: true, scope3Category: true } },
        site: { select: { id: true, name: true, entity: { select: { id: true, name: true } } } },
        enteredBy: { select: { name: true } },
        calculations: { select: { id: true, resultKgCo2e: true, basis: true } },
      },
    }),
    prisma.activityEntry.count({ where }),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      rawValue: Number(r.rawValue),
      rawUnit: r.rawUnit,
      status: r.status,
      dataOrigin: r.dataOrigin,
      dataQualityTier: r.dataQualityTier,
      supplierName: r.supplierName,
      enteredAt: r.enteredAt,
      enteredByName: r.enteredBy.name,
      sourceDocumentId: r.sourceDocumentId,
      dataPointCode: r.activityDataPoint.code,
      dataPointName: r.activityDataPoint.dataPointName,
      scope: r.activityDataPoint.scope,
      scope3Category: r.activityDataPoint.scope3Category,
      siteId: r.site.id,
      siteName: r.site.name,
      entityId: r.site.entity.id,
      entityName: r.site.entity.name,
      // Scope 2 electricity produces two Calculation rows (location- and
      // market-based) from one entry — summing both here would double an
      // entry's headline figure, so the explorer shows the primary
      // (non-market-based) result, matching how every other single-figure
      // summary in this app already treats the pair (see report-service.ts).
      calculationId: r.calculations.find((c) => c.basis !== "MARKET_BASED")?.id ?? r.calculations[0]?.id ?? null,
      resultKgCo2e: r.calculations.find((c) => c.basis !== "MARKET_BASED")
        ? Number(r.calculations.find((c) => c.basis !== "MARKET_BASED")!.resultKgCo2e)
        : (r.calculations[0] ? Number(r.calculations[0].resultKgCo2e) : null),
      calculationCount: r.calculations.length,
    })),
    total,
    page,
    pageSize: ENTRIES_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / ENTRIES_PAGE_SIZE)),
  };
}

export type ActivityEntryListRow = Awaited<ReturnType<typeof listActivityEntries>>["rows"][number];

/** Site/entity options for the filter dropdown, matching the pattern used elsewhere (e.g. documents/page.tsx). */
export async function listFilterableSites() {
  return prisma.site.findMany({
    where: { isActive: true },
    select: { id: true, name: true, entity: { select: { id: true, name: true } } },
    orderBy: [{ entity: { name: "asc" } }, { name: "asc" }],
  });
}

/**
 * Single-entry detail for the explorer's record page. Used for entries with
 * no Calculation yet (AWAITING_FACTOR) — an entry *with* a calculation opens
 * the existing, more detailed /calculations/[id] explainability page
 * instead (see the explorer page's row-link logic).
 */
export async function getActivityEntryDetail(id: string) {
  return prisma.activityEntry.findUnique({
    where: { id },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      rawValue: true,
      rawUnit: true,
      canonicalValue: true,
      canonicalUnit: true,
      status: true,
      dataOrigin: true,
      dataQualityTier: true,
      supplierName: true,
      notes: true,
      plausibilityFlagged: true,
      plausibilityReason: true,
      enteredAt: true,
      sourceDocumentId: true,
      enteredBy: { select: { name: true } },
      activityDataPoint: { select: { code: true, dataPointName: true, scope: true } },
      site: { select: { id: true, name: true, entity: { select: { name: true } } } },
      factorOption: { select: { label: true } },
      calculations: { select: { id: true } },
      sourceDocument: { select: { id: true, filename: true } },
    },
  });
}

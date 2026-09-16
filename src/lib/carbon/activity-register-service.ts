import type { Prisma } from "@prisma/client";
import { EntryStatus, ReportingPeriodState, Scope } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatFactorSource } from "@/lib/format";
import type { OrganisationContext } from "@/lib/organisation/context";
import { hasPermission } from "@/lib/rbac/authorize";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import {
  accessibleActivityEntryFilter,
  accessibleSiteFilter,
  auditActorFor,
  toTenantRepositoryContext,
} from "@/lib/repositories/carbon-repository";
import { lockActivityEntry } from "@/lib/repositories/row-locks";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { assertPeriodAllowsMutation } from "./reporting-period-guard";

/**
 * Phase 4-iii-b: the Activity Data Register — the one screen that answers
 * "what activity data has been entered?".
 *
 * It owns no accounting rule of its own. Visibility comes from the existing
 * tenant/site filters, the open/closed rule comes from the Phase 4-ii guard
 * (in SQL, inside the same transaction as the write), and every mutation
 * commits with the audit event that records it. What this module adds is one
 * honest answer to "can this record be changed?", shared by the UI that draws
 * the buttons and the server actions that enforce them — so a button can
 * never promise something the server will refuse for a different reason.
 */

/** Rows per page. Server-side — the register never loads an organisation's whole history. */
export const REGISTER_PAGE_SIZE = 25;

/** The register's own vocabulary is the real one: EntryStatus, plus the period overlay. */
export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  SUBMITTED: "Submitted",
  FLAGGED: "Flagged for review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  AWAITING_FACTOR: "Awaiting emission factor",
};

export const ENTRY_STATUS_TONE: Record<EntryStatus, "neutral" | "success" | "warning" | "danger" | "info"> = {
  SUBMITTED: "info",
  FLAGGED: "danger",
  APPROVED: "success",
  REJECTED: "neutral",
  AWAITING_FACTOR: "warning",
};

export const SCOPE_LABEL: Record<Scope, string> = {
  SCOPE_1: "Scope 1",
  SCOPE_2: "Scope 2",
  SCOPE_3: "Scope 3",
};

/**
 * Why a record cannot be changed. Each one is a real, separate condition with
 * its own sentence — never collapsed into a single "not allowed".
 */
export type MutationBlocker =
  | "closed_period"
  | "calculated"
  | "referenced"
  | "permission";

export interface Mutability {
  canEditNotes: boolean;
  canDelete: boolean;
  /** Why deletion is unavailable, most specific first. Empty when it is available. */
  deleteBlockers: MutationBlocker[];
  editBlockers: MutationBlocker[];
}

export const BLOCKER_MESSAGE: Record<MutationBlocker, string> = {
  closed_period:
    "This reporting period is closed. Reopen the period before changing accounting data.",
  calculated:
    "This activity has produced an emissions figure. Deleting it would remove accounting history that reports already rely on, so the record is kept.",
  referenced:
    "This activity is cited by other records — a product assessment, a commuting survey or a source review. Deleting it would break those references, so the record is kept.",
  permission:
    "You do not have permission to change activity data. Ask an administrator for the relevant carbon grant.",
};

/** Reference counts that make a record historically important. */
export interface RecordReferences {
  calculations: number;
  lcaLinks: number;
  commutingSurvey: boolean;
  sourceReviews: number;
  reportSnapshots: number;
}

/**
 * The single safety decision, used to draw the buttons AND re-checked inside
 * each server action. Notes are annotation, not accounting: they are absent
 * from the obligation fingerprint and from every calculation, so they stay
 * editable while a period is open even once a figure exists. Quantity, unit
 * and factor are never editable here — restating a figure that reports have
 * already used is Phase 4-iv, not this register.
 */
export function describeMutability(
  context: OrganisationContext,
  periodState: "OPEN" | "CLOSED",
  references: RecordReferences,
): Mutability {
  const canReview = hasPermission(context, "carbon.entry.review");
  const canApprove = hasPermission(context, "carbon.entry.approve");
  const closed = periodState === "CLOSED";

  const editBlockers: MutationBlocker[] = [];
  if (closed) editBlockers.push("closed_period");
  if (!canReview) editBlockers.push("permission");

  const deleteBlockers: MutationBlocker[] = [];
  if (closed) deleteBlockers.push("closed_period");
  if (references.calculations > 0) deleteBlockers.push("calculated");
  if (references.lcaLinks > 0 || references.commutingSurvey || references.sourceReviews > 0) {
    deleteBlockers.push("referenced");
  }
  if (!canApprove) deleteBlockers.push("permission");

  return {
    canEditNotes: editBlockers.length === 0,
    canDelete: deleteBlockers.length === 0,
    deleteBlockers,
    editBlockers,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface ActivityRegisterFilters {
  siteId?: string;
  from?: Date;
  to?: Date;
  status?: EntryStatus;
  scope?: Scope;
  activityDataPointId?: string;
  /** Free text over the human-readable fields an entry actually has. */
  q?: string;
  page?: number;
}

export interface ActivityRegisterRow {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  code: string;
  dataPointName: string;
  scope: Scope;
  scope3Category: string | null;
  optionLabel: string | null;
  organisationName: string;
  siteName: string;
  entityName: string;
  rawValue: number;
  rawUnit: string;
  status: EntryStatus;
  plausibilityFlagged: boolean;
  calculationCount: number;
  resultKgCo2e: number | null;
  updatedAt: Date;
  periodState: "OPEN" | "CLOSED";
}

export interface ActivityRegisterPage {
  rows: ActivityRegisterRow[];
  total: number;
  page: number;
  pageCount: number;
}

/** UTC month floor — the same month key ReportingPeriod is stored under. */
function monthStartOf(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthKey(siteId: string, monthStart: Date): string {
  return `${siteId}:${monthStart.toISOString()}`;
}

function registerWhere(
  context: OrganisationContext,
  filters: ActivityRegisterFilters,
): Prisma.ActivityEntryWhereInput {
  const ctx = toTenantRepositoryContext(context);
  const where: Prisma.ActivityEntryWhereInput = tenantWhere(ctx, accessibleActivityEntryFilter(context));

  if (filters.siteId) where.siteId = filters.siteId;
  if (filters.status) where.status = filters.status;
  if (filters.activityDataPointId) where.activityDataPointId = filters.activityDataPointId;
  if (filters.from || filters.to) {
    where.periodStart = { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) };
  }
  if (filters.scope) where.activityDataPoint = { scope: filters.scope };

  const q = filters.q?.trim();
  if (q) {
    const contains = { contains: q, mode: "insensitive" as const };
    where.OR = [
      { notes: contains },
      { supplierName: contains },
      { rawUnit: contains },
      { site: { name: contains } },
      { site: { entity: { name: contains } } },
      { factorOption: { label: contains } },
      { activityDataPoint: { dataPointName: contains } },
      { activityDataPoint: { code: contains } },
      { activityDataPoint: { category: contains } },
    ];
  }
  return where;
}

/**
 * One page of the register. Period state is resolved in a single extra query
 * over the distinct site/month pairs on the page, not once per row — a
 * missing ReportingPeriod row means OPEN, exactly as the schema defines it.
 */
export async function listActivityRegister(
  context: OrganisationContext,
  filters: ActivityRegisterFilters = {},
): Promise<ActivityRegisterPage> {
  const where = registerWhere(context, filters);
  const page = Math.max(1, Math.trunc(filters.page ?? 1));

  const [total, entries] = await Promise.all([
    prisma.activityEntry.count({ where }),
    prisma.activityEntry.findMany({
      where,
      orderBy: [{ periodStart: "desc" }, { enteredAt: "desc" }],
      skip: (page - 1) * REGISTER_PAGE_SIZE,
      take: REGISTER_PAGE_SIZE,
      include: {
        organisation: { select: { name: true } },
        site: { select: { name: true, entity: { select: { name: true } } } },
        activityDataPoint: { select: { code: true, dataPointName: true, scope: true, scope3Category: true } },
        factorOption: { select: { label: true } },
        calculations: { select: { resultKgCo2e: true } },
      },
    }),
  ]);

  const periodStates = await resolvePeriodStates(
    context,
    entries.map((entry) => ({ siteId: entry.siteId, periodStart: entry.periodStart })),
  );

  return {
    rows: entries.map((entry) => ({
      id: entry.id,
      periodStart: entry.periodStart,
      periodEnd: entry.periodEnd,
      code: entry.activityDataPoint.code,
      dataPointName: entry.activityDataPoint.dataPointName,
      scope: entry.activityDataPoint.scope,
      scope3Category: entry.activityDataPoint.scope3Category,
      optionLabel: entry.factorOption?.label ?? null,
      organisationName: entry.organisation.name,
      siteName: entry.site.name,
      entityName: entry.site.entity.name,
      rawValue: Number(entry.rawValue),
      rawUnit: entry.rawUnit,
      status: entry.status,
      plausibilityFlagged: entry.plausibilityFlagged,
      calculationCount: entry.calculations.length,
      resultKgCo2e:
        entry.calculations.length === 0
          ? null
          : entry.calculations.reduce((sum, calc) => sum + Number(calc.resultKgCo2e), 0),
      updatedAt: entry.updatedAt,
      periodState: periodStates.get(monthKey(entry.siteId, monthStartOf(entry.periodStart))) ?? "OPEN",
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / REGISTER_PAGE_SIZE)),
  };
}

async function resolvePeriodStates(
  context: OrganisationContext,
  rows: { siteId: string; periodStart: Date }[],
): Promise<Map<string, "OPEN" | "CLOSED">> {
  if (rows.length === 0) return new Map();
  const ctx = toTenantRepositoryContext(context);
  const months = [...new Set(rows.map((row) => monthStartOf(row.periodStart).toISOString()))].map((iso) => new Date(iso));
  const siteIds = [...new Set(rows.map((row) => row.siteId))];

  // Only CLOSED rows matter: every month without a row is open by definition.
  const closed = await prisma.reportingPeriod.findMany({
    where: tenantWhere(ctx, {
      siteId: { in: siteIds },
      monthStart: { in: months },
      state: ReportingPeriodState.CLOSED,
    }),
    select: { siteId: true, monthStart: true },
  });
  return new Map(closed.map((row) => [monthKey(row.siteId, monthStartOf(row.monthStart)), "CLOSED" as const]));
}

export interface ActivityRecordDetail {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  code: string;
  dataPointName: string;
  category: string;
  scope: Scope;
  scope3Category: string | null;
  optionLabel: string | null;
  organisationName: string;
  siteId: string;
  siteName: string;
  entityName: string;
  rawValue: number;
  rawUnit: string;
  canonicalValue: number;
  canonicalUnit: string;
  supplierName: string | null;
  notes: string | null;
  status: EntryStatus;
  dataQualityTier: string;
  dataOrigin: string;
  plausibilityFlagged: boolean;
  plausibilityReason: string | null;
  enteredByName: string | null;
  enteredAt: Date;
  updatedAt: Date;
  sourceDocumentId: string | null;
  sourceDocumentName: string | null;
  calculations: {
    id: string;
    basis: string;
    scope: Scope;
    resultKgCo2e: number;
    factorValue: number;
    factorUnit: string;
    factorSource: string;
    factorVintage: string;
    calculatedAt: Date;
  }[];
  references: RecordReferences;
  periodState: "OPEN" | "CLOSED";
}

/**
 * One record, or null when it is not this tenant's or not in the caller's
 * site scope — the register never reveals that an out-of-scope id exists.
 */
export async function getActivityRecord(
  context: OrganisationContext,
  entryId: string,
): Promise<ActivityRecordDetail | null> {
  const ctx = toTenantRepositoryContext(context);
  const entry = await prisma.activityEntry.findFirst({
    where: tenantWhere(ctx, { id: entryId, ...accessibleActivityEntryFilter(context) }),
    include: {
      organisation: { select: { name: true } },
      site: { select: { name: true, entity: { select: { name: true } } } },
      activityDataPoint: {
        select: { code: true, dataPointName: true, category: true, scope: true, scope3Category: true },
      },
      factorOption: { select: { label: true } },
      enteredBy: { select: { name: true } },
      sourceDocument: { select: { id: true, filename: true } },
      calculations: {
        orderBy: { calculatedAt: "asc" },
        select: {
          id: true,
          basis: true,
          scope: true,
          resultKgCo2e: true,
          factorValueSnapshot: true,
          factorUnitSnapshot: true,
          factorSourceSnapshot: true,
          factorVintageSnapshot: true,
          calculatedAt: true,
        },
      },
      _count: { select: { lcaCorporateDataLinks: true, carbonSourcePeriodObligations: true } },
      commutingSurveyResponse: { select: { id: true } },
    },
  });
  if (!entry) return null;

  const reportSnapshots =
    entry.calculations.length === 0
      ? 0
      : await prisma.reportSnapshotCalculation.count({
          where: { calculationId: { in: entry.calculations.map((calc) => calc.id) } },
        });

  const periodState =
    (await resolvePeriodStates(context, [{ siteId: entry.siteId, periodStart: entry.periodStart }])).get(
      monthKey(entry.siteId, monthStartOf(entry.periodStart)),
    ) ?? "OPEN";

  return {
    id: entry.id,
    periodStart: entry.periodStart,
    periodEnd: entry.periodEnd,
    code: entry.activityDataPoint.code,
    dataPointName: entry.activityDataPoint.dataPointName,
    category: entry.activityDataPoint.category,
    scope: entry.activityDataPoint.scope,
    scope3Category: entry.activityDataPoint.scope3Category,
    optionLabel: entry.factorOption?.label ?? null,
    organisationName: entry.organisation.name,
    siteId: entry.siteId,
    siteName: entry.site.name,
    entityName: entry.site.entity.name,
    rawValue: Number(entry.rawValue),
    rawUnit: entry.rawUnit,
    canonicalValue: Number(entry.canonicalValue),
    canonicalUnit: entry.canonicalUnit,
    supplierName: entry.supplierName,
    notes: entry.notes,
    status: entry.status,
    dataQualityTier: entry.dataQualityTier,
    dataOrigin: entry.dataOrigin,
    plausibilityFlagged: entry.plausibilityFlagged,
    plausibilityReason: entry.plausibilityReason,
    enteredByName: entry.enteredBy?.name ?? null,
    enteredAt: entry.enteredAt,
    updatedAt: entry.updatedAt,
    sourceDocumentId: entry.sourceDocument?.id ?? null,
    sourceDocumentName: entry.sourceDocument?.filename ?? null,
    calculations: entry.calculations.map((calc) => ({
      id: calc.id,
      basis: calc.basis,
      scope: calc.scope,
      resultKgCo2e: Number(calc.resultKgCo2e),
      factorValue: Number(calc.factorValueSnapshot),
      factorUnit: calc.factorUnitSnapshot,
      factorSource: formatFactorSource(calc.factorSourceSnapshot),
      factorVintage: calc.factorVintageSnapshot,
      calculatedAt: calc.calculatedAt,
    })),
    references: {
      calculations: entry.calculations.length,
      lcaLinks: entry._count.lcaCorporateDataLinks,
      commutingSurvey: entry.commutingSurveyResponse !== null,
      sourceReviews: entry._count.carbonSourcePeriodObligations,
      reportSnapshots,
    },
    periodState,
  };
}

/** Sites and sources the filter dropdowns offer — only what the caller can actually see. */
export async function getRegisterFilterOptions(context: OrganisationContext) {
  const ctx = toTenantRepositoryContext(context);
  const [sites, dataPoints] = await Promise.all([
    prisma.site.findMany({
      where: tenantWhere(ctx, { isActive: true, ...accessibleSiteFilter(context) }),
      select: { id: true, name: true, entity: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.activityDataPoint.findMany({
      select: { id: true, code: true, dataPointName: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    }),
  ]);
  return {
    sites: sites.map((site) => ({ id: site.id, label: `${site.entity.name} — ${site.name}` })),
    dataPoints: dataPoints.map((point) => ({ id: point.id, label: `${point.code} — ${point.dataPointName}` })),
  };
}

// ---------------------------------------------------------------------------
// Writing — always through the Phase 4-ii guard, always with its audit event
// ---------------------------------------------------------------------------

export class ActivityRecordNotFoundError extends Error {}
export class ActivityRecordProtectedError extends Error {
  constructor(readonly blockers: MutationBlocker[]) {
    super(blockers.map((blocker) => BLOCKER_MESSAGE[blocker]).join(" "));
    this.name = "ActivityRecordProtectedError";
  }
}

/**
 * Re-reads the record's references inside the transaction, so a decision made
 * when the page was drawn cannot authorise a delete that became unsafe since —
 * a calculation that finished, or a product assessment that started citing it.
 */
async function currentReferences(
  tx: Prisma.TransactionClient,
  entryId: string,
): Promise<RecordReferences> {
  const [calculations, lcaLinks, commutingSurvey, sourceReviews] = await Promise.all([
    tx.calculation.count({ where: { activityEntryId: entryId } }),
    tx.lcaCorporateDataLink.count({ where: { activityEntryId: entryId } }),
    tx.commutingSurveyResponse.count({ where: { activityEntryId: entryId } }),
    tx.carbonSourcePeriodObligation.count({ where: { submittedActivityEntryId: entryId } }),
  ]);
  return { calculations, lcaLinks, commutingSurvey: commutingSurvey > 0, sourceReviews, reportSnapshots: 0 };
}

/**
 * Annotation only. The quantity, unit and factor of an entry are deliberately
 * not editable: once a figure exists, changing its inputs is a restatement,
 * which Phase 4-iv owns. Notes carry no figure, so correcting or explaining
 * one stays available while the period is open.
 */
export async function updateActivityEntryNotes(
  context: OrganisationContext,
  entryId: string,
  notes: string,
): Promise<void> {
  const ctx = toTenantRepositoryContext(context);
  if (!hasPermission(context, "carbon.entry.review")) {
    throw new ActivityRecordProtectedError(["permission"]);
  }
  const trimmed = notes.trim();

  await prisma.$transaction(async (tx) => {
    await lockActivityEntry(tx, ctx, entryId);
    const entry = await tx.activityEntry.findFirst({
      where: tenantWhere(ctx, { id: entryId, ...accessibleActivityEntryFilter(context) }),
    });
    if (!entry) throw new ActivityRecordNotFoundError("Activity record not found");

    // The barrier, not the rendered page, decides whether this month is open.
    await assertPeriodAllowsMutation(tx, ctx, entry.siteId, entry.periodStart);

    await tx.activityEntry.update({
      where: { id: entry.id, organisationId: ctx.organisationId },
      data: { notes: trimmed || null },
    });

    await recordAuditEvent(tx, ctx, {
      eventType: "activity_entry.updated",
      resourceType: "activity_entry",
      resourceId: entry.id,
      summary: `Activity entry notes updated for ${entryId}`,
      ...auditActorFor(ctx),
      correlationId: ctx.correlationId,
      before: { notes: entry.notes },
      after: { notes: trimmed || null },
    });
  });
}

/**
 * Hard delete, and only where the record genuinely carries no accounting
 * history: no calculation, no product-assessment citation, no commuting
 * survey response, no source review. Anything else is preserved and explained
 * rather than destroyed — this register does not void or supersede, because
 * the platform has no such mechanism yet (Phase 4-iv).
 */
export async function deleteActivityEntry(
  context: OrganisationContext,
  entryId: string,
): Promise<{ code: string; siteName: string }> {
  const ctx = toTenantRepositoryContext(context);
  if (!hasPermission(context, "carbon.entry.approve")) {
    throw new ActivityRecordProtectedError(["permission"]);
  }

  return prisma.$transaction(async (tx) => {
    await lockActivityEntry(tx, ctx, entryId);
    const entry = await tx.activityEntry.findFirst({
      where: tenantWhere(ctx, { id: entryId, ...accessibleActivityEntryFilter(context) }),
      include: {
        activityDataPoint: { select: { code: true } },
        site: { select: { name: true } },
      },
    });
    if (!entry) throw new ActivityRecordNotFoundError("Activity record not found");

    // Closed-period first: it is the answer the user most needs to hear, and
    // the SQL barrier would refuse the delete regardless of what follows.
    await assertPeriodAllowsMutation(tx, ctx, entry.siteId, entry.periodStart);

    const references = await currentReferences(tx, entryId);
    const blockers: MutationBlocker[] = [];
    if (references.calculations > 0) blockers.push("calculated");
    if (references.lcaLinks > 0 || references.commutingSurvey || references.sourceReviews > 0) {
      blockers.push("referenced");
    }
    if (blockers.length > 0) throw new ActivityRecordProtectedError(blockers);

    await recordAuditEvent(tx, ctx, {
      eventType: "activity_entry.deleted",
      resourceType: "activity_entry",
      resourceId: entry.id,
      summary: `Activity entry deleted for ${entry.activityDataPoint.code} at ${entry.site.name}`,
      ...auditActorFor(ctx),
      correlationId: ctx.correlationId,
      before: {
        activityDataPointCode: entry.activityDataPoint.code,
        siteId: entry.siteId,
        periodStart: entry.periodStart.toISOString(),
        periodEnd: entry.periodEnd.toISOString(),
        canonicalValue: entry.canonicalValue.toString(),
        canonicalUnit: entry.canonicalUnit,
        status: entry.status,
      },
      after: null,
    });

    await tx.activityEntry.delete({ where: { id: entry.id, organisationId: ctx.organisationId } });

    return { code: entry.activityDataPoint.code, siteName: entry.site.name };
  });
}

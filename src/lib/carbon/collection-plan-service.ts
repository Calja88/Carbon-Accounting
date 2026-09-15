/**
 * Phase 2B-i (Carbon Product Reset) — the data-collection plan: which carbon
 * data each site is expected to supply for which period, generated from the
 * Phase 2A `OrganisationSourceConfig` layer.
 *
 * Why a separate table from `CarbonSourcePeriodObligation`: that model is
 * keyed by a free-text `sourceKey` plus a `YYYY-MM` string, its rows are
 * counted un-filtered as the dashboard's coverage denominator
 * (`computeCoverageWindow`), and it cannot express a quarter or a year.
 * Generating into it would have halved an existing fixture's reported
 * completeness without one figure of underlying data changing. Nothing in
 * this module reads, writes or alters that model, the coverage logic, the
 * carbon arithmetic, factor resolution order, Scope 2 methodology or report
 * snapshots.
 *
 * Only the human DECISION is stored (`PENDING`/`REVIEWED`/`EXCLUDED`).
 * "missing", "submitted", "awaiting factor" and "changed since review" are
 * derived on every read from the live `ActivityEntry`/`Calculation` rows, so
 * this table can never drift into claiming something the data no longer
 * supports.
 */

import { createHash } from "node:crypto";
import { CarbonCollectionDecision, CarbonSourceFrequency, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, assertSiteAccess } from "@/lib/rbac/authorize";
import { requireCarbonView } from "@/lib/rbac/carbon-access";
import {
  accessibleSiteFilter,
  requireSiteInScope,
  toTenantRepositoryContext,
} from "@/lib/repositories/carbon-repository";
import { tenantWhere, assertOwned, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import type { TenantRepositoryContext } from "@/lib/repositories/context";

export { TenantOwnershipError, CarbonCollectionDecision };

/** A well-formed request the current state cannot satisfy — never a missing permission, never a foreign tenant. */
export class CollectionPlanError extends Error {}

/** Generating and reviewing a collection plan is the same authority as reviewing a submission. */
export const COLLECTION_MANAGE_PERMISSION = "carbon.entry.review" as const;
/** Excluding data from the expected set is a higher grant, mirroring `excludeSourcePeriodObligation`. */
export const COLLECTION_EXCLUDE_PERMISSION = "carbon.entry.approve" as const;

export function canManageCollectionPlan(context: OrganisationContext): boolean {
  return context.permissions.has(COLLECTION_MANAGE_PERMISSION);
}
export function canExcludeCollectionRequirement(context: OrganisationContext): boolean {
  return context.permissions.has(COLLECTION_EXCLUDE_PERMISSION);
}

type Db = Prisma.TransactionClient;
/** A full client (not a transaction client): the write paths open their own tenant transaction. */
type WriteDb = typeof prisma;

/** Entry statuses that are not a usable submission for collection purposes. */
const AWAITING_ENTRY_STATUSES = new Set(["AWAITING_FACTOR"]);
/** A rejected submission is not data the organisation stands behind, so the requirement stays missing. */
const REJECTED_ENTRY_STATUSES = new Set(["REJECTED"]);

// ---------------------------------------------------------------------------
// Period enumeration (pure)
// ---------------------------------------------------------------------------

export interface CollectionPeriod {
  periodKey: string;
  periodStart: Date;
  periodEnd: Date;
  periodKind: CarbonSourceFrequency;
}

function utcMonthStart(year: number, monthIndex: number): Date {
  return new Date(Date.UTC(year, monthIndex, 1));
}
/** Last day of the month, inclusive — the same convention as report-period.ts. */
function utcMonthEnd(year: number, monthIndex: number): Date {
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}

/**
 * Every period of `kind` overlapping the window. A partially covered quarter
 * or year still counts: the data for it is still expected.
 *
 * Periods that have not started yet are excluded — a requirement for a future
 * period would read as permanently "missing" and imply someone is late when
 * nobody is.
 */
export function enumeratePeriods(
  kind: CarbonSourceFrequency,
  windowStart: Date,
  windowEnd: Date,
  now: Date = new Date(),
): CollectionPeriod[] {
  if (kind === CarbonSourceFrequency.AD_HOC) return [];
  if (windowEnd < windowStart) return [];

  const periods: CollectionPeriod[] = [];
  const startYear = windowStart.getUTCFullYear();
  const endYear = windowEnd.getUTCFullYear();

  for (let year = startYear; year <= endYear; year += 1) {
    if (kind === CarbonSourceFrequency.ANNUAL) {
      periods.push({
        periodKey: `${year}`,
        periodStart: utcMonthStart(year, 0),
        periodEnd: utcMonthEnd(year, 11),
        periodKind: kind,
      });
      continue;
    }
    if (kind === CarbonSourceFrequency.QUARTERLY) {
      for (let quarter = 0; quarter < 4; quarter += 1) {
        periods.push({
          periodKey: `${year}-Q${quarter + 1}`,
          periodStart: utcMonthStart(year, quarter * 3),
          periodEnd: utcMonthEnd(year, quarter * 3 + 2),
          periodKind: kind,
        });
      }
      continue;
    }
    for (let month = 0; month < 12; month += 1) {
      periods.push({
        periodKey: `${year}-${String(month + 1).padStart(2, "0")}`,
        periodStart: utcMonthStart(year, month),
        periodEnd: utcMonthEnd(year, month),
        periodKind: kind,
      });
    }
  }

  return periods.filter(
    (period) =>
      period.periodEnd >= windowStart && // overlaps the window
      period.periodStart <= windowEnd &&
      period.periodStart <= now, // has actually begun
  );
}

// ---------------------------------------------------------------------------
// Status derivation (pure)
// ---------------------------------------------------------------------------

export type CollectionStatus =
  | "not_required"
  | "missing"
  | "submitted"
  | "awaiting_factor"
  | "reviewed"
  | "excluded"
  | "changed_since_review";

export interface MatchedEntry {
  id: string;
  status: string;
  canonicalValue: Prisma.Decimal | string;
  canonicalUnit: string;
}
export interface MatchedCalculation {
  id: string;
  basis: string;
  resultKgCo2e: Prisma.Decimal | string;
}

export interface DeriveStatusInput {
  requirement: { decision: CarbonCollectionDecision; reviewFingerprint: string | null } | null;
  /** Whether an enabled OrganisationSourceConfig still covers this site + source. */
  hasEnabledConfig: boolean;
  entries: MatchedEntry[];
  calculationsByEntryId: Map<string, MatchedCalculation[]>;
}

/**
 * The single place a collection cell's status is decided. Pure and
 * synchronous: it issues no queries, so it is exhaustively testable against
 * every combination without a database.
 */
export function deriveCollectionStatus(input: DeriveStatusInput): CollectionStatus {
  const { requirement, hasEnabledConfig, entries, calculationsByEntryId } = input;
  if (!requirement) return hasEnabledConfig ? "missing" : "not_required";
  if (requirement.decision === CarbonCollectionDecision.EXCLUDED) return "excluded";

  const usable = entries.filter((entry) => !REJECTED_ENTRY_STATUSES.has(entry.status));

  if (requirement.decision === CarbonCollectionDecision.REVIEWED) {
    // The decision column alone is never trusted as current truth: if the
    // submission or its calculations changed after the review, the recorded
    // fingerprint no longer matches and the cell must ask for review again.
    const fresh = usable.length > 0 ? computeCollectionFingerprint(usable, calculationsByEntryId) : null;
    return fresh !== null && fresh === requirement.reviewFingerprint ? "reviewed" : "changed_since_review";
  }

  if (usable.length === 0) return "missing";
  const awaiting = usable.some(
    (entry) => AWAITING_ENTRY_STATUSES.has(entry.status) || (calculationsByEntryId.get(entry.id) ?? []).length === 0,
  );
  return awaiting ? "awaiting_factor" : "submitted";
}

/**
 * Canonical fingerprint of everything a review covered: each matched entry's
 * value/unit plus every contributing calculation, sorted so it never depends
 * on query ordering. A quarterly or annual requirement is satisfied by
 * several entries, so this covers the whole set — unlike
 * `computeReviewFingerprint`, which fingerprints a single obligation's single
 * submission and is left untouched by Phase 2B.
 */
export function computeCollectionFingerprint(
  entries: MatchedEntry[],
  calculationsByEntryId: Map<string, MatchedCalculation[]>,
): string {
  const parts = entries
    .map((entry) => {
      const calcs = (calculationsByEntryId.get(entry.id) ?? [])
        .map((calc) => `calc:${calc.id}:${calc.basis}:${calc.resultKgCo2e.toString()}`)
        .sort();
      return [`entry:${entry.id}:${entry.canonicalValue.toString()}:${entry.canonicalUnit}`, ...calcs].join("|");
    })
    .sort();
  return createHash("sha256").update(parts.join("||")).digest("hex");
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface GenerateCollectionPlanInput {
  periodStart: Date;
  periodEnd: Date;
  siteId?: string;
}

export interface GenerateCollectionPlanResult {
  created: number;
  alreadyPresent: number;
  skippedAdHoc: number;
}

/**
 * Creates any missing requirements for the window from the organisation's
 * enabled source configurations.
 *
 * Idempotency is structural rather than conditional: this path only ever
 * INSERTs (`skipDuplicates`), and contains no update branch at all, so a
 * rerun cannot overwrite a recorded REVIEWED or EXCLUDED decision even by
 * accident.
 */
export async function generateCollectionPlan(
  context: OrganisationContext,
  input: GenerateCollectionPlanInput,
  db: WriteDb = prisma,
  now: Date = new Date(),
): Promise<GenerateCollectionPlanResult> {
  requirePermission(context, COLLECTION_MANAGE_PERMISSION);
  if (input.siteId) await requireSiteInScope(context, input.siteId, db);
  const ctx = toTenantRepositoryContext(context);

  const configs = await db.organisationSourceConfig.findMany({
    where: tenantWhere(ctx, {
      enabled: true,
      ...(input.siteId ? { siteId: input.siteId } : {}),
      site: { ...accessibleSiteFilter(context) },
    }),
    select: { id: true, siteId: true, activityDataPointId: true, frequency: true, effectiveFrom: true },
  });

  let skippedAdHoc = 0;
  const rows: Prisma.CarbonCollectionRequirementCreateManyInput[] = [];
  for (const config of configs) {
    if (config.frequency === CarbonSourceFrequency.AD_HOC) {
      skippedAdHoc += 1;
      continue;
    }
    for (const period of enumeratePeriods(config.frequency, input.periodStart, input.periodEnd, now)) {
      // Never ask for data from before this source applied to the site.
      if (period.periodEnd < config.effectiveFrom) continue;
      rows.push({
        organisationId: ctx.organisationId,
        siteId: config.siteId,
        activityDataPointId: config.activityDataPointId,
        sourceConfigId: config.id,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        periodKey: period.periodKey,
        periodKind: period.periodKind,
      });
    }
  }

  if (rows.length === 0) return { created: 0, alreadyPresent: 0, skippedAdHoc };

  return runInTenantTransaction(ctx, db, async (tx: Db, txCtx: TenantRepositoryContext) => {
    const inserted = await tx.carbonCollectionRequirement.createMany({ data: rows, skipDuplicates: true });

    // One audit event for the whole run, never one per row: recordAuditEvent
    // takes an organisation-row lock to serialise the hash chain, and a few
    // hundred chained events would serialise badly and bury the log.
    await recordAuditEvent(tx, txCtx, {
      eventType: "carbon_collection_requirement.generated",
      resourceType: "carbon_collection_requirement",
      resourceId: `${txCtx.organisationId}:${input.periodStart.toISOString().slice(0, 10)}:${input.periodEnd.toISOString().slice(0, 10)}`,
      summary: `Generated carbon collection plan: ${inserted.count} new of ${rows.length} required for ${input.periodStart.toISOString().slice(0, 10)}..${input.periodEnd.toISOString().slice(0, 10)}${input.siteId ? ` (site ${input.siteId})` : ""}`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
    });

    return { created: inserted.count, alreadyPresent: rows.length - inserted.count, skippedAdHoc };
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface CollectionMatrixRow {
  id: string;
  siteId: string;
  activityDataPointId: string;
  periodKey: string;
  periodStart: Date;
  periodEnd: Date;
  periodKind: CarbonSourceFrequency;
  decision: CarbonCollectionDecision;
  status: CollectionStatus;
  entryIds: string[];
  excludedReason: string | null;
  /** True while the period has begun but not finished — nobody is late yet. */
  periodOpen: boolean;
}

export interface GetCollectionMatrixInput {
  periodStart: Date;
  periodEnd: Date;
  siteId?: string;
}

/**
 * Every requirement overlapping the window, with its status derived from the
 * live submissions. Reads only; it never writes a status back.
 */
export async function getCollectionMatrix(
  context: OrganisationContext,
  input: GetCollectionMatrixInput,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<CollectionMatrixRow[]> {
  requireCarbonView(context);
  if (input.siteId) await requireSiteInScope(context, input.siteId, db);
  const ctx = toTenantRepositoryContext(context);

  const requirements = await db.carbonCollectionRequirement.findMany({
    where: tenantWhere(ctx, {
      periodStart: { lte: input.periodEnd },
      periodEnd: { gte: input.periodStart },
      ...(input.siteId ? { siteId: input.siteId } : {}),
      site: { ...accessibleSiteFilter(context) },
    }),
    orderBy: [{ siteId: "asc" }, { activityDataPointId: "asc" }, { periodStart: "asc" }],
  });
  if (requirements.length === 0) return [];

  const { entriesByRequirementId, calculationsByEntryId } = await loadSubmissions(ctx, context, requirements, db);

  return requirements.map((requirement) => {
    const entries = entriesByRequirementId.get(requirement.id) ?? [];
    return {
      id: requirement.id,
      siteId: requirement.siteId,
      activityDataPointId: requirement.activityDataPointId,
      periodKey: requirement.periodKey,
      periodStart: requirement.periodStart,
      periodEnd: requirement.periodEnd,
      periodKind: requirement.periodKind,
      decision: requirement.decision,
      status: deriveCollectionStatus({ requirement, hasEnabledConfig: true, entries, calculationsByEntryId }),
      entryIds: entries.map((entry) => entry.id),
      excludedReason: requirement.excludedReason,
      periodOpen: requirement.periodEnd > now,
    };
  });
}

interface RequirementKey {
  id: string;
  siteId: string;
  activityDataPointId: string;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Matches submissions to requirements by interval overlap on the same site
 * and catalogue source — never by a period string. This is what lets three
 * monthly entries satisfy one quarterly requirement.
 *
 * Batched into two queries for the whole window rather than per cell, and
 * re-scoped through `tenantWhere` + `accessibleSiteFilter` rather than
 * trusting the requirement's stored ids.
 */
async function loadSubmissions(
  ctx: TenantRepositoryContext,
  context: OrganisationContext,
  requirements: RequirementKey[],
  db: Db,
) {
  const siteIds = [...new Set(requirements.map((r) => r.siteId))];
  const dataPointIds = [...new Set(requirements.map((r) => r.activityDataPointId))];
  const windowStart = requirements.reduce((min, r) => (r.periodStart < min ? r.periodStart : min), requirements[0].periodStart);
  const windowEnd = requirements.reduce((max, r) => (r.periodEnd > max ? r.periodEnd : max), requirements[0].periodEnd);

  const entries = await db.activityEntry.findMany({
    where: tenantWhere(ctx, {
      siteId: { in: siteIds },
      activityDataPointId: { in: dataPointIds },
      periodStart: { lte: windowEnd },
      periodEnd: { gte: windowStart },
      site: { ...accessibleSiteFilter(context) },
    }),
    select: {
      id: true,
      siteId: true,
      activityDataPointId: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      canonicalValue: true,
      canonicalUnit: true,
    },
  });

  const entriesByRequirementId = new Map<string, MatchedEntry[]>();
  for (const requirement of requirements) {
    const matched = entries.filter(
      (entry) =>
        entry.siteId === requirement.siteId &&
        entry.activityDataPointId === requirement.activityDataPointId &&
        entry.periodStart <= requirement.periodEnd &&
        entry.periodEnd >= requirement.periodStart,
    );
    if (matched.length > 0) entriesByRequirementId.set(requirement.id, matched);
  }

  const matchedEntryIds = [...new Set([...entriesByRequirementId.values()].flat().map((entry) => entry.id))];
  const calculations = matchedEntryIds.length
    ? await db.calculation.findMany({
        where: tenantWhere(ctx, { activityEntryId: { in: matchedEntryIds } }),
        select: { id: true, basis: true, resultKgCo2e: true, activityEntryId: true },
      })
    : [];
  const calculationsByEntryId = new Map<string, MatchedCalculation[]>();
  for (const calc of calculations) {
    const list = calculationsByEntryId.get(calc.activityEntryId) ?? [];
    list.push(calc);
    calculationsByEntryId.set(calc.activityEntryId, list);
  }

  return { entriesByRequirementId, calculationsByEntryId };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

async function loadOwnedRequirement(tx: Db, ctx: TenantRepositoryContext, requirementId: string) {
  const requirement = await tx.carbonCollectionRequirement.findFirst({
    where: tenantWhere(ctx, { id: requirementId }),
  });
  return assertOwned(ctx, requirement);
}

/**
 * Records that a person checked this requirement's submissions. Requires a
 * usable submission with a settled result — a review is a statement about
 * real data, never a way to mark an empty cell done.
 */
export async function reviewCollectionRequirement(
  context: OrganisationContext,
  requirementId: string,
  db: WriteDb = prisma,
): Promise<{ id: string; decision: CarbonCollectionDecision }> {
  requirePermission(context, COLLECTION_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);

  return runInTenantTransaction(ctx, db, async (tx: Db, txCtx: TenantRepositoryContext) => {
    const requirement = await loadOwnedRequirement(tx, txCtx, requirementId);
    assertSiteAccess(context, requirement.siteId);
    if (requirement.decision !== CarbonCollectionDecision.PENDING) {
      throw new CollectionPlanError(`Requirement is ${requirement.decision}, not PENDING, and cannot be reviewed.`);
    }

    const { entriesByRequirementId, calculationsByEntryId } = await loadSubmissions(txCtx, context, [requirement], tx);
    const entries = (entriesByRequirementId.get(requirement.id) ?? []).filter(
      (entry) => !REJECTED_ENTRY_STATUSES.has(entry.status),
    );
    if (entries.length === 0) throw new CollectionPlanError("No submission covers this requirement yet.");
    if (entries.some((entry) => AWAITING_ENTRY_STATUSES.has(entry.status))) {
      throw new CollectionPlanError("A submission is still awaiting an emission factor and cannot be reviewed yet.");
    }
    if (entries.some((entry) => (calculationsByEntryId.get(entry.id) ?? []).length === 0)) {
      throw new CollectionPlanError("A submission has no calculated result yet.");
    }

    const reviewFingerprint = computeCollectionFingerprint(entries, calculationsByEntryId);
    // Fixed-precondition CAS: the required starting state is hardcoded, never
    // "whatever this transaction happened to read", so a concurrent duplicate
    // cannot match its own already-written value and succeed twice.
    const cas = await tx.carbonCollectionRequirement.updateMany({
      where: { id: requirement.id, organisationId: txCtx.organisationId, decision: CarbonCollectionDecision.PENDING },
      data: {
        decision: CarbonCollectionDecision.REVIEWED,
        reviewFingerprint,
        reviewedByMembershipId: context.membershipId,
        reviewedAt: new Date(),
      },
    });
    if (cas.count === 0) throw new CollectionPlanError("Requirement changed concurrently; re-check the current state.");

    await recordAuditEvent(tx, txCtx, {
      eventType: "carbon_collection_requirement.reviewed",
      resourceType: "carbon_collection_requirement",
      resourceId: requirement.id,
      summary: `Reviewed collection requirement ${requirement.siteId}/${requirement.activityDataPointId}/${requirement.periodKey} over ${entries.length} submission(s)`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
    });

    return { id: requirement.id, decision: CarbonCollectionDecision.REVIEWED };
  });
}

/** Removes a requirement from the expected set with a recorded reason — never merely because nothing was submitted. */
export async function excludeCollectionRequirement(
  context: OrganisationContext,
  requirementId: string,
  input: { reason: string },
  db: WriteDb = prisma,
): Promise<{ id: string; decision: CarbonCollectionDecision }> {
  requirePermission(context, COLLECTION_EXCLUDE_PERMISSION);
  if (!input.reason.trim()) throw new CollectionPlanError("An exclusion requires a recorded reason.");
  const ctx = toTenantRepositoryContext(context);

  return runInTenantTransaction(ctx, db, async (tx: Db, txCtx: TenantRepositoryContext) => {
    const requirement = await loadOwnedRequirement(tx, txCtx, requirementId);
    assertSiteAccess(context, requirement.siteId);
    if (requirement.decision === CarbonCollectionDecision.EXCLUDED) {
      throw new CollectionPlanError("Requirement is already excluded.");
    }

    const cas = await tx.carbonCollectionRequirement.updateMany({
      where: {
        id: requirement.id,
        organisationId: txCtx.organisationId,
        decision: { not: CarbonCollectionDecision.EXCLUDED },
      },
      data: {
        decision: CarbonCollectionDecision.EXCLUDED,
        excludedByMembershipId: context.membershipId,
        excludedAt: new Date(),
        excludedReason: input.reason,
      },
    });
    if (cas.count === 0) throw new CollectionPlanError("Requirement changed concurrently; re-check the current state.");

    await recordAuditEvent(tx, txCtx, {
      eventType: "carbon_collection_requirement.excluded",
      resourceType: "carbon_collection_requirement",
      resourceId: requirement.id,
      summary: `Excluded collection requirement ${requirement.siteId}/${requirement.activityDataPointId}/${requirement.periodKey}: ${input.reason}`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
    });

    return { id: requirement.id, decision: CarbonCollectionDecision.EXCLUDED };
  });
}

/**
 * Puts an excluded requirement back into the expected set.
 *
 * Non-destructive by design: `excludedBy`/`excludedAt`/`excludedReason` are
 * deliberately NOT cleared, so the row still shows what was excluded and why
 * after being reopened. Repeated exclude/reopen cycles keep their full
 * sequence in the hash-chained audit log; this row keeps the most recent one.
 */
export async function reopenCollectionRequirement(
  context: OrganisationContext,
  requirementId: string,
  db: WriteDb = prisma,
): Promise<{ id: string; decision: CarbonCollectionDecision }> {
  requirePermission(context, COLLECTION_EXCLUDE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);

  return runInTenantTransaction(ctx, db, async (tx: Db, txCtx: TenantRepositoryContext) => {
    const requirement = await loadOwnedRequirement(tx, txCtx, requirementId);
    assertSiteAccess(context, requirement.siteId);
    if (requirement.decision !== CarbonCollectionDecision.EXCLUDED) {
      throw new CollectionPlanError("Only an excluded requirement can be reopened.");
    }

    const cas = await tx.carbonCollectionRequirement.updateMany({
      where: { id: requirement.id, organisationId: txCtx.organisationId, decision: CarbonCollectionDecision.EXCLUDED },
      data: {
        decision: CarbonCollectionDecision.PENDING,
        reopenedByMembershipId: context.membershipId,
        reopenedAt: new Date(),
      },
    });
    if (cas.count === 0) throw new CollectionPlanError("Requirement changed concurrently; re-check the current state.");

    await recordAuditEvent(tx, txCtx, {
      eventType: "carbon_collection_requirement.reopened",
      resourceType: "carbon_collection_requirement",
      resourceId: requirement.id,
      summary: `Reopened collection requirement ${requirement.siteId}/${requirement.activityDataPointId}/${requirement.periodKey} (previously excluded: ${requirement.excludedReason ?? "no reason recorded"})`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
    });

    return { id: requirement.id, decision: CarbonCollectionDecision.PENDING };
  });
}

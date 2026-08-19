/**
 * Audit programme (task T60, Docs/PHASE6_AUDIT_INCIDENT_CAPA_SPEC.md
 * §§1-3,6-7). A standing, risk-based programme of internal audits — the
 * `AuditProgramme` root plus its planned `AuditProgrammeItem` slots. Actual
 * audits (`EmsAudit`) are created from the sibling `audit-service.ts`.
 *
 * Fixed decisions this module enforces (spec §1):
 *  - `AuditProgramme` never mutates approved content in place — a
 *    superseding programme is a new DRAFT row linked by
 *    `supersedesProgrammeId`; activating it marks the old programme
 *    SUPERSEDED in the same transaction, the same successor-chain shape
 *    `EmsScopeVersion` uses;
 *  - every scope row on an `AuditProgrammeItem` sets exactly one of
 *    entity/site/process/aspect/obligation/requirement-map, enforced here,
 *    never left to the database;
 *  - the coverage report (spec §3 "coverage targets") is a live read against
 *    every item's scope rows — this task has no "issue" step to freeze a
 *    snapshot against (that arrives with T61's frozen report), so nothing
 *    here claims to be an immutable coverage snapshot.
 */

import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, assertEntityAccess, assertSiteAccess } from "@/lib/rbac/authorize";
import {
  findTenantAuditProgramme,
  findTenantAuditProgrammeItem,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

export { TenantOwnershipError };

export class AuditProgrammeError extends Error {}

export const PROGRAMME_MANAGE_PERMISSION = "ems.audit_programme.manage" as const;

async function validateMembership(context: OrganisationContext, membershipId: string) {
  const membership = await prisma.organisationMembership.findFirst({
    where: { id: membershipId, organisationId: context.organisationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!membership) throw new TenantOwnershipError();
}

function assertPeriod(periodStart: Date, periodEnd: Date, label = "period") {
  if (!(periodStart instanceof Date) || Number.isNaN(periodStart.getTime())) {
    throw new AuditProgrammeError(`Enter a valid ${label} start date.`);
  }
  if (!(periodEnd instanceof Date) || Number.isNaN(periodEnd.getTime())) {
    throw new AuditProgrammeError(`Enter a valid ${label} end date.`);
  }
  if (periodEnd.getTime() < periodStart.getTime()) {
    throw new AuditProgrammeError(`The ${label} end date must be on or after the ${label} start date.`);
  }
}

// ---------------------------------------------------------------------------
// Programmes
// ---------------------------------------------------------------------------

export interface CreateAuditProgrammeInput {
  name: string;
  description?: string | null;
  objectives?: string | null;
  riskBasis: string;
  periodStart: Date;
  periodEnd: Date;
  ownerMembershipId: string;
  supersedesProgrammeId?: string | null;
  actorUserId: string;
}

export async function createAuditProgramme(context: OrganisationContext, input: CreateAuditProgrammeInput) {
  requirePermission(context, PROGRAMME_MANAGE_PERMISSION);
  if (!input.name.trim()) throw new AuditProgrammeError("Enter a programme name.");
  if (!input.riskBasis.trim()) throw new AuditProgrammeError("Enter the risk basis for this programme.");
  assertPeriod(input.periodStart, input.periodEnd);
  await validateMembership(context, input.ownerMembershipId);
  const ctx = toTenantRepositoryContext(context);

  let supersedesProgrammeId: string | null = null;
  if (input.supersedesProgrammeId) {
    const previous = await findTenantAuditProgramme(ctx, input.supersedesProgrammeId);
    if (!previous) throw new TenantOwnershipError();
    if (previous.status === "SUPERSEDED") {
      throw new AuditProgrammeError("The programme being superseded is already superseded.");
    }
    supersedesProgrammeId = previous.id;
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const programme = await tx.auditProgramme.create({
      data: {
        organisationId: txCtx.organisationId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        objectives: input.objectives?.trim() || null,
        riskBasis: input.riskBasis.trim(),
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        ownerMembershipId: input.ownerMembershipId,
        supersedesProgrammeId,
        createdByUserId: input.actorUserId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "audit_programme.created",
      resourceType: "audit_programme",
      resourceId: programme.id,
      summary: `Audit programme "${input.name}" created.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { name: input.name, periodStart: input.periodStart.toISOString(), periodEnd: input.periodEnd.toISOString() },
    });
    return programme;
  });
}

export async function listAuditProgrammes(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.auditProgramme.findMany({
    where: tenantWhere(ctx, {}),
    include: { owner: { include: { user: { select: { name: true } } } }, items: { select: { id: true } }, audits: { select: { id: true, status: true } } },
    orderBy: { createdAt: "desc" },
  });
}

const programmeDetailInclude = {
  owner: { include: { user: { select: { name: true } } } },
  items: {
    include: {
      scopes: {
        include: {
          entity: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
          process: { select: { id: true, name: true } },
          aspect: { select: { id: true, name: true } },
          obligation: { select: { id: true } },
          requirementMap: { select: { id: true, standardProfile: true, requirementKey: true } },
        },
      },
      audits: { select: { id: true, status: true, title: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
  audits: { select: { id: true, status: true, title: true, scheduledStart: true } },
} as const;

export async function getAuditProgramme(context: OrganisationContext, programmeId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantAuditProgramme(ctx, programmeId);
  if (!programme) throw new TenantOwnershipError();
  return prisma.auditProgramme.findUnique({ where: { id: programme.id }, include: programmeDetailInclude });
}

// ---------------------------------------------------------------------------
// Programme lifecycle: DRAFT -> APPROVED -> ACTIVE -> COMPLETED/SUPERSEDED
// ---------------------------------------------------------------------------

export async function approveAuditProgramme(context: OrganisationContext, programmeId: string, actorUserId: string) {
  requirePermission(context, PROGRAMME_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantAuditProgramme(ctx, programmeId);
  if (!programme) throw new TenantOwnershipError();
  if (programme.status !== "DRAFT") throw new AuditProgrammeError("Only a draft programme can be approved.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.auditProgramme.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: programme.id } },
      data: { status: "APPROVED", approvedAt: new Date(), approvedByUserId: actorUserId },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "audit_programme.approved",
      resourceType: "audit_programme",
      resourceId: programme.id,
      summary: "Audit programme approved.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "DRAFT" },
      after: { status: "APPROVED" },
    });
    return updated;
  });
}

export async function activateAuditProgramme(context: OrganisationContext, programmeId: string, actorUserId: string) {
  requirePermission(context, PROGRAMME_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantAuditProgramme(ctx, programmeId);
  if (!programme) throw new TenantOwnershipError();
  if (programme.status !== "APPROVED") throw new AuditProgrammeError("Only an approved programme can be activated.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.auditProgramme.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: programme.id } },
      data: { status: "ACTIVE" },
    });
    if (programme.supersedesProgrammeId) {
      await tx.auditProgramme.update({
        where: { organisationId_id: { organisationId: txCtx.organisationId, id: programme.supersedesProgrammeId } },
        data: { status: "SUPERSEDED" },
      });
    }
    await recordAuditEvent(tx, txCtx, {
      eventType: "audit_programme.activated",
      resourceType: "audit_programme",
      resourceId: programme.id,
      summary: programme.supersedesProgrammeId
        ? "Audit programme activated, superseding the previous programme."
        : "Audit programme activated.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "APPROVED" },
      after: { status: "ACTIVE" },
    });
    return updated;
  });
}

export async function completeAuditProgramme(context: OrganisationContext, programmeId: string, actorUserId: string) {
  requirePermission(context, PROGRAMME_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantAuditProgramme(ctx, programmeId);
  if (!programme) throw new TenantOwnershipError();
  if (programme.status !== "ACTIVE") throw new AuditProgrammeError("Only an active programme can be completed.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.auditProgramme.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: programme.id } },
      data: { status: "COMPLETED" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "audit_programme.completed",
      resourceType: "audit_programme",
      resourceId: programme.id,
      summary: "Audit programme completed.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "ACTIVE" },
      after: { status: "COMPLETED" },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Programme items and coverage scope
// ---------------------------------------------------------------------------

export interface AuditScopeEntryInput {
  entityId?: string | null;
  siteId?: string | null;
  processId?: string | null;
  aspectId?: string | null;
  obligationId?: string | null;
  requirementMapId?: string | null;
}

/**
 * Validates and normalises a set of coverage-scope rows: exactly one
 * dimension per row, every id belonging to this organisation and (for
 * entity/site) inside the caller's access grant — the same shape
 * `ApplicabilityAssessmentScope`/`ComplianceEvaluationScope` validation uses.
 */
export async function validateAuditScopeEntries(
  context: OrganisationContext,
  entries: AuditScopeEntryInput[],
): Promise<AuditScopeEntryInput[]> {
  const ctx = toTenantRepositoryContext(context);
  const validated: AuditScopeEntryInput[] = [];
  for (const entry of entries) {
    const dims = {
      entityId: entry.entityId || null,
      siteId: entry.siteId || null,
      processId: entry.processId || null,
      aspectId: entry.aspectId || null,
      obligationId: entry.obligationId || null,
      requirementMapId: entry.requirementMapId || null,
    };
    const setCount = Object.values(dims).filter(Boolean).length;
    if (setCount !== 1) {
      throw new AuditProgrammeError("Each coverage scope row must identify exactly one site, process, aspect, obligation or requirement.");
    }
    if (dims.entityId) {
      assertEntityAccess(context, dims.entityId);
      const row = await prisma.entity.findFirst({ where: tenantWhere(ctx, { id: dims.entityId }), select: { id: true } });
      if (!row) throw new TenantOwnershipError();
    } else if (dims.siteId) {
      assertSiteAccess(context, dims.siteId);
      const row = await prisma.site.findFirst({ where: tenantWhere(ctx, { id: dims.siteId }), select: { id: true } });
      if (!row) throw new TenantOwnershipError();
    } else if (dims.processId) {
      const row = await prisma.activityProcess.findFirst({ where: tenantWhere(ctx, { id: dims.processId }), select: { id: true } });
      if (!row) throw new TenantOwnershipError();
    } else if (dims.aspectId) {
      const row = await prisma.environmentalAspect.findFirst({ where: tenantWhere(ctx, { id: dims.aspectId }), select: { id: true } });
      if (!row) throw new TenantOwnershipError();
    } else if (dims.obligationId) {
      const row = await prisma.complianceObligation.findFirst({ where: tenantWhere(ctx, { id: dims.obligationId }), select: { id: true } });
      if (!row) throw new TenantOwnershipError();
    } else if (dims.requirementMapId) {
      const row = await prisma.standardRequirementMap.findFirst({ where: tenantWhere(ctx, { id: dims.requirementMapId }), select: { id: true } });
      if (!row) throw new TenantOwnershipError();
    }
    validated.push(dims);
  }
  return validated;
}

export interface CreateAuditProgrammeItemInput {
  title: string;
  rationale?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  plannedStart: Date;
  plannedEnd: Date;
  scopes: AuditScopeEntryInput[];
  actorUserId: string;
}

export async function createAuditProgrammeItem(
  context: OrganisationContext,
  programmeId: string,
  input: CreateAuditProgrammeItemInput,
) {
  requirePermission(context, PROGRAMME_MANAGE_PERMISSION);
  if (!input.title.trim()) throw new AuditProgrammeError("Enter a title for this planned audit.");
  assertPeriod(input.plannedStart, input.plannedEnd, "planned window");
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantAuditProgramme(ctx, programmeId);
  if (!programme) throw new TenantOwnershipError();
  if (programme.status === "COMPLETED" || programme.status === "SUPERSEDED") {
    throw new AuditProgrammeError("Planned audits cannot be added to a completed or superseded programme.");
  }
  const scopes = await validateAuditScopeEntries(context, input.scopes);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const item = await tx.auditProgrammeItem.create({
      data: {
        organisationId: txCtx.organisationId,
        programmeId: programme.id,
        title: input.title.trim(),
        rationale: input.rationale?.trim() || null,
        priority: input.priority ?? "MEDIUM",
        plannedStart: input.plannedStart,
        plannedEnd: input.plannedEnd,
        createdByUserId: input.actorUserId,
        scopes: { create: scopes.map((scope) => ({ organisationId: txCtx.organisationId, ...scope })) },
      },
      include: { scopes: true },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "audit_programme_item.created",
      resourceType: "audit_programme_item",
      resourceId: item.id,
      summary: `Planned audit "${input.title}" added to the programme.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { programmeId: programme.id, title: input.title, scopeCount: scopes.length },
    });
    return item;
  });
}

export async function getAuditProgrammeItem(context: OrganisationContext, itemId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const item = await findTenantAuditProgrammeItem(ctx, itemId);
  if (!item) throw new TenantOwnershipError();
  return item;
}

// ---------------------------------------------------------------------------
// Coverage report — live read, spans sites/processes/aspects/obligations/
// requirements (spec §3, T60 acceptance).
// ---------------------------------------------------------------------------

export interface AuditCoverageDimensionReport {
  totalCount: number;
  coveredCount: number;
  coveredIds: string[];
}

export interface AuditProgrammeCoverageReport {
  sites: AuditCoverageDimensionReport;
  processes: AuditCoverageDimensionReport;
  aspects: AuditCoverageDimensionReport;
  obligations: AuditCoverageDimensionReport;
  requirements: AuditCoverageDimensionReport;
}

function toDimensionReport(totalIds: string[], coveredIds: Set<string>): AuditCoverageDimensionReport {
  const covered = totalIds.filter((id) => coveredIds.has(id));
  return { totalCount: totalIds.length, coveredCount: covered.length, coveredIds: covered };
}

/**
 * Live coverage read for one programme — every distinct site/process/
 * aspect/obligation/requirement referenced by any of the programme's item
 * or audit scope rows, against the organisation's current universe for each
 * dimension. Not a frozen snapshot (see module docblock).
 */
export async function getAuditProgrammeCoverageReport(
  context: OrganisationContext,
  programmeId: string,
): Promise<AuditProgrammeCoverageReport> {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantAuditProgramme(ctx, programmeId);
  if (!programme) throw new TenantOwnershipError();

  const [itemScopes, auditScopes] = await Promise.all([
    prisma.auditProgrammeItemScope.findMany({
      where: tenantWhere(ctx, { item: { programmeId: programme.id } }),
    }),
    prisma.emsAuditScope.findMany({
      where: tenantWhere(ctx, { audit: { programmeId: programme.id } }),
    }),
  ]);

  const covered = {
    siteId: new Set<string>(),
    processId: new Set<string>(),
    aspectId: new Set<string>(),
    obligationId: new Set<string>(),
    requirementMapId: new Set<string>(),
  };
  for (const scope of [...itemScopes, ...auditScopes]) {
    if (scope.siteId) covered.siteId.add(scope.siteId);
    if (scope.processId) covered.processId.add(scope.processId);
    if (scope.aspectId) covered.aspectId.add(scope.aspectId);
    if (scope.obligationId) covered.obligationId.add(scope.obligationId);
    if (scope.requirementMapId) covered.requirementMapId.add(scope.requirementMapId);
  }

  const [sites, processes, aspects, obligations, requirements] = await Promise.all([
    prisma.site.findMany({ where: tenantWhere(ctx, { isActive: true }), select: { id: true } }),
    prisma.activityProcess.findMany({ where: tenantWhere(ctx, { status: "ACTIVE" as const }), select: { id: true } }),
    prisma.environmentalAspect.findMany({ where: tenantWhere(ctx, { activeTo: null }), select: { id: true } }),
    prisma.complianceObligation.findMany({ where: tenantWhere(ctx, { activeVersionId: { not: null } }), select: { id: true } }),
    prisma.standardRequirementMap.findMany({ where: tenantWhere(ctx, {}), select: { id: true } }),
  ]);

  return {
    sites: toDimensionReport(sites.map((s) => s.id), covered.siteId),
    processes: toDimensionReport(processes.map((p) => p.id), covered.processId),
    aspects: toDimensionReport(aspects.map((a) => a.id), covered.aspectId),
    obligations: toDimensionReport(obligations.map((o) => o.id), covered.obligationId),
    requirements: toDimensionReport(requirements.map((r) => r.id), covered.requirementMapId),
  };
}

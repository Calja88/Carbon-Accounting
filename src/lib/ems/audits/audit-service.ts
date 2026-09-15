/**
 * Planned audit execution shell (task T60, Docs/PHASE6_AUDIT_INCIDENT_CAPA_SPEC.md
 * §§1-3,6-9). Creates and schedules an `EmsAudit` under an `AuditProgramme`,
 * assigns its team with an explicit independence declaration, and validates
 * assigned auditors' scope access. Checklist versioning, question responses,
 * findings and the frozen issued report belong to `checklist-service.ts`,
 * `finding-service.ts` and `report-service.ts` (T61) — this module only ever
 * writes `EmsAudit.status` up to `IN_PROGRESS` (`REPORT_DRAFT`/
 * `REPORT_ISSUED`/`CLOSED` are those modules' concern).
 *
 * Fixed decisions this module enforces (spec §§1,8):
 *  - independence is represented, never assumed from `role` —
 *    `assignAuditTeamMember` requires an explicit
 *    `independenceDeclared`/`conflictDeclared` decision on every call, and a
 *    declared conflict blocks a LEAD_AUDITOR/AUDITOR assignment outright
 *    (spec §8 "independence conflict blocks assignment ... when policy
 *    requires it");
 *  - `rescheduleEmsAudit` is the only function that writes
 *    `scheduledStart`/`scheduledEnd`, and always records an `AuditEvent`
 *    with the before/after dates (T60 acceptance: "schedule changes are
 *    audited");
 *  - `startAuditExecution` re-validates that every assigned auditor's
 *    entity/site access (for a restricted-access membership) covers the
 *    audit's own entity/site scope before the audit can begin (T60
 *    acceptance: "auditor scope validated"), then freezes the audit's
 *    active checklist version, if any, in the same transaction (T61
 *    acceptance: "checklist version frozen at audit start").
 */

import type { AuditTeamRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import {
  findTenantAuditProgramme,
  findTenantAuditProgrammeItem,
  findTenantEmsAudit,
  findTenantAuditTeamMember,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { validateAuditScopeEntries, type AuditScopeEntryInput, AuditProgrammeError } from "./programme-service";
import { freezeActiveChecklistVersionInTransaction, AuditChecklistError } from "./checklist-service";
import type { ReminderSubject } from "@/lib/notifications/types";

export { TenantOwnershipError, AuditProgrammeError, AuditChecklistError };

export const PROGRAMME_MANAGE_PERMISSION = "ems.audit_programme.manage" as const;
export const AUDIT_PERFORM_PERMISSION = "ems.audit.perform" as const;

const AUDITING_ROLES: AuditTeamRole[] = ["LEAD_AUDITOR", "AUDITOR"];

async function validateMembership(context: OrganisationContext, membershipId: string) {
  const membership = await prisma.organisationMembership.findFirst({
    where: { id: membershipId, organisationId: context.organisationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!membership) throw new TenantOwnershipError();
}

function assertPeriod(periodStart: Date, periodEnd: Date) {
  if (!(periodStart instanceof Date) || Number.isNaN(periodStart.getTime())) {
    throw new AuditProgrammeError("Enter a valid scheduled start date.");
  }
  if (!(periodEnd instanceof Date) || Number.isNaN(periodEnd.getTime())) {
    throw new AuditProgrammeError("Enter a valid scheduled end date.");
  }
  if (periodEnd.getTime() < periodStart.getTime()) {
    throw new AuditProgrammeError("The scheduled end date must be on or after the scheduled start date.");
  }
}

// ---------------------------------------------------------------------------
// Audit creation and scope
// ---------------------------------------------------------------------------

export interface CreateEmsAuditInput {
  programmeId: string;
  programmeItemId?: string | null;
  type: "INTERNAL" | "SUPPLIER" | "COMPLIANCE" | "SYSTEM" | "PROCESS" | "OTHER";
  title: string;
  objectives?: string | null;
  criteriaSummary: string;
  criteriaReferences?: Array<{ resourceType: string; resourceId: string }> | null;
  leadMembershipId: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  scopes: AuditScopeEntryInput[];
  actorUserId: string;
}

export async function createEmsAudit(context: OrganisationContext, input: CreateEmsAuditInput) {
  requirePermission(context, PROGRAMME_MANAGE_PERMISSION);
  if (!input.title.trim()) throw new AuditProgrammeError("Enter an audit title.");
  if (!input.criteriaSummary.trim()) throw new AuditProgrammeError("Enter a criteria summary for this audit.");
  assertPeriod(input.scheduledStart, input.scheduledEnd);
  await validateMembership(context, input.leadMembershipId);
  const ctx = toTenantRepositoryContext(context);

  const programme = await findTenantAuditProgramme(ctx, input.programmeId);
  if (!programme) throw new TenantOwnershipError();
  if (programme.status !== "ACTIVE") throw new AuditProgrammeError("Only an active programme can schedule a new audit.");

  let programmeItemId: string | null = null;
  if (input.programmeItemId) {
    const item = await findTenantAuditProgrammeItem(ctx, input.programmeItemId, programme.id);
    if (!item) throw new TenantOwnershipError();
    programmeItemId = item.id;
  }

  const scopes = await validateAuditScopeEntries(context, input.scopes);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const created = await tx.emsAudit.create({
      data: {
        organisationId: txCtx.organisationId,
        programmeId: programme.id,
        programmeItemId,
        type: input.type,
        title: input.title.trim(),
        objectives: input.objectives?.trim() || null,
        criteriaSummary: input.criteriaSummary.trim(),
        criteriaReferences: input.criteriaReferences ?? undefined,
        leadMembershipId: input.leadMembershipId,
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
        createdByUserId: input.actorUserId,
      },
    });
    // A separate createMany, not a nested write — see applicability-service.ts's
    // createApplicabilityAssessment for why (compound-keyed parent relation
    // excludes organisationId from the nested-create input; confirmed via
    // real-Postgres CI).
    if (scopes.length > 0) {
      await tx.emsAuditScope.createMany({
        data: scopes.map((scope) => ({ organisationId: txCtx.organisationId, auditId: created.id, ...scope })),
      });
    }
    const audit = await tx.emsAudit.findUniqueOrThrow({ where: { id: created.id }, include: { scopes: true } });
    await recordAuditEvent(tx, txCtx, {
      eventType: "ems_audit.created",
      resourceType: "ems_audit",
      resourceId: audit.id,
      summary: `Audit "${input.title}" scheduled under the programme.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: {
        programmeId: programme.id,
        scheduledStart: input.scheduledStart.toISOString(),
        scheduledEnd: input.scheduledEnd.toISOString(),
      },
    });
    return audit;
  });
}

export async function listEmsAudits(context: OrganisationContext, programmeId?: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.emsAudit.findMany({
    where: tenantWhere(ctx, programmeId ? { programmeId } : {}),
    include: { lead: { include: { user: { select: { name: true } } } }, team: true },
    orderBy: { scheduledStart: "asc" },
  });
}

const auditDetailInclude = {
  programme: { select: { id: true, name: true } },
  lead: { include: { user: { select: { name: true } } } },
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
  team: {
    include: { membership: { include: { user: { select: { name: true } } } } },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

export async function getEmsAudit(context: OrganisationContext, auditId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const audit = await findTenantEmsAudit(ctx, auditId);
  if (!audit) throw new TenantOwnershipError();
  return prisma.emsAudit.findUnique({ where: { id: audit.id }, include: auditDetailInclude });
}

// ---------------------------------------------------------------------------
// Scheduling — the only functions that write scheduledStart/scheduledEnd.
// Every change is audited (T60 acceptance: "schedule changes are audited").
// ---------------------------------------------------------------------------

export async function rescheduleEmsAudit(
  context: OrganisationContext,
  auditId: string,
  input: { scheduledStart: Date; scheduledEnd: Date; reason?: string | null; actorUserId: string },
) {
  requirePermission(context, PROGRAMME_MANAGE_PERMISSION);
  assertPeriod(input.scheduledStart, input.scheduledEnd);
  const ctx = toTenantRepositoryContext(context);
  const audit = await findTenantEmsAudit(ctx, auditId);
  if (!audit) throw new TenantOwnershipError();
  if (audit.status === "REPORT_ISSUED" || audit.status === "CLOSED") {
    throw new AuditProgrammeError("An issued or closed audit cannot be rescheduled.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.emsAudit.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: audit.id } },
      data: { scheduledStart: input.scheduledStart, scheduledEnd: input.scheduledEnd },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "ems_audit.rescheduled",
      resourceType: "ems_audit",
      resourceId: audit.id,
      summary: input.reason ? `Audit rescheduled: ${input.reason}` : "Audit rescheduled.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { scheduledStart: audit.scheduledStart.toISOString(), scheduledEnd: audit.scheduledEnd.toISOString() },
      after: { scheduledStart: input.scheduledStart.toISOString(), scheduledEnd: input.scheduledEnd.toISOString() },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Team and independence
// ---------------------------------------------------------------------------

export interface AssignAuditTeamMemberInput {
  membershipId: string;
  role: "LEAD_AUDITOR" | "AUDITOR" | "TECHNICAL_EXPERT" | "OBSERVER";
  independenceDeclared: boolean;
  conflictDeclared: boolean;
  conflictNotes?: string | null;
  actorUserId: string;
}

/**
 * Adds one team member to an audit. Independence must be declared
 * explicitly on every call (spec §1 "independence is represented and
 * checked, not assumed from a role name") — there is no default. A declared
 * conflict blocks a LEAD_AUDITOR/AUDITOR assignment outright; it may still
 * be recorded for a TECHNICAL_EXPERT/OBSERVER role, which does not perform
 * or sign off the audit.
 */
export async function assignAuditTeamMember(context: OrganisationContext, auditId: string, input: AssignAuditTeamMemberInput) {
  requirePermission(context, PROGRAMME_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const audit = await findTenantEmsAudit(ctx, auditId);
  if (!audit) throw new TenantOwnershipError();
  if (audit.status === "REPORT_ISSUED" || audit.status === "CLOSED") {
    throw new AuditProgrammeError("The team of an issued or closed audit cannot be changed.");
  }
  await validateMembership(context, input.membershipId);

  if (input.conflictDeclared && !input.conflictNotes?.trim()) {
    throw new AuditProgrammeError("Enter conflict notes when a conflict of interest is declared.");
  }
  const isAuditingRole = (AUDITING_ROLES as readonly string[]).includes(input.role);
  if (input.conflictDeclared && isAuditingRole) {
    throw new AuditProgrammeError(
      "A declared conflict of interest blocks this person from being assigned as a lead auditor or auditor on this audit.",
    );
  }

  const existing = await prisma.auditTeamMember.findFirst({
    where: tenantWhere(ctx, { auditId: audit.id, membershipId: input.membershipId }),
  });
  if (existing) throw new AuditProgrammeError("This person is already on the audit team.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const member = await tx.auditTeamMember.create({
      data: {
        organisationId: txCtx.organisationId,
        auditId: audit.id,
        membershipId: input.membershipId,
        role: input.role,
        independenceDeclared: input.independenceDeclared,
        conflictDeclared: input.conflictDeclared,
        conflictNotes: input.conflictNotes?.trim() || null,
        declaredAt: new Date(),
        addedByUserId: input.actorUserId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "audit_team_member.assigned",
      resourceType: "audit_team_member",
      resourceId: member.id,
      summary: `${input.role} assigned to the audit team.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { auditId: audit.id, role: input.role, independenceDeclared: input.independenceDeclared, conflictDeclared: input.conflictDeclared },
    });
    return member;
  });
}

export async function removeAuditTeamMember(context: OrganisationContext, memberId: string, actorUserId: string) {
  requirePermission(context, PROGRAMME_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const member = await findTenantAuditTeamMember(ctx, memberId);
  if (!member) throw new TenantOwnershipError();
  const audit = await findTenantEmsAudit(ctx, member.auditId);
  if (!audit) throw new TenantOwnershipError();
  if (audit.status === "REPORT_ISSUED" || audit.status === "CLOSED") {
    throw new AuditProgrammeError("The team of an issued or closed audit cannot be changed.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.auditTeamMember.delete({
      where: { organisationId_auditId_membershipId: { organisationId: txCtx.organisationId, auditId: member.auditId, membershipId: member.membershipId } },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "audit_team_member.removed",
      resourceType: "audit_team_member",
      resourceId: member.id,
      summary: `${member.role} removed from the audit team.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { auditId: member.auditId, role: member.role },
    });
    return { id: member.id };
  });
}

// ---------------------------------------------------------------------------
// Preparation and execution — T60 only reaches IN_PROGRESS; see module note.
// ---------------------------------------------------------------------------

export async function startAuditPreparation(context: OrganisationContext, auditId: string, actorUserId: string) {
  requirePermission(context, PROGRAMME_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const audit = await findTenantEmsAudit(ctx, auditId);
  if (!audit) throw new TenantOwnershipError();
  if (audit.status !== "PLANNED") throw new AuditProgrammeError("Only a planned audit can move to preparation.");

  const leadCount = await prisma.auditTeamMember.count({
    where: tenantWhere(ctx, { auditId: audit.id, role: "LEAD_AUDITOR" as const }),
  });
  if (leadCount === 0) throw new AuditProgrammeError("Assign a lead auditor before starting preparation.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.emsAudit.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: audit.id } },
      data: { status: "PREPARATION" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "ems_audit.preparation_started",
      resourceType: "ems_audit",
      resourceId: audit.id,
      summary: "Audit preparation started.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "PLANNED" },
      after: { status: "PREPARATION" },
    });
    return updated;
  });
}

/**
 * Re-validates every assigned lead auditor/auditor's entity/site access
 * against the audit's own scope. A restricted-access membership whose
 * entity/site scopes do not cover the audit's scope fails this check (T60
 * acceptance: "auditor scope validated").
 */
async function validateAuditorScope(context: OrganisationContext, auditId: string) {
  const team = await prisma.auditTeamMember.findMany({
    where: { organisationId: context.organisationId, auditId, role: { in: [...AUDITING_ROLES] } },
    include: { membership: { include: { entityScopes: true, siteScopes: true } } },
  });
  const scopeRows = await prisma.emsAuditScope.findMany({ where: { organisationId: context.organisationId, auditId } });
  const scopeEntityIds = scopeRows.map((s) => s.entityId).filter((id): id is string => Boolean(id));
  const scopeSiteIds = scopeRows.map((s) => s.siteId).filter((id): id is string => Boolean(id));

  for (const member of team) {
    if (member.membership.accessMode !== "RESTRICTED") continue;
    const allowedEntityIds = new Set(member.membership.entityScopes.map((s) => s.entityId));
    const allowedSiteIds = new Set(member.membership.siteScopes.map((s) => s.siteId));
    const coversEntities = scopeEntityIds.every((id) => allowedEntityIds.has(id));
    const coversSites = scopeSiteIds.every((id) => allowedSiteIds.has(id));
    if (!coversEntities || !coversSites) {
      throw new AuditProgrammeError(
        `${member.role === "LEAD_AUDITOR" ? "The lead auditor" : "An auditor"} does not have access to every entity/site in this audit's scope.`,
      );
    }
  }
}

export async function startAuditExecution(context: OrganisationContext, auditId: string, actorUserId: string) {
  requirePermission(context, PROGRAMME_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const audit = await findTenantEmsAudit(ctx, auditId);
  if (!audit) throw new TenantOwnershipError();
  if (audit.status !== "PREPARATION") throw new AuditProgrammeError("Only an audit in preparation can be started.");

  const conflicted = await prisma.auditTeamMember.findFirst({
    where: tenantWhere(ctx, { auditId: audit.id, role: { in: [...AUDITING_ROLES] }, independenceDeclared: false }),
  });
  if (conflicted) throw new AuditProgrammeError("Every lead auditor/auditor must have an independence declaration on file before the audit can start.");

  await validateAuditorScope(context, audit.id);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await freezeActiveChecklistVersionInTransaction(tx, txCtx, audit.id, actorUserId);
    const updated = await tx.emsAudit.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: audit.id } },
      data: { status: "IN_PROGRESS" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "ems_audit.started",
      resourceType: "ems_audit",
      resourceId: audit.id,
      summary: "Audit execution started.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "PREPARATION" },
      after: { status: "IN_PROGRESS" },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// T24 reminder integration — read-only interface, see
// `src/lib/notifications/reminder-service.ts` module note: T24 has no audit
// model of its own to schedule against, so the calling domain supplies
// candidate subjects.
// ---------------------------------------------------------------------------

/** Candidate reminder subjects for a `ReminderRule` with resourceType `"ems_audit"`, keyed on `scheduledStart`. */
export async function listEmsAuditReminderSubjects(context: OrganisationContext): Promise<ReminderSubject[]> {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const audits = await prisma.emsAudit.findMany({
    where: tenantWhere(ctx, { status: { in: ["PLANNED" as const, "PREPARATION" as const] } }),
    select: { id: true, scheduledStart: true },
  });
  return audits.map((audit) => ({
    resourceId: audit.id,
    referenceDate: audit.scheduledStart,
    closed: false,
    reassigned: false,
  }));
}

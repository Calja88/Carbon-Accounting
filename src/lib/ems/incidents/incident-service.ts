/**
 * Environmental incident intake (task T62, Docs/PHASE6_AUDIT_INCIDENT_CAPA_SPEC.md
 * §§1-3,5-9). Depends on T22 (shared evidence: `src/lib/documents/evidence-service.ts`,
 * resource type `environmental_incident`) and T23 (Organisation/EMS tenant
 * foundation). State machine per spec §2:
 *
 *   REPORTED -> TRIAGED -> INVESTIGATING -> RESPONSE_COMPLETE -> CLOSED / REOPENED
 *
 * Fixed decisions this module enforces (spec §§1,4,5,8):
 *  - `createEnvironmentalIncident` never sets `status` past `REPORTED` and
 *    never concludes legal reportability — see `notification-assessment-service.ts`
 *    for the only place a reportability *decision* is ever recorded, and even
 *    there it is always entered by a named human reviewer, never inferred;
 *  - the incident's own `factualDescription`/`immediateResponse`/
 *    `potentialReceptors` are set once at creation and never written again by
 *    this module — `recordIncidentCorrection` is the only way to append a
 *    changed understanding of the facts, and the original always remains
 *    readable (spec acceptance: "preserves original report and corrections");
 *  - `restricted` incidents are hidden from list/search for anyone without
 *    `ems.incident.restricted.view` — `assertIncidentReadAccess` is the single
 *    choke point every read in this module goes through, and a denial there
 *    is indistinguishable from "not found" (spec §5: "must not leak
 *    presence, person, type or Site to unauthorised members"), except for
 *    the reporter reading their own report, which is always allowed (spec
 *    §5: "minimal safe intake" — `ems.incident.report` alone can create but
 *    not browse restricted incidents in general);
 *  - `assignIncidentSeverity` snapshots the exact `IncidentSeverityLevel` row
 *    in effect at the moment of assignment into `severityConfigSnapshot`, so
 *    a later edit to the organisation's severity/escalation configuration
 *    never rewrites a past incident's record (spec §4 "severity config
 *    snapshot").
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, hasPermission } from "@/lib/rbac/authorize";
import {
  findTenantIncidentSeverityLevel,
  findTenantEnvironmentalIncident,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { linkEvidence, uploadEvidenceObject, listEvidenceForResource } from "@/lib/documents/evidence-service";

export { TenantOwnershipError };

export class IncidentError extends Error {}

export const INCIDENT_REPORT_PERMISSION = "ems.incident.report" as const;
export const INCIDENT_MANAGE_PERMISSION = "ems.incident.manage" as const;
export const INCIDENT_RESTRICTED_VIEW_PERMISSION = "ems.incident.restricted.view" as const;

// ---------------------------------------------------------------------------
// Severity levels and escalation rules — the organisation's own configurable
// policy (spec acceptance: "escalation rules configurable"). Only
// ems.incident.manage may define them; a level already referenced by an
// incident is deactivated, never deleted, so `severityConfigSnapshot` on
// past incidents always matches a row that once existed.
// ---------------------------------------------------------------------------

export interface CreateIncidentSeverityLevelInput {
  key: string;
  label: string;
  rank: number;
  requiresEscalation?: boolean;
  actorUserId: string;
}

export async function createIncidentSeverityLevel(context: OrganisationContext, input: CreateIncidentSeverityLevelInput) {
  requirePermission(context, INCIDENT_MANAGE_PERMISSION);
  if (!input.key.trim()) throw new IncidentError("Enter a severity level key.");
  if (!input.label.trim()) throw new IncidentError("Enter a severity level label.");

  const existing = await prisma.incidentSeverityLevel.findFirst({
    where: { organisationId: context.organisationId, key: input.key.trim() },
  });
  if (existing) throw new IncidentError(`A severity level with key "${input.key}" already exists.`);

  return prisma.incidentSeverityLevel.create({
    data: {
      organisationId: context.organisationId,
      key: input.key.trim(),
      label: input.label.trim(),
      rank: input.rank,
      requiresEscalation: input.requiresEscalation ?? false,
      createdByUserId: input.actorUserId,
    },
  });
}

export async function listIncidentSeverityLevels(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.incidentSeverityLevel.findMany({
    where: tenantWhere(ctx, { isActive: true }),
    orderBy: { rank: "asc" },
  });
}

export async function deactivateIncidentSeverityLevel(context: OrganisationContext, severityLevelId: string) {
  requirePermission(context, INCIDENT_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const level = await findTenantIncidentSeverityLevel(ctx, severityLevelId);
  if (!level) throw new TenantOwnershipError();
  return prisma.incidentSeverityLevel.update({
    where: { organisationId_id: { organisationId: ctx.organisationId, id: level.id } },
    data: { isActive: false },
  });
}

export interface UpsertIncidentEscalationRuleInput {
  severityLevelId: string;
  recipientsPolicy: Record<string, unknown>;
  isActive?: boolean;
  actorUserId: string;
}

/**
 * Creates or replaces the escalation rule for one severity level — the
 * organisation's configurable policy for who is notified when an incident of
 * that severity is reported (spec acceptance: "escalation rules
 * configurable"). `recipientsPolicy` follows the same shape/convention as
 * `ReminderRule.recipientsPolicy` (T24): resolved against live membership
 * state, never a stored membership id list.
 */
export async function upsertIncidentEscalationRule(context: OrganisationContext, input: UpsertIncidentEscalationRuleInput) {
  requirePermission(context, INCIDENT_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const level = await findTenantIncidentSeverityLevel(ctx, input.severityLevelId);
  if (!level) throw new TenantOwnershipError();

  const existing = await prisma.incidentEscalationRule.findFirst({
    where: tenantWhere(ctx, { severityLevelId: level.id }),
  });
  if (existing) {
    return prisma.incidentEscalationRule.update({
      where: { organisationId_id: { organisationId: ctx.organisationId, id: existing.id } },
      data: { recipientsPolicy: input.recipientsPolicy as unknown as Prisma.InputJsonValue, isActive: input.isActive ?? true },
    });
  }
  return prisma.incidentEscalationRule.create({
    data: {
      organisationId: ctx.organisationId,
      severityLevelId: level.id,
      recipientsPolicy: input.recipientsPolicy as unknown as Prisma.InputJsonValue,
      isActive: input.isActive ?? true,
      createdByUserId: input.actorUserId,
    },
  });
}

export async function listIncidentEscalationRules(context: OrganisationContext) {
  requirePermission(context, INCIDENT_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  return prisma.incidentEscalationRule.findMany({
    where: tenantWhere(ctx, {}),
    include: { severityLevel: true },
  });
}

// ---------------------------------------------------------------------------
// Restricted-incident access — the single choke point every incident read in
// this module goes through (spec §5).
// ---------------------------------------------------------------------------

/**
 * Throws unless the caller may read this incident: any organisation member
 * with `ems.view` may read a non-restricted incident; a restricted incident
 * additionally requires `ems.incident.restricted.view`, except for the
 * reporter reading their own report. The thrown error is always
 * `TenantOwnershipError` (identical to "not found") so a denial never
 * reveals whether a restricted record exists (spec §5).
 */
function assertIncidentReadAccess(
  context: OrganisationContext,
  incident: { restricted: boolean; reporterMembershipId: string },
): void {
  if (!incident.restricted) return;
  if (context.membershipId === incident.reporterMembershipId) return;
  if (hasPermission(context, INCIDENT_RESTRICTED_VIEW_PERMISSION)) return;
  throw new TenantOwnershipError();
}

// ---------------------------------------------------------------------------
// Incident intake
// ---------------------------------------------------------------------------

export interface CreateEnvironmentalIncidentInput {
  reference: string;
  occurredAt?: Date | null;
  discoveredAt?: Date | null;
  entityId?: string | null;
  siteId?: string | null;
  processId?: string | null;
  aspectId?: string | null;
  type: string;
  factualDescription: string;
  immediateResponse?: string | null;
  potentialReceptors?: string | null;
  restricted?: boolean;
  actorUserId: string;
}

async function assertScopeOwnership(
  ctx: ReturnType<typeof toTenantRepositoryContext>,
  input: Pick<CreateEnvironmentalIncidentInput, "entityId" | "siteId" | "processId" | "aspectId">,
) {
  if (input.entityId) {
    const row = await prisma.entity.findFirst({ where: { id: input.entityId, organisationId: ctx.organisationId } });
    if (!row) throw new TenantOwnershipError();
  }
  if (input.siteId) {
    const row = await prisma.site.findFirst({ where: { id: input.siteId, organisationId: ctx.organisationId } });
    if (!row) throw new TenantOwnershipError();
  }
  if (input.processId) {
    const row = await prisma.activityProcess.findFirst({ where: { id: input.processId, organisationId: ctx.organisationId } });
    if (!row) throw new TenantOwnershipError();
  }
  if (input.aspectId) {
    const row = await prisma.environmentalAspect.findFirst({ where: { id: input.aspectId, organisationId: ctx.organisationId } });
    if (!row) throw new TenantOwnershipError();
  }
}

/**
 * Reports a new incident. Always lands in `REPORTED` with no severity and no
 * notification assessment — this function never decides severity, escalation
 * or legal reportability (spec acceptance: "no automatic legal-reportability
 * conclusion").
 */
export async function createEnvironmentalIncident(context: OrganisationContext, input: CreateEnvironmentalIncidentInput) {
  requirePermission(context, INCIDENT_REPORT_PERMISSION);
  if (!input.reference.trim()) throw new IncidentError("Enter an incident reference.");
  if (!input.type.trim()) throw new IncidentError("Enter an incident type.");
  if (!input.factualDescription.trim()) throw new IncidentError("Describe what happened.");

  const ctx = toTenantRepositoryContext(context);
  await assertScopeOwnership(ctx, input);

  const duplicateReference = await prisma.environmentalIncident.findFirst({
    where: tenantWhere(ctx, { reference: input.reference.trim() }),
  });
  if (duplicateReference) throw new IncidentError(`An incident with reference "${input.reference}" already exists.`);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const incident = await tx.environmentalIncident.create({
      data: {
        organisationId: txCtx.organisationId,
        reference: input.reference.trim(),
        occurredAt: input.occurredAt ?? null,
        discoveredAt: input.discoveredAt ?? null,
        entityId: input.entityId || null,
        siteId: input.siteId || null,
        processId: input.processId || null,
        aspectId: input.aspectId || null,
        type: input.type.trim(),
        factualDescription: input.factualDescription.trim(),
        immediateResponse: input.immediateResponse?.trim() || null,
        potentialReceptors: input.potentialReceptors?.trim() || null,
        restricted: input.restricted ?? false,
        reporterMembershipId: context.membershipId,
        reporterUserId: input.actorUserId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_incident.reported",
      resourceType: "environmental_incident",
      resourceId: incident.id,
      summary: `Incident "${input.reference}" reported.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { reference: input.reference, type: input.type, restricted: incident.restricted },
    });
    return incident;
  });
}

export async function getEnvironmentalIncident(context: OrganisationContext, incidentId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const incident = await findTenantEnvironmentalIncident(ctx, incidentId);
  if (!incident) throw new TenantOwnershipError();
  assertIncidentReadAccess(context, incident);

  const [corrections, notificationAssessments] = await Promise.all([
    prisma.incidentCorrection.findMany({ where: tenantWhere(ctx, { incidentId: incident.id }), orderBy: { correctedAt: "asc" } }),
    prisma.incidentNotificationAssessment.findMany({ where: tenantWhere(ctx, { incidentId: incident.id }), orderBy: { assessedAt: "asc" } }),
  ]);

  const latestCorrection = corrections.at(-1) ?? null;
  return {
    ...incident,
    corrections,
    notificationAssessments,
    // Current view: the latest correction supersedes the original for
    // display, but the original fields above are never overwritten (spec
    // acceptance: "preserves original report and corrections").
    currentFactualDescription: latestCorrection?.correctedFactualDescription ?? incident.factualDescription,
    currentImmediateResponse: latestCorrection?.correctedImmediateResponse ?? incident.immediateResponse,
    currentPotentialReceptors: latestCorrection?.correctedPotentialReceptors ?? incident.potentialReceptors,
  };
}

/**
 * Lists incidents visible to the caller. Restricted incidents are excluded
 * unless the caller has `ems.incident.restricted.view` — a restricted
 * incident the caller reported is still excluded from this list (spec §5:
 * restricted list/search/count "must not leak presence ... to unauthorised
 * members"); use `getEnvironmentalIncident` to read one's own report
 * directly by id.
 */
export async function listEnvironmentalIncidents(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const canViewRestricted = hasPermission(context, INCIDENT_RESTRICTED_VIEW_PERMISSION);
  return prisma.environmentalIncident.findMany({
    where: tenantWhere(ctx, canViewRestricted ? {} : { restricted: false }),
    orderBy: { reportedAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Corrections — append-only; the original incident fields are never
// overwritten (spec acceptance).
// ---------------------------------------------------------------------------

export interface RecordIncidentCorrectionInput {
  correctedFactualDescription?: string | null;
  correctedImmediateResponse?: string | null;
  correctedPotentialReceptors?: string | null;
  reason: string;
  actorUserId: string;
}

export async function recordIncidentCorrection(context: OrganisationContext, incidentId: string, input: RecordIncidentCorrectionInput) {
  requirePermission(context, INCIDENT_MANAGE_PERMISSION);
  if (!input.reason.trim()) throw new IncidentError("Enter a reason for this correction.");
  if (!input.correctedFactualDescription?.trim() && !input.correctedImmediateResponse?.trim() && !input.correctedPotentialReceptors?.trim()) {
    throw new IncidentError("Enter at least one corrected field.");
  }
  const ctx = toTenantRepositoryContext(context);
  const incident = await findTenantEnvironmentalIncident(ctx, incidentId);
  if (!incident) throw new TenantOwnershipError();
  assertIncidentReadAccess(context, incident);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const correction = await tx.incidentCorrection.create({
      data: {
        organisationId: txCtx.organisationId,
        incidentId: incident.id,
        correctedFactualDescription: input.correctedFactualDescription?.trim() || null,
        correctedImmediateResponse: input.correctedImmediateResponse?.trim() || null,
        correctedPotentialReceptors: input.correctedPotentialReceptors?.trim() || null,
        reason: input.reason.trim(),
        correctedByUserId: input.actorUserId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "incident_correction.recorded",
      resourceType: "environmental_incident",
      resourceId: incident.id,
      summary: `Correction recorded: ${input.reason}`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { correctionId: correction.id },
    });
    return correction;
  });
}

// ---------------------------------------------------------------------------
// Evidence — shared T22 evidence object/link, resource type
// "environmental_incident". `listIncidentEvidence` goes through the same
// restricted-access check as every other read in this module.
// ---------------------------------------------------------------------------

export async function uploadIncidentEvidence(
  context: OrganisationContext,
  input: { incidentId: string; fileName: string; mimeType: string; bytes: Buffer; purpose?: string | null; actorUserId: string },
) {
  requirePermission(context, INCIDENT_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const incident = await findTenantEnvironmentalIncident(ctx, input.incidentId);
  if (!incident) throw new TenantOwnershipError();
  assertIncidentReadAccess(context, incident);

  const evidence = await uploadEvidenceObject(context, {
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
    uploadedByUserId: input.actorUserId,
  });
  await linkEvidence(context, {
    evidenceId: evidence.id,
    resourceType: "environmental_incident",
    resourceId: incident.id,
    purpose: input.purpose,
    linkedByUserId: input.actorUserId,
  });
  return evidence;
}

export async function listIncidentEvidence(context: OrganisationContext, incidentId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const incident = await findTenantEnvironmentalIncident(ctx, incidentId);
  if (!incident) throw new TenantOwnershipError();
  assertIncidentReadAccess(context, incident);
  return listEvidenceForResource(context, "environmental_incident", incident.id);
}

// ---------------------------------------------------------------------------
// Severity assignment and status transitions
// ---------------------------------------------------------------------------

/**
 * Assigns/reassigns severity and moves the incident from REPORTED to
 * TRIAGED. Freezes the exact severity-level row into
 * `severityConfigSnapshot` (spec §4) so a later config edit never rewrites
 * this incident's history.
 */
export async function assignIncidentSeverity(context: OrganisationContext, incidentId: string, severityLevelId: string, actorUserId: string) {
  requirePermission(context, INCIDENT_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const incident = await findTenantEnvironmentalIncident(ctx, incidentId);
  if (!incident) throw new TenantOwnershipError();
  assertIncidentReadAccess(context, incident);
  if (!["REPORTED", "TRIAGED"].includes(incident.status)) {
    throw new IncidentError(`Severity cannot be (re)assigned once an incident is in status ${incident.status}.`);
  }

  const level = await findTenantIncidentSeverityLevel(ctx, severityLevelId);
  if (!level) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.environmentalIncident.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: incident.id } },
      data: {
        severityLevelId: level.id,
        severityConfigSnapshot: { key: level.key, label: level.label, rank: level.rank, requiresEscalation: level.requiresEscalation },
        status: "TRIAGED",
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_incident.triaged",
      resourceType: "environmental_incident",
      resourceId: incident.id,
      summary: `Incident triaged with severity "${level.label}".`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: incident.status },
      after: { status: "TRIAGED", severityLevelKey: level.key },
    });
    return updated;
  });
}

async function transitionIncidentStatus(
  context: OrganisationContext,
  incidentId: string,
  input: { to: "INVESTIGATING" | "RESPONSE_COMPLETE"; from: string[]; actorUserId: string; eventType: "environmental_incident.investigation_started" | "environmental_incident.response_completed" },
) {
  requirePermission(context, INCIDENT_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const incident = await findTenantEnvironmentalIncident(ctx, incidentId);
  if (!incident) throw new TenantOwnershipError();
  assertIncidentReadAccess(context, incident);
  if (!input.from.includes(incident.status)) {
    throw new IncidentError(`An incident in status ${incident.status} cannot move to ${input.to}.`);
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.environmentalIncident.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: incident.id } },
      data: { status: input.to },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: input.eventType,
      resourceType: "environmental_incident",
      resourceId: incident.id,
      summary: `Incident moved from ${incident.status} to ${input.to}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: incident.status },
      after: { status: input.to },
    });
    return updated;
  });
}

export async function startIncidentInvestigation(context: OrganisationContext, incidentId: string, actorUserId: string) {
  return transitionIncidentStatus(context, incidentId, {
    to: "INVESTIGATING",
    from: ["TRIAGED"],
    actorUserId,
    eventType: "environmental_incident.investigation_started",
  });
}

export async function completeIncidentResponse(context: OrganisationContext, incidentId: string, actorUserId: string) {
  return transitionIncidentStatus(context, incidentId, {
    to: "RESPONSE_COMPLETE",
    from: ["INVESTIGATING"],
    actorUserId,
    eventType: "environmental_incident.response_completed",
  });
}

export async function closeEnvironmentalIncident(context: OrganisationContext, incidentId: string, actorUserId: string) {
  requirePermission(context, INCIDENT_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const incident = await findTenantEnvironmentalIncident(ctx, incidentId);
  if (!incident) throw new TenantOwnershipError();
  assertIncidentReadAccess(context, incident);
  if (incident.status !== "RESPONSE_COMPLETE") {
    throw new IncidentError("Only an incident with response complete can be closed.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.environmentalIncident.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: incident.id } },
      data: { status: "CLOSED", closedAt: new Date(), closedByUserId: actorUserId },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_incident.closed",
      resourceType: "environmental_incident",
      resourceId: incident.id,
      summary: "Incident closed.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: incident.status },
      after: { status: "CLOSED" },
    });
    return updated;
  });
}

export async function reopenEnvironmentalIncident(context: OrganisationContext, incidentId: string, reason: string, actorUserId: string) {
  requirePermission(context, INCIDENT_MANAGE_PERMISSION);
  if (!reason.trim()) throw new IncidentError("Enter a reason for reopening this incident.");
  const ctx = toTenantRepositoryContext(context);
  const incident = await findTenantEnvironmentalIncident(ctx, incidentId);
  if (!incident) throw new TenantOwnershipError();
  assertIncidentReadAccess(context, incident);
  if (incident.status !== "CLOSED") throw new IncidentError("Only a closed incident can be reopened.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.environmentalIncident.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: incident.id } },
      data: { status: "REOPENED", reopenedAt: new Date(), reopenedByUserId: actorUserId, reopenReason: reason.trim() },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_incident.reopened",
      resourceType: "environmental_incident",
      resourceId: incident.id,
      summary: `Incident reopened: ${reason}`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: incident.status },
      after: { status: "REOPENED" },
    });
    return updated;
  });
}

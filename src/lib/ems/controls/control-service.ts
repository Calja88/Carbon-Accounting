/** Tenant-scoped operational controls and review cycle (task T33). */

import type { ControlCheckResult, OperationalControlType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import {
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { notifyMembership, suppressNotificationsForResource } from "@/lib/notifications/notification-service";
import { linkEvidence, uploadEvidenceObject } from "@/lib/documents/evidence-service";

export { TenantOwnershipError };

export class OperationalControlError extends Error {}

export interface ControlApplicabilityInput {
  entityId?: string | null;
  siteId?: string | null;
  processId?: string | null;
  /** A task-local reference only. Provider records/evaluations belong to T35. */
  externalProviderReference?: string | null;
}

export interface OperationalControlInput {
  controlKey: string;
  title: string;
  type: OperationalControlType;
  description?: string | null;
  frequency?: string | null;
  acceptanceCriteria?: string | null;
  effectivenessCriteria?: string | null;
  ownerMembershipId: string;
  controlledDocumentRevisionId?: string | null;
  reviewDueDate: Date;
  aspectIds: string[];
  applicabilities?: ControlApplicabilityInput[];
  actorUserId: string;
}

function visibleControlWhere(context: OrganisationContext): Prisma.OperationalControlWhereInput {
  if (context.access.mode === "ORGANISATION_WIDE") return {};
  const siteIds = [...context.access.siteIds];
  const entityIds = [...context.access.entityIds];
  return {
    OR: [
      { aspectLinks: { some: { aspect: { process: { OR: [{ siteId: { in: siteIds } }, { entityId: { in: entityIds } }] } } } } },
      { applicabilities: { some: { OR: [{ siteId: { in: siteIds } }, { entityId: { in: entityIds } }] } } },
    ],
  };
}

async function findVisibleControl(context: OrganisationContext, id: string) {
  const ctx = toTenantRepositoryContext(context);
  return prisma.operationalControl.findFirst({
    where: tenantWhere(ctx, { id, ...visibleControlWhere(context) }),
  });
}

function assertProcessInScope(
  context: OrganisationContext,
  process: { siteId: string | null; entityId: string | null },
): void {
  if (context.access.mode === "ORGANISATION_WIDE") return;
  if (process.siteId && context.access.siteIds.has(process.siteId)) return;
  if (process.entityId && context.access.entityIds.has(process.entityId)) return;
  throw new TenantOwnershipError();
}

export async function listOperationalControls(context: OrganisationContext, asOf = new Date()) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const controls = await prisma.operationalControl.findMany({
    where: tenantWhere(ctx, visibleControlWhere(context)),
    include: {
      owner: { select: { id: true, user: { select: { name: true } } } },
      controlledDocumentRevision: { include: { document: { select: { reference: true, title: true } } } },
      aspectLinks: { include: { aspect: { select: { id: true, name: true } } } },
      applicabilities: true,
      checks: { orderBy: { scheduledAt: "desc" }, take: 10 },
    },
    orderBy: [{ controlKey: "asc" }, { version: "desc" }],
  });
  return controls.map((control) => ({
    ...control,
    reviewOverdue: control.status === "ACTIVE" && control.reviewDueDate.getTime() < asOf.getTime(),
  }));
}

/** Returns current significant aspects with no ACTIVE operational-control version. */
export async function listSignificantAspectControlGaps(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const scopeWhere: Prisma.EnvironmentalAspectWhereInput = context.access.mode === "ORGANISATION_WIDE"
    ? {}
    : { process: { OR: [
      { siteId: { in: [...context.access.siteIds] } },
      { entityId: { in: [...context.access.entityIds] } },
    ] } };
  const gapWhere: Prisma.EnvironmentalAspectWhereInput = {
      ...scopeWhere,
      assessments: { some: { status: "APPROVED", finalSignificant: true } },
      operationalControlLinks: { none: { control: { status: "ACTIVE" } } },
  };
  return prisma.environmentalAspect.findMany({
    where: tenantWhere(ctx, gapWhere),
    include: { process: { select: { id: true, name: true, siteId: true, entityId: true } } },
    orderBy: { name: "asc" },
  });
}

async function validateReferences(context: OrganisationContext, input: OperationalControlInput) {
  const ctx = toTenantRepositoryContext(context);
  const aspectIds = [...new Set(input.aspectIds.filter(Boolean))];
  if (aspectIds.length === 0) throw new OperationalControlError("Link at least one environmental aspect.");
  if (!(input.reviewDueDate instanceof Date) || Number.isNaN(input.reviewDueDate.getTime())) {
    throw new OperationalControlError("Enter a valid review due date.");
  }

  const aspects = await prisma.environmentalAspect.findMany({
    where: tenantWhere(ctx, { id: { in: aspectIds } }),
    include: { process: { select: { id: true, siteId: true, entityId: true } } },
  });
  if (aspects.length !== aspectIds.length) throw new TenantOwnershipError();
  aspects.forEach((aspect) => assertProcessInScope(context, aspect.process));

  const owner = await prisma.organisationMembership.findFirst({
    where: { id: input.ownerMembershipId, organisationId: ctx.organisationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!owner) throw new TenantOwnershipError();

  let documentRevision: { id: string } | null = null;
  if (input.controlledDocumentRevisionId) {
    const documentWhere: Prisma.ControlledDocumentRevisionWhereInput = {
      id: input.controlledDocumentRevisionId,
      status: { in: ["APPROVED", "EFFECTIVE"] },
    };
    documentRevision = await prisma.controlledDocumentRevision.findFirst({
      where: tenantWhere(ctx, documentWhere),
      select: { id: true },
    });
    if (!documentRevision) {
      throw new OperationalControlError("Choose an approved or effective controlled-document revision from this organisation.");
    }
  }

  const applicabilities = input.applicabilities ?? [];
  for (const applicability of applicabilities) {
    if (!applicability.entityId && !applicability.siteId && !applicability.processId && !applicability.externalProviderReference?.trim()) {
      throw new OperationalControlError("Each applicability entry must identify an entity, site, process, or provider reference.");
    }
    const [entity, site, process] = await Promise.all([
      applicability.entityId
        ? prisma.entity.findFirst({ where: tenantWhere(ctx, { id: applicability.entityId }), select: { id: true } })
        : null,
      applicability.siteId
        ? prisma.site.findFirst({ where: tenantWhere(ctx, { id: applicability.siteId }), select: { id: true, entityId: true } })
        : null,
      applicability.processId
        ? prisma.activityProcess.findFirst({ where: tenantWhere(ctx, { id: applicability.processId }), select: { id: true, siteId: true, entityId: true } })
        : null,
    ]);
    if ((applicability.entityId && !entity) || (applicability.siteId && !site) || (applicability.processId && !process)) {
      throw new TenantOwnershipError();
    }
    if (process) assertProcessInScope(context, process);
    if (context.access.mode === "RESTRICTED") {
      if (site && !context.access.siteIds.has(site.id) && !context.access.entityIds.has(site.entityId)) throw new TenantOwnershipError();
      if (entity && !context.access.entityIds.has(entity.id)) throw new TenantOwnershipError();
    }
  }

  return { aspectIds, documentRevision, applicabilities };
}

async function createControlVersion(
  context: OrganisationContext,
  input: OperationalControlInput,
  version: number,
  supersedesControlId: string | null,
) {
  requirePermission(context, "ems.control.manage");
  const validated = await validateReferences(context, input);
  const ctx = toTenantRepositoryContext(context);
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const control = await tx.operationalControl.create({
      data: {
        organisationId: txCtx.organisationId,
        controlKey: input.controlKey.trim(),
        version,
        title: input.title.trim(),
        type: input.type,
        description: input.description?.trim() || null,
        frequency: input.frequency?.trim() || null,
        acceptanceCriteria: input.acceptanceCriteria?.trim() || null,
        effectivenessCriteria: input.effectivenessCriteria?.trim() || null,
        ownerMembershipId: input.ownerMembershipId,
        controlledDocumentRevisionId: validated.documentRevision?.id ?? null,
        reviewDueDate: input.reviewDueDate,
        reviewedAt: supersedesControlId ? new Date() : null,
        supersedesControlId,
        createdByUserId: input.actorUserId,
        aspectLinks: {
          create: validated.aspectIds.map((aspectId) => ({ organisationId: txCtx.organisationId, aspectId })),
        },
        applicabilities: {
          create: validated.applicabilities.map((item) => ({
            organisationId: txCtx.organisationId,
            entityId: item.entityId || null,
            siteId: item.siteId || null,
            processId: item.processId || null,
            externalProviderReference: item.externalProviderReference?.trim() || null,
          })),
        },
      },
      include: { aspectLinks: true, applicabilities: true },
    });
    if (supersedesControlId) {
      await tx.operationalControl.update({
        where: { organisationId_id: { organisationId: txCtx.organisationId, id: supersedesControlId } },
        data: { status: "SUPERSEDED", reviewedAt: new Date() },
      });
      await suppressNotificationsForResource(tx, txCtx, "operational_control", supersedesControlId);
    }
    await recordAuditEvent(tx, txCtx, {
      eventType: supersedesControlId ? "operational_control.revised" : "operational_control.created",
      resourceType: "operational_control",
      resourceId: control.id,
      summary: `Operational control "${control.title}" version ${version} recorded.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { controlKey: control.controlKey, version, aspectIds: validated.aspectIds },
    });
    return control;
  });
}

export async function createOperationalControl(context: OrganisationContext, input: OperationalControlInput) {
  requirePermission(context, "ems.control.manage");
  const ctx = toTenantRepositoryContext(context);
  const existing = await prisma.operationalControl.findFirst({
    where: tenantWhere(ctx, { controlKey: input.controlKey.trim() }),
    select: { id: true },
  });
  if (existing) throw new OperationalControlError("That control key already exists. Review it to create a successor version.");
  return createControlVersion(context, input, 1, null);
}

export async function reviseOperationalControl(
  context: OrganisationContext,
  controlId: string,
  input: Omit<OperationalControlInput, "controlKey">,
) {
  requirePermission(context, "ems.control.manage");
  const ctx = toTenantRepositoryContext(context);
  const current = await prisma.operationalControl.findFirst({
    where: tenantWhere(ctx, { id: controlId, ...visibleControlWhere(context) }),
    include: { aspectLinks: true, applicabilities: true },
  });
  if (!current) throw new TenantOwnershipError();
  if (current.status !== "ACTIVE") throw new OperationalControlError("Only the current active control can be reviewed.");
  const latest = await prisma.operationalControl.findFirst({
    where: tenantWhere(ctx, { controlKey: current.controlKey }),
    orderBy: { version: "desc" },
  });
  if (!latest || latest.id !== current.id) throw new OperationalControlError("Review the latest control version.");
  return createControlVersion(context, { ...input, controlKey: current.controlKey }, current.version + 1, current.id);
}

export async function retireOperationalControl(context: OrganisationContext, controlId: string, actorUserId: string) {
  requirePermission(context, "ems.control.manage");
  const ctx = toTenantRepositoryContext(context);
  const control = await findVisibleControl(context, controlId);
  if (!control || control.status !== "ACTIVE") throw new OperationalControlError("Only an active control can be retired.");
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const retired = await tx.operationalControl.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: control.id } },
      data: { status: "RETIRED", reviewedAt: new Date() },
    });
    await suppressNotificationsForResource(tx, txCtx, "operational_control", control.id);
    await recordAuditEvent(tx, txCtx, {
      eventType: "operational_control.retired", resourceType: "operational_control", resourceId: control.id,
      summary: `Operational control "${control.title}" retired.`, actorUserId, correlationId: txCtx.correlationId,
      source: "web-app", before: { status: "ACTIVE" }, after: { status: "RETIRED" },
    });
    return retired;
  });
}

export interface RecordControlCheckInput {
  controlId: string;
  scheduledAt: Date;
  performedAt?: Date | null;
  result: ControlCheckResult;
  notes?: string | null;
  exceptionSummary?: string | null;
  actionReference?: string | null;
  actorUserId: string;
}

export async function recordControlCheck(context: OrganisationContext, input: RecordControlCheckInput) {
  requirePermission(context, "ems.control.manage");
  const ctx = toTenantRepositoryContext(context);
  const control = await findVisibleControl(context, input.controlId);
  if (!control || control.status !== "ACTIVE") throw new OperationalControlError("Checks can only be recorded against the active control version.");
  if (input.result === "FAIL" && !input.exceptionSummary?.trim()) {
    throw new OperationalControlError("A failed check requires an exception summary.");
  }
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const check = await tx.controlCheck.create({
      data: {
        organisationId: txCtx.organisationId,
        controlId: control.id,
        scheduledAt: input.scheduledAt,
        performedAt: input.result === "PENDING" ? null : input.performedAt ?? new Date(),
        result: input.result,
        notes: input.notes?.trim() || null,
        exceptionSummary: input.exceptionSummary?.trim() || null,
        actionReference: input.actionReference?.trim() || null,
        reviewerMembershipId: input.result === "PENDING" ? null : context.membershipId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "control_check.recorded", resourceType: "control_check", resourceId: check.id,
      summary: `Operational-control check recorded with result ${check.result}.`, actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId, source: "web-app", after: { controlId: control.id, result: check.result },
    });
    return check;
  });
}

/** Explicitly evaluates overdue ACTIVE controls; callers decide when to run it (no background scheduler). */
export async function notifyOverdueControlReviews(context: OrganisationContext, asOf = new Date()) {
  requirePermission(context, "ems.control.manage");
  const ctx = toTenantRepositoryContext(context);
  const overdueWhere: Prisma.OperationalControlWhereInput = {
    ...visibleControlWhere(context), status: "ACTIVE", reviewDueDate: { lt: asOf },
  };
  const controls = await prisma.operationalControl.findMany({
    where: tenantWhere(ctx, overdueWhere),
    select: { id: true, ownerMembershipId: true, reviewDueDate: true },
  });
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const results = [];
    for (const control of controls) {
      const outcome = await notifyMembership(tx, txCtx, {
        type: "review.overdue",
        recipientMembershipId: control.ownerMembershipId,
        resourceType: "operational_control",
        resourceId: control.id,
        dedupeKey: `operational-control-review:${control.id}:${control.reviewDueDate.toISOString()}`,
      });
      results.push({ controlId: control.id, ...outcome });
    }
    return results;
  });
}

export async function uploadEvidenceToControlCheck(
  context: OrganisationContext,
  input: { checkId: string; fileName: string; mimeType: string; bytes: Buffer; purpose?: string | null; actorUserId: string },
) {
  requirePermission(context, "ems.control.manage");
  const ctx = toTenantRepositoryContext(context);
  const check = await prisma.controlCheck.findFirst({
    where: tenantWhere(ctx, { id: input.checkId, control: visibleControlWhere(context) }),
  });
  if (!check) throw new TenantOwnershipError();
  const evidence = await uploadEvidenceObject(context, {
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
    uploadedByUserId: input.actorUserId,
  });
  await linkEvidence(context, {
    evidenceId: evidence.id,
    resourceType: "control_check",
    resourceId: check.id,
    purpose: input.purpose,
    linkedByUserId: input.actorUserId,
  });
  return evidence;
}

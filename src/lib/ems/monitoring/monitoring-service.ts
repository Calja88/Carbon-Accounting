/** Tenant-scoped environmental monitoring plans and append-only results (T34). */

import type { MonitoringDataQualityFlag, MonitoringValidityDecision, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { D, InvalidNumberError } from "@/lib/lca/decimal";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { linkEvidence, uploadEvidenceObject } from "@/lib/documents/evidence-service";

export { TenantOwnershipError };

export class MonitoringError extends Error {}

function processIsVisible(context: OrganisationContext, process: { siteId: string | null; entityId: string | null }): boolean {
  return context.access.mode === "ORGANISATION_WIDE"
    || Boolean(process.siteId && context.access.siteIds.has(process.siteId))
    || Boolean(process.entityId && context.access.entityIds.has(process.entityId));
}

export function visibleMonitoringPlanWhere(context: OrganisationContext): Prisma.MonitoringPlanWhereInput {
  if (context.access.mode === "ORGANISATION_WIDE") return {};
  const siteIds = [...context.access.siteIds];
  const entityIds = [...context.access.entityIds];
  const processWhere = { OR: [{ siteId: { in: siteIds } }, { entityId: { in: entityIds } }] };
  return {
    OR: [
      { aspect: { process: processWhere } },
      { control: { aspectLinks: { some: { aspect: { process: processWhere } } } } },
    ],
  };
}

async function findVisiblePlan(context: OrganisationContext, planId: string) {
  const ctx = toTenantRepositoryContext(context);
  return prisma.monitoringPlan.findFirst({
    where: tenantWhere(ctx, { id: planId, ...visibleMonitoringPlanWhere(context) }),
  });
}

export interface MonitoringPlanInput {
  planKey: string;
  parameter: string;
  method: string;
  location: string;
  frequency: string;
  unit: string;
  acceptanceCriteria: string;
  aspectId?: string | null;
  controlId?: string | null;
  obligationReference?: string | null;
  objectiveReference?: string | null;
  responsibleMembershipId: string;
  instrumentRequired: boolean;
  equipmentId?: string | null;
  reviewDueDate?: Date | null;
  actorUserId: string;
}

async function validatePlanReferences(context: OrganisationContext, input: MonitoringPlanInput) {
  const ctx = toTenantRepositoryContext(context);
  const method = input.method.trim();
  const unit = input.unit.trim();
  if (!method) throw new MonitoringError("Monitoring method is mandatory.");
  if (!unit) throw new MonitoringError("Monitoring unit is mandatory.");
  if (!input.aspectId && !input.controlId && !input.obligationReference?.trim() && !input.objectiveReference?.trim()) {
    throw new MonitoringError("Link the plan to an aspect, control, obligation, or objective.");
  }
  if (context.access.mode === "RESTRICTED" && !input.aspectId && !input.controlId) {
    throw new TenantOwnershipError();
  }
  if (input.instrumentRequired && !input.equipmentId) {
    throw new MonitoringError("Choose calibrated equipment when an instrument is required.");
  }

  const aspect = input.aspectId
    ? await prisma.environmentalAspect.findFirst({
      where: tenantWhere(ctx, { id: input.aspectId }),
      include: { process: { select: { siteId: true, entityId: true } } },
    })
    : null;
  const controlWhere: Prisma.OperationalControlWhereInput | undefined = input.controlId
    ? tenantWhere(ctx, { id: input.controlId, status: "ACTIVE" as const })
    : undefined;
  const control = controlWhere
    ? await prisma.operationalControl.findFirst({
      where: controlWhere,
      include: { aspectLinks: { include: { aspect: { include: { process: { select: { siteId: true, entityId: true } } } } } } },
    })
    : null;
  const equipmentWhere: Prisma.MonitoringEquipmentWhereInput | undefined = input.equipmentId
    ? tenantWhere(ctx, {
      id: input.equipmentId,
      status: "ACTIVE" as const,
      ...(context.access.mode === "RESTRICTED" ? {
        OR: [
          { ownerMembershipId: context.membershipId },
          { plans: { some: visibleMonitoringPlanWhere(context) } },
        ],
      } : {}),
    })
    : undefined;
  const equipment = equipmentWhere ? await prisma.monitoringEquipment.findFirst({ where: equipmentWhere }) : null;
  const responsible = await prisma.organisationMembership.findFirst({
    where: { organisationId: ctx.organisationId, id: input.responsibleMembershipId, status: "ACTIVE" },
    select: { id: true },
  });

  if ((input.aspectId && !aspect) || (input.controlId && !control) || (input.equipmentId && !equipment) || !responsible) {
    throw new TenantOwnershipError();
  }
  if (aspect && !processIsVisible(context, aspect.process)) throw new TenantOwnershipError();
  if (control && context.access.mode === "RESTRICTED" && !control.aspectLinks.some((link) => processIsVisible(context, link.aspect.process))) {
    throw new TenantOwnershipError();
  }
  if (aspect && control && !control.aspectLinks.some((link) => link.aspectId === aspect.id)) {
    throw new MonitoringError("The selected operational control is not linked to the selected aspect.");
  }
  return { method, unit };
}

export async function listMonitoringPlans(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.monitoringPlan.findMany({
    where: tenantWhere(ctx, visibleMonitoringPlanWhere(context)),
    include: {
      aspect: { select: { id: true, name: true } },
      control: { select: { id: true, title: true, version: true } },
      responsible: { include: { user: { select: { name: true } } } },
      equipment: { select: { id: true, reference: true, calibrationDueDate: true, status: true } },
      results: {
        include: { exceptionReview: true },
        orderBy: { measuredAt: "desc" },
        take: 20,
      },
    },
    orderBy: { planKey: "asc" },
  });
}

export async function createMonitoringPlan(context: OrganisationContext, input: MonitoringPlanInput) {
  requirePermission(context, "ems.monitoring.record");
  const validated = await validatePlanReferences(context, input);
  const ctx = toTenantRepositoryContext(context);
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const plan = await tx.monitoringPlan.create({
      data: {
        organisationId: txCtx.organisationId,
        planKey: input.planKey.trim(),
        parameter: input.parameter.trim(),
        method: validated.method,
        location: input.location.trim(),
        frequency: input.frequency.trim(),
        unit: validated.unit,
        acceptanceCriteria: input.acceptanceCriteria.trim(),
        aspectId: input.aspectId || null,
        controlId: input.controlId || null,
        obligationReference: input.obligationReference?.trim() || null,
        objectiveReference: input.objectiveReference?.trim() || null,
        responsibleMembershipId: input.responsibleMembershipId,
        instrumentRequired: input.instrumentRequired,
        equipmentId: input.equipmentId || null,
        reviewDueDate: input.reviewDueDate || null,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "monitoring_plan.created", resourceType: "monitoring_plan", resourceId: plan.id,
      summary: `Environmental monitoring plan "${plan.planKey}" created.`, actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId, source: "web-app",
      after: { planKey: plan.planKey, aspectId: plan.aspectId, controlId: plan.controlId, unit: plan.unit },
    });
    return plan;
  });
}

export interface MonitoringResultInput {
  planId: string;
  measuredAt: Date;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  value: string;
  unit: string;
  qualitativeResult?: string | null;
  dataQualityFlag: MonitoringDataQualityFlag;
  actorUserId: string;
}

export async function recordMonitoringResult(context: OrganisationContext, input: MonitoringResultInput) {
  requirePermission(context, "ems.monitoring.record");
  const ctx = toTenantRepositoryContext(context);
  const plan = await findVisiblePlan(context, input.planId);
  if (!plan || plan.status !== "ACTIVE") throw new TenantOwnershipError();
  if (input.unit.trim() !== plan.unit) {
    throw new MonitoringError(`Result unit must exactly match the plan unit "${plan.unit}".`);
  }
  if (input.periodStart && input.periodEnd && input.periodEnd < input.periodStart) {
    throw new MonitoringError("The monitoring period end cannot precede its start.");
  }
  let value;
  try {
    value = D(input.value);
  } catch (error) {
    if (error instanceof InvalidNumberError) throw new MonitoringError("Enter a finite Decimal monitoring result.");
    throw error;
  }
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const result = await tx.monitoringResult.create({
      data: {
        organisationId: txCtx.organisationId,
        planId: plan.id,
        measuredAt: input.measuredAt,
        periodStart: input.periodStart || null,
        periodEnd: input.periodEnd || null,
        value,
        unit: plan.unit,
        qualitativeResult: input.qualitativeResult?.trim() || null,
        dataQualityFlag: input.dataQualityFlag,
        reviewStatus: input.dataQualityFlag === "SUSPECT" || input.dataQualityFlag === "REJECTED"
          ? "EXCEPTION_REVIEW_REQUIRED"
          : "PENDING",
        recordedByMembershipId: context.membershipId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "monitoring_result.recorded", resourceType: "monitoring_result", resourceId: result.id,
      summary: "Environmental monitoring result recorded.", actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId, source: "web-app",
      after: { planId: plan.id, unit: plan.unit, dataQualityFlag: result.dataQualityFlag },
    });
    return result;
  });
}

async function findVisibleResult(context: OrganisationContext, resultId: string) {
  const ctx = toTenantRepositoryContext(context);
  return prisma.monitoringResult.findFirst({
    where: tenantWhere(ctx, { id: resultId, plan: visibleMonitoringPlanWhere(context) }),
  });
}

export async function reviewMonitoringResult(
  context: OrganisationContext,
  input: { resultId: string; reviewNote: string; actorUserId: string },
) {
  requirePermission(context, "ems.monitoring.review");
  const ctx = toTenantRepositoryContext(context);
  const result = await findVisibleResult(context, input.resultId);
  if (!result) throw new TenantOwnershipError();
  if (result.reviewStatus === "EXCEPTION_REVIEW_REQUIRED") {
    throw new MonitoringError("This result requires a documented exception review.");
  }
  if (result.reviewStatus === "REVIEWED") throw new MonitoringError("This result has already been reviewed.");
  if (!input.reviewNote.trim()) throw new MonitoringError("Document the result review.");
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const reviewed = await tx.monitoringResult.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: result.id } },
      data: { reviewStatus: "REVIEWED", reviewedByMembershipId: context.membershipId, reviewedAt: new Date(), reviewNote: input.reviewNote.trim() },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "monitoring_result.reviewed", resourceType: "monitoring_result", resourceId: result.id,
      summary: "Environmental monitoring result reviewed without changing the recorded measurement.",
      actorUserId: input.actorUserId, correlationId: txCtx.correlationId, source: "web-app",
      after: { reviewStatus: reviewed.reviewStatus },
    });
    return reviewed;
  });
}

export async function documentResultExceptionReview(
  context: OrganisationContext,
  input: { resultId: string; reason: string; validityDecision: MonitoringValidityDecision; consequence: string; actionReference?: string | null; actorUserId: string },
) {
  requirePermission(context, "ems.monitoring.review");
  const ctx = toTenantRepositoryContext(context);
  const result = await findVisibleResult(context, input.resultId);
  if (!result) throw new TenantOwnershipError();
  if (!input.reason.trim() || !input.consequence.trim()) throw new MonitoringError("Document the exception reason and consequences.");
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const review = await tx.monitoringExceptionReview.create({
      data: {
        organisationId: txCtx.organisationId, resultId: result.id, reason: input.reason.trim(),
        validityDecision: input.validityDecision, consequence: input.consequence.trim(),
        actionReference: input.actionReference?.trim() || null, reviewedByMembershipId: context.membershipId,
      },
    });
    await tx.monitoringResult.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: result.id } },
      data: { reviewStatus: "REVIEWED", reviewedByMembershipId: context.membershipId, reviewedAt: review.reviewedAt, reviewNote: input.reason.trim() },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "monitoring_exception.reviewed", resourceType: "monitoring_result", resourceId: result.id,
      summary: "Monitoring exception reviewed; the original result remains retained.", actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId, source: "web-app", after: { validityDecision: review.validityDecision },
    });
    return review;
  });
}

export async function uploadEvidenceToMonitoringResult(
  context: OrganisationContext,
  input: { resultId: string; fileName: string; mimeType: string; bytes: Buffer; purpose?: string | null; actorUserId: string },
) {
  requirePermission(context, "ems.monitoring.record");
  const result = await findVisibleResult(context, input.resultId);
  if (!result) throw new TenantOwnershipError();
  const evidence = await uploadEvidenceObject(context, {
    fileName: input.fileName, mimeType: input.mimeType, bytes: input.bytes, uploadedByUserId: input.actorUserId,
  });
  await linkEvidence(context, {
    evidenceId: evidence.id, resourceType: "monitoring_result", resourceId: result.id,
    purpose: input.purpose, linkedByUserId: input.actorUserId,
  });
  return evidence;
}

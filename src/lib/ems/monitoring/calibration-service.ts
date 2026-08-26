/** Tenant-scoped monitoring equipment, calibration assurance, and reminders (T34). */

import type { EquipmentCalibrationResult, MonitoringValidityDecision, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { notifyMembership } from "@/lib/notifications/notification-service";
import { linkEvidence, uploadEvidenceObject } from "@/lib/documents/evidence-service";
import { visibleMonitoringPlanWhere } from "./monitoring-service";

export { TenantOwnershipError };

export class CalibrationError extends Error {}

function visibleEquipmentWhere(context: OrganisationContext): Prisma.MonitoringEquipmentWhereInput {
  if (context.access.mode === "ORGANISATION_WIDE") return {};
  return {
    OR: [
      { ownerMembershipId: context.membershipId },
      { plans: { some: visibleMonitoringPlanWhere(context) } },
    ],
  };
}

async function findVisibleEquipment(context: OrganisationContext, equipmentId: string) {
  const ctx = toTenantRepositoryContext(context);
  return prisma.monitoringEquipment.findFirst({
    where: tenantWhere(ctx, { id: equipmentId, ...visibleEquipmentWhere(context) }),
  });
}

export async function listMonitoringEquipment(context: OrganisationContext, asOf = new Date()) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const equipment = await prisma.monitoringEquipment.findMany({
    where: tenantWhere(ctx, visibleEquipmentWhere(context)),
    include: {
      owner: { include: { user: { select: { name: true } } } },
      calibrations: { include: { exceptionReview: true }, orderBy: { performedAt: "desc" }, take: 20 },
    },
    orderBy: { reference: "asc" },
  });
  return equipment.map((item) => ({
    ...item,
    calibrationOverdue: item.status === "ACTIVE" && item.calibrationDueDate.getTime() < asOf.getTime(),
  }));
}

export interface MonitoringEquipmentInput {
  reference: string;
  description: string;
  location: string;
  calibrationFrequency: string;
  calibrationDueDate: Date;
  ownerMembershipId: string;
  actorUserId: string;
}

export async function createMonitoringEquipment(context: OrganisationContext, input: MonitoringEquipmentInput) {
  requirePermission(context, "ems.monitoring.record");
  const ctx = toTenantRepositoryContext(context);
  const owner = await prisma.organisationMembership.findFirst({
    where: { organisationId: ctx.organisationId, id: input.ownerMembershipId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!owner || (context.access.mode === "RESTRICTED" && owner.id !== context.membershipId)) throw new TenantOwnershipError();
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const equipment = await tx.monitoringEquipment.create({
      data: {
        organisationId: txCtx.organisationId, reference: input.reference.trim(), description: input.description.trim(),
        location: input.location.trim(), calibrationFrequency: input.calibrationFrequency.trim(),
        calibrationDueDate: input.calibrationDueDate, ownerMembershipId: input.ownerMembershipId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "monitoring_equipment.created", resourceType: "monitoring_equipment", resourceId: equipment.id,
      summary: `Monitoring equipment "${equipment.reference}" recorded.`, actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId, source: "web-app", after: { reference: equipment.reference },
    });
    return equipment;
  });
}

/**
 * Retires a piece of monitoring equipment, or takes it out of service.
 *
 * Equipment is OPERATIONAL_CONTROLLED: its calibration history is the
 * assurance record behind every result measured with it, and both
 * `EquipmentCalibration` and `MonitoringPlan` reference it with
 * `onDelete: Restrict`. `RETIRED`/`OUT_OF_SERVICE` are the terminal states
 * the enum already carries, so no delete path is added. Retiring equipment
 * that active plans still depend on is refused rather than silently
 * orphaning those plans — deactivate or re-equip the plan first.
 */
export async function retireMonitoringEquipment(
  context: OrganisationContext,
  input: { equipmentId: string; status: "RETIRED" | "OUT_OF_SERVICE"; reason: string; actorUserId: string },
) {
  requirePermission(context, "ems.monitoring.record");
  const ctx = toTenantRepositoryContext(context);
  const equipment = await findVisibleEquipment(context, input.equipmentId);
  if (!equipment) throw new TenantOwnershipError();
  if (equipment.status === input.status) throw new CalibrationError("This equipment is already in that state.");
  if (equipment.status === "RETIRED") throw new CalibrationError("Retired equipment cannot be returned to service.");
  if (!input.reason.trim()) throw new CalibrationError("Record why the equipment is being taken out of use.");
  const activePlans = await prisma.monitoringPlan.count({
    where: tenantWhere(ctx, { equipmentId: equipment.id, status: { in: ["DRAFT" as const, "ACTIVE" as const] } }),
  });
  if (activePlans > 0) {
    throw new CalibrationError(
      `${activePlans} active monitoring plan(s) still use this equipment. Deactivate or re-equip them first.`,
    );
  }
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.monitoringEquipment.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: equipment.id } },
      data: { status: input.status },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "monitoring_equipment.retired", resourceType: "monitoring_equipment", resourceId: equipment.id,
      summary: `Monitoring equipment "${equipment.reference}" moved to ${input.status}: ${input.reason.trim()}`,
      actorUserId: input.actorUserId, correlationId: txCtx.correlationId, source: "web-app",
      before: { status: equipment.status }, after: { status: updated.status },
    });
    return updated;
  });
}

export interface EquipmentCalibrationInput {
  equipmentId: string;
  dueDate: Date;
  performedAt: Date;
  provider: string;
  method: string;
  result: EquipmentCalibrationResult;
  nextDueDate: Date;
  responseReference?: string | null;
  actorUserId: string;
}

export async function recordEquipmentCalibration(context: OrganisationContext, input: EquipmentCalibrationInput) {
  requirePermission(context, "ems.monitoring.record");
  const ctx = toTenantRepositoryContext(context);
  const equipment = await findVisibleEquipment(context, input.equipmentId);
  if (!equipment || equipment.status === "RETIRED") throw new TenantOwnershipError();
  if (input.nextDueDate < input.performedAt) throw new CalibrationError("The next calibration due date cannot precede the performed date.");
  const outOfTolerance = input.result === "OUT_OF_TOLERANCE";
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const calibration = await tx.equipmentCalibration.create({
      data: {
        organisationId: txCtx.organisationId, equipmentId: equipment.id, dueDate: input.dueDate,
        performedAt: input.performedAt, provider: input.provider.trim(), method: input.method.trim(),
        result: input.result, nextDueDate: input.nextDueDate, outOfTolerance,
        responseReference: input.responseReference?.trim() || null, recordedByMembershipId: context.membershipId,
      },
    });
    await tx.monitoringEquipment.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: equipment.id } },
      data: { calibrationDueDate: input.nextDueDate, status: outOfTolerance ? "OUT_OF_SERVICE" : "ACTIVE" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "equipment_calibration.recorded", resourceType: "equipment_calibration", resourceId: calibration.id,
      summary: "Monitoring-equipment calibration recorded.", actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId, source: "web-app",
      after: { equipmentId: equipment.id, result: calibration.result, outOfTolerance },
    });
    return calibration;
  });
}

async function findVisibleCalibration(context: OrganisationContext, calibrationId: string) {
  const ctx = toTenantRepositoryContext(context);
  return prisma.equipmentCalibration.findFirst({
    where: tenantWhere(ctx, { id: calibrationId, equipment: visibleEquipmentWhere(context) }),
    include: { exceptionReview: true },
  });
}

export async function documentCalibrationExceptionReview(
  context: OrganisationContext,
  input: { calibrationId: string; reason: string; validityDecision: MonitoringValidityDecision; consequence: string; actionReference?: string | null; actorUserId: string },
) {
  requirePermission(context, "ems.monitoring.review");
  const ctx = toTenantRepositoryContext(context);
  const calibration = await findVisibleCalibration(context, input.calibrationId);
  if (!calibration) throw new TenantOwnershipError();
  if (!calibration.outOfTolerance) throw new CalibrationError("Only an out-of-tolerance calibration requires this review.");
  if (calibration.exceptionReview) throw new CalibrationError("This calibration already has a documented exception review.");
  if (!input.reason.trim() || !input.consequence.trim()) throw new CalibrationError("Document the exception reason and consequences.");
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const review = await tx.monitoringExceptionReview.create({
      data: {
        organisationId: txCtx.organisationId, calibrationId: calibration.id, reason: input.reason.trim(),
        validityDecision: input.validityDecision, consequence: input.consequence.trim(),
        actionReference: input.actionReference?.trim() || calibration.responseReference || null,
        reviewedByMembershipId: context.membershipId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "calibration_exception.reviewed", resourceType: "equipment_calibration", resourceId: calibration.id,
      summary: "Out-of-tolerance calibration reviewed; historic monitoring records remain retained.",
      actorUserId: input.actorUserId, correlationId: txCtx.correlationId, source: "web-app",
      after: { validityDecision: review.validityDecision, actionReference: review.actionReference },
    });
    return review;
  });
}

/** Explicit, user-triggered evaluation only; T34 does not install a scheduler. */
export async function notifyOverdueCalibrations(context: OrganisationContext, asOf = new Date()) {
  requirePermission(context, "ems.monitoring.record");
  const ctx = toTenantRepositoryContext(context);
  const overdueWhere: Prisma.MonitoringEquipmentWhereInput = {
    ...visibleEquipmentWhere(context), status: "ACTIVE", calibrationDueDate: { lt: asOf },
  };
  const equipment = await prisma.monitoringEquipment.findMany({
    where: tenantWhere(ctx, overdueWhere),
    select: { id: true, ownerMembershipId: true, calibrationDueDate: true },
  });
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const outcomes = [];
    for (const item of equipment) {
      const outcome = await notifyMembership(tx, txCtx, {
        type: "expiry.expired", recipientMembershipId: item.ownerMembershipId,
        resourceType: "monitoring_equipment", resourceId: item.id,
        dedupeKey: `equipment-calibration:${item.id}:${item.calibrationDueDate.toISOString()}`,
      });
      outcomes.push({ equipmentId: item.id, ...outcome });
    }
    return outcomes;
  });
}

export async function uploadCalibrationCertificate(
  context: OrganisationContext,
  input: { calibrationId: string; fileName: string; mimeType: string; bytes: Buffer; actorUserId: string },
) {
  requirePermission(context, "ems.monitoring.record");
  const calibration = await findVisibleCalibration(context, input.calibrationId);
  if (!calibration) throw new TenantOwnershipError();
  const evidence = await uploadEvidenceObject(context, {
    fileName: input.fileName, mimeType: input.mimeType, bytes: input.bytes, uploadedByUserId: input.actorUserId,
  });
  await linkEvidence(context, {
    evidenceId: evidence.id, resourceType: "equipment_calibration", resourceId: calibration.id,
    purpose: "Calibration or verification certificate", linkedByUserId: input.actorUserId,
  });
  return evidence;
}

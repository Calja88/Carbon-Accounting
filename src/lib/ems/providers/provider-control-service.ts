/**
 * Tenant-scoped external-provider controls and evaluations (task T35,
 * Docs/PHASE3_ASPECTS_OPERATIONS_SPEC.md §2 "Operational controls" /
 * §5 "External-provider controls/evaluations"). Mirrors the T33
 * control-service pattern: `ems.control.manage` covers provider controls
 * per the Phase 3 spec §4 permission table, no separate code exists.
 *
 * `providerReference` is the same stable identifier
 * `ControlApplicability.externalProviderReference` was left as a task-local
 * text hook for in T33 — an operational control's applicability entry can
 * name a provider by this reference, and this module is where that
 * reference now resolves to a real, permission-checked record.
 */

import type { ExternalProviderControlStatus, ExternalProviderEvaluationResult, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext, findTenantExternalProviderControl } from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { notifyMembership } from "@/lib/notifications/notification-service";
import { linkEvidence, uploadEvidenceObject } from "@/lib/documents/evidence-service";

export { TenantOwnershipError };

export class ExternalProviderControlError extends Error {}

export interface ExternalProviderControlInput {
  providerReference: string;
  providerName: string;
  providedDescription: string;
  communicatedRequirements: string;
  evaluationFrequency: string;
  ownerMembershipId: string;
  nextReviewDueDate: Date;
  aspectIds: string[];
  actorUserId: string;
}

async function validateAspects(context: OrganisationContext, aspectIds: string[]) {
  const ctx = toTenantRepositoryContext(context);
  const ids = [...new Set(aspectIds.filter(Boolean))];
  if (ids.length === 0) throw new ExternalProviderControlError("Link at least one environmental aspect.");
  const aspects = await prisma.environmentalAspect.findMany({
    where: tenantWhere(ctx, { id: { in: ids } }),
    select: { id: true },
  });
  if (aspects.length !== ids.length) throw new TenantOwnershipError();
  return ids;
}

export async function createExternalProviderControl(context: OrganisationContext, input: ExternalProviderControlInput) {
  requirePermission(context, "ems.control.manage");
  const ctx = toTenantRepositoryContext(context);
  const aspectIds = await validateAspects(context, input.aspectIds);

  const owner = await prisma.organisationMembership.findFirst({
    where: { id: input.ownerMembershipId, organisationId: ctx.organisationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!owner) throw new TenantOwnershipError();

  const existing = await prisma.externalProviderControl.findFirst({
    where: tenantWhere(ctx, { providerReference: input.providerReference.trim() }),
    select: { id: true },
  });
  if (existing) throw new ExternalProviderControlError("That provider reference already exists.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const control = await tx.externalProviderControl.create({
      data: {
        organisationId: txCtx.organisationId,
        providerReference: input.providerReference.trim(),
        providerName: input.providerName.trim(),
        providedDescription: input.providedDescription.trim(),
        communicatedRequirements: input.communicatedRequirements.trim(),
        evaluationFrequency: input.evaluationFrequency.trim(),
        ownerMembershipId: input.ownerMembershipId,
        nextReviewDueDate: input.nextReviewDueDate,
        createdByUserId: input.actorUserId,
        aspectLinks: { create: aspectIds.map((aspectId) => ({ organisationId: txCtx.organisationId, aspectId })) },
      },
      include: { aspectLinks: true },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "external_provider_control.created",
      resourceType: "external_provider_control",
      resourceId: control.id,
      summary: `External-provider control "${control.providerName}" recorded.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { providerReference: control.providerReference, aspectIds },
    });
    return control;
  });
}

export async function listExternalProviderControls(context: OrganisationContext, asOf = new Date()) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const controls = await prisma.externalProviderControl.findMany({
    where: tenantWhere(ctx, {}),
    include: {
      owner: { select: { id: true, user: { select: { name: true } } } },
      aspectLinks: { include: { aspect: { select: { id: true, name: true } } } },
      evaluations: { orderBy: { evaluatedAt: "desc" }, take: 10 },
    },
    orderBy: { providerReference: "asc" },
  });
  return controls.map((control) => ({
    ...control,
    reviewOverdue: control.status === "ACTIVE" && control.nextReviewDueDate.getTime() < asOf.getTime(),
  }));
}

export async function setExternalProviderControlStatus(
  context: OrganisationContext,
  providerControlId: string,
  status: ExternalProviderControlStatus,
  actorUserId: string,
) {
  requirePermission(context, "ems.control.manage");
  const ctx = toTenantRepositoryContext(context);
  const control = await findTenantExternalProviderControl(ctx, providerControlId);
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.externalProviderControl.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: control.id } },
      data: { status },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "external_provider_control.status_changed",
      resourceType: "external_provider_control",
      resourceId: control.id,
      summary: `External-provider control "${control.providerName}" set to ${status}.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: control.status },
      after: { status },
    });
    return updated;
  });
}

export interface RecordExternalProviderEvaluationInput {
  providerControlId: string;
  evaluatedAt: Date;
  result: ExternalProviderEvaluationResult;
  notes?: string | null;
  actionReference?: string | null;
  nextReviewDueDate: Date;
  actorUserId: string;
}

/**
 * Records one evaluation event against a snapshot of the provider's
 * communicated requirements/frequency at evaluation time, and moves the
 * provider's own review clock forward. Never overwrites a prior evaluation.
 */
export async function recordExternalProviderEvaluation(
  context: OrganisationContext,
  input: RecordExternalProviderEvaluationInput,
) {
  requirePermission(context, "ems.control.manage");
  const ctx = toTenantRepositoryContext(context);
  const control = await findTenantExternalProviderControl(ctx, input.providerControlId);

  const criteriaSnapshot: Prisma.InputJsonValue = {
    providerReference: control.providerReference,
    communicatedRequirements: control.communicatedRequirements,
    evaluationFrequency: control.evaluationFrequency,
  };

  const reviewerMembershipId = context.membershipId;
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const evaluation = await tx.externalProviderEvaluation.create({
      data: {
        organisationId: txCtx.organisationId,
        providerControlId: control.id,
        evaluatedAt: input.evaluatedAt,
        criteriaSnapshot,
        result: input.result,
        notes: input.notes?.trim() || null,
        actionReference: input.actionReference?.trim() || null,
        reviewerMembershipId,
      },
    });
    await tx.externalProviderControl.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: control.id } },
      data: { lastReviewedAt: input.evaluatedAt, nextReviewDueDate: input.nextReviewDueDate },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "external_provider_evaluation.recorded",
      resourceType: "external_provider_evaluation",
      resourceId: evaluation.id,
      summary: `External-provider evaluation recorded with result ${evaluation.result}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { providerControlId: control.id, result: evaluation.result },
    });
    return evaluation;
  });
}

/** Explicitly evaluates overdue ACTIVE provider controls; callers decide when to run it (no background scheduler). */
export async function notifyOverdueProviderReviews(context: OrganisationContext, asOf = new Date()) {
  requirePermission(context, "ems.control.manage");
  const ctx = toTenantRepositoryContext(context);
  const overdueWhere: Prisma.ExternalProviderControlWhereInput = { status: "ACTIVE", nextReviewDueDate: { lt: asOf } };
  const controls = await prisma.externalProviderControl.findMany({
    where: tenantWhere(ctx, overdueWhere),
    select: { id: true, ownerMembershipId: true, nextReviewDueDate: true },
  });
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const results = [];
    for (const control of controls) {
      const outcome = await notifyMembership(tx, txCtx, {
        type: "review.overdue",
        recipientMembershipId: control.ownerMembershipId,
        resourceType: "external_provider_control",
        resourceId: control.id,
        dedupeKey: `external-provider-review:${control.id}:${control.nextReviewDueDate.toISOString()}`,
      });
      results.push({ providerControlId: control.id, ...outcome });
    }
    return results;
  });
}

export async function uploadEvidenceToProviderEvaluation(
  context: OrganisationContext,
  input: { evaluationId: string; fileName: string; mimeType: string; bytes: Buffer; purpose?: string | null; actorUserId: string },
) {
  requirePermission(context, "ems.control.manage");
  const ctx = toTenantRepositoryContext(context);
  const evaluation = await prisma.externalProviderEvaluation.findFirst({
    where: tenantWhere(ctx, { id: input.evaluationId }),
  });
  if (!evaluation) throw new TenantOwnershipError();
  const evidence = await uploadEvidenceObject(context, {
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
    uploadedByUserId: input.actorUserId,
  });
  await linkEvidence(context, {
    evidenceId: evidence.id,
    resourceType: "external_provider_evaluation",
    resourceId: evaluation.id,
    purpose: input.purpose,
    linkedByUserId: input.actorUserId,
  });
  return evidence;
}

import { withLockedNonconformity } from "./locked-transaction";

import { prisma } from "@/lib/prisma";
import type { EffectivenessResult } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, PermissionDeniedError } from "@/lib/rbac/authorize";
import { findTenantNonconformity, toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

export { TenantOwnershipError };

export class EffectivenessError extends Error {}

export const EFFECTIVENESS_REVIEW_PERMISSION = "ems.corrective_action.effectiveness_review" as const;

const NON_CLOSED_ACTION_STATUSES = new Set(["COMPLETED", "VERIFIED"]);

export interface RequestEffectivenessReviewInput {
  actorUserId: string;
}

export async function requestEffectivenessReview(context: OrganisationContext, nonconformityId: string, input: RequestEffectivenessReviewInput) {
  // Compatibility argument only: the authenticated context supplies the actor.
  void input;
  requirePermission(context, "ems.nonconformity.manage");
  return withLockedNonconformity(context, { nonconformityId }, "ems.nonconformity.manage", async (tx, txCtx, context) => {
  const ctx = txCtx;
  const nonconformity = await tx.nonconformity.findFirst({ where: tenantWhere(ctx, { id: nonconformityId }) });
  if (!nonconformity) throw new TenantOwnershipError();
  if (nonconformity.status !== "ACTIONS_IN_PROGRESS") {
    throw new EffectivenessError(`Effectiveness review cannot be requested while the nonconformity is ${nonconformity.status}.`);
  }

  const actions = await tx.correctiveAction.findMany({ where: tenantWhere(ctx, { nonconformityId: nonconformity.id }) });
  const nonCancelled = actions.filter((action) => action.status !== "CANCELLED");
  const allDone = nonCancelled.length > 0 && nonCancelled.every((action) => NON_CLOSED_ACTION_STATUSES.has(action.status));
  if (!allDone) {
    throw new EffectivenessError("Every corrective action must be completed before requesting effectiveness review.");
  }

    const { count } = await tx.nonconformity.updateMany({
      where: { organisationId: txCtx.organisationId, id: nonconformity.id, status: "ACTIONS_IN_PROGRESS" },
      data: { status: "EFFECTIVENESS_REVIEW", reviewCycle: nonconformity.reviewCycle + 1 },
    });
    if (count === 0) {
      throw new EffectivenessError("Nonconformity status changed before the request could be recorded.");
    }
    const updated = await tx.nonconformity.findUniqueOrThrow({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: nonconformity.id } },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "nonconformity.effectiveness_review_requested",
      resourceType: "nonconformity",
      resourceId: nonconformity.id,
      summary: `Nonconformity "${nonconformity.reference}" moved to EFFECTIVENESS_REVIEW.`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "ACTIONS_IN_PROGRESS" },
      after: { status: "EFFECTIVENESS_REVIEW" },
    });
    return updated;
  });
}

export interface PerformEffectivenessReviewInput {
  reviewCycle: number;
  criteria: string;
  reviewDate: Date;
  result: EffectivenessResult;
  decision: string;
  actorUserId: string;
}

export async function performEffectivenessReview(context: OrganisationContext, nonconformityId: string, input: PerformEffectivenessReviewInput) {
  requirePermission(context, EFFECTIVENESS_REVIEW_PERMISSION);
  if (!input.criteria.trim()) throw new EffectivenessError("Enter the review criteria.");
  if (!input.decision.trim()) throw new EffectivenessError("Enter the review decision.");
  return withLockedNonconformity(context, { nonconformityId }, EFFECTIVENESS_REVIEW_PERMISSION, async (tx, txCtx, context) => {
  const ctx = txCtx;
  const nonconformity = await tx.nonconformity.findFirst({ where: tenantWhere(ctx, { id: nonconformityId }) });
  if (!nonconformity) throw new TenantOwnershipError();
  if (nonconformity.status !== "EFFECTIVENESS_REVIEW") {
    throw new EffectivenessError(`Effectiveness review cannot be recorded while the nonconformity is ${nonconformity.status}.`);
  }

  const actions = await tx.correctiveAction.findMany({
    where: tenantWhere(ctx, { nonconformityId: nonconformity.id }),
    select: { ownerMembershipId: true, status: true },
  });
  if (actions.some((action) => action.ownerMembershipId === context.membershipId)) {
    throw new PermissionDeniedError("FOUR_EYES_SELF_APPROVAL");
  }

  const policy = await tx.nonconformityClosurePolicy.findFirst({ where: tenantWhere(ctx, {}) });
  const ineffectiveOutcomePolicy = policy?.ineffectiveOutcomePolicy ?? "REOPEN_NONCONFORMITY";

    if (!Number.isSafeInteger(input.reviewCycle) || input.reviewCycle < 1 || input.reviewCycle !== nonconformity.reviewCycle) {
      throw new EffectivenessError("This review cycle has changed. Reload before reviewing.");
    }
    const existing = await tx.effectivenessReview.findFirst({ where: tenantWhere(txCtx, { nonconformityId, reviewCycle: input.reviewCycle }) });
    if (existing) throw new EffectivenessError("A decision has already been recorded for this review cycle.");
    const nonCancelled = actions.filter(action => action.status !== "CANCELLED");
    if (!nonCancelled.length || nonCancelled.some(action => !NON_CLOSED_ACTION_STATUSES.has(action.status))) {
      throw new EffectivenessError("All non-cancelled actions must still be complete.");
    }

    const review = await tx.effectivenessReview.create({
      data: {
        organisationId: txCtx.organisationId,
        nonconformityId: nonconformity.id,
        reviewCycle: input.reviewCycle,
        criteria: input.criteria.trim(),
        reviewDate: input.reviewDate,
        reviewerMembershipId: context.membershipId,
        result: input.result,
        decision: input.decision.trim(),
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "effectiveness_review.recorded",
      resourceType: "effectiveness_review",
      resourceId: review.id,
      summary: `Effectiveness review recorded for nonconformity "${nonconformity.reference}": ${input.result}.`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { nonconformityId: nonconformity.id, reviewCycle: input.reviewCycle, result: input.result },
    });

    if (input.result === "EFFECTIVE") {
      return { review, nonconformity, followUp: null };
    }

    const reopened = await tx.nonconformity.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: nonconformity.id } },
      data: {
        status: "REOPENED",
        reopenedAt: new Date(),
        reopenedByUserId: context.userId,
        reopenReason: `${input.result} effectiveness review: ${input.decision.trim()}`,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "nonconformity.reopened",
      resourceType: "nonconformity",
      resourceId: nonconformity.id,
      summary: `Nonconformity "${nonconformity.reference}" reopened after ${input.result} effectiveness review.`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "EFFECTIVENESS_REVIEW" },
      after: { status: "REOPENED" },
    });
    // PARTIALLY_EFFECTIVE / INEFFECTIVE: never closable — reopen this
    // nonconformity, or create a separately tracked follow-up, per policy.
    if (ineffectiveOutcomePolicy === "CREATE_FOLLOW_UP") {
      const followUp = await tx.nonconformity.create({
        data: {
          organisationId: txCtx.organisationId,
          reference: `${nonconformity.reference}-FU-${Date.now()}`,
          sourceType: "MANUAL",
          sourceReferenceNote: `Follow-up from ${input.result} effectiveness review of nonconformity "${nonconformity.reference}".`,
          statement: `Follow-up required: the corrective actions for "${nonconformity.reference}" were reviewed as ${input.result}. ${input.decision.trim()}`,
          requirementReference: nonconformity.requirementReference,
          complianceObligationId: nonconformity.complianceObligationId,
          operationalControlId: nonconformity.operationalControlId,
          ownerMembershipId: nonconformity.ownerMembershipId,
          createdByUserId: context.userId,
        },
      });
      await tx.nonconformitySourceLink.create({
        data: {
          organisationId: txCtx.organisationId,
          nonconformityId: followUp.id,
          sourceType: "MANUAL",
          sourceReferenceNote: `Follow-up from nonconformity ${nonconformity.id} (${nonconformity.reference}).`,
          isPrimary: true,
          linkedByMembershipId: context.membershipId,
        },
      });
      await recordAuditEvent(tx, txCtx, {
        eventType: "nonconformity.follow_up_created",
        resourceType: "nonconformity",
        resourceId: followUp.id,
        summary: `Follow-up nonconformity "${followUp.reference}" created from ineffective review of "${nonconformity.reference}".`,
        actorUserId: context.userId,
        correlationId: txCtx.correlationId,
        source: "web-app",
        after: { followUpOf: nonconformity.id },
      });
      return { review, nonconformity: reopened, followUp };
    }

    return { review, nonconformity: reopened, followUp: null };
  });
}

export async function listEffectivenessReviews(context: OrganisationContext, nonconformityId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const nonconformity = await findTenantNonconformity(ctx, nonconformityId);
  if (!nonconformity) throw new TenantOwnershipError();
  return prisma.effectivenessReview.findMany({
    where: tenantWhere(ctx, { nonconformityId: nonconformity.id }),
    orderBy: { createdAt: "desc" },
  });
}

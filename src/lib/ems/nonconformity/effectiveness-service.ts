/**
 * Effectiveness review and ineffective-outcome handling (task T64,
 * Docs/PHASE6_AUDIT_INCIDENT_CAPA_SPEC.md §§1-2,4). Depends on T63
 * (`Nonconformity`) and this module's own `CorrectiveAction`, both already
 * on this branch.
 *
 * Fixed decisions this module enforces (spec §1, T64 acceptance):
 *  - `requestEffectivenessReview` only moves a Nonconformity from
 *    `ACTIONS_IN_PROGRESS` to `EFFECTIVENESS_REVIEW` once every one of its
 *    non-cancelled `CorrectiveAction`s is `COMPLETED`/`VERIFIED`, and there
 *    is at least one such action — an empty or all-cancelled action set can
 *    never reach effectiveness review;
 *  - `performEffectivenessReview` denies the reviewer whenever they are the
 *    owner of *any* `CorrectiveAction` on the same Nonconformity and
 *    four-eyes is enabled (T64 acceptance: "action owner cannot perform
 *    independent effectiveness review when policy enabled") — this is a
 *    membership-id comparison, not `assertFourEyes`'s user-id comparison,
 *    because `CorrectiveAction.ownerMembershipId` and the reviewer here are
 *    both membership ids;
 *  - an `EFFECTIVE` result never itself closes the Nonconformity — the
 *    caller still calls `closeNonconformity` separately, which re-checks
 *    the closure policy live;
 *  - a `PARTIALLY_EFFECTIVE`/`INEFFECTIVE` result can never lead to closure
 *    (T64 acceptance: "ineffective outcome reopens or creates follow-up ...
 *    it cannot close"): per
 *    `NonconformityClosurePolicy.ineffectiveOutcomePolicy`, either this same
 *    Nonconformity moves to `REOPENED` (`REOPEN_NONCONFORMITY`, the
 *    default), or a new, separately tracked follow-up Nonconformity is
 *    created and this one stays in `EFFECTIVENESS_REVIEW` — never a
 *    closable status either way (`CLOSABLE_STATUSES` in
 *    `nonconformity-service.ts` excludes it);
 *  - every review is a new, immutable `EffectivenessReview` row — review
 *    history is never overwritten, even across a reopen-and-redo cycle.
 */

import { prisma } from "@/lib/prisma";
import type { EffectivenessResult } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, PermissionDeniedError } from "@/lib/rbac/authorize";
import { findTenantNonconformity, toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

export { TenantOwnershipError };

export class EffectivenessError extends Error {}

export const EFFECTIVENESS_REVIEW_PERMISSION = "ems.corrective_action.effectiveness_review" as const;

const NON_CLOSED_ACTION_STATUSES = new Set(["COMPLETED", "VERIFIED"]);

export interface RequestEffectivenessReviewInput {
  actorUserId: string;
}

export async function requestEffectivenessReview(context: OrganisationContext, nonconformityId: string, input: RequestEffectivenessReviewInput) {
  requirePermission(context, "ems.nonconformity.manage");
  const ctx = toTenantRepositoryContext(context);
  const nonconformity = await findTenantNonconformity(ctx, nonconformityId);
  if (!nonconformity) throw new TenantOwnershipError();
  if (nonconformity.status !== "ACTIONS_IN_PROGRESS") {
    throw new EffectivenessError(`Effectiveness review cannot be requested while the nonconformity is ${nonconformity.status}.`);
  }

  const actions = await prisma.correctiveAction.findMany({ where: tenantWhere(ctx, { nonconformityId: nonconformity.id }) });
  const nonCancelled = actions.filter((action) => action.status !== "CANCELLED");
  const allDone = nonCancelled.length > 0 && nonCancelled.every((action) => NON_CLOSED_ACTION_STATUSES.has(action.status));
  if (!allDone) {
    throw new EffectivenessError("Every corrective action must be completed before requesting effectiveness review.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    // BD02: CAS on the write — a corrective action completing/reopening (or
    // this same transition firing twice concurrently) between the reads
    // above and this write gets a conflict, not a silent duplicate
    // transition. The action-completeness check itself isn't re-run inside
    // the transaction (it would need every action row locked too); the
    // status guard below still stops a second, now-stale request from
    // re-entering effectiveness review.
    const { count } = await tx.nonconformity.updateMany({
      where: { organisationId: txCtx.organisationId, id: nonconformity.id, status: "ACTIONS_IN_PROGRESS" },
      data: { status: "EFFECTIVENESS_REVIEW" },
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
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "ACTIONS_IN_PROGRESS" },
      after: { status: "EFFECTIVENESS_REVIEW" },
    });
    return updated;
  });
}

export interface PerformEffectivenessReviewInput {
  criteria: string;
  reviewDate: Date;
  result: EffectivenessResult;
  decision: string;
  actorUserId: string;
}

/**
 * Records an effectiveness review. Denies the reviewer when they own any
 * corrective action on this nonconformity, then applies the organisation's
 * `ineffectiveOutcomePolicy` to a non-EFFECTIVE result.
 *
 * BD02: four-eyes is always enforced, server-side and non-overridable — the
 * `fourEyesEnabled?: boolean` parameter this function previously accepted
 * (mirroring a pattern repeated across the EMS layer) was never actually
 * supplied by any live caller; removing it closes the unused override
 * before it becomes one, without changing behaviour for any real caller.
 * The check is re-proven fresh inside the transaction below (not just from
 * the pre-transaction `actions` read here), and the status transition is a
 * compare-and-swap so a second, now-stale request gets a conflict rather
 * than a duplicate review.
 */
export async function performEffectivenessReview(context: OrganisationContext, nonconformityId: string, input: PerformEffectivenessReviewInput) {
  requirePermission(context, EFFECTIVENESS_REVIEW_PERMISSION);
  if (!input.criteria.trim()) throw new EffectivenessError("Enter the review criteria.");
  if (!input.decision.trim()) throw new EffectivenessError("Enter the review decision.");
  const ctx = toTenantRepositoryContext(context);
  const nonconformity = await findTenantNonconformity(ctx, nonconformityId);
  if (!nonconformity) throw new TenantOwnershipError();
  if (nonconformity.status !== "EFFECTIVENESS_REVIEW") {
    throw new EffectivenessError(`Effectiveness review cannot be recorded while the nonconformity is ${nonconformity.status}.`);
  }

  const actions = await prisma.correctiveAction.findMany({
    where: tenantWhere(ctx, { nonconformityId: nonconformity.id }),
    select: { ownerMembershipId: true },
  });
  if (actions.some((action) => action.ownerMembershipId === context.membershipId)) {
    throw new PermissionDeniedError("FOUR_EYES_SELF_APPROVAL");
  }

  const policy = await prisma.nonconformityClosurePolicy.findFirst({ where: tenantWhere(ctx, {}) });
  const ineffectiveOutcomePolicy = policy?.ineffectiveOutcomePolicy ?? "REOPEN_NONCONFORMITY";

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    // BD02: CAS + row lock — a no-op conditional update on the nonconformity
    // both re-proves it is still EFFECTIVENESS_REVIEW at write time and, via
    // Postgres row-level locking, holds a lock on it for the rest of this
    // transaction, so a concurrent second review request serializes behind
    // this one rather than racing it. A stale caller gets a conflict here,
    // never a duplicate review.
    const { count: stillReviewable } = await tx.nonconformity.updateMany({
      where: { organisationId: txCtx.organisationId, id: nonconformity.id, status: "EFFECTIVENESS_REVIEW" },
      data: { status: "EFFECTIVENESS_REVIEW" },
    });
    if (stillReviewable === 0) {
      throw new EffectivenessError("Nonconformity status changed before this review could be recorded.");
    }
    // Re-prove four-eyes fresh, inside the lock just taken above — not just
    // from the pre-transaction read, which a concurrent reassignment could
    // have made stale.
    const freshActions = await tx.correctiveAction.findMany({
      where: tenantWhere(txCtx, { nonconformityId: nonconformity.id }),
      select: { ownerMembershipId: true },
    });
    if (freshActions.some((action) => action.ownerMembershipId === context.membershipId)) {
      throw new PermissionDeniedError("FOUR_EYES_SELF_APPROVAL");
    }

    const review = await tx.effectivenessReview.create({
      data: {
        organisationId: txCtx.organisationId,
        nonconformityId: nonconformity.id,
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
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { nonconformityId: nonconformity.id, result: input.result },
    });

    if (input.result === "EFFECTIVE") {
      return { review, nonconformity, followUp: null };
    }

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
          createdByUserId: input.actorUserId,
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
        actorUserId: input.actorUserId,
        correlationId: txCtx.correlationId,
        source: "web-app",
        after: { followUpOf: nonconformity.id },
      });
      return { review, nonconformity, followUp };
    }

    const reopened = await tx.nonconformity.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: nonconformity.id } },
      data: {
        status: "REOPENED",
        reopenedAt: new Date(),
        reopenedByUserId: input.actorUserId,
        reopenReason: `${input.result} effectiveness review: ${input.decision.trim()}`,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "nonconformity.reopened",
      resourceType: "nonconformity",
      resourceId: nonconformity.id,
      summary: `Nonconformity "${nonconformity.reference}" reopened after ${input.result} effectiveness review.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "EFFECTIVENESS_REVIEW" },
      after: { status: "REOPENED" },
    });
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

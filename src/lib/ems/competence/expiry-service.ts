/**
 * Competence expiry and deduplicated reminders (task T71,
 * Docs/PHASE7_COMPETENCE_MANAGEMENT_REVIEW_SPEC.md §1 "Expiry creates a
 * gap/notification; it does not delete historical competence."). Depends on
 * T24's notification/reminder engine, already on this branch.
 *
 * Fixed decisions this module enforces (T71 acceptance: "expiry reminders
 * deduplicated", "expired competence appears as gap"):
 *  - `checkCompetenceExpiry` only ever moves a COMPETENT assignment whose
 *    `competentUntil` has passed to EXPIRED — it never touches a
 *    REQUIRED/IN_PROGRESS/EVIDENCE_SUBMITTED/GAP assignment, and it never
 *    deletes the assignment or its evidence/assessment history;
 *  - the "expiry.expired" notification uses a stable
 *    `competence_expiry_expired:{assignmentId}` dedupe key
 *    (notification-service.ts's `notifyMembership` collapses a repeated
 *    call with the same key into the existing row via its unique
 *    constraint) — re-running the check for an already-EXPIRED assignment
 *    is a no-op (the query only selects COMPETENT rows), and a raced
 *    concurrent run for the same assignment still yields exactly one
 *    notification;
 *  - `evaluateUpcomingCompetenceExpiryReminders` reuses T24's
 *    `evaluateReminderRule` engine as-is (same dedupe guarantee, scoped by
 *    the caller-supplied `ReminderRule`) rather than re-implementing
 *    reminder scheduling — T71 supplies only the competence-domain
 *    `ReminderSubject[]` T24 has no model of its own to build.
 */

import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { notifyMembership } from "@/lib/notifications/notification-service";
import { evaluateReminderRule, type EvaluateReminderRuleOptions } from "@/lib/notifications/reminder-service";
import type { ReminderSubject } from "@/lib/notifications/types";

const MANAGE_PERMISSION = "ems.competence.manage" as const;

/**
 * Transitions every COMPETENT assignment whose `competentUntil` has passed
 * `asOf` to EXPIRED, recording the gap fields and a deduplicated
 * "expiry.expired" notification. Idempotent: an assignment already EXPIRED
 * is simply not selected on a repeat run.
 */
export async function checkCompetenceExpiry(
  context: OrganisationContext,
  actorUserId: string,
  asOf: Date = new Date(),
): Promise<string[]> {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);

  const dueAssignments = await prisma.competenceAssignment.findMany({
    where: tenantWhere(ctx, { status: "COMPETENT" as const, competentUntil: { lte: asOf } }),
    include: { person: true },
  });

  const expiredIds: string[] = [];
  for (const assignment of dueAssignments) {
    const result = await runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
      const fresh = await tx.competenceAssignment.findFirst({
        where: tenantWhere(txCtx, { id: assignment.id, status: "COMPETENT" as const }),
      });
      if (!fresh) return null;

      const updated = await tx.competenceAssignment.update({
        where: { organisationId_id: { organisationId: txCtx.organisationId, id: fresh.id } },
        data: { status: "EXPIRED", gapSince: fresh.competentUntil ?? asOf, gapNote: "Competence has expired." },
      });

      await recordAuditEvent(tx, txCtx, {
        eventType: "competence_assignment.expired",
        resourceType: "competence_assignment",
        resourceId: fresh.id,
        summary: "Competence assignment expired.",
        actorUserId,
        correlationId: txCtx.correlationId,
        source: "system",
        before: { status: "COMPETENT" },
        after: { status: "EXPIRED" },
      });

      const recipientMembershipId = assignment.person.membershipId ?? assignment.assignedByMembershipId;
      if (recipientMembershipId) {
        await notifyMembership(tx, txCtx, {
          type: "expiry.expired",
          recipientMembershipId,
          resourceType: "competence_record",
          resourceId: fresh.id,
          dedupeKey: `competence_expiry_expired:${fresh.id}`,
        });
      }

      return updated;
    });
    if (result) expiredIds.push(result.id);
  }

  return expiredIds;
}

/**
 * Runs T24's generic `evaluateReminderRule` for competence expiries
 * approaching (not yet past) `competentUntil`, using `rule` as the caller's
 * already-created `ReminderRule` (resourceType "competence_assignment").
 * Subjects prefer the person's own membership as recipient, falling back to
 * the rule's configured `recipientsPolicy` when the person has none (e.g. a
 * contractor with no login identity).
 */
export async function evaluateUpcomingCompetenceExpiryReminders(
  context: OrganisationContext,
  rule: EvaluateReminderRuleOptions["rule"],
  asOf: Date = new Date(),
) {
  const ctx = toTenantRepositoryContext(context);
  const assignments = await prisma.competenceAssignment.findMany({
    where: tenantWhere(ctx, { status: "COMPETENT" as const, competentUntil: { not: null } }),
    include: { person: true },
  });

  const subjects: ReminderSubject[] = assignments.map((assignment) => ({
    resourceId: assignment.id,
    referenceDate: assignment.competentUntil as Date,
    closed: false,
    reassigned: false,
    recipientsPolicy: assignment.person.membershipId
      ? { kind: "membership", membershipId: assignment.person.membershipId }
      : undefined,
  }));

  return evaluateReminderRule(context, {
    rule,
    notificationType: "expiry.upcoming",
    subjects,
    asOf,
  });
}

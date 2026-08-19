/**
 * Overdue-action escalation (task T52, Docs/PHASE5_OBJECTIVES_ACTIONS_SPEC.md
 * §§1,7 "overdue reminders deduplicate and stop after closure/reassignment").
 * Mirrors `notifyOverdueControlReviews` (T33, `control-service.ts`) exactly:
 * an explicit, permission-checked function callers/jobs invoke — there is
 * no background scheduler here, matching every other T24 consumer in this
 * codebase.
 *
 * Dedupe key includes the due date, so a due-date change on an in-flight
 * action produces a fresh reminder rather than reusing a stale one; a
 * reassigned or closed action is excluded from the candidate query itself
 * (`reassignActionItem`/`completeActionItem`/`setActionItemStatus`
 * already call `suppressNotificationsForResource` for the previous state,
 * so this function never needs to re-check "closed" — a closed action can
 * never appear in the `notIn` filter below).
 */

import type { ActionItemStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { notifyMembership } from "@/lib/notifications/notification-service";

const MANAGE_PERMISSION = "ems.action.manage" as const;

const CLOSED_STATUSES: readonly ActionItemStatus[] = ["COMPLETED", "VERIFIED", "CANCELLED"];

/** Explicitly evaluates overdue, still-open actions; callers decide when to run it (no background scheduler). */
export async function notifyOverdueActionItems(context: OrganisationContext, asOf = new Date()) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const overdueActions = await prisma.actionItem.findMany({
    where: tenantWhere(ctx, {
      status: { notIn: [...CLOSED_STATUSES] },
      dueDate: { lt: asOf },
    }),
    select: { id: true, ownerMembershipId: true, dueDate: true },
  });

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const results = [];
    for (const action of overdueActions) {
      const outcome = await notifyMembership(tx, txCtx, {
        type: "action.overdue",
        recipientMembershipId: action.ownerMembershipId,
        resourceType: "action",
        resourceId: action.id,
        dedupeKey: `action-overdue:${action.id}:${action.dueDate.toISOString()}`,
      });
      results.push({ actionItemId: action.id, ...outcome });
    }
    return results;
  });
}

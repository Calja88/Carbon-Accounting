/**
 * In-app notification service (task T24, Docs/PHASE2_EMS_FOUNDATION_SPEC.md
 * §3 "Audit, outbox and notifications", §7 "P2-07").
 *
 * `notifyMembership` is the single write entry point later domains
 * (T32/T33/T41/T44/T50/T70 — all of which depend on T24) call to raise a
 * notification. It is deliberately narrow:
 *
 *  - message text always comes from `NOTIFICATION_TEMPLATES` (types.ts),
 *    never from caller-supplied free text, so "no sensitive record detail
 *    leaks into generic notification text" is enforced by the function
 *    signature, not by caller discipline;
 *  - the recipient membership is reloaded and checked ACTIVE inside the
 *    same transaction as the write ("recipient is an active, in-scope
 *    member at send time") — a membership suspended/removed since the
 *    notification was scheduled means no row is written at all;
 *  - `dedupeKey` collapses a repeated trigger for the same recipient into
 *    the existing row via the schema's unique constraint, mirroring the
 *    T21 outbox idempotency-key pattern;
 *  - delivery is synchronous and in-app only for T24 — `channel` stays
 *    `IN_APP` and `deliveredAt` is set immediately. The email adapter
 *    (delivery/email-adapter.ts) is a stub a later task wires up; this
 *    service never calls out to it.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { assertOwned, tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { findActiveTenantMembership, toTenantRepositoryContext } from "@/lib/repositories/notifications-repository";
import { NOTIFICATION_TEMPLATES, isKnownNotificationType, type NotificationType } from "./types";

export { TenantOwnershipError };

type Tx = Prisma.TransactionClient | typeof prisma;

export class NotificationError extends Error {}

export interface NotifyMembershipInput {
  type: NotificationType;
  recipientMembershipId: string;
  resourceType: string;
  resourceId: string;
  /** Unique per (organisationId, recipientMembershipId). Re-triggering the same event for the same recipient before it is superseded collapses to the existing row. */
  dedupeKey: string;
  reminderRuleId?: string;
}

/**
 * Creates and (synchronously) delivers an in-app notification inside the
 * caller's transaction, or returns `{ id: null, status: "SUPPRESSED" }`
 * without writing a row if the recipient is not an active member of this
 * organisation at send time. Idempotent on `dedupeKey`: a second call with
 * the same key returns the existing row instead of creating a duplicate.
 */
export async function notifyMembership(
  tx: Tx,
  ctx: TenantRepositoryContext,
  input: NotifyMembershipInput,
): Promise<{ id: string | null; status: "DELIVERED" | "SUPPRESSED" }> {
  if (!isKnownNotificationType(input.type)) {
    throw new NotificationError(`Unknown notification type "${input.type}".`);
  }

  const existing = await tx.notification.findFirst({
    where: {
      organisationId: ctx.organisationId,
      recipientMembershipId: input.recipientMembershipId,
      dedupeKey: input.dedupeKey,
    },
  });
  if (existing) {
    return { id: existing.id, status: existing.status === "SUPPRESSED" ? "SUPPRESSED" : "DELIVERED" };
  }

  const recipient = await findActiveTenantMembership(ctx, input.recipientMembershipId);
  if (!recipient) {
    return { id: null, status: "SUPPRESSED" };
  }

  const { title, body } = NOTIFICATION_TEMPLATES[input.type](input.resourceType);
  const now = new Date();

  try {
    const created = await tx.notification.create({
      data: {
        organisationId: ctx.organisationId,
        recipientMembershipId: input.recipientMembershipId,
        type: input.type,
        channel: "IN_APP",
        status: "DELIVERED",
        title,
        body,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        dedupeKey: input.dedupeKey,
        reminderRuleId: input.reminderRuleId ?? null,
        deliveredAt: now,
      },
    });
    return { id: created.id, status: "DELIVERED" };
  } catch (error) {
    // Raced with a concurrent call using the same dedupe key — the unique
    // constraint on (organisationId, recipientMembershipId, dedupeKey) is
    // the real guarantee; this just resolves the loser's return value.
    const raced = await tx.notification.findFirst({
      where: {
        organisationId: ctx.organisationId,
        recipientMembershipId: input.recipientMembershipId,
        dedupeKey: input.dedupeKey,
      },
    });
    if (raced) return { id: raced.id, status: raced.status === "SUPPRESSED" ? "SUPPRESSED" : "DELIVERED" };
    throw error;
  }
}

/**
 * Suppresses every PENDING/DELIVERED/READ notification for a resource — the
 * T24 acceptance criterion "reassigned/closed items suppress stale
 * reminders". Called by the owning domain when it reassigns or closes a
 * record, so a recipient with an open (or already-read) notification does
 * not keep acting on stale state.
 */
export async function suppressNotificationsForResource(
  tx: Tx,
  ctx: TenantRepositoryContext,
  resourceType: string,
  resourceId: string,
): Promise<number> {
  const result = await tx.notification.updateMany({
    where: {
      organisationId: ctx.organisationId,
      resourceType,
      resourceId,
      status: { in: ["PENDING", "DELIVERED", "READ"] },
    },
    data: { status: "SUPPRESSED", suppressedAt: new Date() },
  });
  return result.count;
}

function requireOwnNotification(context: OrganisationContext, notification: { recipientMembershipId: string }): void {
  if (notification.recipientMembershipId !== context.membershipId) {
    throw new NotificationError("Only the recipient may act on this notification.");
  }
}

export interface ListMyNotificationsFilter {
  status?: "PENDING" | "DELIVERED" | "READ" | "DISMISSED" | "SUPPRESSED";
  take?: number;
}

/** Lists notifications addressed to the caller's own membership — never another member's inbox. */
export async function listMyNotifications(context: OrganisationContext, filter: ListMyNotificationsFilter = {}) {
  const ctx = toTenantRepositoryContext(context);
  return prisma.notification.findMany({
    where: tenantWhere(ctx, {
      recipientMembershipId: context.membershipId,
      ...(filter.status ? { status: filter.status } : {}),
    }),
    orderBy: { createdAt: "desc" },
    take: filter.take ?? 100,
  });
}

/** Marks a notification READ — acknowledgement. Only the recipient may acknowledge their own notification. */
export async function acknowledgeNotification(context: OrganisationContext, notificationId: string) {
  const ctx = toTenantRepositoryContext(context);
  const notification = assertOwned(ctx, await prisma.notification.findFirst({ where: tenantWhere(ctx, { id: notificationId }) }));
  requireOwnNotification(context, notification);
  if (notification.status === "SUPPRESSED" || notification.status === "DISMISSED") return notification;
  return prisma.notification.update({
    where: { id: notification.id },
    data: { status: "READ", readAt: notification.readAt ?? new Date() },
  });
}

/** Marks a notification DISMISSED. Only the recipient may dismiss their own notification. */
export async function dismissNotification(context: OrganisationContext, notificationId: string) {
  const ctx = toTenantRepositoryContext(context);
  const notification = assertOwned(ctx, await prisma.notification.findFirst({ where: tenantWhere(ctx, { id: notificationId }) }));
  requireOwnNotification(context, notification);
  if (notification.status === "SUPPRESSED") return notification;
  return prisma.notification.update({
    where: { id: notification.id },
    data: { status: "DISMISSED", dismissedAt: new Date() },
  });
}

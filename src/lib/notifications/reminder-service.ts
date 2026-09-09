/**
 * Reminder rule service (task T24, Docs/PHASE2_EMS_FOUNDATION_SPEC.md §3
 * "Audit, outbox and notifications", §7 "P2-07").
 *
 * `ReminderRule` only *describes* when/who; T24 has no aspect, obligation,
 * or audit-report models of its own to schedule reminders for (those belong
 * to T30+/T40+/T50+/T70+, which all depend on T24). `evaluateReminderRule`
 * therefore takes the candidate subjects from the caller's own domain
 * (`ReminderSubject[]`, e.g. "these compliance obligations and their review
 * dates") rather than querying a resource table this task doesn't own.
 *
 * A subject flagged `closed` or `reassigned` is skipped — the T24
 * acceptance criterion "suppress stale reminders for reassigned or closed
 * items" — before a notification is ever raised for it.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext, findTenantReminderRule, tenantWhere } from "@/lib/repositories/notifications-repository";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { notifyMembership } from "./notification-service";
import { isRecipientsPolicy, type NotificationType, type RecipientsPolicy, type ReminderSubject } from "./types";

export { TenantOwnershipError } from "@/lib/repositories/notifications-repository";

export class ReminderRuleError extends Error {}

type Tx = Prisma.TransactionClient;

export interface CreateReminderRuleInput {
  resourceType: string;
  event: string;
  offsetDays: number;
  recurrence?: string;
  recipientsPolicy: RecipientsPolicy;
}

export async function createReminderRule(context: OrganisationContext, input: CreateReminderRuleInput) {
  requirePermission(context, "ems.notification.manage");
  if (!isRecipientsPolicy(input.recipientsPolicy)) {
    throw new ReminderRuleError("recipientsPolicy must be a known recipient-resolution policy shape.");
  }
  const ctx = toTenantRepositoryContext(context);
  return prisma.reminderRule.create({
    data: {
      organisationId: ctx.organisationId,
      resourceType: input.resourceType,
      event: input.event,
      offsetDays: input.offsetDays,
      recurrence: input.recurrence ?? "ONCE",
      recipientsPolicy: input.recipientsPolicy as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function setReminderRuleActive(context: OrganisationContext, ruleId: string, isActive: boolean) {
  requirePermission(context, "ems.notification.manage");
  const ctx = toTenantRepositoryContext(context);
  const rule = await findTenantReminderRule(ctx, ruleId);
  return prisma.reminderRule.update({ where: { id: rule.id }, data: { isActive } });
}

export async function listReminderRules(context: OrganisationContext, resourceType?: string) {
  requirePermission(context, "ems.notification.manage");
  const ctx = toTenantRepositoryContext(context);
  return prisma.reminderRule.findMany({
    where: tenantWhere(ctx, resourceType ? { resourceType } : {}),
    orderBy: { createdAt: "desc" },
  });
}

/** Resolves the active memberships a policy currently targets — always re-read live, never a stored id list. */
async function resolveRecipients(tx: Tx, ctx: TenantRepositoryContext, policy: RecipientsPolicy): Promise<string[]> {
  if (policy.kind === "membership") {
    const membership = await tx.organisationMembership.findFirst({
      where: { id: policy.membershipId, organisationId: ctx.organisationId, status: "ACTIVE" },
      select: { id: true },
    });
    return membership ? [membership.id] : [];
  }

  const memberships = await tx.organisationMembership.findMany({
    where: {
      organisationId: ctx.organisationId,
      status: "ACTIVE",
      roles: { some: { role: { isActive: true, permissions: { some: { permissionCode: policy.permission } } } } },
    },
    select: { id: true },
  });
  return memberships.map((m) => m.id);
}

export interface EvaluateReminderRuleOptions {
  rule: { id: string; resourceType: string; event: string; offsetDays: number; recipientsPolicy: unknown };
  notificationType: NotificationType;
  subjects: ReminderSubject[];
  /** Defaults to now — the reference point "offsetDays" is measured against `subject.referenceDate` relative to. */
  asOf?: Date;
}

export interface EvaluateReminderRuleResult {
  resourceId: string;
  skippedReason?: "NOT_DUE" | "CLOSED" | "REASSIGNED" | "NO_RECIPIENTS";
  notifiedMembershipIds: string[];
}

function isDue(subject: ReminderSubject, offsetDays: number, asOf: Date): boolean {
  const dueAt = new Date(subject.referenceDate);
  dueAt.setDate(dueAt.getDate() + offsetDays);
  return dueAt.getTime() <= asOf.getTime();
}

/**
 * Evaluates one rule against caller-supplied subjects and raises a
 * notification (via `notifyMembership`) for each due, non-stale, resolvable
 * subject. Runs inside its own transaction per rule so a large subject
 * batch does not hold one long-lived transaction across every resource.
 */
export async function evaluateReminderRule(
  context: OrganisationContext,
  options: EvaluateReminderRuleOptions,
): Promise<EvaluateReminderRuleResult[]> {
  requirePermission(context, "ems.notification.manage");
  const ctx = toTenantRepositoryContext(context);
  const asOf = options.asOf ?? new Date();
  const results: EvaluateReminderRuleResult[] = [];

  for (const subject of options.subjects) {
    if (subject.closed) {
      results.push({ resourceId: subject.resourceId, skippedReason: "CLOSED", notifiedMembershipIds: [] });
      continue;
    }
    if (subject.reassigned) {
      results.push({ resourceId: subject.resourceId, skippedReason: "REASSIGNED", notifiedMembershipIds: [] });
      continue;
    }
    if (!isDue(subject, options.rule.offsetDays, asOf)) {
      results.push({ resourceId: subject.resourceId, skippedReason: "NOT_DUE", notifiedMembershipIds: [] });
      continue;
    }

    const policy = subject.recipientsPolicy ?? (options.rule.recipientsPolicy as RecipientsPolicy);
    if (!isRecipientsPolicy(policy)) {
      results.push({ resourceId: subject.resourceId, skippedReason: "NO_RECIPIENTS", notifiedMembershipIds: [] });
      continue;
    }

    const notifiedMembershipIds = await runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
      const recipientMembershipIds = await resolveRecipients(tx, txCtx, policy);
      const notified: string[] = [];
      for (const recipientMembershipId of recipientMembershipIds) {
        const outcome = await notifyMembership(tx, txCtx, {
          type: options.notificationType,
          recipientMembershipId,
          resourceType: options.rule.resourceType,
          resourceId: subject.resourceId,
          dedupeKey: `${options.rule.id}:${options.rule.event}:${subject.resourceId}`,
          reminderRuleId: options.rule.id,
        });
        if (outcome.status === "DELIVERED" && outcome.id) notified.push(recipientMembershipId);
      }
      return notified;
    });

    results.push({
      resourceId: subject.resourceId,
      skippedReason: notifiedMembershipIds.length === 0 ? "NO_RECIPIENTS" : undefined,
      notifiedMembershipIds,
    });
  }

  return results;
}

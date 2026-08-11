/**
 * Notifications and reminders tenant repository (task T24,
 * Docs/PHASE2_EMS_FOUNDATION_SPEC.md §3 "Audit, outbox and notifications").
 * Follows the T15/T22/T23 tenant-repository pattern: every read bakes
 * `organisationId` into the query itself, and a foreign-tenant id is denied
 * identically to a missing one.
 */

import { prisma } from "@/lib/prisma";
import { toTenantRepositoryContext, systemTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { assertOwned, tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";

export { TenantOwnershipError, toTenantRepositoryContext, systemTenantRepositoryContext, tenantWhere };

export async function findTenantNotification(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.notification.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

export async function findTenantReminderRule(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.reminderRule.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

/**
 * Loads an active, in-scope membership for this organisation, or null.
 * "In-scope" here means the membership belongs to the same organisation and
 * is `ACTIVE` — the same live-state check `OrganisationContext` (T13) uses,
 * applied to a notification recipient rather than the calling user, and
 * re-run at delivery time rather than trusted from creation time.
 */
export async function findActiveTenantMembership(ctx: TenantRepositoryContext, membershipId: string) {
  return prisma.organisationMembership.findFirst({
    where: { id: membershipId, organisationId: ctx.organisationId, status: "ACTIVE" },
  });
}

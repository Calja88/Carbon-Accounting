/**
 * Legal hold service (task T81, Docs/PHASE8_HARDENING_READINESS_SPEC.md §4:
 * "Holds always win."). A hold is either organisation-wide
 * (`resourceType`/`resourceId` both null) or targeted at one resource (both
 * set) — `isUnderLegalHold` checks both shapes, so a caller never needs to
 * enumerate every possible org-wide hold row itself.
 *
 * Every create/release is permission-gated on `organisation.legal_hold.manage`
 * and audited in the same transaction, matching the T20 pattern used by
 * every other mutating service in this codebase.
 */

import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext, tenantWhere } from "@/lib/repositories/carbon-repository";
import { assertOwned, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

export { TenantOwnershipError };

export class LegalHoldError extends Error {}

export interface CreateLegalHoldInput {
  /** Both null: an organisation-wide hold. Both set: a hold on one resource. Mixed (one set, one null) is rejected. */
  resourceType?: string | null;
  resourceId?: string | null;
  reason: string;
  actorUserId: string;
}

function assertValidScope(input: Pick<CreateLegalHoldInput, "resourceType" | "resourceId">): void {
  const hasType = Boolean(input.resourceType);
  const hasId = Boolean(input.resourceId);
  if (hasType !== hasId) {
    throw new LegalHoldError("A legal hold must set both resourceType and resourceId, or neither (organisation-wide).");
  }
}

/** Creates a legal hold. Requires `organisation.legal_hold.manage`. */
export async function createLegalHold(context: OrganisationContext, input: CreateLegalHoldInput) {
  requirePermission(context, "organisation.legal_hold.manage");
  if (!input.reason.trim()) {
    throw new LegalHoldError("A legal hold requires a reason.");
  }
  assertValidScope(input);

  const ctx = toTenantRepositoryContext(context);
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const hold = await tx.legalHold.create({
      data: {
        organisationId: txCtx.organisationId,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        reason: input.reason,
        createdByUserId: input.actorUserId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "legal_hold.created",
      resourceType: "legal_hold",
      resourceId: hold.id,
      summary: input.resourceType
        ? `Legal hold placed on ${input.resourceType} ${input.resourceId}.`
        : "Organisation-wide legal hold placed.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { resourceType: hold.resourceType, resourceId: hold.resourceId, reason: hold.reason },
    });
    return hold;
  });
}

export interface ReleaseLegalHoldInput {
  holdId: string;
  releaseReason: string;
  actorUserId: string;
}

/** Releases an active legal hold. Requires `organisation.legal_hold.manage`. Releasing an already-released hold is rejected — the database trigger enforces this too, but the service check gives a clear domain error. */
export async function releaseLegalHold(context: OrganisationContext, input: ReleaseLegalHoldInput) {
  requirePermission(context, "organisation.legal_hold.manage");
  if (!input.releaseReason.trim()) {
    throw new LegalHoldError("Releasing a legal hold requires a reason.");
  }

  const ctx = toTenantRepositoryContext(context);
  const hold = assertOwned(ctx, await prisma.legalHold.findFirst({ where: { id: input.holdId } }));
  if (hold.status === "RELEASED") {
    throw new LegalHoldError(`Legal hold ${hold.id} is already released.`);
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const released = await tx.legalHold.update({
      where: { id: hold.id },
      data: {
        status: "RELEASED",
        releasedByUserId: input.actorUserId,
        releasedAt: new Date(),
        releaseReason: input.releaseReason,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "legal_hold.released",
      resourceType: "legal_hold",
      resourceId: released.id,
      summary: released.resourceType
        ? `Legal hold released on ${released.resourceType} ${released.resourceId}.`
        : "Organisation-wide legal hold released.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "ACTIVE" },
      after: { status: "RELEASED", releaseReason: released.releaseReason },
    });
    return released;
  });
}

/** Organisation-scoped read of every hold — active and released — for the legal-hold register view. Requires `organisation.legal_hold.manage`. */
export async function listLegalHolds(context: OrganisationContext) {
  requirePermission(context, "organisation.legal_hold.manage");
  const ctx = toTenantRepositoryContext(context);
  return prisma.legalHold.findMany({ where: tenantWhere(ctx, {}), orderBy: { createdAt: "desc" } });
}

/**
 * True if `resourceType`/`resourceId` is currently under an active hold —
 * its own resource-specific hold, or the organisation-wide hold. No
 * permission check: this is a read used internally by write paths (e.g.
 * retention execution) to decide whether they may proceed, not a
 * user-facing query.
 */
export async function isUnderLegalHold(
  ctx: TenantRepositoryContext,
  resourceType: string,
  resourceId: string,
): Promise<boolean> {
  const hold = await prisma.legalHold.findFirst({
    where: {
      organisationId: ctx.organisationId,
      status: "ACTIVE",
      OR: [
        { resourceType, resourceId },
        { resourceType: null, resourceId: null },
      ],
    },
    select: { id: true },
  });
  return hold !== null;
}

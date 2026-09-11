/**
 * Explicit review/exclusion decisions for `CarbonSourcePeriodObligation`
 * (Checkpoint B corrective handoff §1). An obligation's `status` column may
 * only ever move REVIEW_REQUIRED -> REVIEWED through `reviewSourcePeriodObligation`
 * and -> EXCLUDED through `excludeSourcePeriodObligation` — never stamped
 * directly by a seed or a read path merely because a matching
 * `ActivityEntry` happens to exist. The database's own CHECK constraints
 * (migration 20260911040000) additionally require REVIEWED to carry a
 * submission, reviewer, timestamp and fingerprint, and EXCLUDED to carry an
 * authorised decision and reason, so a row cannot reach either terminal
 * state through any other write path.
 *
 * `reviewFingerprint` is a canonical hash of the reviewed submission's
 * value/unit plus every contributing Calculation's id/basis/result. If the
 * submission or its calculations later change, the stored fingerprint no
 * longer matches what a fresh review would compute — coverage reads must
 * treat that as "requires review again" even though the status column still
 * says REVIEWED until the next explicit review call updates it (this
 * module never silently rewrites review history from a read path).
 */

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, assertSiteAccess } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { tenantWhere, assertOwned, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import type { TenantRepositoryContext } from "@/lib/repositories/context";

export { TenantOwnershipError };

export class SourcePeriodObligationError extends Error {}

type Tx = Prisma.TransactionClient;

/** An entry in one of these statuses has no settled result yet and cannot be reviewed. */
const UNRESOLVED_ENTRY_STATUSES = new Set(["FLAGGED", "AWAITING_FACTOR", "REJECTED"]);

/**
 * Canonical fingerprint of a reviewed submission: the entry's own
 * value/unit plus every contributing calculation's id/basis/result,
 * calculations sorted by id so the fingerprint does not depend on query
 * ordering. Changing any of these inputs changes the fingerprint.
 */
export function computeReviewFingerprint(
  entry: { id: string; canonicalValue: Prisma.Decimal | string; canonicalUnit: string },
  calculations: { id: string; basis: string; resultKgCo2e: Prisma.Decimal | string }[],
): string {
  const parts = [
    `entry:${entry.id}:${entry.canonicalValue.toString()}:${entry.canonicalUnit}`,
    ...calculations
      .map((c) => `calc:${c.id}:${c.basis}:${c.resultKgCo2e.toString()}`)
      .sort(),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

async function loadOwnedObligation(tx: Tx, ctx: TenantRepositoryContext, obligationId: string) {
  const obligation = await tx.carbonSourcePeriodObligation.findFirst({
    where: tenantWhere(ctx, { id: obligationId }),
  });
  return assertOwned(ctx, obligation);
}

export interface ReviewSourcePeriodObligationInput {
  /** Recorded on the audit event only; never interpreted by coverage logic. */
  note?: string;
}

/**
 * Reviews the submission already bound to this obligation. Requires
 * `carbon.entry.review` plus site access to the obligation's own site.
 * Fails if no submission is bound yet, the submission is in an unresolved
 * QA state (FLAGGED/AWAITING_FACTOR/REJECTED), or it has no calculated
 * result. The CAS `updateMany` guards against a concurrent duplicate
 * review racing this one — a lost race throws rather than double-reviewing.
 */
export async function reviewSourcePeriodObligation(
  context: OrganisationContext,
  obligationId: string,
  input: ReviewSourcePeriodObligationInput = {},
) {
  requirePermission(context, "carbon.entry.review");
  const ctx = toTenantRepositoryContext(context);

  return runInTenantTransaction(ctx, prisma, async (tx: Tx, txCtx: TenantRepositoryContext) => {
    const obligation = await loadOwnedObligation(tx, txCtx, obligationId);
    assertSiteAccess(context, obligation.siteId);

    if (obligation.status === "EXCLUDED") {
      throw new SourcePeriodObligationError("An excluded obligation cannot be reviewed.");
    }
    if (!obligation.submittedActivityEntryId) {
      throw new SourcePeriodObligationError("No submission is bound to this obligation yet.");
    }

    const entry = await tx.activityEntry.findFirst({
      where: tenantWhere(txCtx, { id: obligation.submittedActivityEntryId }),
    });
    const owned = assertOwned(txCtx, entry);
    if (
      owned.siteId !== obligation.siteId ||
      monthOf(owned.periodStart) !== obligation.month
    ) {
      throw new SourcePeriodObligationError("Bound submission no longer matches this obligation's site/month.");
    }
    if (UNRESOLVED_ENTRY_STATUSES.has(owned.status)) {
      throw new SourcePeriodObligationError(`Submission is ${owned.status} and cannot be reviewed yet.`);
    }

    const calculations = await tx.calculation.findMany({
      where: tenantWhere(txCtx, { activityEntryId: owned.id }),
      select: { id: true, basis: true, resultKgCo2e: true },
    });
    if (calculations.length === 0) {
      throw new SourcePeriodObligationError("Submission has no calculated result yet.");
    }

    const reviewFingerprint = computeReviewFingerprint(owned, calculations);
    const reviewedAt = new Date();

    const cas = await tx.carbonSourcePeriodObligation.updateMany({
      where: { id: obligation.id, organisationId: txCtx.organisationId, status: obligation.status },
      data: {
        status: "REVIEWED",
        reviewedByMembershipId: context.membershipId,
        reviewedAt,
        reviewFingerprint,
      },
    });
    if (cas.count === 0) {
      throw new SourcePeriodObligationError("Obligation status changed concurrently; re-review the current state.");
    }

    await recordAuditEvent(tx, txCtx, {
      eventType: "carbon_source_period_obligation.reviewed",
      resourceType: "carbon_source_period_obligation",
      resourceId: obligation.id,
      summary: `Reviewed carbon source-period obligation ${obligation.siteId}/${obligation.month}/${obligation.sourceKey}${input.note ? ` — ${input.note}` : ""}`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
    });

    return tx.carbonSourcePeriodObligation.findUniqueOrThrow({ where: { id: obligation.id } });
  });
}

export interface ExcludeSourcePeriodObligationInput {
  reason: string;
}

/**
 * Excludes an obligation from the reviewed-completeness denominator with a
 * recorded reason and authorised decision — never merely because no
 * matching submission was found. Requires `carbon.entry.approve` (a
 * separate, higher grant than `carbon.entry.review`) plus site access.
 */
export async function excludeSourcePeriodObligation(
  context: OrganisationContext,
  obligationId: string,
  input: ExcludeSourcePeriodObligationInput,
) {
  requirePermission(context, "carbon.entry.approve");
  if (!input.reason.trim()) {
    throw new SourcePeriodObligationError("An exclusion requires a recorded reason.");
  }
  const ctx = toTenantRepositoryContext(context);

  return runInTenantTransaction(ctx, prisma, async (tx: Tx, txCtx: TenantRepositoryContext) => {
    const obligation = await loadOwnedObligation(tx, txCtx, obligationId);
    assertSiteAccess(context, obligation.siteId);

    const excludedAt = new Date();
    const cas = await tx.carbonSourcePeriodObligation.updateMany({
      where: { id: obligation.id, organisationId: txCtx.organisationId, status: obligation.status },
      data: {
        status: "EXCLUDED",
        excludedByMembershipId: context.membershipId,
        excludedAt,
        excludedReason: input.reason,
      },
    });
    if (cas.count === 0) {
      throw new SourcePeriodObligationError("Obligation status changed concurrently; re-check the current state.");
    }

    await recordAuditEvent(tx, txCtx, {
      eventType: "carbon_source_period_obligation.excluded",
      resourceType: "carbon_source_period_obligation",
      resourceId: obligation.id,
      summary: `Excluded carbon source-period obligation ${obligation.siteId}/${obligation.month}/${obligation.sourceKey}: ${input.reason}`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
    });

    return tx.carbonSourcePeriodObligation.findUniqueOrThrow({ where: { id: obligation.id } });
  });
}

function monthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

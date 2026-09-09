import { withLockedNonconformity } from "./locked-transaction";
/**
 * Root-cause analysis (task T64, Docs/PHASE6_AUDIT_INCIDENT_CAPA_SPEC.md
 * §§1-2,4). Depends on T63 (`Nonconformity`), already on this branch.
 *
 * Fixed decisions this module enforces (spec §1, T64 acceptance):
 *  - a `RootCauseAnalysis` is recorded, then separately approved — recording
 *    never implies approval, and only an approved analysis satisfies
 *    `NonconformityClosurePolicy.requireRootCauseApproval`
 *    (`nonconformity-service.ts#assertMandatoryCloseStepsComplete`);
 *  - approving a `RootCauseAnalysis` moves its Nonconformity from
 *    `CONTAINED` (or `REOPENED`, when the analysis is redone after an
 *    ineffective outcome) to `ROOT_CAUSE_APPROVED` — the only way that
 *    transition can happen;
 *  - a `RootCauseAnalysis` is never edited after it is recorded; a
 *    correction is a new row, so root-cause history is never overwritten.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma, RootCauseMethod } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { findTenantNonconformity, toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

export { TenantOwnershipError };

export class RootCauseError extends Error {}

export const NONCONFORMITY_MANAGE_PERMISSION = "ems.nonconformity.manage" as const;

/** Statuses a Nonconformity may be in when a fresh root-cause analysis is started. */
const ANALYSABLE_STATUSES = new Set(["CONTAINED", "REOPENED"]);

export interface RecordRootCauseAnalysisInput {
  method: RootCauseMethod;
  analysisPayload: Record<string, unknown>;
  contributors?: Record<string, unknown> | unknown[] | null;
  conclusion: string;
  actorUserId: string;
}

export async function recordRootCauseAnalysis(context: OrganisationContext, nonconformityId: string, input: RecordRootCauseAnalysisInput) {
  requirePermission(context, NONCONFORMITY_MANAGE_PERMISSION);
  if (!input.conclusion.trim()) throw new RootCauseError("Enter the root-cause conclusion.");
  return withLockedNonconformity(context, { nonconformityId }, NONCONFORMITY_MANAGE_PERMISSION, async (tx, txCtx, context) => {
  const ctx = txCtx;
  const nonconformity = await tx.nonconformity.findFirst({ where: tenantWhere(ctx, { id: nonconformityId }) });
  if (!nonconformity) throw new TenantOwnershipError();
  if (!ANALYSABLE_STATUSES.has(nonconformity.status)) {
    throw new RootCauseError(`A root-cause analysis cannot be recorded while the nonconformity is ${nonconformity.status}.`);
  }

    const analysis = await tx.rootCauseAnalysis.create({
      data: {
        organisationId: txCtx.organisationId,
        nonconformityId: nonconformity.id,
        method: input.method,
        analysisPayload: input.analysisPayload as Prisma.InputJsonValue,
        contributors: (input.contributors as Prisma.InputJsonValue | undefined) ?? undefined,
        conclusion: input.conclusion.trim(),
        createdByUserId: context.userId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "root_cause_analysis.recorded",
      resourceType: "root_cause_analysis",
      resourceId: analysis.id,
      summary: `Root-cause analysis (${input.method}) recorded for nonconformity "${nonconformity.reference}".`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { nonconformityId: nonconformity.id, method: input.method },
    });
    return analysis;
  });
}

export interface ApproveRootCauseAnalysisInput {
  actorUserId: string;
}

/**
 * Approves a recorded root-cause analysis and moves the Nonconformity to
 * `ROOT_CAUSE_APPROVED` (spec §2 state machine). The only transition this
 * module performs.
 */
export async function approveRootCauseAnalysis(context: OrganisationContext, rootCauseAnalysisId: string, input: ApproveRootCauseAnalysisInput) {
  // Compatibility argument only: the authenticated context supplies the actor.
  void input;
  requirePermission(context, NONCONFORMITY_MANAGE_PERMISSION);
  return withLockedNonconformity(context, { rootCauseAnalysisId }, NONCONFORMITY_MANAGE_PERMISSION, async (tx, txCtx, context) => {
  const ctx = txCtx;
  const analysis = await tx.rootCauseAnalysis.findFirst({ where: tenantWhere(ctx, { id: rootCauseAnalysisId }) });
  if (!analysis) throw new TenantOwnershipError();
  if (analysis.approvedAt) throw new RootCauseError("This root-cause analysis has already been approved.");
  const nonconformity = await tx.nonconformity.findFirst({ where: tenantWhere(ctx, { id: analysis.nonconformityId }) });
  if (!nonconformity) throw new TenantOwnershipError();
  if (!ANALYSABLE_STATUSES.has(nonconformity.status)) {
    throw new RootCauseError(`Root-cause approval cannot be recorded while the nonconformity is ${nonconformity.status}.`);
  }

    const approved = await tx.rootCauseAnalysis.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: analysis.id } },
      data: { approvedByMembershipId: context.membershipId, approvedAt: new Date() },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "root_cause_analysis.approved",
      resourceType: "root_cause_analysis",
      resourceId: analysis.id,
      summary: `Root-cause analysis approved for nonconformity "${nonconformity.reference}".`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { nonconformityId: nonconformity.id },
    });
    await tx.nonconformity.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: nonconformity.id } },
      data: { status: "ROOT_CAUSE_APPROVED" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "nonconformity.root_cause_approved",
      resourceType: "nonconformity",
      resourceId: nonconformity.id,
      summary: `Nonconformity "${nonconformity.reference}" moved to ROOT_CAUSE_APPROVED.`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: nonconformity.status },
      after: { status: "ROOT_CAUSE_APPROVED" },
    });
    return approved;
  });
}

export async function listRootCauseAnalyses(context: OrganisationContext, nonconformityId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const nonconformity = await findTenantNonconformity(ctx, nonconformityId);
  if (!nonconformity) throw new TenantOwnershipError();
  return prisma.rootCauseAnalysis.findMany({
    where: tenantWhere(ctx, { nonconformityId: nonconformity.id }),
    orderBy: { createdAt: "asc" },
  });
}

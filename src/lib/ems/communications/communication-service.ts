/**
 * Tenant-scoped environmental communications (task T35,
 * Docs/PHASE3_ASPECTS_OPERATIONS_SPEC.md §2 "Communications and emergency
 * preparedness"). `ems.communication.manage` gates both plans and records.
 *
 * T35 acceptance: "external communications follow configured approval" — a
 * `CommunicationRecord` whose plan has `approvalRequired = true` (or one
 * with `audience = EXTERNAL`/`BOTH` and no plan) must already carry
 * `approverMembershipId`/`approvedAt` before it may be created; the service
 * never approves a record itself and never mutates one after creation.
 */

import type { CommunicationAudience, CommunicationPlanStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext, findTenantCommunicationPlan } from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { linkEvidence, uploadEvidenceObject } from "@/lib/documents/evidence-service";

export { TenantOwnershipError };

export class CommunicationError extends Error {}

export interface CommunicationPlanInput {
  subject: string;
  audience: CommunicationAudience;
  triggerFrequency: string;
  method: string;
  approvalRequired: boolean;
  sourceRequirements?: string | null;
  ownerMembershipId: string;
  actorUserId: string;
}

export async function createCommunicationPlan(context: OrganisationContext, input: CommunicationPlanInput) {
  requirePermission(context, "ems.communication.manage");
  const ctx = toTenantRepositoryContext(context);
  const owner = await prisma.organisationMembership.findFirst({
    where: { id: input.ownerMembershipId, organisationId: ctx.organisationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!owner) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const plan = await tx.communicationPlan.create({
      data: {
        organisationId: txCtx.organisationId,
        subject: input.subject.trim(),
        audience: input.audience,
        triggerFrequency: input.triggerFrequency.trim(),
        method: input.method.trim(),
        approvalRequired: input.approvalRequired,
        sourceRequirements: input.sourceRequirements?.trim() || null,
        ownerMembershipId: input.ownerMembershipId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "communication_plan.created",
      resourceType: "communication_plan",
      resourceId: plan.id,
      summary: `Communication plan "${plan.subject}" created.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { subject: plan.subject, audience: plan.audience, approvalRequired: plan.approvalRequired },
    });
    return plan;
  });
}

export async function setCommunicationPlanStatus(
  context: OrganisationContext,
  planId: string,
  status: CommunicationPlanStatus,
  actorUserId: string,
) {
  requirePermission(context, "ems.communication.manage");
  const ctx = toTenantRepositoryContext(context);
  const plan = await findTenantCommunicationPlan(ctx, planId);
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.communicationPlan.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: plan.id } },
      data: { status },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "communication_plan.status_changed",
      resourceType: "communication_plan",
      resourceId: plan.id,
      summary: `Communication plan "${plan.subject}" set to ${status}.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: plan.status },
      after: { status },
    });
    return updated;
  });
}

export async function listCommunicationPlans(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.communicationPlan.findMany({
    where: tenantWhere(ctx, {}),
    include: {
      owner: { select: { id: true, user: { select: { name: true } } } },
      records: { orderBy: { occurredAt: "desc" }, take: 10 },
    },
    orderBy: { subject: "asc" },
  });
}

export interface CommunicationRecordInput {
  planId?: string | null;
  occurredAt: Date;
  audience: CommunicationAudience;
  parties: string;
  contentSummary: string;
  approvedContentRevisionId?: string | null;
  approverMembershipId?: string | null;
  approvedAt?: Date | null;
  responseFollowUp?: string | null;
  senderMembershipId: string;
  actorUserId: string;
}

function requiresApproval(audience: CommunicationAudience, plan: { approvalRequired: boolean } | null): boolean {
  if (plan) return plan.approvalRequired;
  return audience === "EXTERNAL" || audience === "BOTH";
}

export async function recordCommunication(context: OrganisationContext, input: CommunicationRecordInput) {
  requirePermission(context, "ems.communication.manage");
  const ctx = toTenantRepositoryContext(context);

  let plan: { id: string; approvalRequired: boolean; status: CommunicationPlanStatus } | null = null;
  if (input.planId) {
    plan = await findTenantCommunicationPlan(ctx, input.planId);
    if (plan.status !== "ACTIVE") throw new CommunicationError("Only an active communication plan may be used.");
  }

  if (requiresApproval(input.audience, plan)) {
    if (!input.approverMembershipId || !input.approvedAt) {
      throw new CommunicationError("This communication requires configured approval before it can be recorded.");
    }
    const approver = await prisma.organisationMembership.findFirst({
      where: { id: input.approverMembershipId, organisationId: ctx.organisationId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!approver) throw new TenantOwnershipError();
  }

  if (input.approvedContentRevisionId) {
    const documentWhere: Prisma.ControlledDocumentRevisionWhereInput = {
      id: input.approvedContentRevisionId,
      status: { in: ["APPROVED", "EFFECTIVE"] },
    };
    const revision = await prisma.controlledDocumentRevision.findFirst({
      where: tenantWhere(ctx, documentWhere),
      select: { id: true },
    });
    if (!revision) throw new CommunicationError("Choose an approved or effective controlled-document revision from this organisation.");
  }

  const sender = await prisma.organisationMembership.findFirst({
    where: { id: input.senderMembershipId, organisationId: ctx.organisationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!sender) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const record = await tx.communicationRecord.create({
      data: {
        organisationId: txCtx.organisationId,
        planId: plan?.id ?? null,
        occurredAt: input.occurredAt,
        audience: input.audience,
        parties: input.parties.trim(),
        contentSummary: input.contentSummary.trim(),
        approvedContentRevisionId: input.approvedContentRevisionId || null,
        senderMembershipId: input.senderMembershipId,
        approverMembershipId: input.approverMembershipId || null,
        approvedAt: input.approvedAt ?? null,
        responseFollowUp: input.responseFollowUp?.trim() || null,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "communication_record.created",
      resourceType: "communication_record",
      resourceId: record.id,
      summary: `Communication recorded for audience ${record.audience}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { planId: record.planId, audience: record.audience },
    });
    return record;
  });
}

export async function uploadEvidenceToCommunicationRecord(
  context: OrganisationContext,
  input: { recordId: string; fileName: string; mimeType: string; bytes: Buffer; purpose?: string | null; actorUserId: string },
) {
  requirePermission(context, "ems.communication.manage");
  const ctx = toTenantRepositoryContext(context);
  const record = await prisma.communicationRecord.findFirst({ where: tenantWhere(ctx, { id: input.recordId }) });
  if (!record) throw new TenantOwnershipError();
  const evidence = await uploadEvidenceObject(context, {
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
    uploadedByUserId: input.actorUserId,
  });
  await linkEvidence(context, {
    evidenceId: evidence.id,
    resourceType: "communication_record",
    resourceId: record.id,
    purpose: input.purpose,
    linkedByUserId: input.actorUserId,
  });
  return evidence;
}

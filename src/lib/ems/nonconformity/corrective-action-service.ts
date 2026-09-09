import { withLockedNonconformity } from "./locked-transaction";
/**
 * Corrective/preventive action handling (task T64,
 * Docs/PHASE6_AUDIT_INCIDENT_CAPA_SPEC.md §§1-2,4,6). Depends on T63
 * (`Nonconformity`, in `ROOT_CAUSE_APPROVED` before an action can be
 * created) and T52 (`ActionItem`, optionally shared — see below), both
 * already on this branch.
 *
 * Fixed decisions this module enforces (spec §1, T64 acceptance):
 *  - a `CorrectiveAction` can only be created once its Nonconformity's root
 *    cause has been approved (`ROOT_CAUSE_APPROVED`), never before;
 *  - creating the first `CorrectiveAction` on a Nonconformity moves it from
 *    `ROOT_CAUSE_APPROVED` to `ACTIONS_IN_PROGRESS` — the only way that
 *    transition can happen;
 *  - `sharedActionItemId` optionally links an existing T52 `ActionItem` for
 *    dashboard/reminder reuse (spec §6 "shared action service"), but this
 *    module never writes to the linked `ActionItem` — completing or
 *    verifying a `CorrectiveAction` never mutates a shared `ActionItem`'s
 *    own status, exactly as T52's `completeActionItem` never mutates a
 *    linked `EnvironmentalObjective`;
 *  - a closed action (COMPLETED/VERIFIED/CANCELLED) is immutable except
 *    through `reopenCorrectiveAction`'s explicit transition, mirroring the
 *    T52 `ActionItem` convention;
 *  - overdue escalation (`notifyOverdueCorrectiveActions`) reuses the T24
 *    `action.overdue` notification type and mirrors T52's
 *    `notifyOverdueActionItems` exactly: an explicit, permission-checked
 *    function callers/jobs invoke, deduped by id+due-date, no background
 *    scheduler here;
 *  - every status transition, reassignment, completion, verification and
 *    reopen writes a platform `AuditEvent`, preserving action history.
 */

import type { CorrectiveActionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import {
  findTenantNonconformity,
  findTenantCorrectiveAction,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { notifyMembership, suppressNotificationsForResource } from "@/lib/notifications/notification-service";
import { linkEvidence, uploadEvidenceObject, listEvidenceForResource } from "@/lib/documents/evidence-service";
import type { TenantRepositoryContext } from "@/lib/repositories/context";

export { TenantOwnershipError };

export class CorrectiveActionError extends Error {}

export const CORRECTIVE_ACTION_MANAGE_PERMISSION = "ems.corrective_action.manage" as const;

type Tx = Prisma.TransactionClient;

const CLOSED_STATUSES: readonly CorrectiveActionStatus[] = ["COMPLETED", "VERIFIED", "CANCELLED"];

function isClosed(status: CorrectiveActionStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

async function validateActiveMembership(context: OrganisationContext, membershipId: string, db: Prisma.TransactionClient = prisma) {
  const membership = await db.organisationMembership.findFirst({
    where: { id: membershipId, organisationId: context.organisationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!membership) throw new TenantOwnershipError();
  return membership;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface CreateCorrectiveActionInput {
  description: string;
  completionCriteria?: string | null;
  ownerMembershipId: string;
  dueDate: Date;
  sharedActionItemId?: string | null;
  actorUserId: string;
}

export async function createCorrectiveAction(context: OrganisationContext, nonconformityId: string, input: CreateCorrectiveActionInput) {
  requirePermission(context, CORRECTIVE_ACTION_MANAGE_PERMISSION);
  if (!input.description.trim()) throw new CorrectiveActionError("Describe the corrective action.");
  if (!input.dueDate) throw new CorrectiveActionError("Enter a due date.");
  return withLockedNonconformity(context, { nonconformityId }, CORRECTIVE_ACTION_MANAGE_PERMISSION, async (tx, txCtx, context) => {
  const ctx = txCtx;
  const nonconformity = await tx.nonconformity.findFirst({ where: tenantWhere(ctx, { id: nonconformityId }) });
  if (!nonconformity) throw new TenantOwnershipError();
  if (nonconformity.status !== "ROOT_CAUSE_APPROVED" && nonconformity.status !== "ACTIONS_IN_PROGRESS") {
    throw new CorrectiveActionError(`A corrective action cannot be created while the nonconformity is ${nonconformity.status}; approve root cause first.`);
  }
  await validateActiveMembership(context, input.ownerMembershipId, tx);
  if (input.sharedActionItemId) {
    const sharedAction = await tx.actionItem.findFirst({ where: tenantWhere(ctx, { id: input.sharedActionItemId }) });
    if (!sharedAction) throw new TenantOwnershipError();
  }

    const action = await tx.correctiveAction.create({
      data: {
        organisationId: txCtx.organisationId,
        nonconformityId: nonconformity.id,
        description: input.description.trim(),
        completionCriteria: input.completionCriteria?.trim() || null,
        ownerMembershipId: input.ownerMembershipId,
        dueDate: input.dueDate,
        sharedActionItemId: input.sharedActionItemId || null,
        status: "OPEN",
        createdByUserId: context.userId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "corrective_action.created",
      resourceType: "corrective_action",
      resourceId: action.id,
      summary: `Corrective action created for nonconformity "${nonconformity.reference}".`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { nonconformityId: nonconformity.id, ownerMembershipId: action.ownerMembershipId, dueDate: action.dueDate },
    });
    if (nonconformity.status === "ROOT_CAUSE_APPROVED") {
      await tx.nonconformity.update({
        where: { organisationId_id: { organisationId: txCtx.organisationId, id: nonconformity.id } },
        data: { status: "ACTIONS_IN_PROGRESS" },
      });
      await recordAuditEvent(tx, txCtx, {
        eventType: "nonconformity.actions_in_progress",
        resourceType: "nonconformity",
        resourceId: nonconformity.id,
        summary: `Nonconformity "${nonconformity.reference}" moved to ACTIONS_IN_PROGRESS.`,
        actorUserId: context.userId,
        correlationId: txCtx.correlationId,
        source: "web-app",
        before: { status: "ROOT_CAUSE_APPROVED" },
        after: { status: "ACTIONS_IN_PROGRESS" },
      });
    }
    return action;
  });
}

export async function listCorrectiveActions(context: OrganisationContext, nonconformityId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const nonconformity = await findTenantNonconformity(ctx, nonconformityId);
  if (!nonconformity) throw new TenantOwnershipError();
  return prisma.correctiveAction.findMany({
    where: tenantWhere(ctx, { nonconformityId: nonconformity.id }),
    orderBy: { dueDate: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Reassignment
// ---------------------------------------------------------------------------

export interface ReassignCorrectiveActionInput {
  newOwnerMembershipId: string;
  actorUserId: string;
}

export async function reassignCorrectiveAction(context: OrganisationContext, correctiveActionId: string, input: ReassignCorrectiveActionInput) {
  requirePermission(context, CORRECTIVE_ACTION_MANAGE_PERMISSION);
  return withLockedNonconformity(context, { correctiveActionId }, CORRECTIVE_ACTION_MANAGE_PERMISSION, async (tx, txCtx, context) => {
  const ctx = txCtx;
  const action = await tx.correctiveAction.findFirst({ where: tenantWhere(ctx, { id: correctiveActionId }) });
  if (!action) throw new TenantOwnershipError();
  const parent = await tx.nonconformity.findFirst({ where: tenantWhere(ctx, { id: action.nonconformityId }) });
  if (!parent) throw new TenantOwnershipError();
  if (parent.status === "CLOSED") throw new CorrectiveActionError("Reopen the nonconformity before changing its corrective actions.");
  if (parent.status === "EFFECTIVENESS_REVIEW") throw new CorrectiveActionError("Reopen the corrective action to start a new review cycle before changing it.");

  if (isClosed(action.status)) throw new CorrectiveActionError(`Corrective action is ${action.status} and cannot be reassigned; reopen it first.`);
  await validateActiveMembership(context, input.newOwnerMembershipId, tx);

    const updated = await tx.correctiveAction.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: action.id } },
      data: { ownerMembershipId: input.newOwnerMembershipId },
    });
    await suppressNotificationsForResource(tx, txCtx, "corrective_action", action.id);
    await recordAuditEvent(tx, txCtx, {
      eventType: "corrective_action.reassigned",
      resourceType: "corrective_action",
      resourceId: action.id,
      summary: "Corrective action reassigned to a new owner.",
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { ownerMembershipId: action.ownerMembershipId },
      after: { ownerMembershipId: input.newOwnerMembershipId },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Status transitions (OPEN <-> IN_PROGRESS)
// ---------------------------------------------------------------------------

const OPEN_STATUS_TRANSITIONS: Record<string, CorrectiveActionStatus[]> = {
  OPEN: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["CANCELLED"],
  REOPENED: ["IN_PROGRESS", "CANCELLED"],
};

export async function setCorrectiveActionStatus(context: OrganisationContext, correctiveActionId: string, status: CorrectiveActionStatus, actorUserId: string) {
  // Compatibility argument only: the authenticated context supplies the actor.
  void actorUserId;
  requirePermission(context, CORRECTIVE_ACTION_MANAGE_PERMISSION);
  return withLockedNonconformity(context, { correctiveActionId }, CORRECTIVE_ACTION_MANAGE_PERMISSION, async (tx, txCtx, context) => {
  const ctx = txCtx;
  const action = await tx.correctiveAction.findFirst({ where: tenantWhere(ctx, { id: correctiveActionId }) });
  if (!action) throw new TenantOwnershipError();
  const parent = await tx.nonconformity.findFirst({ where: tenantWhere(ctx, { id: action.nonconformityId }) });
  if (!parent) throw new TenantOwnershipError();
  if (parent.status === "CLOSED") throw new CorrectiveActionError("Reopen the nonconformity before changing its corrective actions.");
  if (parent.status === "EFFECTIVENESS_REVIEW") throw new CorrectiveActionError("Reopen the corrective action to start a new review cycle before changing it.");

  if (isClosed(action.status)) throw new CorrectiveActionError(`Corrective action is ${action.status} and cannot change status directly; reopen it first.`);
  const allowed = OPEN_STATUS_TRANSITIONS[action.status] ?? [];
  if (!allowed.includes(status)) {
    throw new CorrectiveActionError(`Corrective action cannot move from ${action.status} to ${status}.`);
  }

    const updated = await tx.correctiveAction.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: action.id } },
      data: { status },
    });
    if (status === "CANCELLED") {
      await suppressNotificationsForResource(tx, txCtx, "corrective_action", action.id);
    }
    await recordAuditEvent(tx, txCtx, {
      eventType: "corrective_action.status_changed",
      resourceType: "corrective_action",
      resourceId: action.id,
      summary: `Corrective action status changed to ${status}.`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: action.status },
      after: { status },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Completion, verification, evidence
// ---------------------------------------------------------------------------

export interface CompleteCorrectiveActionInput {
  completionEvidenceNote: string;
  actorUserId: string;
}

export async function completeCorrectiveAction(context: OrganisationContext, correctiveActionId: string, input: CompleteCorrectiveActionInput) {
  requirePermission(context, CORRECTIVE_ACTION_MANAGE_PERMISSION);
  if (!input.completionEvidenceNote.trim()) throw new CorrectiveActionError("Describe the completion evidence.");
  return withLockedNonconformity(context, { correctiveActionId }, CORRECTIVE_ACTION_MANAGE_PERMISSION, async (tx, txCtx, context) => {
  const ctx = txCtx;
  const action = await tx.correctiveAction.findFirst({ where: tenantWhere(ctx, { id: correctiveActionId }) });
  if (!action) throw new TenantOwnershipError();
  const parent = await tx.nonconformity.findFirst({ where: tenantWhere(ctx, { id: action.nonconformityId }) });
  if (!parent) throw new TenantOwnershipError();
  if (parent.status === "CLOSED") throw new CorrectiveActionError("Reopen the nonconformity before changing its corrective actions.");
  if (parent.status === "EFFECTIVENESS_REVIEW") throw new CorrectiveActionError("Reopen the corrective action to start a new review cycle before changing it.");

  if (isClosed(action.status)) throw new CorrectiveActionError(`Corrective action is already ${action.status}.`);

    const now = new Date();
    // BD02: CAS on the write itself, not just the read above — closes the
    // race between the pre-transaction status check and this write (a
    // concurrent duplicate submit, or the action closing via another path
    // mid-request). A stale caller gets a conflict, never a silent
    // second "completed" transition.
    const { count } = await tx.correctiveAction.updateMany({
      where: { organisationId: txCtx.organisationId, id: action.id, status: { notIn: [...CLOSED_STATUSES] } },
      data: {
        status: "COMPLETED",
        completedAt: now,
        completedByUserId: context.userId,
        completionEvidenceNote: input.completionEvidenceNote.trim(),
      },
    });
    if (count === 0) throw new CorrectiveActionError("Corrective action was already closed by another update.");
    const updated = await tx.correctiveAction.findUniqueOrThrow({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: action.id } },
    });
    await suppressNotificationsForResource(tx, txCtx, "corrective_action", action.id);
    await recordAuditEvent(tx, txCtx, {
      eventType: "corrective_action.completed",
      resourceType: "corrective_action",
      resourceId: action.id,
      summary: "Corrective action completed.",
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: action.status },
      after: { status: "COMPLETED" },
    });
    return updated;
  });
}

export interface VerifyCorrectiveActionInput {
  actorUserId: string;
}

/**
 * BD02: four-eyes is always enforced here, server-side and non-overridable
 * — no organisation setting currently relaxes it, so unlike the sibling
 * `fourEyesEnabled?: boolean` parameter this module and others in the EMS
 * layer historically accepted (never actually supplied by any live caller,
 * confirmed by inspection), there is no legitimate value a caller could
 * pass here. Removing the parameter closes that unused override before it
 * becomes one. The same pattern exists elsewhere in the EMS layer
 * (objectives, legal obligations, documents); left alone here as outside
 * this package's demonstrated corrective-action/effectiveness chain.
 */
export async function verifyCorrectiveAction(context: OrganisationContext, correctiveActionId: string, input: VerifyCorrectiveActionInput) {
  // Compatibility argument only: the authenticated context supplies the actor.
  void input;
  requirePermission(context, CORRECTIVE_ACTION_MANAGE_PERMISSION);
  return withLockedNonconformity(context, { correctiveActionId }, CORRECTIVE_ACTION_MANAGE_PERMISSION, async (tx, txCtx, context) => {
  const ctx = txCtx;
  const action = await tx.correctiveAction.findFirst({ where: tenantWhere(ctx, { id: correctiveActionId }) });
  if (!action) throw new TenantOwnershipError();
  const parent = await tx.nonconformity.findFirst({ where: tenantWhere(ctx, { id: action.nonconformityId }) });
  if (!parent) throw new TenantOwnershipError();
  if (parent.status === "CLOSED") throw new CorrectiveActionError("Reopen the nonconformity before changing its corrective actions.");

  if (action.status !== "COMPLETED") throw new CorrectiveActionError("Only a completed corrective action can be verified.");
  if (action.completedByUserId === context.userId) {
    throw new CorrectiveActionError("The person who completed this corrective action cannot also verify it.");
  }

    const now = new Date();
    // BD02: CAS re-proves both the status and the self-verification
    // exclusion at the moment of the write — closes the race where the
    // action changed (or was completed by this same actor) between the
    // reads above and this transaction.
    const { count } = await tx.correctiveAction.updateMany({
      where: {
        organisationId: txCtx.organisationId,
        id: action.id,
        status: "COMPLETED",
        completedByUserId: { not: context.userId },
      },
      data: { status: "VERIFIED", verifiedAt: now, verifiedByMembershipId: context.membershipId },
    });
    if (count === 0) {
      throw new CorrectiveActionError(
        "Corrective action could not be verified — it may have changed since you loaded it, or you completed it yourself.",
      );
    }
    const updated = await tx.correctiveAction.findUniqueOrThrow({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: action.id } },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "corrective_action.verified",
      resourceType: "corrective_action",
      resourceId: action.id,
      summary: "Corrective action verified.",
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "COMPLETED" },
      after: { status: "VERIFIED" },
    });
    return updated;
  });
}

export interface ReopenCorrectiveActionInput {
  reopenReason: string;
  actorUserId: string;
}

export async function reopenCorrectiveAction(context: OrganisationContext, correctiveActionId: string, input: ReopenCorrectiveActionInput) {
  requirePermission(context, CORRECTIVE_ACTION_MANAGE_PERMISSION);
  if (!input.reopenReason.trim()) throw new CorrectiveActionError("Enter a reason for reopening.");
  return withLockedNonconformity(context, { correctiveActionId }, CORRECTIVE_ACTION_MANAGE_PERMISSION, async (tx, txCtx, context) => {
  const ctx = txCtx;
  const action = await tx.correctiveAction.findFirst({ where: tenantWhere(ctx, { id: correctiveActionId }) });
  if (!action) throw new TenantOwnershipError();
  const parent = await tx.nonconformity.findFirst({ where: tenantWhere(ctx, { id: action.nonconformityId }) });
  if (!parent) throw new TenantOwnershipError();
  if (parent.status === "CLOSED") throw new CorrectiveActionError("Reopen the nonconformity before changing its corrective actions.");

  if (!isClosed(action.status)) throw new CorrectiveActionError("Only a completed, verified or cancelled corrective action can be reopened.");

    if (parent.status === "EFFECTIVENESS_REVIEW") {
      await tx.nonconformity.update({ where: { id: parent.id }, data: { status: "ACTIONS_IN_PROGRESS" } });
      await recordAuditEvent(tx, txCtx, { eventType: "nonconformity.actions_in_progress", resourceType: "nonconformity", resourceId: parent.id,
        summary: "Corrective action reopened; a new effectiveness review cycle is required.", actorUserId: context.userId, correlationId: txCtx.correlationId,
        source: "web-app", before: { status: parent.status, reviewCycle: parent.reviewCycle }, after: { status: "ACTIONS_IN_PROGRESS" } });
    }
    const now = new Date();
    const updated = await tx.correctiveAction.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: action.id } },
      data: { status: "REOPENED", reopenedAt: now, reopenedByUserId: context.userId, reopenReason: input.reopenReason.trim() },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "corrective_action.reopened",
      resourceType: "corrective_action",
      resourceId: action.id,
      summary: "Corrective action reopened.",
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: action.status },
      after: { status: "REOPENED" },
    });
    return updated;
  });
}

export async function uploadEvidenceToCorrectiveAction(
  context: OrganisationContext,
  input: { correctiveActionId: string; fileName: string; mimeType: string; bytes: Buffer; purpose?: string | null; actorUserId: string },
) {
  requirePermission(context, CORRECTIVE_ACTION_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const action = await findTenantCorrectiveAction(ctx, input.correctiveActionId);
  if (!action) throw new TenantOwnershipError();

  const evidence = await uploadEvidenceObject(context, {
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
    uploadedByUserId: context.userId,
  });
  await linkEvidence(context, {
    evidenceId: evidence.id,
    resourceType: "corrective_action",
    resourceId: action.id,
    purpose: input.purpose,
    linkedByUserId: context.userId,
  });
  return evidence;
}

export async function listCorrectiveActionEvidence(context: OrganisationContext, correctiveActionId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const action = await findTenantCorrectiveAction(ctx, correctiveActionId);
  if (!action) throw new TenantOwnershipError();
  return listEvidenceForResource(context, "corrective_action", action.id);
}

// ---------------------------------------------------------------------------
// Overdue escalation (spec §1/T64 acceptance: "overdue escalation works").
// Mirrors `notifyOverdueActionItems` (T52) exactly.
// ---------------------------------------------------------------------------

export async function notifyOverdueCorrectiveActions(context: OrganisationContext, asOf = new Date()) {
  requirePermission(context, CORRECTIVE_ACTION_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const overdueActions = await prisma.correctiveAction.findMany({
    where: tenantWhere(ctx, {
      status: { notIn: [...CLOSED_STATUSES] },
      dueDate: { lt: asOf },
    }),
    select: { id: true, ownerMembershipId: true, dueDate: true },
  });

  return runInTenantTransaction(ctx, prisma, async (tx: Tx, txCtx: TenantRepositoryContext) => {
    const results = [];
    for (const action of overdueActions) {
      const outcome = await notifyMembership(tx, txCtx, {
        type: "action.overdue",
        recipientMembershipId: action.ownerMembershipId,
        resourceType: "corrective_action",
        resourceId: action.id,
        dedupeKey: `corrective-action-overdue:${action.id}:${action.dueDate.toISOString()}`,
      });
      results.push({ correctiveActionId: action.id, ...outcome });
    }
    return results;
  });
}

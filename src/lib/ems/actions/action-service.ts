/**
 * Action programmes and reminders (task T52, Docs/PHASE5_OBJECTIVES_ACTIONS_SPEC.md
 * §§1-3). Depends on T50 (`EnvironmentalObjective`) and T24
 * (notifications/reminders), both already on this branch.
 *
 * Fixed decisions this module enforces (spec §1):
 *  - completing/verifying an `ActionItem` never writes to
 *    `EnvironmentalObjective`/`EnvironmentalObjectiveVersion` — this module
 *    has no import of the objective-service write path, so "completing
 *    actions does not automatically mark an objective achieved" is true by
 *    construction, not by convention;
 *  - a closed action (COMPLETED/VERIFIED/CANCELLED) is immutable except
 *    through `reopenActionItem`'s explicit transition — defence-in-depth
 *    for this is the `action_item_immutable_once_closed` database trigger
 *    (T52 migration), so a bug in this module's own status checks still
 *    cannot mutate a closed row;
 *  - `verifyActionItem` denies the action's own completor from also
 *    verifying it whenever four-eyes is enabled — the same interim
 *    decision T22/T23/T44/T50 made (spec §5 "verification follows
 *    configured permission/separation");
 *  - reassignment, status changes, progress, completion, verification and
 *    reopen all write an `ActionStatusHistory` row (append-only) and a
 *    platform `AuditEvent`, satisfying "reassignment/history audited";
 *  - reassigning or closing an action suppresses its stale overdue
 *    notifications via `suppressNotificationsForResource` (T24 pattern).
 */

import type { ActionItemStatus, ActionProgrammeStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, assertFourEyes } from "@/lib/rbac/authorize";
import {
  findTenantActionProgramme,
  findTenantActionItem,
  findTenantEnvironmentalObjective,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { suppressNotificationsForResource } from "@/lib/notifications/notification-service";
import type { TenantRepositoryContext } from "@/lib/repositories/context";

export { TenantOwnershipError };

export class ActionError extends Error {}

const MANAGE_PERMISSION = "ems.action.manage" as const;

type Tx = Prisma.TransactionClient;

const CLOSED_STATUSES: readonly ActionItemStatus[] = ["COMPLETED", "VERIFIED", "CANCELLED"];

function isClosed(status: ActionItemStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Owner/membership validation shared by every write below.
// ---------------------------------------------------------------------------

async function validateActiveMembership(context: OrganisationContext, membershipId: string) {
  const membership = await prisma.organisationMembership.findFirst({
    where: { id: membershipId, organisationId: context.organisationId, status: "ACTIVE" },
    select: { id: true, userId: true },
  });
  if (!membership) throw new TenantOwnershipError();
  return membership;
}

// ---------------------------------------------------------------------------
// Programmes
// ---------------------------------------------------------------------------

export interface CreateActionProgrammeInput {
  objectiveId?: string | null;
  title: string;
  resourcesDescription?: string | null;
  ownerMembershipId: string;
  startDate?: Date | null;
  targetDate?: Date | null;
  actorUserId: string;
}

export async function createActionProgramme(context: OrganisationContext, input: CreateActionProgrammeInput) {
  requirePermission(context, MANAGE_PERMISSION);
  if (!input.title.trim()) throw new ActionError("Enter a title.");
  await validateActiveMembership(context, input.ownerMembershipId);
  const ctx = toTenantRepositoryContext(context);
  if (input.objectiveId) {
    const objective = await findTenantEnvironmentalObjective(ctx, input.objectiveId);
    if (!objective) throw new TenantOwnershipError();
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const programme = await tx.actionProgramme.create({
      data: {
        organisationId: txCtx.organisationId,
        objectiveId: input.objectiveId || null,
        title: input.title.trim(),
        resourcesDescription: input.resourcesDescription?.trim() || null,
        ownerMembershipId: input.ownerMembershipId,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        status: "ACTIVE",
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "action_programme.created",
      resourceType: "action_programme",
      resourceId: programme.id,
      summary: `Action programme "${programme.title}" created.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { title: programme.title, objectiveId: programme.objectiveId },
    });
    return programme;
  });
}

export async function listActionProgrammes(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.actionProgramme.findMany({
    where: tenantWhere(ctx, {}),
    include: {
      owner: { include: { user: { select: { name: true } } } },
      objective: { select: { id: true, activeVersionId: true } },
      actions: { orderBy: { dueDate: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function setActionProgrammeStatus(
  context: OrganisationContext,
  programmeId: string,
  status: ActionProgrammeStatus,
  actorUserId: string,
) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantActionProgramme(ctx, programmeId);
  if (!programme) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.actionProgramme.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: programme.id } },
      data: { status },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "action_programme.status_changed",
      resourceType: "action_programme",
      resourceId: programme.id,
      summary: `Action programme status changed to ${status}.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: programme.status },
      after: { status },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Action items — reads and dashboard
// ---------------------------------------------------------------------------

const actionItemInclude = {
  owner: { include: { user: { select: { name: true } } } },
  programme: { select: { id: true, title: true, objectiveId: true } },
  dependenciesOn: { include: { dependsOnActionItem: { select: { id: true, title: true, status: true } } } },
  progressUpdates: { orderBy: { recordedAt: "desc" as const } },
  statusHistory: { orderBy: { occurredAt: "desc" as const } },
} as const;

export async function listActionItems(context: OrganisationContext, programmeId?: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.actionItem.findMany({
    where: tenantWhere(ctx, programmeId ? { programmeId } : {}),
    include: actionItemInclude,
    orderBy: { dueDate: "asc" },
  });
}

/** Tenant-scoped dashboard read: open/overdue actions grouped by owner. Every query bakes organisationId into the where clause via `tenantWhere`. */
export async function listActionDashboard(context: OrganisationContext, asOf = new Date()) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const items = await prisma.actionItem.findMany({
    where: tenantWhere(ctx, { status: { notIn: [...CLOSED_STATUSES] } }),
    include: actionItemInclude,
    orderBy: { dueDate: "asc" },
  });
  return items.map((item) => ({
    ...item,
    overdue: item.dueDate.getTime() < asOf.getTime(),
  }));
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface CreateActionItemInput {
  programmeId: string;
  title: string;
  description?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  ownerMembershipId: string;
  startDate?: Date | null;
  dueDate: Date;
  completionCriteria?: string | null;
  dependsOnActionItemIds?: string[];
  actorUserId: string;
}

export async function createActionItem(context: OrganisationContext, input: CreateActionItemInput) {
  requirePermission(context, MANAGE_PERMISSION);
  if (!input.title.trim()) throw new ActionError("Enter a title.");
  if (!input.dueDate) throw new ActionError("Enter a due date.");
  await validateActiveMembership(context, input.ownerMembershipId);
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantActionProgramme(ctx, input.programmeId);
  if (!programme) throw new TenantOwnershipError();

  const dependsOnIds = input.dependsOnActionItemIds ?? [];
  const dependencies: string[] = [];
  for (const dependsOnId of dependsOnIds) {
    const dependsOn = await findTenantActionItem(ctx, dependsOnId);
    if (!dependsOn) throw new TenantOwnershipError();
    dependencies.push(dependsOn.id);
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const action = await tx.actionItem.create({
      data: {
        organisationId: txCtx.organisationId,
        programmeId: programme.id,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        priority: input.priority ?? "MEDIUM",
        ownerMembershipId: input.ownerMembershipId,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate,
        completionCriteria: input.completionCriteria?.trim() || null,
        status: "OPEN",
        dependenciesOn: {
          create: dependencies.map((dependsOnActionItemId) => ({
            organisationId: txCtx.organisationId,
            dependsOnActionItemId,
          })),
        },
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "action_item.created",
      resourceType: "action_item",
      resourceId: action.id,
      summary: `Action "${action.title}" created.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { programmeId: programme.id, ownerMembershipId: action.ownerMembershipId, dueDate: action.dueDate },
    });
    return action;
  });
}

// ---------------------------------------------------------------------------
// Reassignment (audited, suppresses stale notifications for the old owner)
// ---------------------------------------------------------------------------

export interface ReassignActionItemInput {
  newOwnerMembershipId: string;
  note?: string | null;
  actorUserId: string;
}

export async function reassignActionItem(context: OrganisationContext, actionItemId: string, input: ReassignActionItemInput) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const action = await findTenantActionItem(ctx, actionItemId);
  if (!action) throw new TenantOwnershipError();
  if (isClosed(action.status)) throw new ActionError(`Action is ${action.status} and cannot be reassigned; reopen it first.`);
  await validateActiveMembership(context, input.newOwnerMembershipId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.actionItem.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: action.id } },
      data: { ownerMembershipId: input.newOwnerMembershipId },
    });
    await tx.actionStatusHistory.create({
      data: {
        organisationId: txCtx.organisationId,
        actionItemId: action.id,
        eventType: "REASSIGNED",
        previousOwnerMembershipId: action.ownerMembershipId,
        newOwnerMembershipId: input.newOwnerMembershipId,
        note: input.note?.trim() || null,
        actorUserId: input.actorUserId,
      },
    });
    // The previous owner's overdue reminders no longer apply to them.
    await suppressNotificationsForResource(tx, txCtx, "action", action.id);
    await recordAuditEvent(tx, txCtx, {
      eventType: "action_item.reassigned",
      resourceType: "action_item",
      resourceId: action.id,
      summary: "Action reassigned to a new owner.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { ownerMembershipId: action.ownerMembershipId },
      after: { ownerMembershipId: input.newOwnerMembershipId },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Status transitions (OPEN <-> IN_PROGRESS <-> BLOCKED) — gated by
// dependencies, and refuses to touch a closed action.
// ---------------------------------------------------------------------------

const OPEN_STATUS_TRANSITIONS: Record<string, ActionItemStatus[]> = {
  OPEN: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["BLOCKED", "CANCELLED"],
  BLOCKED: ["IN_PROGRESS", "CANCELLED"],
  REOPENED: ["IN_PROGRESS", "BLOCKED", "CANCELLED"],
};

async function assertDependenciesSatisfied(tx: Tx, ctx: TenantRepositoryContext, actionItemId: string) {
  const dependencies = await tx.actionDependency.findMany({
    where: tenantWhere(ctx, { actionItemId }),
    include: { dependsOnActionItem: { select: { status: true, title: true } } },
  });
  const unmet = dependencies.filter((d) => !["COMPLETED", "VERIFIED"].includes(d.dependsOnActionItem.status));
  if (unmet.length > 0) {
    throw new ActionError(`Cannot proceed while dependency "${unmet[0].dependsOnActionItem.title}" is not complete.`);
  }
}

export async function setActionItemStatus(
  context: OrganisationContext,
  actionItemId: string,
  status: ActionItemStatus,
  actorUserId: string,
  note?: string | null,
) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const action = await findTenantActionItem(ctx, actionItemId);
  if (!action) throw new TenantOwnershipError();
  if (isClosed(action.status)) throw new ActionError(`Action is ${action.status} and cannot change status directly; reopen it first.`);
  const allowed = OPEN_STATUS_TRANSITIONS[action.status] ?? [];
  if (!allowed.includes(status)) {
    throw new ActionError(`Action cannot move from ${action.status} to ${status}.`);
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    if (status === "IN_PROGRESS") {
      await assertDependenciesSatisfied(tx, txCtx, action.id);
    }
    const updated = await tx.actionItem.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: action.id } },
      data: { status },
    });
    await tx.actionStatusHistory.create({
      data: {
        organisationId: txCtx.organisationId,
        actionItemId: action.id,
        eventType: "STATUS_CHANGE",
        fromStatus: action.status,
        toStatus: status,
        note: note?.trim() || null,
        actorUserId,
      },
    });
    if (status === "CANCELLED") {
      await suppressNotificationsForResource(tx, txCtx, "action", action.id);
    }
    await recordAuditEvent(tx, txCtx, {
      eventType: "action_item.status_changed",
      resourceType: "action_item",
      resourceId: action.id,
      summary: `Action status changed to ${status}.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: action.status },
      after: { status },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Progress updates — append-only, allowed on any non-closed action.
// ---------------------------------------------------------------------------

export interface RecordActionProgressInput {
  progressPercent?: number | null;
  note: string;
  actorUserId: string;
}

export async function recordActionProgress(context: OrganisationContext, actionItemId: string, input: RecordActionProgressInput) {
  requirePermission(context, MANAGE_PERMISSION);
  if (!input.note.trim()) throw new ActionError("Enter a progress note.");
  const ctx = toTenantRepositoryContext(context);
  const action = await findTenantActionItem(ctx, actionItemId);
  if (!action) throw new TenantOwnershipError();
  if (isClosed(action.status)) throw new ActionError(`Action is ${action.status} and cannot take progress updates; reopen it first.`);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const update = await tx.actionProgressUpdate.create({
      data: {
        organisationId: txCtx.organisationId,
        actionItemId: action.id,
        progressPercent: input.progressPercent ?? null,
        note: input.note.trim(),
        recordedByUserId: input.actorUserId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "action_item.progress_recorded",
      resourceType: "action_item",
      resourceId: action.id,
      summary: "Action progress recorded.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { progressPercent: input.progressPercent ?? null },
    });
    return update;
  });
}

// ---------------------------------------------------------------------------
// Completion — sets COMPLETED, never touches the linked objective (spec §1).
// ---------------------------------------------------------------------------

export interface CompleteActionItemInput {
  completionEvidenceNote: string;
  actorUserId: string;
}

export async function completeActionItem(context: OrganisationContext, actionItemId: string, input: CompleteActionItemInput) {
  requirePermission(context, MANAGE_PERMISSION);
  if (!input.completionEvidenceNote.trim()) throw new ActionError("Describe the completion evidence.");
  const ctx = toTenantRepositoryContext(context);
  const action = await findTenantActionItem(ctx, actionItemId);
  if (!action) throw new TenantOwnershipError();
  if (isClosed(action.status)) throw new ActionError(`Action is already ${action.status}.`);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await assertDependenciesSatisfied(tx, txCtx, action.id);
    const now = new Date();
    const updated = await tx.actionItem.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: action.id } },
      data: {
        status: "COMPLETED",
        completedAt: now,
        completedByUserId: input.actorUserId,
        completionEvidenceNote: input.completionEvidenceNote.trim(),
      },
    });
    await tx.actionStatusHistory.create({
      data: {
        organisationId: txCtx.organisationId,
        actionItemId: action.id,
        eventType: "STATUS_CHANGE",
        fromStatus: action.status,
        toStatus: "COMPLETED",
        actorUserId: input.actorUserId,
      },
    });
    await suppressNotificationsForResource(tx, txCtx, "action", action.id);
    await recordAuditEvent(tx, txCtx, {
      eventType: "action_item.completed",
      resourceType: "action_item",
      resourceId: action.id,
      summary: "Action completed. This does not mark any linked objective achieved.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: action.status },
      after: { status: "COMPLETED" },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Verification — separate from completion (spec §5); denies the completor
// from also verifying whenever four-eyes is enabled.
// ---------------------------------------------------------------------------

export interface VerifyActionItemInput {
  actorUserId: string;
  fourEyesEnabled?: boolean;
}

export async function verifyActionItem(context: OrganisationContext, actionItemId: string, input: VerifyActionItemInput) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const action = await findTenantActionItem(ctx, actionItemId);
  if (!action) throw new TenantOwnershipError();
  if (action.status !== "COMPLETED") throw new ActionError("Only a completed action can be verified.");
  assertFourEyes({
    enabled: input.fourEyesEnabled ?? true,
    actorUserId: input.actorUserId,
    authorUserId: action.completedByUserId ?? "",
  });

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const now = new Date();
    const updated = await tx.actionItem.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: action.id } },
      data: { status: "VERIFIED", verifiedAt: now, verifiedByUserId: input.actorUserId },
    });
    await tx.actionStatusHistory.create({
      data: {
        organisationId: txCtx.organisationId,
        actionItemId: action.id,
        eventType: "STATUS_CHANGE",
        fromStatus: "COMPLETED",
        toStatus: "VERIFIED",
        actorUserId: input.actorUserId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "action_item.verified",
      resourceType: "action_item",
      resourceId: action.id,
      summary: "Action verified.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "COMPLETED" },
      after: { status: "VERIFIED" },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Reopen — the only mutation a closed action accepts (database-trigger
// enforced defence-in-depth in the T52 migration).
// ---------------------------------------------------------------------------

export interface ReopenActionItemInput {
  reopenReason: string;
  actorUserId: string;
}

export async function reopenActionItem(context: OrganisationContext, actionItemId: string, input: ReopenActionItemInput) {
  requirePermission(context, MANAGE_PERMISSION);
  if (!input.reopenReason.trim()) throw new ActionError("Enter a reason for reopening.");
  const ctx = toTenantRepositoryContext(context);
  const action = await findTenantActionItem(ctx, actionItemId);
  if (!action) throw new TenantOwnershipError();
  if (!isClosed(action.status)) throw new ActionError("Only a closed action (completed, verified or cancelled) can be reopened.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const now = new Date();
    const updated = await tx.actionItem.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: action.id } },
      data: { status: "REOPENED", reopenedAt: now, reopenedByUserId: input.actorUserId, reopenReason: input.reopenReason.trim() },
    });
    await tx.actionStatusHistory.create({
      data: {
        organisationId: txCtx.organisationId,
        actionItemId: action.id,
        eventType: "REOPENED",
        fromStatus: action.status,
        toStatus: "REOPENED",
        note: input.reopenReason.trim(),
        actorUserId: input.actorUserId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "action_item.reopened",
      resourceType: "action_item",
      resourceId: action.id,
      summary: "Action reopened.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: action.status },
      after: { status: "REOPENED" },
    });
    return updated;
  });
}

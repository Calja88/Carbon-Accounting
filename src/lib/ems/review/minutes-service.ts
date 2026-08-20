/**
 * Management review hold/decisions/approved minutes/action links (task T73,
 * Docs/PHASE7_COMPETENCE_MANAGEMENT_REVIEW_SPEC.md §§1,4,6, PR sequence
 * P7-08). Depends on `pack-service.ts` (T73) for the issued pack and
 * `review-service.ts` (T72), both already on this branch.
 *
 * Fixed decisions this module enforces (spec §1/§4/§6):
 *  - `holdManagementReview` is the only way PACK_ISSUED -> HELD moves, and
 *    only once the review's pack has actually been issued — a review can
 *    never be marked held while still collecting inputs;
 *  - `recordManagementReviewDecision` always takes caller-supplied
 *    `decisionType`/`text`/`rationale`; it never reads pack payload, AI
 *    narrative content, metric values, findings or actions to populate a
 *    decision field (spec §1 "do not infer decisions automatically ...").
 *    There is no update/delete function for `ManagementReviewDecision` — a
 *    recorded decision can never be edited, only ever a plain read model
 *    (schema file-header note). Allowed while the review is HELD,
 *    MINUTES_DRAFT or APPROVED (the last so a correction addendum can
 *    record new decisions after the primary minutes were approved), never
 *    before HELD or once CLOSED;
 *  - `draftManagementReviewMinutes` creates the review's first
 *    `ManagementReviewMinuteRevision` (`revisionNumber: 1`,
 *    `status: DRAFT`) only from HELD, moving the review HELD ->
 *    MINUTES_DRAFT. `content` is a compiled snapshot of the review's
 *    current decisions/attendees/pack reference (and the reviewed AI
 *    narrative id, if one was marked REVIEWED) — never a live FK, the same
 *    frozen-JSON-payload convention `AuditReportRevision.frozenPayload`
 *    uses, so a later change to a decision row (there is none) or narrative
 *    status can never rewrite an already-approved revision's content;
 *  - `approveManagementReviewMinutes` requires
 *    `ems.management_review.approve` (default Sustainability Lead only,
 *    catalogue-configured, not hard-coded), recomputes `content`/
 *    `checksumSha256` one final time, freezes the revision (`status:
 *    APPROVED`), and — only for the primary (`revisionNumber: 1`,
 *    `supersedesRevisionId: null`) revision — moves the review
 *    MINUTES_DRAFT -> APPROVED. After APPROVED, no field on that revision
 *    is ever written again;
 *  - `createManagementReviewMinutesAddendum` is the only way to correct
 *    already-approved minutes (spec §1 "corrections require a
 *    successor/addendum"): only once the review is APPROVED, only against
 *    the current latest APPROVED revision with no existing successor,
 *    creates a new `DRAFT` revision with `supersedesRevisionId` set, which
 *    must then go through `approveManagementReviewMinutes` itself — an
 *    addendum is never auto-approved;
 *  - `linkManagementReviewAction`/`unlinkManagementReviewAction` only ever
 *    create/remove a `ManagementReviewActionLink` row; neither ever reads
 *    or writes any field on the linked `ActionItem` itself (the exact
 *    `CorrectiveAction.sharedActionItemId`, T64, link-only convention), so
 *    a review can never silently mark its own resulting action complete or
 *    achieved (spec §1 acceptance);
 *  - `closeManagementReview` is a plain APPROVED -> CLOSED transition with
 *    no other side effect — closing a review never touches a linked
 *    `ActionItem`'s status.
 */

import { createHash } from "node:crypto";
import type { ManagementReviewDecisionType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import {
  findTenantManagementReview,
  findTenantManagementReviewDecision,
  findTenantManagementReviewMinuteRevision,
  findTenantManagementReviewAiNarrative,
  findTenantActionItem,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { canonicalStringify } from "@/lib/audit/integrity";

export { TenantOwnershipError };

export class ManagementReviewMinutesError extends Error {}

const MANAGE_PERMISSION = "ems.management_review.manage" as const;
const APPROVE_PERMISSION = "ems.management_review.approve" as const;
const VIEW_PERMISSION = "ems.view" as const;

const DECISION_ALLOWED_STATUSES = new Set(["HELD", "MINUTES_DRAFT", "APPROVED"]);

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function computeChecksum(payload: unknown): string {
  return createHash("sha256").update(canonicalStringify(payload)).digest("hex");
}

async function validateActiveMembership(context: OrganisationContext, membershipId: string) {
  const membership = await prisma.organisationMembership.findFirst({
    where: { id: membershipId, organisationId: context.organisationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!membership) throw new TenantOwnershipError();
  return membership;
}

// ---------------------------------------------------------------------------
// Hold
// ---------------------------------------------------------------------------

export async function holdManagementReview(context: OrganisationContext, reviewId: string, heldDate: Date, actorUserId: string) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const review = await findTenantManagementReview(ctx, reviewId);
  if (!review) throw new TenantOwnershipError();
  if (review.status !== "PACK_ISSUED") {
    throw new ManagementReviewMinutesError("A review can only be held once its pack has been issued.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.managementReview.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: review.id } },
      data: { status: "HELD", heldDate },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review.held",
      resourceType: "management_review",
      resourceId: review.id,
      summary: "Management review held.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "PACK_ISSUED" },
      after: { status: "HELD", heldDate: heldDate.toISOString() },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Decisions (never inferred — always explicit caller input)
// ---------------------------------------------------------------------------

export interface RecordManagementReviewDecisionInput {
  inputDefinitionKey?: string | null;
  decisionType: ManagementReviewDecisionType;
  text: string;
  rationale?: string | null;
  ownerMembershipId?: string | null;
  targetDate?: Date | null;
  actorUserId: string;
}

export async function recordManagementReviewDecision(
  context: OrganisationContext,
  reviewId: string,
  input: RecordManagementReviewDecisionInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  if (!input.text.trim()) throw new ManagementReviewMinutesError("Enter the decision text.");
  const ctx = toTenantRepositoryContext(context);
  const review = await findTenantManagementReview(ctx, reviewId);
  if (!review) throw new TenantOwnershipError();
  if (!DECISION_ALLOWED_STATUSES.has(review.status)) {
    throw new ManagementReviewMinutesError("Decisions can only be recorded once the review has been held, and not after it is closed.");
  }
  if (input.ownerMembershipId) await validateActiveMembership(context, input.ownerMembershipId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const decision = await tx.managementReviewDecision.create({
      data: {
        organisationId: txCtx.organisationId,
        reviewId: review.id,
        inputDefinitionKey: input.inputDefinitionKey || null,
        decisionType: input.decisionType,
        text: input.text.trim(),
        rationale: input.rationale?.trim() || null,
        ownerMembershipId: input.ownerMembershipId || null,
        targetDate: input.targetDate ?? null,
        recordedByMembershipId: context.membershipId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_decision.recorded",
      resourceType: "management_review_decision",
      resourceId: decision.id,
      summary: `Management review decision recorded: ${input.decisionType}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { reviewId: review.id, decisionType: input.decisionType },
    });
    return decision;
  });
}

export async function listManagementReviewDecisions(context: OrganisationContext, reviewId: string) {
  requirePermission(context, VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const review = await findTenantManagementReview(ctx, reviewId);
  if (!review) throw new TenantOwnershipError();
  return prisma.managementReviewDecision.findMany({
    where: tenantWhere(ctx, { reviewId: review.id }),
    orderBy: { recordedAt: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Minutes content compilation (frozen JSON snapshot, never a live FK)
// ---------------------------------------------------------------------------

async function compileMinutesContent(
  ctx: TenantRepositoryContext,
  reviewId: string,
  narrativeId: string | null,
) {
  const decisions = await prisma.managementReviewDecision.findMany({
    where: tenantWhere(ctx, { reviewId }),
    orderBy: { recordedAt: "asc" },
  });
  const attendees = await prisma.managementReviewAttendee.findMany({
    where: tenantWhere(ctx, { reviewId }),
    orderBy: { personId: "asc" },
  });

  return {
    reviewId,
    narrativeId: narrativeId ?? null,
    attendees: attendees.map((attendee) => ({
      personId: attendee.personId,
      role: attendee.role,
      attended: attendee.attended ?? null,
    })),
    decisions: decisions.map((decision) => ({
      id: decision.id,
      decisionType: decision.decisionType,
      text: decision.text,
      rationale: decision.rationale,
      ownerMembershipId: decision.ownerMembershipId,
      targetDate: decision.targetDate ? decision.targetDate.toISOString() : null,
      recordedAt: decision.recordedAt.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Minutes draft -> approve
// ---------------------------------------------------------------------------

export interface DraftManagementReviewMinutesInput {
  narrativeId?: string | null;
  actorUserId: string;
}

export async function draftManagementReviewMinutes(
  context: OrganisationContext,
  reviewId: string,
  input: DraftManagementReviewMinutesInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const review = await findTenantManagementReview(ctx, reviewId);
  if (!review) throw new TenantOwnershipError();
  if (review.status !== "HELD") {
    throw new ManagementReviewMinutesError("Minutes can only be drafted once the review has been held.");
  }

  let narrativeId: string | null = null;
  if (input.narrativeId) {
    const narrative = await findTenantManagementReviewAiNarrative(ctx, input.narrativeId);
    if (!narrative) throw new TenantOwnershipError();
    if (narrative.status !== "REVIEWED") {
      throw new ManagementReviewMinutesError("Only a reviewed AI narrative may be referenced from minutes.");
    }
    narrativeId = narrative.id;
  }

  const content = await compileMinutesContent(ctx, review.id, narrativeId);
  const checksumSha256 = computeChecksum(content);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const revision = await tx.managementReviewMinuteRevision.create({
      data: {
        organisationId: txCtx.organisationId,
        reviewId: review.id,
        revisionNumber: 1,
        status: "DRAFT",
        supersedesRevisionId: null,
        content: toJsonInput(content),
        checksumSha256,
        narrativeId,
        preparedByMembershipId: context.membershipId,
      },
    });
    await tx.managementReview.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: review.id } },
      data: { status: "MINUTES_DRAFT" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_minutes.drafted",
      resourceType: "management_review_minute_revision",
      resourceId: revision.id,
      summary: "Management review minutes drafted.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "HELD" },
      after: { status: "MINUTES_DRAFT", revisionNumber: 1 },
    });
    return revision;
  });
}

export async function approveManagementReviewMinutes(context: OrganisationContext, revisionId: string, actorUserId: string) {
  requirePermission(context, APPROVE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const revision = await findTenantManagementReviewMinuteRevision(ctx, revisionId);
  if (!revision) throw new TenantOwnershipError();
  if (revision.status !== "DRAFT") throw new ManagementReviewMinutesError("This minute revision has already been approved.");

  const review = await findTenantManagementReview(ctx, revision.reviewId);
  if (!review) throw new TenantOwnershipError();
  const isPrimary = revision.supersedesRevisionId === null;
  if (isPrimary && review.status !== "MINUTES_DRAFT") {
    throw new ManagementReviewMinutesError("The primary minute revision can only be approved while the review is in minutes-draft.");
  }
  if (!isPrimary && review.status !== "APPROVED") {
    throw new ManagementReviewMinutesError("An addendum minute revision can only be approved once the review is already approved.");
  }

  const content = await compileMinutesContentFromFrozen(revision.content, ctx, review.id);
  const checksumSha256 = computeChecksum(content);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const approved = await tx.managementReviewMinuteRevision.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: revision.id } },
      data: {
        content: toJsonInput(content),
        checksumSha256,
        status: "APPROVED",
        approvedByMembershipId: context.membershipId,
        approvedAt: new Date(),
      },
    });

    if (isPrimary) {
      await tx.managementReview.update({
        where: { organisationId_id: { organisationId: txCtx.organisationId, id: review.id } },
        data: { status: "APPROVED" },
      });
    }

    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_minutes.approved",
      resourceType: "management_review_minute_revision",
      resourceId: approved.id,
      summary: `Management review minutes approved (revision ${approved.revisionNumber}).`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "DRAFT" },
      after: { status: "APPROVED", checksumSha256 },
    });

    return approved;
  });
}

/** Recompiles content for approval, reusing the draft's own narrative reference so approval never silently drops it. */
async function compileMinutesContentFromFrozen(
  draftContent: Prisma.JsonValue,
  ctx: TenantRepositoryContext,
  reviewId: string,
) {
  const narrativeId = (draftContent as { narrativeId?: string | null } | null)?.narrativeId ?? null;
  return compileMinutesContent(ctx, reviewId, narrativeId);
}

export interface CreateManagementReviewMinutesAddendumInput {
  reason: string;
  narrativeId?: string | null;
  actorUserId: string;
}

export async function createManagementReviewMinutesAddendum(
  context: OrganisationContext,
  reviewId: string,
  input: CreateManagementReviewMinutesAddendumInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  if (!input.reason.trim()) throw new ManagementReviewMinutesError("Enter a reason for this addendum.");
  const ctx = toTenantRepositoryContext(context);
  const review = await findTenantManagementReview(ctx, reviewId);
  if (!review) throw new TenantOwnershipError();
  if (review.status !== "APPROVED" && review.status !== "CLOSED") {
    throw new ManagementReviewMinutesError("An addendum can only be created once the review's minutes are approved.");
  }

  const latestApproved = await prisma.managementReviewMinuteRevision.findFirst({
    where: tenantWhere(ctx, { reviewId: review.id, status: "APPROVED" as const }),
    orderBy: { revisionNumber: "desc" },
  });
  if (!latestApproved) throw new ManagementReviewMinutesError("No approved minute revision exists to correct.");
  const hasSuccessor = await prisma.managementReviewMinuteRevision.findFirst({
    where: tenantWhere(ctx, { supersedesRevisionId: latestApproved.id }),
  });
  if (hasSuccessor) throw new ManagementReviewMinutesError("A correction addendum already exists for the latest approved minutes.");

  let narrativeId: string | null = null;
  if (input.narrativeId) {
    const narrative = await findTenantManagementReviewAiNarrative(ctx, input.narrativeId);
    if (!narrative) throw new TenantOwnershipError();
    if (narrative.status !== "REVIEWED") {
      throw new ManagementReviewMinutesError("Only a reviewed AI narrative may be referenced from minutes.");
    }
    narrativeId = narrative.id;
  }

  const content = await compileMinutesContent(ctx, review.id, narrativeId);
  const checksumSha256 = computeChecksum(content);
  const nextRevisionNumber = latestApproved.revisionNumber + 1;

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const revision = await tx.managementReviewMinuteRevision.create({
      data: {
        organisationId: txCtx.organisationId,
        reviewId: review.id,
        revisionNumber: nextRevisionNumber,
        status: "DRAFT",
        content: toJsonInput(content),
        checksumSha256,
        narrativeId,
        preparedByMembershipId: context.membershipId,
        supersedesRevisionId: latestApproved.id,
        addendumReason: input.reason.trim(),
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_minutes.addendum_drafted",
      resourceType: "management_review_minute_revision",
      resourceId: revision.id,
      summary: `Management review minutes addendum drafted (revision ${nextRevisionNumber}).`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { reviewId: review.id, supersedesRevisionId: latestApproved.id },
    });
    return revision;
  });
}

export async function listManagementReviewMinuteRevisions(context: OrganisationContext, reviewId: string) {
  requirePermission(context, VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const review = await findTenantManagementReview(ctx, reviewId);
  if (!review) throw new TenantOwnershipError();
  return prisma.managementReviewMinuteRevision.findMany({
    where: tenantWhere(ctx, { reviewId: review.id }),
    orderBy: { revisionNumber: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Close
// ---------------------------------------------------------------------------

export async function closeManagementReview(context: OrganisationContext, reviewId: string, actorUserId: string) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const review = await findTenantManagementReview(ctx, reviewId);
  if (!review) throw new TenantOwnershipError();
  if (review.status !== "APPROVED") {
    throw new ManagementReviewMinutesError("Only an approved review can be closed.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.managementReview.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: review.id } },
      data: { status: "CLOSED" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review.closed",
      resourceType: "management_review",
      resourceId: review.id,
      summary: "Management review closed.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "APPROVED" },
      after: { status: "CLOSED" },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Decision -> ActionItem links (spec §4 "decision to shared ActionItem") —
// link-only, never writes to the linked ActionItem (see file-header note).
// ---------------------------------------------------------------------------

export interface LinkManagementReviewActionInput {
  actionItemId: string;
  actorUserId: string;
}

export async function linkManagementReviewAction(
  context: OrganisationContext,
  decisionId: string,
  input: LinkManagementReviewActionInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const decision = await findTenantManagementReviewDecision(ctx, decisionId);
  if (!decision) throw new TenantOwnershipError();
  const actionItem = await findTenantActionItem(ctx, input.actionItemId);
  if (!actionItem) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const existing = await tx.managementReviewActionLink.findFirst({
      where: tenantWhere(txCtx, { decisionId: decision.id, actionItemId: actionItem.id }),
    });
    if (existing) throw new ManagementReviewMinutesError("This action is already linked to this decision.");

    const link = await tx.managementReviewActionLink.create({
      data: {
        organisationId: txCtx.organisationId,
        decisionId: decision.id,
        actionItemId: actionItem.id,
        linkedByMembershipId: context.membershipId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_action_link.linked",
      resourceType: "management_review_action_link",
      resourceId: link.id,
      summary: "Action linked to management review decision.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { decisionId: decision.id, actionItemId: actionItem.id },
    });
    return link;
  });
}

export async function unlinkManagementReviewAction(context: OrganisationContext, linkId: string, actorUserId: string) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const link = await prisma.managementReviewActionLink.findFirst({ where: tenantWhere(ctx, { id: linkId }) });
  if (!link) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.managementReviewActionLink.delete({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: link.id } },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_action_link.unlinked",
      resourceType: "management_review_action_link",
      resourceId: link.id,
      summary: "Action unlinked from management review decision.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { decisionId: link.decisionId, actionItemId: link.actionItemId },
    });
  });
}

export async function listManagementReviewActionLinks(context: OrganisationContext, decisionId: string) {
  requirePermission(context, VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const decision = await findTenantManagementReviewDecision(ctx, decisionId);
  if (!decision) throw new TenantOwnershipError();
  return prisma.managementReviewActionLink.findMany({
    where: tenantWhere(ctx, { decisionId: decision.id }),
    orderBy: { linkedAt: "asc" },
  });
}

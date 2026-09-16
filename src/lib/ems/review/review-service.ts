/**
 * Management review scheduling, attendees and exact-version input linking
 * (task T72, Docs/PHASE7_COMPETENCE_MANAGEMENT_REVIEW_SPEC.md §4, PR
 * sequence P7-05/P7-06). Depends on `agenda-service.ts` (T72),
 * `person-service.ts` (T70) and the T45/T52/T61/T64/T71 modules read
 * through `input-adapters/*.ts`, all already on this branch.
 *
 * Fixed decisions this module enforces (spec §1):
 *  - a review pins one exact `ManagementReviewAgendaTemplateVersion` at
 *    schedule time (`agendaTemplateVersionId`), never the template's
 *    mutable `activeVersionId` pointer — a later template revision never
 *    rewrites an already-scheduled review's agenda (agenda-service.ts file
 *    header). Only an APPROVED or ACTIVE version may be pinned — a DRAFT
 *    version's item list can still change in place, so scheduling against
 *    one would silently move under the review;
 *  - `status` only ever reaches PLANNED/INPUT_COLLECTION here —
 *    PACK_ISSUED onward is T73's `pack-service.ts`/`minutes-service.ts`
 *    (schema file-header note);
 *  - `linkManagementReviewInput` only ever links a candidate an
 *    `input-adapters/*.ts` module actually resolved for that input key's
 *    `sourceType` as of the review's own `cutoffDate` — a coordinator can
 *    never hand-type an arbitrary foreign-tenant or unissued record id
 *    into a link (spec §1 "input links point to exact report/record
 *    versions");
 *  - `listOpenPriorActions` is a derived read model over T52 `ActionItem`,
 *    never a persisted table — the same "derived, not stored" convention
 *    T70's `gap-service.ts` uses for `CompetenceGap` (spec §1 "open prior
 *    actions are included"), so it can never itself go stale;
 *  - this module makes no compliance/effectiveness/certification
 *    conclusion of its own — it only surfaces what the source modules
 *    already recorded (AI-boundary rule applies equally to human
 *    coordinators using this service).
 */

import type { ActionItemStatus, ManagementReviewInputSourceType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import {
  findTenantManagementReview,
  findTenantManagementReviewAgendaTemplateVersion,
  findTenantManagementReviewInputDefinition,
  findTenantPersonProfile,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { getReviewInputAdapter } from "./input-adapters";

export { TenantOwnershipError };

export class ManagementReviewError extends Error {}

const MANAGE_PERMISSION = "ems.management_review.manage" as const;
const VIEW_PERMISSION = "ems.view" as const;

const OPEN_ACTION_STATUSES: readonly ActionItemStatus[] = ["OPEN", "IN_PROGRESS", "BLOCKED", "REOPENED"];

function toJsonInput(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function lockEditableReview(tx: Prisma.TransactionClient, ctx: ReturnType<typeof toTenantRepositoryContext>, reviewId: string) {
  await tx.$queryRaw`SELECT "id" FROM "ManagementReview" WHERE "id" = ${reviewId} AND "organisationId" = ${ctx.organisationId} FOR UPDATE`;
  const review = await tx.managementReview.findFirst({ where: tenantWhere(ctx, { id: reviewId }) });
  if (!review) throw new TenantOwnershipError();
  if (review.status !== "PLANNED" && review.status !== "INPUT_COLLECTION") throw new ManagementReviewError("Issued review inputs cannot be changed.");
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
// Reads
// ---------------------------------------------------------------------------

const reviewInclude = {
  attendees: { include: { person: { select: { id: true, displayName: true } } } },
  inputLinks: { orderBy: { linkedAt: "desc" } },
  agendaTemplateVersion: { include: { items: { orderBy: { order: "asc" } }, template: true } },
} as const;

export async function listManagementReviews(context: OrganisationContext) {
  requirePermission(context, VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  return prisma.managementReview.findMany({
    where: tenantWhere(ctx, {}),
    orderBy: { scheduledDate: "desc" },
  });
}

export async function getManagementReview(context: OrganisationContext, reviewId: string) {
  requirePermission(context, VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const review = await findTenantManagementReview(ctx, reviewId);
  if (!review) throw new TenantOwnershipError();
  return prisma.managementReview.findUnique({ where: { id: review.id }, include: reviewInclude });
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export interface ScheduleManagementReviewInput {
  reference: string;
  periodStart: Date;
  periodEnd: Date;
  cutoffDate: Date;
  scheduledDate: Date;
  chairMembershipId: string;
  coordinatorMembershipId: string;
  agendaTemplateVersionId: string;
  actorUserId: string;
}

export async function scheduleManagementReview(context: OrganisationContext, input: ScheduleManagementReviewInput) {
  requirePermission(context, MANAGE_PERMISSION);
  if (!input.reference.trim()) throw new ManagementReviewError("Enter a reference.");
  if (input.periodEnd < input.periodStart) throw new ManagementReviewError("Period end must not be before period start.");
  if (input.cutoffDate < input.periodStart) throw new ManagementReviewError("Cutoff date must fall within or after the review period.");

  await validateActiveMembership(context, input.chairMembershipId);
  await validateActiveMembership(context, input.coordinatorMembershipId);

  const ctx = toTenantRepositoryContext(context);
  const templateVersion = await findTenantManagementReviewAgendaTemplateVersion(ctx, input.agendaTemplateVersionId);
  if (!templateVersion) throw new TenantOwnershipError();
  if (templateVersion.status !== "APPROVED" && templateVersion.status !== "ACTIVE") {
    throw new ManagementReviewError("Only an approved or active agenda template version may be scheduled against.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const review = await tx.managementReview.create({
      data: {
        organisationId: txCtx.organisationId,
        reference: input.reference.trim(),
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        cutoffDate: input.cutoffDate,
        scheduledDate: input.scheduledDate,
        chairMembershipId: input.chairMembershipId,
        coordinatorMembershipId: input.coordinatorMembershipId,
        agendaTemplateId: templateVersion.templateId,
        agendaTemplateVersionId: templateVersion.id,
        createdByUserId: input.actorUserId,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review.scheduled",
      resourceType: "management_review",
      resourceId: review.id,
      summary: `Management review scheduled: ${input.reference}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { reference: input.reference, scheduledDate: input.scheduledDate.toISOString() },
    });

    return review;
  });
}

export interface RescheduleManagementReviewInput {
  scheduledDate: Date;
  actorUserId: string;
}

export async function rescheduleManagementReview(
  context: OrganisationContext,
  reviewId: string,
  input: RescheduleManagementReviewInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const review = await findTenantManagementReview(ctx, reviewId);
  if (!review) throw new TenantOwnershipError();
  if (review.status !== "PLANNED" && review.status !== "INPUT_COLLECTION") {
    throw new ManagementReviewError("Only a planned or input-collection review can be rescheduled.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.managementReview.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: review.id } },
      data: { scheduledDate: input.scheduledDate },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review.rescheduled",
      resourceType: "management_review",
      resourceId: review.id,
      summary: "Management review rescheduled.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { scheduledDate: review.scheduledDate.toISOString() },
      after: { scheduledDate: input.scheduledDate.toISOString() },
    });
    return updated;
  });
}

/** PLANNED -> INPUT_COLLECTION, opening the review to input linking. */
export async function startManagementReviewInputCollection(context: OrganisationContext, reviewId: string, actorUserId: string) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const review = await findTenantManagementReview(ctx, reviewId);
  if (!review) throw new TenantOwnershipError();
  if (review.status !== "PLANNED") throw new ManagementReviewError("Only a planned review can start input collection.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.managementReview.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: review.id } },
      data: { status: "INPUT_COLLECTION" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review.input_collection_started",
      resourceType: "management_review",
      resourceId: review.id,
      summary: "Management review moved to input collection.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "PLANNED" },
      after: { status: "INPUT_COLLECTION" },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Attendees
// ---------------------------------------------------------------------------

export interface AddManagementReviewAttendeeInput {
  personId: string;
  role?: "CHAIR" | "COORDINATOR" | "MEMBER" | "GUEST";
  notes?: string | null;
  actorUserId: string;
}

export async function addManagementReviewAttendee(
  context: OrganisationContext,
  reviewId: string,
  input: AddManagementReviewAttendeeInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const review = await findTenantManagementReview(ctx, reviewId);
  if (!review) throw new TenantOwnershipError();
  const person = await findTenantPersonProfile(ctx, input.personId);
  if (!person) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await lockEditableReview(tx, txCtx, review.id);
    const existing = await tx.managementReviewAttendee.findFirst({
      where: tenantWhere(txCtx, { reviewId: review.id, personId: person.id }),
    });
    if (existing) throw new ManagementReviewError("This person is already an attendee of this review.");

    const attendee = await tx.managementReviewAttendee.create({
      data: {
        organisationId: txCtx.organisationId,
        reviewId: review.id,
        personId: person.id,
        role: input.role ?? "MEMBER",
        notes: input.notes?.trim() || null,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_attendee.added",
      resourceType: "management_review_attendee",
      resourceId: attendee.id,
      summary: "Attendee added to management review.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { reviewId: review.id, personId: person.id, role: attendee.role },
    });

    return attendee;
  });
}

export async function removeManagementReviewAttendee(context: OrganisationContext, attendeeId: string, actorUserId: string) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const attendee = await prisma.managementReviewAttendee.findFirst({ where: tenantWhere(ctx, { id: attendeeId }) });
  if (!attendee) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await lockEditableReview(tx, txCtx, attendee.reviewId);
    await tx.managementReviewAttendee.delete({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: attendee.id } },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_attendee.removed",
      resourceType: "management_review_attendee",
      resourceId: attendee.id,
      summary: "Attendee removed from management review.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { reviewId: attendee.reviewId, personId: attendee.personId },
    });
  });
}

// ---------------------------------------------------------------------------
// Exact-version input linking (spec §5 adapter contract)
// ---------------------------------------------------------------------------

export interface LinkManagementReviewInputInput {
  inputDefinitionKey: string;
  /** When omitted, the newest candidate the adapter resolves is linked. */
  sourceRecordId?: string;
  actorUserId: string;
}

export async function linkManagementReviewInput(
  context: OrganisationContext,
  reviewId: string,
  input: LinkManagementReviewInputInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const review = await findTenantManagementReview(ctx, reviewId);
  if (!review) throw new TenantOwnershipError();
  if (review.status !== "PLANNED" && review.status !== "INPUT_COLLECTION") {
    throw new ManagementReviewError("Inputs can only be linked before the review is held.");
  }

  const definition = await prisma.managementReviewInputDefinition.findFirst({
    where: tenantWhere(ctx, { key: input.inputDefinitionKey, isActive: true }),
  });
  if (!definition) throw new ManagementReviewError("Unknown or inactive input definition key.");

  const adapter = getReviewInputAdapter(definition.sourceType);
  if (!adapter) throw new ManagementReviewError(`No input adapter is registered for source type ${definition.sourceType}.`);

  const candidates = await adapter.resolveCandidates(ctx, review.cutoffDate);
  const resolved = input.sourceRecordId
    ? candidates.find((candidate) => candidate.sourceRecordId === input.sourceRecordId)
    : candidates[0];
  if (!resolved) {
    throw new ManagementReviewError("No matching exact-version source record was found for this input.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await lockEditableReview(tx, txCtx, review.id);
    const link = await tx.managementReviewInputLink.upsert({
      where: {
        organisationId_reviewId_inputDefinitionKey_sourceRecordId: {
          organisationId: txCtx.organisationId,
          reviewId: review.id,
          inputDefinitionKey: definition.key,
          sourceRecordId: resolved.sourceRecordId,
        },
      },
      create: {
        organisationId: txCtx.organisationId,
        reviewId: review.id,
        inputDefinitionKey: definition.key,
        sourceType: resolved.sourceType,
        sourceRecordId: resolved.sourceRecordId,
        sourceVersionLabel: resolved.sourceVersionLabel,
        summary: toJsonInput(resolved.summary),
        isStale: resolved.isStale,
        linkedByMembershipId: context.membershipId,
      },
      update: {
        sourceVersionLabel: resolved.sourceVersionLabel,
        summary: toJsonInput(resolved.summary),
        isStale: resolved.isStale,
        linkedByMembershipId: context.membershipId,
        linkedAt: new Date(),
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_input_link.linked",
      resourceType: "management_review_input_link",
      resourceId: link.id,
      summary: `Input linked: ${definition.key} -> ${resolved.sourceType}:${resolved.sourceRecordId}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { inputDefinitionKey: definition.key, sourceRecordId: resolved.sourceRecordId, sourceVersionLabel: resolved.sourceVersionLabel },
    });

    return link;
  });
}

export async function removeManagementReviewInputLink(context: OrganisationContext, linkId: string, actorUserId: string) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const link = await prisma.managementReviewInputLink.findFirst({ where: tenantWhere(ctx, { id: linkId }) });
  if (!link) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await lockEditableReview(tx, txCtx, link.reviewId);
    await tx.managementReviewInputLink.delete({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: link.id } },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_input_link.removed",
      resourceType: "management_review_input_link",
      resourceId: link.id,
      summary: "Input link removed from management review.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { reviewId: link.reviewId, inputDefinitionKey: link.inputDefinitionKey, sourceRecordId: link.sourceRecordId },
    });
  });
}

// ---------------------------------------------------------------------------
// Open prior actions (spec §1 "open prior actions are included") — derived
// read model, never persisted (see file header).
// ---------------------------------------------------------------------------

export interface OpenPriorActionRow {
  actionItemId: string;
  programmeId: string;
  title: string;
  status: ActionItemStatus;
  dueDate: Date;
  ownerMembershipId: string;
}

export async function listOpenPriorActions(context: OrganisationContext, reviewId: string): Promise<OpenPriorActionRow[]> {
  requirePermission(context, VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const review = await findTenantManagementReview(ctx, reviewId);
  if (!review) throw new TenantOwnershipError();

  const rows = await prisma.actionItem.findMany({
    where: tenantWhere(ctx, { status: { in: [...OPEN_ACTION_STATUSES] } }),
    orderBy: { dueDate: "asc" },
    select: { id: true, programmeId: true, title: true, status: true, dueDate: true, ownerMembershipId: true },
  });

  return rows.map((row) => ({
    actionItemId: row.id,
    programmeId: row.programmeId,
    title: row.title,
    status: row.status,
    dueDate: row.dueDate,
    ownerMembershipId: row.ownerMembershipId,
  }));
}

// ---------------------------------------------------------------------------
// Input definitions (organisation-configurable catalogue, spec §4)
// ---------------------------------------------------------------------------

export interface UpsertManagementReviewInputDefinitionInput {
  key: string;
  label: string;
  sourceType: ManagementReviewInputSourceType;
  required?: boolean;
  periodRule?: string | null;
  actorUserId: string;
}

export async function upsertManagementReviewInputDefinition(
  context: OrganisationContext,
  input: UpsertManagementReviewInputDefinitionInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  if (!input.key.trim()) throw new ManagementReviewError("Enter an input key.");
  if (!input.label.trim()) throw new ManagementReviewError("Enter a label.");
  const ctx = toTenantRepositoryContext(context);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    return tx.managementReviewInputDefinition.upsert({
      where: { organisationId_key: { organisationId: txCtx.organisationId, key: input.key.trim() } },
      create: {
        organisationId: txCtx.organisationId,
        key: input.key.trim(),
        label: input.label.trim(),
        sourceType: input.sourceType,
        required: input.required ?? true,
        periodRule: input.periodRule?.trim() || null,
      },
      update: {
        label: input.label.trim(),
        sourceType: input.sourceType,
        required: input.required ?? true,
        periodRule: input.periodRule?.trim() || null,
      },
    });
  });
}

export async function listManagementReviewInputDefinitions(context: OrganisationContext) {
  requirePermission(context, VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  return prisma.managementReviewInputDefinition.findMany({
    where: tenantWhere(ctx, {}),
    orderBy: { key: "asc" },
  });
}

export async function deactivateManagementReviewInputDefinition(context: OrganisationContext, id: string) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const definition = await findTenantManagementReviewInputDefinition(ctx, id);
  if (!definition) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    return tx.managementReviewInputDefinition.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: definition.id } },
      data: { isActive: false },
    });
  });
}

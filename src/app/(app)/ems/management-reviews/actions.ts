"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  ManagementReviewError,
  scheduleManagementReview,
  rescheduleManagementReview,
  startManagementReviewInputCollection,
  addManagementReviewAttendee,
  removeManagementReviewAttendee,
  linkManagementReviewInput,
  removeManagementReviewInputLink,
  upsertManagementReviewInputDefinition,
  deactivateManagementReviewInputDefinition,
} from "@/lib/ems/review/review-service";
import {
  ManagementReviewAgendaError,
  createManagementReviewAgendaTemplate,
  updateManagementReviewAgendaTemplateVersionDraft,
  approveManagementReviewAgendaTemplateVersion,
  activateManagementReviewAgendaTemplateVersion,
  createSuccessorManagementReviewAgendaTemplateVersion,
} from "@/lib/ems/review/agenda-service";
import {
  ManagementReviewPackError,
  generateManagementReviewPack,
  issueManagementReviewPack,
  addManagementReviewAiNarrative,
  reviewManagementReviewAiNarrative,
} from "@/lib/ems/review/pack-service";
import {
  ManagementReviewMinutesError,
  holdManagementReview,
  recordManagementReviewDecision,
  draftManagementReviewMinutes,
  approveManagementReviewMinutes,
  createManagementReviewMinutesAddendum,
  closeManagementReview,
  linkManagementReviewAction,
  unlinkManagementReviewAction,
} from "@/lib/ems/review/minutes-service";
import {
  scheduleManagementReviewFormSchema,
  rescheduleManagementReviewFormSchema,
  addManagementReviewAttendeeFormSchema,
  linkManagementReviewInputFormSchema,
  upsertManagementReviewInputDefinitionFormSchema,
  agendaItemsJsonSchema,
  createAgendaTemplateFormSchema,
  updateAgendaTemplateVersionDraftFormSchema,
  createSuccessorAgendaTemplateVersionFormSchema,
  holdManagementReviewFormSchema,
  addManagementReviewAiNarrativeFormSchema,
  reviewManagementReviewAiNarrativeFormSchema,
  recordManagementReviewDecisionFormSchema,
  draftManagementReviewMinutesFormSchema,
  createManagementReviewMinutesAddendumFormSchema,
  linkManagementReviewActionFormSchema,
} from "@/lib/ems/review/review-schemas";

export interface ReviewActionState {
  error: string | null;
  message: string | null;
}

const emptyState: ReviewActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation or scope.";
  if (error instanceof ManagementReviewError) return error.message;
  if (error instanceof ManagementReviewAgendaError) return error.message;
  if (error instanceof ManagementReviewPackError) return error.message;
  if (error instanceof ManagementReviewMinutesError) return error.message;
  throw error;
}

function revalidateReviews(reviewId?: string) {
  revalidatePath("/ems/management-reviews");
  if (reviewId) revalidatePath(`/ems/management-reviews/${reviewId}`);
}

function parseItemsJson(itemsJson: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(itemsJson);
  } catch {
    throw new ManagementReviewAgendaError("Agenda items are not valid JSON.");
  }
  const result = agendaItemsJsonSchema.safeParse(parsed);
  if (!result.success) throw new ManagementReviewAgendaError(result.error.issues[0]?.message ?? "Check the agenda items.");
  return result.data.map((item) => ({
    order: item.order,
    title: item.title,
    description: item.description || null,
    inputDefinitionKey: item.inputDefinitionKey || null,
  }));
}

// ---------------------------------------------------------------------------
// Review scheduling
// ---------------------------------------------------------------------------

export async function scheduleManagementReviewAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = scheduleManagementReviewFormSchema.safeParse({
      reference: formData.get("reference"),
      periodStart: formData.get("periodStart"),
      periodEnd: formData.get("periodEnd"),
      cutoffDate: formData.get("cutoffDate"),
      scheduledDate: formData.get("scheduledDate"),
      chairMembershipId: formData.get("chairMembershipId"),
      coordinatorMembershipId: formData.get("coordinatorMembershipId"),
      agendaTemplateVersionId: formData.get("agendaTemplateVersionId"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the review details." };
    await scheduleManagementReview(context, { ...parsed.data, actorUserId: context.userId });
    revalidateReviews();
    return { ...emptyState, message: "Management review scheduled." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function rescheduleManagementReviewAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = rescheduleManagementReviewFormSchema.safeParse({
      reviewId: formData.get("reviewId"),
      scheduledDate: formData.get("scheduledDate"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the new date." };
    await rescheduleManagementReview(context, parsed.data.reviewId, {
      scheduledDate: parsed.data.scheduledDate,
      actorUserId: context.userId,
    });
    revalidateReviews();
    return { ...emptyState, message: "Management review rescheduled." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function startInputCollectionAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const reviewId = String(formData.get("reviewId") ?? "");
    if (!reviewId) return { ...emptyState, error: "Choose a review." };
    await startManagementReviewInputCollection(context, reviewId, context.userId);
    revalidateReviews();
    return { ...emptyState, message: "Review moved to input collection." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

// ---------------------------------------------------------------------------
// Attendees
// ---------------------------------------------------------------------------

export async function addManagementReviewAttendeeAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = addManagementReviewAttendeeFormSchema.safeParse({
      reviewId: formData.get("reviewId"),
      personId: formData.get("personId"),
      role: formData.get("role") || "MEMBER",
      notes: formData.get("notes"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the attendee details." };
    await addManagementReviewAttendee(context, parsed.data.reviewId, {
      personId: parsed.data.personId,
      role: parsed.data.role,
      notes: parsed.data.notes || null,
      actorUserId: context.userId,
    });
    revalidateReviews();
    return { ...emptyState, message: "Attendee added." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function removeManagementReviewAttendeeAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const attendeeId = String(formData.get("attendeeId") ?? "");
    if (!attendeeId) return { ...emptyState, error: "Choose an attendee." };
    await removeManagementReviewAttendee(context, attendeeId, context.userId);
    revalidateReviews();
    return { ...emptyState, message: "Attendee removed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

// ---------------------------------------------------------------------------
// Input links
// ---------------------------------------------------------------------------

export async function linkManagementReviewInputAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = linkManagementReviewInputFormSchema.safeParse({
      reviewId: formData.get("reviewId"),
      inputDefinitionKey: formData.get("inputDefinitionKey"),
      sourceRecordId: formData.get("sourceRecordId"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the input details." };
    await linkManagementReviewInput(context, parsed.data.reviewId, {
      inputDefinitionKey: parsed.data.inputDefinitionKey,
      sourceRecordId: parsed.data.sourceRecordId || undefined,
      actorUserId: context.userId,
    });
    revalidateReviews();
    return { ...emptyState, message: "Input linked." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function removeManagementReviewInputLinkAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const linkId = String(formData.get("linkId") ?? "");
    if (!linkId) return { ...emptyState, error: "Choose an input link." };
    await removeManagementReviewInputLink(context, linkId, context.userId);
    revalidateReviews();
    return { ...emptyState, message: "Input link removed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function upsertManagementReviewInputDefinitionAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = upsertManagementReviewInputDefinitionFormSchema.safeParse({
      key: formData.get("key"),
      label: formData.get("label"),
      sourceType: formData.get("sourceType"),
      required: formData.get("required") === "on" || formData.get("required") === "true",
      periodRule: formData.get("periodRule"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the input definition." };
    await upsertManagementReviewInputDefinition(context, {
      key: parsed.data.key,
      label: parsed.data.label,
      sourceType: parsed.data.sourceType,
      required: parsed.data.required,
      periodRule: parsed.data.periodRule || null,
      actorUserId: context.userId,
    });
    revalidateReviews();
    return { ...emptyState, message: "Input definition saved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function deactivateManagementReviewInputDefinitionAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const id = String(formData.get("id") ?? "");
    if (!id) return { ...emptyState, error: "Choose an input definition." };
    await deactivateManagementReviewInputDefinition(context, id);
    revalidateReviews();
    return { ...emptyState, message: "Input definition deactivated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

// ---------------------------------------------------------------------------
// Agenda templates
// ---------------------------------------------------------------------------

export async function createAgendaTemplateAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createAgendaTemplateFormSchema.safeParse({
      templateKey: formData.get("templateKey"),
      name: formData.get("name"),
      itemsJson: formData.get("itemsJson"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the template details." };
    const items = parseItemsJson(parsed.data.itemsJson);
    await createManagementReviewAgendaTemplate(context, {
      templateKey: parsed.data.templateKey,
      name: parsed.data.name,
      items,
      actorUserId: context.userId,
    });
    revalidateReviews();
    return { ...emptyState, message: "Agenda template drafted." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function updateAgendaTemplateVersionDraftAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = updateAgendaTemplateVersionDraftFormSchema.safeParse({
      versionId: formData.get("versionId"),
      name: formData.get("name"),
      itemsJson: formData.get("itemsJson"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the template details." };
    const items = parseItemsJson(parsed.data.itemsJson);
    await updateManagementReviewAgendaTemplateVersionDraft(context, parsed.data.versionId, {
      name: parsed.data.name,
      items,
      actorUserId: context.userId,
    });
    revalidateReviews();
    return { ...emptyState, message: "Draft agenda template version updated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function approveAgendaTemplateVersionAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const versionId = String(formData.get("versionId") ?? "");
    if (!versionId) return { ...emptyState, error: "Choose a version." };
    await approveManagementReviewAgendaTemplateVersion(context, versionId, context.userId);
    revalidateReviews();
    return { ...emptyState, message: "Agenda template version approved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function activateAgendaTemplateVersionAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const versionId = String(formData.get("versionId") ?? "");
    if (!versionId) return { ...emptyState, error: "Choose a version." };
    await activateManagementReviewAgendaTemplateVersion(context, versionId, context.userId);
    revalidateReviews();
    return { ...emptyState, message: "Agenda template version activated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createSuccessorAgendaTemplateVersionAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createSuccessorAgendaTemplateVersionFormSchema.safeParse({
      templateId: formData.get("templateId"),
      name: formData.get("name"),
      itemsJson: formData.get("itemsJson"),
      revisionRationale: formData.get("revisionRationale"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the successor version details." };
    const items = parseItemsJson(parsed.data.itemsJson);
    await createSuccessorManagementReviewAgendaTemplateVersion(context, parsed.data.templateId, {
      name: parsed.data.name,
      items,
      revisionRationale: parsed.data.revisionRationale,
      actorUserId: context.userId,
    });
    revalidateReviews();
    return { ...emptyState, message: "Successor agenda template version created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

// ---------------------------------------------------------------------------
// Review pack (T73/UI12)
// ---------------------------------------------------------------------------

export async function generateManagementReviewPackAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const reviewId = String(formData.get("reviewId") ?? "");
    if (!reviewId) return { ...emptyState, error: "Choose a review." };
    await generateManagementReviewPack(context, reviewId, context.userId);
    revalidateReviews(reviewId);
    return { ...emptyState, message: "Review pack generated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function issueManagementReviewPackAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const reviewId = String(formData.get("reviewId") ?? "");
    if (!reviewId) return { ...emptyState, error: "Choose a review." };
    await issueManagementReviewPack(context, reviewId, context.userId);
    revalidateReviews(reviewId);
    return { ...emptyState, message: "Review pack issued. It is now frozen and cannot be regenerated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

// ---------------------------------------------------------------------------
// AI narrative — labelled draft support only, never a decision/approval source
// ---------------------------------------------------------------------------

export async function addManagementReviewAiNarrativeAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = addManagementReviewAiNarrativeFormSchema.safeParse({
      packId: formData.get("packId"),
      content: formData.get("content"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the narrative content." };
    const reviewId = String(formData.get("reviewId") ?? "");
    await addManagementReviewAiNarrative(context, parsed.data.packId, { content: parsed.data.content, actorUserId: context.userId });
    revalidateReviews(reviewId || undefined);
    return { ...emptyState, message: "AI narrative attached, pending human review." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function reviewManagementReviewAiNarrativeAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = reviewManagementReviewAiNarrativeFormSchema.safeParse({
      narrativeId: formData.get("narrativeId"),
      decision: formData.get("decision"),
      rejectionReason: formData.get("rejectionReason"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the review decision." };
    const reviewId = String(formData.get("reviewId") ?? "");
    await reviewManagementReviewAiNarrative(context, parsed.data.narrativeId, {
      decision: parsed.data.decision,
      rejectionReason: parsed.data.rejectionReason || null,
      actorUserId: context.userId,
    });
    revalidateReviews(reviewId || undefined);
    return { ...emptyState, message: `AI narrative marked ${parsed.data.decision.toLowerCase()}.` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

// ---------------------------------------------------------------------------
// Hold, decisions, minutes, addenda, closure
// ---------------------------------------------------------------------------

export async function holdManagementReviewAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = holdManagementReviewFormSchema.safeParse({
      reviewId: formData.get("reviewId"),
      heldDate: formData.get("heldDate"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the held date." };
    await holdManagementReview(context, parsed.data.reviewId, parsed.data.heldDate, context.userId);
    revalidateReviews(parsed.data.reviewId);
    return { ...emptyState, message: "Management review marked held." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function recordManagementReviewDecisionAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const targetDateRaw = formData.get("targetDate");
    const parsed = recordManagementReviewDecisionFormSchema.safeParse({
      reviewId: formData.get("reviewId"),
      inputDefinitionKey: formData.get("inputDefinitionKey"),
      decisionType: formData.get("decisionType"),
      text: formData.get("text"),
      rationale: formData.get("rationale"),
      ownerMembershipId: formData.get("ownerMembershipId"),
      targetDate: targetDateRaw ? targetDateRaw : "",
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the decision details." };
    await recordManagementReviewDecision(context, parsed.data.reviewId, {
      inputDefinitionKey: parsed.data.inputDefinitionKey || null,
      decisionType: parsed.data.decisionType,
      text: parsed.data.text,
      rationale: parsed.data.rationale || null,
      ownerMembershipId: parsed.data.ownerMembershipId || null,
      targetDate: parsed.data.targetDate ? (parsed.data.targetDate as Date) : null,
      actorUserId: context.userId,
    });
    revalidateReviews(parsed.data.reviewId);
    return { ...emptyState, message: "Decision recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function draftManagementReviewMinutesAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = draftManagementReviewMinutesFormSchema.safeParse({
      reviewId: formData.get("reviewId"),
      narrativeId: formData.get("narrativeId"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the review." };
    await draftManagementReviewMinutes(context, parsed.data.reviewId, {
      narrativeId: parsed.data.narrativeId || null,
      actorUserId: context.userId,
    });
    revalidateReviews(parsed.data.reviewId);
    return { ...emptyState, message: "Minutes drafted." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function approveManagementReviewMinutesAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const revisionId = String(formData.get("revisionId") ?? "");
    if (!revisionId) return { ...emptyState, error: "Choose a minute revision." };
    const reviewId = String(formData.get("reviewId") ?? "");
    await approveManagementReviewMinutes(context, revisionId, context.userId);
    revalidateReviews(reviewId || undefined);
    return { ...emptyState, message: "Minutes approved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createManagementReviewMinutesAddendumAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createManagementReviewMinutesAddendumFormSchema.safeParse({
      reviewId: formData.get("reviewId"),
      reason: formData.get("reason"),
      narrativeId: formData.get("narrativeId"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the addendum details." };
    await createManagementReviewMinutesAddendum(context, parsed.data.reviewId, {
      reason: parsed.data.reason,
      narrativeId: parsed.data.narrativeId || null,
      actorUserId: context.userId,
    });
    revalidateReviews(parsed.data.reviewId);
    return { ...emptyState, message: "Minutes addendum drafted." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function closeManagementReviewAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const reviewId = String(formData.get("reviewId") ?? "");
    if (!reviewId) return { ...emptyState, error: "Choose a review." };
    await closeManagementReview(context, reviewId, context.userId);
    revalidateReviews(reviewId);
    return { ...emptyState, message: "Management review closed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

// ---------------------------------------------------------------------------
// Decision -> shared ActionItem links
// ---------------------------------------------------------------------------

export async function linkManagementReviewActionAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = linkManagementReviewActionFormSchema.safeParse({
      decisionId: formData.get("decisionId"),
      actionItemId: formData.get("actionItemId"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the action link." };
    const reviewId = String(formData.get("reviewId") ?? "");
    await linkManagementReviewAction(context, parsed.data.decisionId, {
      actionItemId: parsed.data.actionItemId,
      actorUserId: context.userId,
    });
    revalidateReviews(reviewId || undefined);
    return { ...emptyState, message: "Action linked to decision." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function unlinkManagementReviewActionAction(_previous: ReviewActionState, formData: FormData): Promise<ReviewActionState> {
  try {
    const context = await requireOrganisationContext();
    const linkId = String(formData.get("linkId") ?? "");
    if (!linkId) return { ...emptyState, error: "Choose an action link." };
    const reviewId = String(formData.get("reviewId") ?? "");
    await unlinkManagementReviewAction(context, linkId, context.userId);
    revalidateReviews(reviewId || undefined);
    return { ...emptyState, message: "Action unlinked from decision." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

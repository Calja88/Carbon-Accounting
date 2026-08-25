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
  scheduleManagementReviewFormSchema,
  rescheduleManagementReviewFormSchema,
  addManagementReviewAttendeeFormSchema,
  linkManagementReviewInputFormSchema,
  upsertManagementReviewInputDefinitionFormSchema,
  agendaItemsJsonSchema,
  createAgendaTemplateFormSchema,
  updateAgendaTemplateVersionDraftFormSchema,
  createSuccessorAgendaTemplateVersionFormSchema,
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
  throw error;
}

function revalidateReviews() {
  revalidatePath("/ems/management-reviews");
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

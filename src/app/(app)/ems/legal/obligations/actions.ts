"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  ComplianceObligationError,
  createComplianceObligation,
  createSuccessorComplianceObligationVersion,
  approveComplianceObligationVersion,
  rejectComplianceObligationVersion,
  retireComplianceObligationVersion,
  returnComplianceObligationVersionForRevision,
  submitComplianceObligationVersionForReview,
  updateComplianceObligationVersionDraft,
  recordObligationChangeReview,
  type ObligationScopeInput,
} from "@/lib/ems/legal/obligation-service";
import {
  createComplianceObligationFormSchema,
  createObligationChangeReviewFormSchema,
  decideComplianceObligationVersionFormSchema,
  updateComplianceObligationVersionDraftFormSchema,
} from "@/lib/ems/legal/obligation-schemas";

export interface ObligationActionState {
  error: string | null;
  message: string | null;
}

const emptyState: ObligationActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation or scope.";
  if (error instanceof ComplianceObligationError) return error.message;
  throw error;
}

function revalidateObligations() {
  revalidatePath("/ems/legal/obligations");
}

function scopesFromForm(parsed: { entityIds: string[]; siteIds: string[]; aspectIds: string[] }): ObligationScopeInput[] {
  return [
    ...parsed.entityIds.map((entityId) => ({ entityId })),
    ...parsed.siteIds.map((siteId) => ({ siteId })),
    ...parsed.aspectIds.map((aspectId) => ({ aspectId })),
  ];
}

function draftFieldsFromForm(formData: FormData) {
  return {
    title: formData.get("title"),
    requirementSummary: formData.get("requirementSummary"),
    provisionReferenceId: formData.get("provisionReferenceId"),
    ownerMembershipId: formData.get("ownerMembershipId"),
    frequency: formData.get("frequency"),
    triggerDescription: formData.get("triggerDescription"),
    effectiveFrom: formData.get("effectiveFrom") || undefined,
    reviewDueDate: formData.get("reviewDueDate") || undefined,
    entityIds: formData.getAll("entityIds").map(String),
    siteIds: formData.getAll("siteIds").map(String),
    aspectIds: formData.getAll("aspectIds").map(String),
    controlIds: formData.getAll("controlIds").map(String),
  };
}

export async function createComplianceObligationAction(_previous: ObligationActionState, formData: FormData): Promise<ObligationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createComplianceObligationFormSchema.safeParse({
      applicabilityAssessmentId: formData.get("applicabilityAssessmentId"),
      ...draftFieldsFromForm(formData),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the obligation details." };
    await createComplianceObligation(context, {
      applicabilityAssessmentId: parsed.data.applicabilityAssessmentId,
      title: parsed.data.title,
      requirementSummary: parsed.data.requirementSummary,
      provisionReferenceId: parsed.data.provisionReferenceId || null,
      ownerMembershipId: parsed.data.ownerMembershipId,
      frequency: parsed.data.frequency || null,
      triggerDescription: parsed.data.triggerDescription || null,
      effectiveFrom: parsed.data.effectiveFrom ?? null,
      reviewDueDate: parsed.data.reviewDueDate ?? null,
      scopes: scopesFromForm(parsed.data),
      controlIds: parsed.data.controlIds,
      actorUserId: context.userId,
    });
    revalidateObligations();
    return { ...emptyState, message: "Draft compliance obligation created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function updateComplianceObligationVersionDraftAction(
  _previous: ObligationActionState,
  formData: FormData,
): Promise<ObligationActionState> {
  try {
    const context = await requireOrganisationContext();
    const obligationVersionId = String(formData.get("obligationVersionId") ?? "");
    const parsed = updateComplianceObligationVersionDraftFormSchema.safeParse(draftFieldsFromForm(formData));
    if (!obligationVersionId || !parsed.success) {
      return { ...emptyState, error: parsed.success ? "Choose a version." : parsed.error.issues[0]?.message ?? "Check the obligation details." };
    }
    await updateComplianceObligationVersionDraft(context, obligationVersionId, {
      title: parsed.data.title,
      requirementSummary: parsed.data.requirementSummary,
      provisionReferenceId: parsed.data.provisionReferenceId || null,
      ownerMembershipId: parsed.data.ownerMembershipId,
      frequency: parsed.data.frequency || null,
      triggerDescription: parsed.data.triggerDescription || null,
      effectiveFrom: parsed.data.effectiveFrom ?? null,
      reviewDueDate: parsed.data.reviewDueDate ?? null,
      scopes: scopesFromForm(parsed.data),
      controlIds: parsed.data.controlIds,
      actorUserId: context.userId,
    });
    revalidateObligations();
    return { ...emptyState, message: "Draft updated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createSuccessorComplianceObligationVersionAction(
  _previous: ObligationActionState,
  formData: FormData,
): Promise<ObligationActionState> {
  try {
    const context = await requireOrganisationContext();
    const obligationId = String(formData.get("obligationId") ?? "");
    const parsed = createComplianceObligationFormSchema.safeParse({
      applicabilityAssessmentId: formData.get("applicabilityAssessmentId"),
      ...draftFieldsFromForm(formData),
    });
    if (!obligationId || !parsed.success) {
      return { ...emptyState, error: parsed.success ? "Choose an obligation." : parsed.error.issues[0]?.message ?? "Check the obligation details." };
    }
    await createSuccessorComplianceObligationVersion(context, obligationId, {
      applicabilityAssessmentId: parsed.data.applicabilityAssessmentId,
      title: parsed.data.title,
      requirementSummary: parsed.data.requirementSummary,
      provisionReferenceId: parsed.data.provisionReferenceId || null,
      ownerMembershipId: parsed.data.ownerMembershipId,
      frequency: parsed.data.frequency || null,
      triggerDescription: parsed.data.triggerDescription || null,
      effectiveFrom: parsed.data.effectiveFrom ?? null,
      reviewDueDate: parsed.data.reviewDueDate ?? null,
      scopes: scopesFromForm(parsed.data),
      controlIds: parsed.data.controlIds,
      actorUserId: context.userId,
    });
    revalidateObligations();
    return { ...emptyState, message: "Successor draft version created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function submitComplianceObligationVersionForReviewAction(
  _previous: ObligationActionState,
  formData: FormData,
): Promise<ObligationActionState> {
  try {
    const context = await requireOrganisationContext();
    const obligationVersionId = String(formData.get("obligationVersionId") ?? "");
    if (!obligationVersionId) return { ...emptyState, error: "Choose a version." };
    await submitComplianceObligationVersionForReview(context, obligationVersionId, context.userId);
    revalidateObligations();
    return { ...emptyState, message: "Submitted for review." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function decideComplianceObligationVersionAction(
  _previous: ObligationActionState,
  formData: FormData,
): Promise<ObligationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = decideComplianceObligationVersionFormSchema.safeParse({
      obligationVersionId: formData.get("obligationVersionId"),
      decision: formData.get("decision"),
      comment: formData.get("comment"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the decision details." };
    const input = { actorUserId: context.userId, comment: parsed.data.comment || null };
    if (parsed.data.decision === "APPROVED") {
      await approveComplianceObligationVersion(context, parsed.data.obligationVersionId, input);
    } else if (parsed.data.decision === "REJECTED") {
      await rejectComplianceObligationVersion(context, parsed.data.obligationVersionId, input);
    } else {
      await returnComplianceObligationVersionForRevision(context, parsed.data.obligationVersionId, input);
    }
    revalidateObligations();
    return { ...emptyState, message: `Decision recorded: ${parsed.data.decision}.` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function retireComplianceObligationVersionAction(
  _previous: ObligationActionState,
  formData: FormData,
): Promise<ObligationActionState> {
  try {
    const context = await requireOrganisationContext();
    const obligationVersionId = String(formData.get("obligationVersionId") ?? "");
    if (!obligationVersionId) return { ...emptyState, error: "Choose a version." };
    await retireComplianceObligationVersion(context, obligationVersionId, { actorUserId: context.userId });
    revalidateObligations();
    return { ...emptyState, message: "Obligation version retired." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function recordObligationChangeReviewAction(
  _previous: ObligationActionState,
  formData: FormData,
): Promise<ObligationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createObligationChangeReviewFormSchema.safeParse({
      changeEventId: formData.get("changeEventId"),
      obligationVersionId: formData.get("obligationVersionId"),
      impactAssessment: formData.get("impactAssessment"),
      decision: formData.get("decision") || undefined,
      followUpDate: formData.get("followUpDate") || undefined,
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the review details." };
    await recordObligationChangeReview(context, {
      changeEventId: parsed.data.changeEventId,
      obligationVersionId: parsed.data.obligationVersionId,
      impactAssessment: parsed.data.impactAssessment,
      decision: parsed.data.decision ?? null,
      followUpDate: parsed.data.followUpDate ?? null,
      actorUserId: context.userId,
    });
    revalidateObligations();
    return { ...emptyState, message: "Change review recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

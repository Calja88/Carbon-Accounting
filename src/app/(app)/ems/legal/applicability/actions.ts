"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { EvidenceError } from "@/lib/documents/evidence-service";
import {
  ApplicabilityWorkflowError,
  attachEvidenceToApplicabilityAssessment,
  createApplicabilityAssessment,
  decideApplicabilityAssessment,
  submitApplicabilityAssessmentForReview,
  updateApplicabilityAssessmentDraft,
  uploadEvidenceToApplicabilityAssessment,
  type ApplicabilityScopeInput,
} from "@/lib/ems/legal/applicability-service";
import {
  createApplicabilityAssessmentFormSchema,
  decideApplicabilityAssessmentFormSchema,
} from "@/lib/ems/legal/applicability-schemas";

export interface ApplicabilityActionState {
  error: string | null;
  message: string | null;
}

const emptyState: ApplicabilityActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation or scope.";
  if (error instanceof ApplicabilityWorkflowError || error instanceof EvidenceError) return error.message;
  throw error;
}

function revalidateApplicability() {
  revalidatePath("/ems/legal/applicability");
}

function scopesFromForm(parsed: { entityIds: string[]; siteIds: string[]; processIds: string[]; aspectIds: string[] }): ApplicabilityScopeInput[] {
  return [
    ...parsed.entityIds.map((entityId) => ({ entityId })),
    ...parsed.siteIds.map((siteId) => ({ siteId })),
    ...parsed.processIds.map((processId) => ({ processId })),
    ...parsed.aspectIds.map((aspectId) => ({ aspectId })),
  ];
}

function parseAssessmentForm(formData: FormData) {
  return createApplicabilityAssessmentFormSchema.safeParse({
    instrumentId: formData.get("instrumentId"),
    otherRequirementSourceId: formData.get("otherRequirementSourceId"),
    changeEventId: formData.get("changeEventId"),
    supersedesAssessmentId: formData.get("supersedesAssessmentId"),
    decision: formData.get("decision"),
    rationale: formData.get("rationale"),
    entityIds: formData.getAll("entityIds").map(String),
    siteIds: formData.getAll("siteIds").map(String),
    processIds: formData.getAll("processIds").map(String),
    aspectIds: formData.getAll("aspectIds").map(String),
  });
}

export async function createApplicabilityAssessmentAction(
  _previous: ApplicabilityActionState,
  formData: FormData,
): Promise<ApplicabilityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = parseAssessmentForm(formData);
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the assessment details." };
    await createApplicabilityAssessment(context, {
      instrumentId: parsed.data.instrumentId || null,
      otherRequirementSourceId: parsed.data.otherRequirementSourceId || null,
      changeEventId: parsed.data.changeEventId || null,
      supersedesAssessmentId: parsed.data.supersedesAssessmentId || null,
      decision: parsed.data.decision,
      rationale: parsed.data.rationale,
      scopes: scopesFromForm(parsed.data),
      actorUserId: context.userId,
    });
    revalidateApplicability();
    return { ...emptyState, message: "Draft applicability assessment created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function updateApplicabilityAssessmentDraftAction(
  _previous: ApplicabilityActionState,
  formData: FormData,
): Promise<ApplicabilityActionState> {
  try {
    const context = await requireOrganisationContext();
    const assessmentId = String(formData.get("assessmentId") ?? "");
    const parsed = parseAssessmentForm(formData);
    if (!assessmentId || !parsed.success) {
      return { ...emptyState, error: parsed.success ? "Choose an assessment." : parsed.error.issues[0]?.message ?? "Check the assessment details." };
    }
    await updateApplicabilityAssessmentDraft(context, assessmentId, {
      decision: parsed.data.decision,
      rationale: parsed.data.rationale,
      scopes: scopesFromForm(parsed.data),
      actorUserId: context.userId,
    });
    revalidateApplicability();
    return { ...emptyState, message: "Draft updated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function submitApplicabilityAssessmentForReviewAction(
  _previous: ApplicabilityActionState,
  formData: FormData,
): Promise<ApplicabilityActionState> {
  try {
    const context = await requireOrganisationContext();
    const assessmentId = String(formData.get("assessmentId") ?? "");
    if (!assessmentId) return { ...emptyState, error: "Choose an assessment." };
    await submitApplicabilityAssessmentForReview(context, assessmentId, context.userId);
    revalidateApplicability();
    return { ...emptyState, message: "Submitted for review." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function decideApplicabilityAssessmentAction(
  _previous: ApplicabilityActionState,
  formData: FormData,
): Promise<ApplicabilityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = decideApplicabilityAssessmentFormSchema.safeParse({
      assessmentId: formData.get("assessmentId"),
      decision: formData.get("decision"),
      rationale: formData.get("rationale"),
      nextReviewAt: formData.get("nextReviewAt"),
      followUpOwnerMembershipId: formData.get("followUpOwnerMembershipId"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the decision details." };
    await decideApplicabilityAssessment(context, parsed.data.assessmentId, {
      decision: parsed.data.decision,
      rationale: parsed.data.rationale,
      nextReviewAt: parsed.data.nextReviewAt,
      followUpOwnerMembershipId: parsed.data.followUpOwnerMembershipId || null,
      actorUserId: context.userId,
    });
    revalidateApplicability();
    return { ...emptyState, message: `Decision recorded: ${parsed.data.decision}.` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function uploadApplicabilityEvidenceAction(
  _previous: ApplicabilityActionState,
  formData: FormData,
): Promise<ApplicabilityActionState> {
  try {
    const context = await requireOrganisationContext();
    const assessmentId = String(formData.get("assessmentId") ?? "");
    const file = formData.get("file");
    if (!assessmentId || !(file instanceof File) || file.size === 0) {
      return { ...emptyState, error: "Choose an assessment and an evidence file." };
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    await uploadEvidenceToApplicabilityAssessment(context, {
      assessmentId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes,
      purpose: String(formData.get("purpose") ?? "") || null,
      actorUserId: context.userId,
    });
    revalidateApplicability();
    return { ...emptyState, message: "Evidence attached." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function linkApplicabilityEvidenceAction(
  _previous: ApplicabilityActionState,
  formData: FormData,
): Promise<ApplicabilityActionState> {
  try {
    const context = await requireOrganisationContext();
    const assessmentId = String(formData.get("assessmentId") ?? "");
    const evidenceId = String(formData.get("evidenceId") ?? "");
    if (!assessmentId || !evidenceId) return { ...emptyState, error: "Choose an assessment and an evidence item." };
    await attachEvidenceToApplicabilityAssessment(context, {
      assessmentId,
      evidenceId,
      purpose: String(formData.get("purpose") ?? "") || null,
      actorUserId: context.userId,
    });
    revalidateApplicability();
    return { ...emptyState, message: "Evidence linked." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

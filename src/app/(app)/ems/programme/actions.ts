"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  EmsProgrammeError,
  createEmsProgramme,
  activateEmsProgramme,
  suspendEmsProgramme,
  closeEmsProgramme,
  createScopeVersion,
  createSuccessorScopeVersion,
  submitScopeVersionForReview,
  approveScopeVersion,
  addScopeEntity,
  addScopeSite,
  addScopeActivity,
} from "@/lib/ems/foundation/programme-service";
import {
  EmsContextError,
  createContextIssue,
  createInterestedParty,
  deactivateInterestedParty,
  createInterestedPartyRequirement,
  createEmsRiskOpportunity,
  recordResidualRating,
} from "@/lib/ems/foundation/context-service";
import {
  ChangeAssessmentError,
  createChangeAssessment,
  submitChangeAssessmentForReview,
  approveChangeAssessment,
  recordChangeImplementation,
  recordChangeEffectivenessReview,
} from "@/lib/ems/foundation/change-service";
import {
  createProgrammeFormSchema,
  createScopeVersionFormSchema,
  contextIssueFormSchema,
  interestedPartyFormSchema,
  interestedPartyRequirementFormSchema,
  emsRiskOpportunityFormSchema,
  residualRatingFormSchema,
  changeAssessmentFormSchema,
  submitChangeAssessmentFormSchema,
  approveChangeAssessmentFormSchema,
  implementChangeAssessmentFormSchema,
  effectivenessReviewFormSchema,
} from "@/lib/ems/foundation/schemas";

export interface FoundationActionState {
  error: string | null;
  message: string | null;
}

const emptyState: FoundationActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation.";
  if (error instanceof EmsProgrammeError || error instanceof EmsContextError || error instanceof ChangeAssessmentError) {
    return error.message;
  }
  if (error instanceof Error && error.message.includes("Unique constraint")) return "That record already exists.";
  throw error;
}

function revalidateProgramme() {
  revalidatePath("/ems/programme");
  revalidatePath("/ems");
}

function dateOrNull(value: unknown): Date | null {
  return value instanceof Date ? value : null;
}

// ---------------------------------------------------------------------------
// Programme
// ---------------------------------------------------------------------------

export async function createProgrammeAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createProgrammeFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the programme details." };
    await createEmsProgramme(context, {
      ...parsed.data,
      ownerMembershipId: parsed.data.ownerMembershipId || null,
      actorUserId: context.userId,
    });
    revalidateProgramme();
    return { ...emptyState, message: `Programme "${parsed.data.name}" created.` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function activateProgrammeAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    await activateEmsProgramme(context, String(formData.get("programmeId") ?? ""), context.userId);
    revalidateProgramme();
    return { ...emptyState, message: "Programme activated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function suspendProgrammeAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    await suspendEmsProgramme(context, String(formData.get("programmeId") ?? ""), context.userId);
    revalidateProgramme();
    return { ...emptyState, message: "Programme suspended." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function closeProgrammeAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    await closeEmsProgramme(context, String(formData.get("programmeId") ?? ""), context.userId);
    revalidateProgramme();
    return { ...emptyState, message: "Programme closed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export async function createScopeVersionAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createScopeVersionFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the scope statement." };
    const isSuccessor = String(formData.get("successor") ?? "") === "true";
    const input = {
      programmeId: parsed.data.programmeId,
      statement: parsed.data.statement,
      exclusions: parsed.data.exclusions || null,
      exclusionsRationale: parsed.data.exclusionsRationale || null,
      actorUserId: context.userId,
    };
    if (isSuccessor) {
      await createSuccessorScopeVersion(context, input);
    } else {
      await createScopeVersion(context, input);
    }
    revalidateProgramme();
    return { ...emptyState, message: "Scope version created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function submitScopeVersionAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    await submitScopeVersionForReview(context, String(formData.get("scopeVersionId") ?? ""), context.userId);
    revalidateProgramme();
    return { ...emptyState, message: "Scope version submitted for review." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function approveScopeVersionAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    await approveScopeVersion(context, String(formData.get("scopeVersionId") ?? ""), { actorUserId: context.userId });
    revalidateProgramme();
    return { ...emptyState, message: "Scope version approved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function addScopeEntityAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    const scopeVersionId = String(formData.get("scopeVersionId") ?? "");
    const entityId = String(formData.get("entityId") ?? "");
    if (!scopeVersionId || !entityId) return { ...emptyState, error: "Choose an entity to add." };
    await addScopeEntity(context, scopeVersionId, entityId);
    revalidateProgramme();
    return { ...emptyState, message: "Entity added to scope boundary." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function addScopeSiteAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    const scopeVersionId = String(formData.get("scopeVersionId") ?? "");
    const siteId = String(formData.get("siteId") ?? "");
    if (!scopeVersionId || !siteId) return { ...emptyState, error: "Choose a site to add." };
    await addScopeSite(context, scopeVersionId, siteId);
    revalidateProgramme();
    return { ...emptyState, message: "Site added to scope boundary." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function addScopeActivityAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    const scopeVersionId = String(formData.get("scopeVersionId") ?? "");
    const description = String(formData.get("description") ?? "").trim();
    if (!scopeVersionId || !description) return { ...emptyState, error: "Describe the activity, product or service." };
    const siteId = String(formData.get("siteId") ?? "").trim();
    await addScopeActivity(context, scopeVersionId, { description, siteId: siteId || null });
    revalidateProgramme();
    return { ...emptyState, message: "Activity added to scope boundary." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export async function createContextIssueAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = contextIssueFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the context issue details." };
    await createContextIssue(context, {
      ...parsed.data,
      description: parsed.data.description || null,
      significance: parsed.data.significance || null,
      ownerMembershipId: parsed.data.ownerMembershipId || null,
      reviewDate: dateOrNull(parsed.data.reviewDate),
      actorUserId: context.userId,
    });
    revalidateProgramme();
    return { ...emptyState, message: `Context issue "${parsed.data.title}" recorded.` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

// ---------------------------------------------------------------------------
// Interested parties
// ---------------------------------------------------------------------------

export async function createInterestedPartyAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = interestedPartyFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the interested party details." };
    await createInterestedParty(context, {
      ...parsed.data,
      influence: parsed.data.influence || null,
      relationshipOwnerMembershipId: parsed.data.relationshipOwnerMembershipId || null,
      actorUserId: context.userId,
    });
    revalidateProgramme();
    return { ...emptyState, message: `Interested party "${parsed.data.name}" added.` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function deactivateInterestedPartyAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    await deactivateInterestedParty(context, String(formData.get("partyId") ?? ""), { actorUserId: context.userId });
    revalidateProgramme();
    return { ...emptyState, message: "Interested party deactivated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createInterestedPartyRequirementAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = interestedPartyRequirementFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the requirement details." };
    await createInterestedPartyRequirement(context, {
      ...parsed.data,
      sourceReference: parsed.data.sourceReference || null,
      isMandatory: parsed.data.isMandatory ?? false,
      evaluationDate: dateOrNull(parsed.data.evaluationDate),
      reviewDate: dateOrNull(parsed.data.reviewDate),
      actorUserId: context.userId,
    });
    revalidateProgramme();
    return { ...emptyState, message: "Requirement recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

// ---------------------------------------------------------------------------
// Risks and opportunities
// ---------------------------------------------------------------------------

export async function createRiskOpportunityAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = emsRiskOpportunityFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the risk/opportunity details." };
    await createEmsRiskOpportunity(context, {
      programmeId: parsed.data.programmeId,
      kind: parsed.data.kind,
      category: parsed.data.category,
      description: parsed.data.description,
      consequence: parsed.data.consequence || null,
      likelihood: parsed.data.likelihood || null,
      ratingScaleVersion: parsed.data.ratingScaleVersion,
      initialRating: { value: parsed.data.initialRatingValue },
      ownerMembershipId: parsed.data.ownerMembershipId || null,
      actorUserId: context.userId,
    });
    revalidateProgramme();
    return { ...emptyState, message: `${parsed.data.kind === "RISK" ? "Risk" : "Opportunity"} "${parsed.data.category}" registered.` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function recordResidualRatingAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = residualRatingFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Enter a residual rating value." };
    await recordResidualRating(context, parsed.data.riskOpportunityId, {
      residualRating: { value: parsed.data.residualRatingValue },
      status: parsed.data.status,
      actorUserId: context.userId,
    });
    revalidateProgramme();
    return { ...emptyState, message: "Residual rating recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

// ---------------------------------------------------------------------------
// Change control
// ---------------------------------------------------------------------------

export async function createChangeAssessmentAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = changeAssessmentFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the change assessment details." };
    await createChangeAssessment(context, {
      programmeId: parsed.data.programmeId,
      proposedChange: parsed.data.proposedChange,
      triggerType: parsed.data.triggerType,
      triggerDate: dateOrNull(parsed.data.triggerDate),
      actorUserId: context.userId,
    });
    revalidateProgramme();
    return { ...emptyState, message: "Change assessment created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function submitChangeAssessmentAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = submitChangeAssessmentFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Enter assessment notes." };
    await submitChangeAssessmentForReview(context, parsed.data.assessmentId, parsed.data.assessmentNotes, context.userId);
    revalidateProgramme();
    return { ...emptyState, message: "Change assessment submitted for review." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function approveChangeAssessmentAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = approveChangeAssessmentFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Enter the decision." };
    await approveChangeAssessment(context, parsed.data.assessmentId, parsed.data.decision, context.userId);
    revalidateProgramme();
    return { ...emptyState, message: "Change assessment approved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function implementChangeAssessmentAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = implementChangeAssessmentFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: "Choose a change assessment." };
    await recordChangeImplementation(context, parsed.data.assessmentId, context.userId);
    revalidateProgramme();
    return { ...emptyState, message: "Change implementation recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function effectivenessReviewAction(_previous: FoundationActionState, formData: FormData): Promise<FoundationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = effectivenessReviewFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Enter the effectiveness review." };
    await recordChangeEffectivenessReview(context, parsed.data.assessmentId, parsed.data.review, context.userId);
    revalidateProgramme();
    return { ...emptyState, message: "Change effectiveness review recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

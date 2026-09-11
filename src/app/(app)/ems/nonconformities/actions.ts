"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  NonconformityError,
  createNonconformityFromSource,
  linkAdditionalSourceToNonconformity,
  recordContainment,
  reviewContainmentAdequacy,
  closeNonconformity,
  reopenNonconformity,
  createNonconformityClassification,
  assignNonconformityClassification,
  upsertNonconformityClosurePolicy,
} from "@/lib/ems/nonconformity/nonconformity-service";
import { RootCauseError, recordRootCauseAnalysis, approveRootCauseAnalysis } from "@/lib/ems/nonconformity/root-cause-service";
import {
  CorrectiveActionError,
  createCorrectiveAction,
  setCorrectiveActionStatus,
  completeCorrectiveAction,
  verifyCorrectiveAction,
  reopenCorrectiveAction,
  uploadEvidenceToCorrectiveAction,
} from "@/lib/ems/nonconformity/corrective-action-service";
import { EffectivenessError, requestEffectivenessReview, performEffectivenessReview } from "@/lib/ems/nonconformity/effectiveness-service";
import {
  createNonconformityFromSourceFormSchema,
  linkAdditionalSourceFormSchema,
  recordContainmentFormSchema,
  reviewContainmentAdequacyFormSchema,
  reopenNonconformityFormSchema,
  createNonconformityClassificationFormSchema,
  assignNonconformityClassificationFormSchema,
  upsertNonconformityClosurePolicyFormSchema,
  recordRootCauseAnalysisFormSchema,
  approveRootCauseAnalysisFormSchema,
  createCorrectiveActionFormSchema,
  setCorrectiveActionStatusFormSchema,
  completeCorrectiveActionFormSchema,
  verifyCorrectiveActionFormSchema,
  reopenCorrectiveActionFormSchema,
  requestEffectivenessReviewFormSchema,
  performEffectivenessReviewFormSchema,
} from "@/lib/ems/nonconformity/schemas";

export interface NonconformityActionState {
  error: string | null;
  message: string | null;
}

const emptyState: NonconformityActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) {
    if (error.reason === "FOUR_EYES_SELF_APPROVAL") return "You own a corrective action on this nonconformity, so you cannot also review its effectiveness.";
    return "You don't have permission to do that.";
  }
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation.";
  if (error instanceof NonconformityError) return error.message;
  if (error instanceof RootCauseError) return error.message;
  if (error instanceof CorrectiveActionError) return error.message;
  if (error instanceof EffectivenessError) return error.message;
  throw error;
}

function revalidateNonconformities(nonconformityId?: string) {
  revalidatePath("/ems/nonconformities");
  if (nonconformityId) revalidatePath(`/ems/nonconformities/${nonconformityId}`);
  // BD06: every NC/CAPA/effectiveness transition here is a genuine source-state
  // change BD05's Overview and Attention queue project — revalidate both so a
  // completed action, a review outcome or a closure is reflected on refresh
  // without a manual full reload assumption. Never remove an Attention card
  // client-side while the source record itself is still open.
  revalidatePath("/");
  revalidatePath("/attention");
}

export async function createNonconformityFromSourceAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createNonconformityFromSourceFormSchema.safeParse({
      reference: formData.get("reference"),
      sourceType: formData.get("sourceType"),
      sourceId: formData.get("sourceId"),
      sourceReferenceNote: formData.get("sourceReferenceNote"),
      statement: formData.get("statement"),
      requirementReference: formData.get("requirementReference"),
      complianceObligationId: formData.get("complianceObligationId"),
      operationalControlId: formData.get("operationalControlId"),
      classificationId: formData.get("classificationId"),
      ownerMembershipId: formData.get("ownerMembershipId"),
      dueDate: formData.get("dueDate") || undefined,
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the nonconformity details." };
    const nonconformity = await createNonconformityFromSource(context, {
      reference: parsed.data.reference,
      sourceType: parsed.data.sourceType,
      sourceId: parsed.data.sourceId || null,
      sourceReferenceNote: parsed.data.sourceReferenceNote || null,
      statement: parsed.data.statement,
      requirementReference: parsed.data.requirementReference,
      complianceObligationId: parsed.data.complianceObligationId || null,
      operationalControlId: parsed.data.operationalControlId || null,
      classificationId: parsed.data.classificationId || null,
      ownerMembershipId: parsed.data.ownerMembershipId || null,
      dueDate: parsed.data.dueDate ?? null,
      actorUserId: context.userId,
    });
    revalidateNonconformities(nonconformity.id);
    return { ...emptyState, message: "Nonconformity created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function linkAdditionalSourceAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = linkAdditionalSourceFormSchema.safeParse({
      nonconformityId: formData.get("nonconformityId"),
      sourceType: formData.get("sourceType"),
      sourceId: formData.get("sourceId"),
      sourceReferenceNote: formData.get("sourceReferenceNote"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the additional source." };
    await linkAdditionalSourceToNonconformity(context, parsed.data.nonconformityId, {
      sourceType: parsed.data.sourceType,
      sourceId: parsed.data.sourceId || null,
      sourceReferenceNote: parsed.data.sourceReferenceNote || null,
      actorUserId: context.userId,
    });
    revalidateNonconformities(parsed.data.nonconformityId);
    return { ...emptyState, message: "Additional source linked; source traceability preserved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function recordContainmentAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = recordContainmentFormSchema.safeParse({
      nonconformityId: formData.get("nonconformityId"),
      actionTaken: formData.get("actionTaken"),
      actionTakenAt: formData.get("actionTakenAt"),
      ownerMembershipId: formData.get("ownerMembershipId"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the containment details." };
    await recordContainment(context, parsed.data.nonconformityId, {
      actionTaken: parsed.data.actionTaken,
      actionTakenAt: parsed.data.actionTakenAt,
      ownerMembershipId: parsed.data.ownerMembershipId,
      actorUserId: context.userId,
    });
    revalidateNonconformities(parsed.data.nonconformityId);
    return { ...emptyState, message: "Containment recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function reviewContainmentAdequacyAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = reviewContainmentAdequacyFormSchema.safeParse({
      containmentId: formData.get("containmentId"),
      adequate: formData.get("adequate") === "on" || formData.get("adequate") === "true",
      notes: formData.get("notes"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the adequacy review." };
    const nonconformityId = String(formData.get("nonconformityId") ?? "");
    await reviewContainmentAdequacy(context, parsed.data.containmentId, {
      adequate: parsed.data.adequate,
      notes: parsed.data.notes || null,
      actorUserId: context.userId,
    });
    revalidateNonconformities(nonconformityId || undefined);
    return { ...emptyState, message: "Containment adequacy review recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function closeNonconformityAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const nonconformityId = String(formData.get("nonconformityId") ?? "");
    if (!nonconformityId) return { ...emptyState, error: "Choose a nonconformity." };
    await closeNonconformity(context, nonconformityId, context.userId);
    revalidateNonconformities(nonconformityId);
    return { ...emptyState, message: "Nonconformity closed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function reopenNonconformityAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = reopenNonconformityFormSchema.safeParse({
      nonconformityId: formData.get("nonconformityId"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Enter a reason for reopening." };
    await reopenNonconformity(context, parsed.data.nonconformityId, parsed.data.reason, context.userId);
    revalidateNonconformities(parsed.data.nonconformityId);
    return { ...emptyState, message: "Nonconformity reopened." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createNonconformityClassificationAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createNonconformityClassificationFormSchema.safeParse({
      key: formData.get("key"),
      label: formData.get("label"),
      rank: formData.get("rank"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the classification." };
    await createNonconformityClassification(context, { key: parsed.data.key, label: parsed.data.label, rank: parsed.data.rank, actorUserId: context.userId });
    revalidateNonconformities();
    return { ...emptyState, message: "Classification added." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function assignNonconformityClassificationAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = assignNonconformityClassificationFormSchema.safeParse({
      nonconformityId: formData.get("nonconformityId"),
      classificationId: formData.get("classificationId"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Choose a classification." };
    await assignNonconformityClassification(context, parsed.data.nonconformityId, parsed.data.classificationId, context.userId);
    revalidateNonconformities(parsed.data.nonconformityId);
    return { ...emptyState, message: "Classification assigned." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function upsertNonconformityClosurePolicyAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = upsertNonconformityClosurePolicyFormSchema.safeParse({
      requireContainment: formData.get("requireContainment") === "on" || formData.get("requireContainment") === "true",
      requireRootCauseApproval: formData.get("requireRootCauseApproval") === "on" || formData.get("requireRootCauseApproval") === "true",
      requireCorrectiveActionsComplete: formData.get("requireCorrectiveActionsComplete") === "on" || formData.get("requireCorrectiveActionsComplete") === "true",
      requireEffectivenessReview: formData.get("requireEffectivenessReview") === "on" || formData.get("requireEffectivenessReview") === "true",
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the closure policy." };
    await upsertNonconformityClosurePolicy(context, { ...parsed.data, actorUserId: context.userId });
    revalidateNonconformities();
    return { ...emptyState, message: "Closure policy saved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

// ---------------------------------------------------------------------------
// Root cause, corrective action and effectiveness (T64)
// ---------------------------------------------------------------------------

export async function recordRootCauseAnalysisAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = recordRootCauseAnalysisFormSchema.safeParse({
      nonconformityId: formData.get("nonconformityId"),
      method: formData.get("method"),
      analysisPayload: formData.get("analysisPayload"),
      contributors: formData.get("contributors"),
      conclusion: formData.get("conclusion"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the root-cause analysis." };
    await recordRootCauseAnalysis(context, parsed.data.nonconformityId, {
      method: parsed.data.method,
      analysisPayload: { notes: parsed.data.analysisPayload },
      contributors: parsed.data.contributors ? { notes: parsed.data.contributors } : null,
      conclusion: parsed.data.conclusion,
      actorUserId: context.userId,
    });
    revalidateNonconformities(parsed.data.nonconformityId);
    return { ...emptyState, message: "Root-cause analysis recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function approveRootCauseAnalysisAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = approveRootCauseAnalysisFormSchema.safeParse({
      rootCauseAnalysisId: formData.get("rootCauseAnalysisId"),
      nonconformityId: formData.get("nonconformityId"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Choose a root-cause analysis." };
    await approveRootCauseAnalysis(context, parsed.data.rootCauseAnalysisId, { actorUserId: context.userId });
    revalidateNonconformities(parsed.data.nonconformityId);
    return { ...emptyState, message: "Root-cause analysis approved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createCorrectiveActionAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createCorrectiveActionFormSchema.safeParse({
      nonconformityId: formData.get("nonconformityId"),
      description: formData.get("description"),
      completionCriteria: formData.get("completionCriteria"),
      ownerMembershipId: formData.get("ownerMembershipId"),
      dueDate: formData.get("dueDate"),
      sharedActionItemId: formData.get("sharedActionItemId"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the corrective action." };
    await createCorrectiveAction(context, parsed.data.nonconformityId, {
      description: parsed.data.description,
      completionCriteria: parsed.data.completionCriteria || null,
      ownerMembershipId: parsed.data.ownerMembershipId,
      dueDate: parsed.data.dueDate,
      sharedActionItemId: parsed.data.sharedActionItemId || null,
      actorUserId: context.userId,
    });
    revalidateNonconformities(parsed.data.nonconformityId);
    return { ...emptyState, message: "Corrective action created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function setCorrectiveActionStatusAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = setCorrectiveActionStatusFormSchema.safeParse({
      correctiveActionId: formData.get("correctiveActionId"),
      nonconformityId: formData.get("nonconformityId"),
      status: formData.get("status"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the status change." };
    await setCorrectiveActionStatus(context, parsed.data.correctiveActionId, parsed.data.status, context.userId);
    revalidateNonconformities(parsed.data.nonconformityId);
    return { ...emptyState, message: "Corrective action status updated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function completeCorrectiveActionAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = completeCorrectiveActionFormSchema.safeParse({
      correctiveActionId: formData.get("correctiveActionId"),
      nonconformityId: formData.get("nonconformityId"),
      completionEvidenceNote: formData.get("completionEvidenceNote"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Describe the completion evidence." };
    await completeCorrectiveAction(context, parsed.data.correctiveActionId, {
      completionEvidenceNote: parsed.data.completionEvidenceNote,
      actorUserId: context.userId,
    });
    revalidateNonconformities(parsed.data.nonconformityId);
    return { ...emptyState, message: "Corrective action completed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function verifyCorrectiveActionAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = verifyCorrectiveActionFormSchema.safeParse({
      correctiveActionId: formData.get("correctiveActionId"),
      nonconformityId: formData.get("nonconformityId"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Choose a corrective action." };
    await verifyCorrectiveAction(context, parsed.data.correctiveActionId, { actorUserId: context.userId });
    revalidateNonconformities(parsed.data.nonconformityId);
    return { ...emptyState, message: "Corrective action verified." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function reopenCorrectiveActionAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = reopenCorrectiveActionFormSchema.safeParse({
      correctiveActionId: formData.get("correctiveActionId"),
      nonconformityId: formData.get("nonconformityId"),
      reopenReason: formData.get("reopenReason"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Enter a reason for reopening." };
    await reopenCorrectiveAction(context, parsed.data.correctiveActionId, { reopenReason: parsed.data.reopenReason, actorUserId: context.userId });
    revalidateNonconformities(parsed.data.nonconformityId);
    return { ...emptyState, message: "Corrective action reopened." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function uploadCorrectiveActionEvidenceAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const correctiveActionId = String(formData.get("correctiveActionId") ?? "");
    const nonconformityId = String(formData.get("nonconformityId") ?? "");
    const file = formData.get("file");
    if (!correctiveActionId) return { ...emptyState, error: "Choose a corrective action." };
    if (!(file instanceof File) || file.size === 0) return { ...emptyState, error: "Choose a file to upload." };
    const bytes = Buffer.from(await file.arrayBuffer());
    await uploadEvidenceToCorrectiveAction(context, {
      correctiveActionId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes,
      purpose: String(formData.get("purpose") ?? "") || null,
      actorUserId: context.userId,
    });
    revalidateNonconformities(nonconformityId || undefined);
    return { ...emptyState, message: "Evidence uploaded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function requestEffectivenessReviewAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = requestEffectivenessReviewFormSchema.safeParse({ nonconformityId: formData.get("nonconformityId") });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Choose a nonconformity." };
    await requestEffectivenessReview(context, parsed.data.nonconformityId, { actorUserId: context.userId });
    revalidateNonconformities(parsed.data.nonconformityId);
    return { ...emptyState, message: "Effectiveness review requested." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function performEffectivenessReviewAction(_previous: NonconformityActionState, formData: FormData): Promise<NonconformityActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = performEffectivenessReviewFormSchema.safeParse({
      nonconformityId: formData.get("nonconformityId"),
      reviewCycle: formData.get("reviewCycle"),
      criteria: formData.get("criteria"),
      reviewDate: formData.get("reviewDate"),
      result: formData.get("result"),
      decision: formData.get("decision"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the effectiveness review." };
    await performEffectivenessReview(context, parsed.data.nonconformityId, {
      reviewCycle: parsed.data.reviewCycle,
      criteria: parsed.data.criteria,
      reviewDate: parsed.data.reviewDate,
      result: parsed.data.result,
      decision: parsed.data.decision,
      actorUserId: context.userId,
    });
    revalidateNonconformities(parsed.data.nonconformityId);
    return { ...emptyState, message: "Effectiveness review recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

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
import {
  createNonconformityFromSourceFormSchema,
  linkAdditionalSourceFormSchema,
  recordContainmentFormSchema,
  reviewContainmentAdequacyFormSchema,
  reopenNonconformityFormSchema,
  createNonconformityClassificationFormSchema,
  assignNonconformityClassificationFormSchema,
  upsertNonconformityClosurePolicyFormSchema,
} from "@/lib/ems/nonconformity/schemas";

export interface NonconformityActionState {
  error: string | null;
  message: string | null;
}

const emptyState: NonconformityActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation.";
  if (error instanceof NonconformityError) return error.message;
  throw error;
}

function revalidateNonconformities(nonconformityId?: string) {
  revalidatePath("/ems/nonconformities");
  if (nonconformityId) revalidatePath(`/ems/nonconformities/${nonconformityId}`);
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

"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { EvidenceError } from "@/lib/documents/evidence-service";
import {
  OtherRequirementSourceError,
  attachEvidenceToOtherRequirementSource,
  changeOtherRequirementSourceStatus,
  createOtherRequirementSource,
  updateOtherRequirementSource,
  uploadEvidenceToOtherRequirementSource,
} from "@/lib/ems/legal/other-requirement-service";
import {
  changeOtherRequirementSourceStatusFormSchema,
  createOtherRequirementSourceFormSchema,
  updateOtherRequirementSourceFormSchema,
} from "@/lib/ems/legal/other-requirement-schemas";

export interface OtherRequirementActionState {
  error: string | null;
  message: string | null;
}

const emptyState: OtherRequirementActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation.";
  if (error instanceof OtherRequirementSourceError || error instanceof EvidenceError) return error.message;
  throw error;
}

function revalidateOtherRequirements() {
  revalidatePath("/ems/legal/other-requirements");
  revalidatePath("/ems/legal/applicability");
}

function draftFieldsFromForm(formData: FormData) {
  return {
    type: formData.get("type"),
    title: formData.get("title"),
    issuingParty: formData.get("issuingParty"),
    reference: formData.get("reference"),
    description: formData.get("description"),
    ownerMembershipId: formData.get("ownerMembershipId"),
    issuedAt: formData.get("issuedAt") || undefined,
    effectiveFrom: formData.get("effectiveFrom") || undefined,
    expiryDate: formData.get("expiryDate") || undefined,
    nextReviewAt: formData.get("nextReviewAt") || undefined,
  };
}

export async function createOtherRequirementSourceAction(
  _previous: OtherRequirementActionState,
  formData: FormData,
): Promise<OtherRequirementActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createOtherRequirementSourceFormSchema.safeParse(draftFieldsFromForm(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the source details." };
    await createOtherRequirementSource(context, {
      type: parsed.data.type,
      title: parsed.data.title,
      issuingParty: parsed.data.issuingParty,
      reference: parsed.data.reference || null,
      description: parsed.data.description || null,
      ownerMembershipId: parsed.data.ownerMembershipId,
      issuedAt: parsed.data.issuedAt ?? null,
      effectiveFrom: parsed.data.effectiveFrom ?? null,
      expiryDate: parsed.data.expiryDate ?? null,
      nextReviewAt: parsed.data.nextReviewAt ?? null,
      actorUserId: context.userId,
    });
    revalidateOtherRequirements();
    return { ...emptyState, message: "Other-requirement source recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function updateOtherRequirementSourceAction(
  _previous: OtherRequirementActionState,
  formData: FormData,
): Promise<OtherRequirementActionState> {
  try {
    const context = await requireOrganisationContext();
    const sourceId = String(formData.get("sourceId") ?? "");
    const parsed = updateOtherRequirementSourceFormSchema.safeParse(draftFieldsFromForm(formData));
    if (!sourceId || !parsed.success) {
      return { ...emptyState, error: parsed.success ? "Choose a source." : parsed.error.issues[0]?.message ?? "Check the source details." };
    }
    await updateOtherRequirementSource(context, sourceId, {
      type: parsed.data.type,
      title: parsed.data.title,
      issuingParty: parsed.data.issuingParty,
      reference: parsed.data.reference || null,
      description: parsed.data.description || null,
      ownerMembershipId: parsed.data.ownerMembershipId,
      issuedAt: parsed.data.issuedAt ?? null,
      effectiveFrom: parsed.data.effectiveFrom ?? null,
      expiryDate: parsed.data.expiryDate ?? null,
      nextReviewAt: parsed.data.nextReviewAt ?? null,
      actorUserId: context.userId,
    });
    revalidateOtherRequirements();
    return { ...emptyState, message: "Other-requirement source updated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function changeOtherRequirementSourceStatusAction(
  _previous: OtherRequirementActionState,
  formData: FormData,
): Promise<OtherRequirementActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = changeOtherRequirementSourceStatusFormSchema.safeParse({
      sourceId: formData.get("sourceId"),
      status: formData.get("status"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Choose a status." };
    await changeOtherRequirementSourceStatus(context, parsed.data.sourceId, parsed.data.status, context.userId);
    revalidateOtherRequirements();
    return { ...emptyState, message: `Status changed to ${parsed.data.status}.` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function uploadOtherRequirementSourceEvidenceAction(
  _previous: OtherRequirementActionState,
  formData: FormData,
): Promise<OtherRequirementActionState> {
  try {
    const context = await requireOrganisationContext();
    const sourceId = String(formData.get("sourceId") ?? "");
    const file = formData.get("file");
    if (!sourceId || !(file instanceof File) || file.size === 0) {
      return { ...emptyState, error: "Choose a source and an evidence file." };
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    await uploadEvidenceToOtherRequirementSource(context, {
      sourceId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes,
      purpose: String(formData.get("purpose") ?? "") || null,
      actorUserId: context.userId,
    });
    revalidateOtherRequirements();
    return { ...emptyState, message: "Evidence attached." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function linkOtherRequirementSourceEvidenceAction(
  _previous: OtherRequirementActionState,
  formData: FormData,
): Promise<OtherRequirementActionState> {
  try {
    const context = await requireOrganisationContext();
    const sourceId = String(formData.get("sourceId") ?? "");
    const evidenceId = String(formData.get("evidenceId") ?? "");
    if (!sourceId || !evidenceId) return { ...emptyState, error: "Choose a source and an evidence item." };
    await attachEvidenceToOtherRequirementSource(context, {
      sourceId,
      evidenceId,
      purpose: String(formData.get("purpose") ?? "") || null,
      actorUserId: context.userId,
    });
    revalidateOtherRequirements();
    return { ...emptyState, message: "Evidence linked." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

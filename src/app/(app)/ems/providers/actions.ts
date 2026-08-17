"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { EvidenceError } from "@/lib/documents/evidence-service";
import {
  ExternalProviderControlError,
  createExternalProviderControl,
  notifyOverdueProviderReviews,
  recordExternalProviderEvaluation,
  setExternalProviderControlStatus,
  uploadEvidenceToProviderEvaluation,
} from "@/lib/ems/providers/provider-control-service";
import { externalProviderControlFormSchema, externalProviderEvaluationFormSchema } from "@/lib/ems/providers/schemas";

export interface ProviderActionState {
  error: string | null;
  message: string | null;
}

const emptyState: ProviderActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation.";
  if (error instanceof ExternalProviderControlError || error instanceof EvidenceError) return error.message;
  if (error instanceof Error && error.message.includes("Unique constraint")) return "That provider reference already exists.";
  throw error;
}

function revalidateProviders() {
  revalidatePath("/ems/providers");
}

export async function createProviderControlAction(_previous: ProviderActionState, formData: FormData): Promise<ProviderActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = externalProviderControlFormSchema.safeParse({
      ...Object.fromEntries(formData),
      aspectIds: formData.getAll("aspectIds").map(String),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the provider details." };
    await createExternalProviderControl(context, { ...parsed.data, actorUserId: context.userId });
    revalidateProviders();
    return { ...emptyState, message: `Recorded provider "${parsed.data.providerName}".` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function retireProviderControlAction(_previous: ProviderActionState, formData: FormData): Promise<ProviderActionState> {
  try {
    const context = await requireOrganisationContext();
    await setExternalProviderControlStatus(context, String(formData.get("providerControlId") ?? ""), "RETIRED", context.userId);
    revalidateProviders();
    return { ...emptyState, message: "Provider control retired." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function recordProviderEvaluationAction(_previous: ProviderActionState, formData: FormData): Promise<ProviderActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = externalProviderEvaluationFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the evaluation details." };
    await recordExternalProviderEvaluation(context, {
      ...parsed.data,
      notes: parsed.data.notes || null,
      actionReference: parsed.data.actionReference || null,
      actorUserId: context.userId,
    });
    revalidateProviders();
    return { ...emptyState, message: "Evaluation recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function notifyOverdueProviderReviewsAction(_previous: ProviderActionState, _formData: FormData): Promise<ProviderActionState> {
  void _previous;
  void _formData;
  try {
    const context = await requireOrganisationContext();
    const outcomes = await notifyOverdueProviderReviews(context);
    revalidateProviders();
    const delivered = outcomes.filter((outcome) => outcome.status === "DELIVERED").length;
    return { ...emptyState, message: `Review cycle checked: ${delivered} overdue owner notification${delivered === 1 ? "" : "s"} delivered or already present.` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function uploadProviderEvaluationEvidenceAction(_previous: ProviderActionState, formData: FormData): Promise<ProviderActionState> {
  try {
    const context = await requireOrganisationContext();
    const evaluationId = String(formData.get("evaluationId") ?? "");
    const file = formData.get("file");
    if (!evaluationId || !(file instanceof File) || file.size === 0) return { ...emptyState, error: "Choose an evaluation and evidence file." };
    await uploadEvidenceToProviderEvaluation(context, {
      evaluationId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes: Buffer.from(await file.arrayBuffer()),
      purpose: String(formData.get("purpose") ?? "").trim() || null,
      actorUserId: context.userId,
    });
    revalidateProviders();
    return { ...emptyState, message: "Evaluation evidence attached." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

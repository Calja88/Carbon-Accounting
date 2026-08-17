"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { EvidenceError } from "@/lib/documents/evidence-service";
import {
  CommunicationError,
  createCommunicationPlan,
  recordCommunication,
  setCommunicationPlanStatus,
  uploadEvidenceToCommunicationRecord,
} from "@/lib/ems/communications/communication-service";
import { communicationPlanFormSchema, communicationRecordFormSchema } from "@/lib/ems/communications/schemas";

export interface CommunicationActionState {
  error: string | null;
  message: string | null;
}

const emptyState: CommunicationActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation.";
  if (error instanceof CommunicationError || error instanceof EvidenceError) return error.message;
  throw error;
}

function revalidateCommunications() {
  revalidatePath("/ems/communications");
}

export async function createCommunicationPlanAction(_previous: CommunicationActionState, formData: FormData): Promise<CommunicationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = communicationPlanFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the plan details." };
    await createCommunicationPlan(context, { ...parsed.data, sourceRequirements: parsed.data.sourceRequirements || null, actorUserId: context.userId });
    revalidateCommunications();
    return { ...emptyState, message: `Created plan "${parsed.data.subject}".` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function retireCommunicationPlanAction(_previous: CommunicationActionState, formData: FormData): Promise<CommunicationActionState> {
  try {
    const context = await requireOrganisationContext();
    await setCommunicationPlanStatus(context, String(formData.get("planId") ?? ""), "RETIRED", context.userId);
    revalidateCommunications();
    return { ...emptyState, message: "Plan retired." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function recordCommunicationAction(_previous: CommunicationActionState, formData: FormData): Promise<CommunicationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = communicationRecordFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the communication details." };
    await recordCommunication(context, {
      ...parsed.data,
      planId: parsed.data.planId || null,
      approvedContentRevisionId: parsed.data.approvedContentRevisionId || null,
      approverMembershipId: parsed.data.approverMembershipId || null,
      approvedAt: parsed.data.approvedAt instanceof Date ? parsed.data.approvedAt : null,
      responseFollowUp: parsed.data.responseFollowUp || null,
      senderMembershipId: context.membershipId,
      actorUserId: context.userId,
    });
    revalidateCommunications();
    return { ...emptyState, message: "Communication recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function uploadCommunicationEvidenceAction(_previous: CommunicationActionState, formData: FormData): Promise<CommunicationActionState> {
  try {
    const context = await requireOrganisationContext();
    const recordId = String(formData.get("recordId") ?? "");
    const file = formData.get("file");
    if (!recordId || !(file instanceof File) || file.size === 0) return { ...emptyState, error: "Choose a communication record and evidence file." };
    await uploadEvidenceToCommunicationRecord(context, {
      recordId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes: Buffer.from(await file.arrayBuffer()),
      purpose: String(formData.get("purpose") ?? "").trim() || null,
      actorUserId: context.userId,
    });
    revalidateCommunications();
    return { ...emptyState, message: "Communication evidence attached." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

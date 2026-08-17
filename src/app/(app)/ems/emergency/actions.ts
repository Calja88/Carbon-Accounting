"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { EvidenceError } from "@/lib/documents/evidence-service";
import {
  EmergencyPreparednessError,
  addExerciseAction as addExerciseActionService,
  createEmergencyPlan,
  createEmergencyScenario,
  recordEmergencyExercise,
  reviseEmergencyPlan,
  setEmergencyScenarioStatus,
  uploadEvidenceToExercise,
} from "@/lib/ems/emergency/emergency-service";
import {
  emergencyExerciseActionFormSchema,
  emergencyExerciseFormSchema,
  emergencyPlanFormSchema,
  emergencyScenarioFormSchema,
} from "@/lib/ems/emergency/schemas";

export interface EmergencyActionState {
  error: string | null;
  message: string | null;
}

const emptyState: EmergencyActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation.";
  if (error instanceof EmergencyPreparednessError || error instanceof EvidenceError) return error.message;
  throw error;
}

function revalidateEmergency() {
  revalidatePath("/ems/emergency");
}

export async function createScenarioAction(_previous: EmergencyActionState, formData: FormData): Promise<EmergencyActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = emergencyScenarioFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the scenario details." };
    await createEmergencyScenario(context, {
      ...parsed.data,
      aspectId: parsed.data.aspectId || null,
      processId: parsed.data.processId || null,
      siteId: parsed.data.siteId || null,
      controlsSummary: parsed.data.controlsSummary || null,
      actorUserId: context.userId,
    });
    revalidateEmergency();
    return { ...emptyState, message: `Recorded scenario "${parsed.data.name}".` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function retireScenarioAction(_previous: EmergencyActionState, formData: FormData): Promise<EmergencyActionState> {
  try {
    const context = await requireOrganisationContext();
    await setEmergencyScenarioStatus(context, String(formData.get("scenarioId") ?? ""), "RETIRED", context.userId);
    revalidateEmergency();
    return { ...emptyState, message: "Scenario retired." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createPlanAction(_previous: EmergencyActionState, formData: FormData): Promise<EmergencyActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = emergencyPlanFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the plan details." };
    await createEmergencyPlan(context, { ...parsed.data, communicationPlanId: parsed.data.communicationPlanId || null, actorUserId: context.userId });
    revalidateEmergency();
    return { ...emptyState, message: "Emergency plan created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function revisePlanAction(_previous: EmergencyActionState, formData: FormData): Promise<EmergencyActionState> {
  try {
    const context = await requireOrganisationContext();
    const planId = String(formData.get("planId") ?? "");
    const parsed = emergencyPlanFormSchema.safeParse(Object.fromEntries(formData));
    if (!planId || !parsed.success) {
      return { ...emptyState, error: parsed.success ? "Choose a plan." : parsed.error.issues[0]?.message ?? "Check the plan details." };
    }
    await reviseEmergencyPlan(context, planId, { ...parsed.data, communicationPlanId: parsed.data.communicationPlanId || null, actorUserId: context.userId });
    revalidateEmergency();
    return { ...emptyState, message: "Emergency plan revised as a successor version." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function recordExerciseAction(_previous: EmergencyActionState, formData: FormData): Promise<EmergencyActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = emergencyExerciseFormSchema.safeParse({
      ...Object.fromEntries(formData),
      participantMembershipIds: formData.getAll("participantMembershipIds").map(String),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the exercise details." };
    await recordEmergencyExercise(context, {
      ...parsed.data,
      observations: parsed.data.observations || null,
      lessons: parsed.data.lessons || null,
      actorUserId: context.userId,
    });
    revalidateEmergency();
    return { ...emptyState, message: "Exercise recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function addExerciseActionAction(_previous: EmergencyActionState, formData: FormData): Promise<EmergencyActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = emergencyExerciseActionFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the follow-up action details." };
    await addExerciseActionService(context, {
      ...parsed.data,
      ownerMembershipId: parsed.data.ownerMembershipId || null,
      dueDate: parsed.data.dueDate instanceof Date ? parsed.data.dueDate : null,
      actionReference: parsed.data.actionReference || null,
      incidentReference: parsed.data.incidentReference || null,
      nonconformityReference: parsed.data.nonconformityReference || null,
      actorUserId: context.userId,
    });
    revalidateEmergency();
    return { ...emptyState, message: "Follow-up action recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function uploadExerciseEvidenceAction(_previous: EmergencyActionState, formData: FormData): Promise<EmergencyActionState> {
  try {
    const context = await requireOrganisationContext();
    const exerciseId = String(formData.get("exerciseId") ?? "");
    const file = formData.get("file");
    if (!exerciseId || !(file instanceof File) || file.size === 0) return { ...emptyState, error: "Choose an exercise and evidence file." };
    await uploadEvidenceToExercise(context, {
      exerciseId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes: Buffer.from(await file.arrayBuffer()),
      purpose: String(formData.get("purpose") ?? "").trim() || null,
      actorUserId: context.userId,
    });
    revalidateEmergency();
    return { ...emptyState, message: "Exercise evidence attached." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  CompetenceRequirementError,
  createCompetenceRequirement,
  updateCompetenceRequirementVersionDraft,
  approveCompetenceRequirementVersion,
  activateCompetenceRequirementVersion,
  createSuccessorCompetenceRequirementVersion,
  type CompetenceRequirementScopeInput,
} from "@/lib/ems/competence/requirement-service";
import {
  competenceRequirementDraftFormSchema,
  createCompetenceRequirementFormSchema,
  createSuccessorCompetenceRequirementVersionFormSchema,
} from "@/lib/ems/competence/requirement-schemas";

export interface CompetenceRequirementActionState {
  error: string | null;
  message: string | null;
}

const emptyState: CompetenceRequirementActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation or scope.";
  if (error instanceof CompetenceRequirementError) return error.message;
  throw error;
}

function revalidateRequirements() {
  revalidatePath("/ems/competence/requirements");
}

function scopesFromForm(parsed: {
  roleIds: string[];
  processIds: string[];
  aspectIds: string[];
  controlIds: string[];
  obligationVersionIds: string[];
  emergencyScenarioIds: string[];
  emergencyRoleLabel?: string;
}): CompetenceRequirementScopeInput[] {
  return [
    ...parsed.roleIds.map((roleId) => ({ scopeType: "ROLE" as const, roleId })),
    ...parsed.processIds.map((processId) => ({ scopeType: "PROCESS" as const, processId })),
    ...parsed.aspectIds.map((aspectId) => ({ scopeType: "ASPECT" as const, aspectId })),
    ...parsed.controlIds.map((controlId) => ({ scopeType: "CONTROL" as const, controlId })),
    ...parsed.obligationVersionIds.map((obligationVersionId) => ({ scopeType: "OBLIGATION" as const, obligationVersionId })),
    ...parsed.emergencyScenarioIds.map((emergencyScenarioId) => ({ scopeType: "EMERGENCY_ROLE" as const, emergencyScenarioId })),
    ...(parsed.emergencyRoleLabel ? [{ scopeType: "EMERGENCY_ROLE" as const, emergencyRoleLabel: parsed.emergencyRoleLabel }] : []),
  ];
}

function draftFieldsFromForm(formData: FormData) {
  return {
    title: formData.get("title"),
    description: formData.get("description"),
    renewalRule: formData.get("renewalRule"),
    acceptableEvidence: formData.get("acceptableEvidence"),
    roleIds: formData.getAll("roleIds").map(String),
    processIds: formData.getAll("processIds").map(String),
    aspectIds: formData.getAll("aspectIds").map(String),
    controlIds: formData.getAll("controlIds").map(String),
    obligationVersionIds: formData.getAll("obligationVersionIds").map(String),
    emergencyScenarioIds: formData.getAll("emergencyScenarioIds").map(String),
    emergencyRoleLabel: formData.get("emergencyRoleLabel"),
  };
}

export async function createCompetenceRequirementAction(
  _previous: CompetenceRequirementActionState,
  formData: FormData,
): Promise<CompetenceRequirementActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createCompetenceRequirementFormSchema.safeParse({
      requirementKey: formData.get("requirementKey"),
      ...draftFieldsFromForm(formData),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the requirement details." };
    await createCompetenceRequirement(context, {
      requirementKey: parsed.data.requirementKey,
      title: parsed.data.title,
      description: parsed.data.description,
      renewalRule: parsed.data.renewalRule || null,
      acceptableEvidence: parsed.data.acceptableEvidence || null,
      scopes: scopesFromForm(parsed.data),
      actorUserId: context.userId,
    });
    revalidateRequirements();
    return { ...emptyState, message: "Draft competence requirement created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function updateCompetenceRequirementVersionDraftAction(
  _previous: CompetenceRequirementActionState,
  formData: FormData,
): Promise<CompetenceRequirementActionState> {
  try {
    const context = await requireOrganisationContext();
    const versionId = String(formData.get("versionId") ?? "");
    const parsed = competenceRequirementDraftFormSchema.safeParse(draftFieldsFromForm(formData));
    if (!versionId || !parsed.success) {
      return { ...emptyState, error: parsed.success ? "Choose a version." : parsed.error.issues[0]?.message ?? "Check the requirement details." };
    }
    await updateCompetenceRequirementVersionDraft(context, versionId, {
      title: parsed.data.title,
      description: parsed.data.description,
      renewalRule: parsed.data.renewalRule || null,
      acceptableEvidence: parsed.data.acceptableEvidence || null,
      scopes: scopesFromForm(parsed.data),
      actorUserId: context.userId,
    });
    revalidateRequirements();
    return { ...emptyState, message: "Draft updated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function approveCompetenceRequirementVersionAction(
  _previous: CompetenceRequirementActionState,
  formData: FormData,
): Promise<CompetenceRequirementActionState> {
  try {
    const context = await requireOrganisationContext();
    const versionId = String(formData.get("versionId") ?? "");
    if (!versionId) return { ...emptyState, error: "Choose a version." };
    await approveCompetenceRequirementVersion(context, versionId, context.userId);
    revalidateRequirements();
    return { ...emptyState, message: "Version approved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function activateCompetenceRequirementVersionAction(
  _previous: CompetenceRequirementActionState,
  formData: FormData,
): Promise<CompetenceRequirementActionState> {
  try {
    const context = await requireOrganisationContext();
    const versionId = String(formData.get("versionId") ?? "");
    if (!versionId) return { ...emptyState, error: "Choose a version." };
    await activateCompetenceRequirementVersion(context, versionId, context.userId);
    revalidateRequirements();
    return { ...emptyState, message: "Version activated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createSuccessorCompetenceRequirementVersionAction(
  _previous: CompetenceRequirementActionState,
  formData: FormData,
): Promise<CompetenceRequirementActionState> {
  try {
    const context = await requireOrganisationContext();
    const requirementId = String(formData.get("requirementId") ?? "");
    const parsed = createSuccessorCompetenceRequirementVersionFormSchema.safeParse(draftFieldsFromForm(formData));
    if (!requirementId || !parsed.success) {
      return { ...emptyState, error: parsed.success ? "Choose a requirement." : parsed.error.issues[0]?.message ?? "Check the requirement details." };
    }
    await createSuccessorCompetenceRequirementVersion(context, requirementId, {
      title: parsed.data.title,
      description: parsed.data.description,
      renewalRule: parsed.data.renewalRule || null,
      acceptableEvidence: parsed.data.acceptableEvidence || null,
      scopes: scopesFromForm(parsed.data),
      revisionRationale: parsed.data.revisionRationale,
      actorUserId: context.userId,
    });
    revalidateRequirements();
    return { ...emptyState, message: "Successor draft version created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

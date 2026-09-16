"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError, type OrganisationContext } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { EvidenceError } from "@/lib/documents/evidence-service";
import { SignificanceValidationError } from "@/lib/ems/aspects/significance-engine";
import {
  SignificanceWorkflowError,
  approveAspectAssessment,
  approveSignificanceMethod,
  createAspectAssessment,
  createSignificanceMethod,
  createSuccessorSignificanceMethod,
  discardSignificanceMethod,
} from "@/lib/ems/aspects/significance-service";
import {
  AspectRegisterError,
  createEnvironmentalAspect,
  createEnvironmentalImpact,
  deleteEnvironmentalAspect,
  deleteEnvironmentalImpact,
  linkAspectToImpact,
  unlinkAspectImpact,
  updateEnvironmentalAspect,
  uploadEvidenceToAspect,
} from "@/lib/ems/aspects/aspect-service";
import {
  aspectImpactLinkFormSchema,
  environmentalAspectFormSchema,
  environmentalImpactFormSchema,
  aspectAssessmentInputSchema,
  significanceMethodInputSchema,
} from "@/lib/ems/aspects/schemas";

export interface AspectActionState {
  error: string | null;
  message: string | null;
}

const emptyState: AspectActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation.";
  if (error instanceof AspectRegisterError || error instanceof EvidenceError) return error.message;
  if (error instanceof SignificanceWorkflowError || error instanceof SignificanceValidationError) return error.message;
  if (error instanceof Error && error.message.includes("Unique constraint")) return "That register entry already exists.";
  throw error;
}

function parseJson(value: FormDataEntryValue | null, label: string): unknown {
  try {
    return JSON.parse(String(value ?? ""));
  } catch {
    throw new SignificanceWorkflowError(`${label} must be valid JSON.`);
  }
}

async function requireContext(): Promise<OrganisationContext> {
  return requireOrganisationContext();
}

function revalidateAspects() {
  revalidatePath("/ems/aspects");
}

function aspectInput(formData: FormData) {
  return environmentalAspectFormSchema.safeParse({
    processId: formData.get("processId"),
    name: formData.get("name"),
    description: formData.get("description"),
    sourceInputOutput: formData.get("sourceInputOutput"),
    scopeDescription: formData.get("scopeDescription"),
    existingControls: formData.get("existingControls"),
    controlRelationship: formData.get("controlRelationship"),
    lifecycleStage: formData.get("lifecycleStage"),
    operatingCondition: formData.get("operatingCondition"),
    effect: formData.get("effect"),
  });
}

export async function createAspectAction(_previous: AspectActionState, formData: FormData): Promise<AspectActionState> {
  try {
    const context = await requireContext();
    const parsed = aspectInput(formData);
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the aspect details." };
    await createEnvironmentalAspect(context, {
      ...parsed.data,
      description: parsed.data.description || null,
      sourceInputOutput: parsed.data.sourceInputOutput || null,
      scopeDescription: parsed.data.scopeDescription || null,
      existingControls: parsed.data.existingControls || null,
      lifecycleStage: parsed.data.lifecycleStage || null,
      actorUserId: context.userId,
    });
    revalidateAspects();
    return { ...emptyState, message: `Created "${parsed.data.name}".` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function updateAspectAction(_previous: AspectActionState, formData: FormData): Promise<AspectActionState> {
  try {
    const context = await requireContext();
    const aspectId = String(formData.get("aspectId") ?? "");
    const parsed = aspectInput(formData);
    if (!aspectId || !parsed.success) {
      return { ...emptyState, error: parsed.success ? "Choose an aspect." : parsed.error.issues[0]?.message ?? "Check the aspect details." };
    }
    await updateEnvironmentalAspect(context, aspectId, {
      ...parsed.data,
      description: parsed.data.description || null,
      sourceInputOutput: parsed.data.sourceInputOutput || null,
      scopeDescription: parsed.data.scopeDescription || null,
      existingControls: parsed.data.existingControls || null,
      lifecycleStage: parsed.data.lifecycleStage || null,
      actorUserId: context.userId,
    });
    revalidateAspects();
    return { ...emptyState, message: "Aspect updated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createImpactAction(_previous: AspectActionState, formData: FormData): Promise<AspectActionState> {
  try {
    const context = await requireContext();
    const parsed = environmentalImpactFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the impact details." };
    await createEnvironmentalImpact(context, {
      ...parsed.data,
      receptor: parsed.data.receptor || null,
      description: parsed.data.description || null,
      actorUserId: context.userId,
    });
    revalidateAspects();
    return { ...emptyState, message: `Created "${parsed.data.name}".` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function linkImpactAction(_previous: AspectActionState, formData: FormData): Promise<AspectActionState> {
  try {
    const context = await requireContext();
    const parsed = aspectImpactLinkFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the link details." };
    await linkAspectToImpact(context, {
      ...parsed.data,
      causalDescription: parsed.data.causalDescription || null,
      actorUserId: context.userId,
    });
    revalidateAspects();
    return { ...emptyState, message: "Impact linked." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function deleteAspectAction(_previous: AspectActionState, formData: FormData): Promise<AspectActionState> {
  try {
    const context = await requireContext();
    await deleteEnvironmentalAspect(context, String(formData.get("aspectId") ?? ""), context.userId);
    revalidateAspects();
    return { ...emptyState, message: "Aspect deleted." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function deleteImpactAction(_previous: AspectActionState, formData: FormData): Promise<AspectActionState> {
  try {
    const context = await requireContext();
    await deleteEnvironmentalImpact(context, String(formData.get("impactId") ?? ""), context.userId);
    revalidateAspects();
    return { ...emptyState, message: "Impact deleted." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function unlinkImpactAction(_previous: AspectActionState, formData: FormData): Promise<AspectActionState> {
  try {
    const context = await requireContext();
    await unlinkAspectImpact(context, String(formData.get("linkId") ?? ""), context.userId);
    revalidateAspects();
    return { ...emptyState, message: "Impact unlinked." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function uploadAspectEvidenceAction(_previous: AspectActionState, formData: FormData): Promise<AspectActionState> {
  try {
    const context = await requireContext();
    const aspectId = String(formData.get("aspectId") ?? "");
    const file = formData.get("file");
    if (!aspectId || !(file instanceof File) || file.size === 0) return { ...emptyState, error: "Choose an evidence file." };
    await uploadEvidenceToAspect(context, {
      aspectId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes: Buffer.from(await file.arrayBuffer()),
      purpose: String(formData.get("purpose") ?? "").trim() || null,
      actorUserId: context.userId,
    });
    revalidateAspects();
    return { ...emptyState, message: "Evidence attached." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createSignificanceMethodAction(_previous: AspectActionState, formData: FormData): Promise<AspectActionState> {
  try {
    const context = await requireContext();
    const formula = String(formData.get("formula"));
    const formulaConfig = formula === "RULE_SET"
      ? { formula, rules: parseJson(formData.get("rulesJson"), "Rules") }
      : { formula };
    const parsed = significanceMethodInputSchema.safeParse({
      programmeId: formData.get("programmeId"),
      methodKey: formData.get("methodKey"),
      name: formData.get("name"),
      formulaConfig,
      threshold: formData.get("threshold"),
      criteria: parseJson(formData.get("criteriaJson"), "Criteria"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the method details." };
    const supersedesMethodId = String(formData.get("supersedesMethodId") ?? "");
    if (supersedesMethodId) {
      await createSuccessorSignificanceMethod(context, supersedesMethodId, {
        name: parsed.data.name,
        formulaConfig: parsed.data.formulaConfig,
        threshold: parsed.data.threshold,
        criteria: parsed.data.criteria,
      });
    } else {
      await createSignificanceMethod(context, parsed.data);
    }
    revalidateAspects();
    return { ...emptyState, message: supersedesMethodId ? "Successor method created." : "Significance method created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function discardSignificanceMethodAction(_previous: AspectActionState, formData: FormData): Promise<AspectActionState> {
  try {
    const context = await requireContext();
    await discardSignificanceMethod(context, String(formData.get("methodId") ?? ""), context.userId);
    revalidateAspects();
    return { ...emptyState, message: "Draft method discarded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function approveSignificanceMethodAction(_previous: AspectActionState, formData: FormData): Promise<AspectActionState> {
  try {
    const context = await requireContext();
    await approveSignificanceMethod(context, String(formData.get("methodId") ?? ""));
    revalidateAspects();
    return { ...emptyState, message: "Significance method approved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createAspectAssessmentAction(_previous: AspectActionState, formData: FormData): Promise<AspectActionState> {
  try {
    const context = await requireContext();
    const inputs: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("criterion:")) inputs[key.slice("criterion:".length)] = String(value);
    }
    const overrideValue = String(formData.get("overrideSignificant") ?? "");
    const parsed = aspectAssessmentInputSchema.safeParse({
      aspectId: formData.get("aspectId"),
      methodId: formData.get("methodId"),
      inputs,
      overrideSignificant: overrideValue === "" ? null : overrideValue === "true",
      overrideRationale: String(formData.get("overrideRationale") ?? "").trim() || null,
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the assessment inputs." };
    await createAspectAssessment(context, parsed.data);
    revalidateAspects();
    return { ...emptyState, message: "Assessment snapshot created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function approveAspectAssessmentAction(_previous: AspectActionState, formData: FormData): Promise<AspectActionState> {
  try {
    const context = await requireContext();
    await approveAspectAssessment(context, String(formData.get("assessmentId") ?? ""));
    revalidateAspects();
    return { ...emptyState, message: "Assessment approved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

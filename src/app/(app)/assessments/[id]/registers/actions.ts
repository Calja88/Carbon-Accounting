"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { LcaMateriality } from "@prisma/client";
import {
  approveAssumption,
  approveExclusion,
  deleteAssumption,
  deleteExclusion,
  upsertAssumption,
  upsertExclusion,
} from "@/lib/lca/registers-service";
import { checkCanApprove, checkCanEditAssessment, getLcaContext, type OrganisationContext } from "@/lib/lca/permissions";
import { requireAssessmentInScope } from "@/lib/repositories/lca-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import type { AssessmentFormState } from "@/lib/lca/form-state";


async function guard(assessmentId: string): Promise<{ error: string; orgContext: null } | { error: null; orgContext: OrganisationContext }> {
  const orgContext = await getLcaContext();
  if (!orgContext) return { error: "You must be signed in.", orgContext: null };
  let assessment;
  try {
    assessment = await requireAssessmentInScope(orgContext, assessmentId);
  } catch (err) {
    if (err instanceof TenantOwnershipError) return { error: "That assessment no longer exists.", orgContext: null };
    throw err;
  }
  const permission = checkCanEditAssessment(orgContext, assessment.status);
  if (!permission.ok) return { error: permission.reason, orgContext: null };
  return { error: null, orgContext };
}

const assumptionSchema = z.object({
  assessmentId: z.string().min(1),
  assumptionId: z.string().optional(),
  assumption: z.string().min(1, "State the assumption."),
  category: z.string().min(1),
  rationale: z.string().min(1, "Record why this assumption is reasonable."),
  source: z.string().optional(),
  uncertainty: z.string().optional(),
  materiality: z.enum(LcaMateriality),
  ownerUserId: z.string().optional(),
  processId: z.string().optional(),
  inventoryItemId: z.string().optional(),
});

export async function saveAssumptionAction(
  _prev: AssessmentFormState,
  formData: FormData,
): Promise<AssessmentFormState> {
  const parsed = assumptionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  const check = await guard(data.assessmentId);
  if (check.error) return { error: check.error, success: false };

  await upsertAssumption(check.orgContext!, {
    id: data.assumptionId || null,
    assessmentId: data.assessmentId,
    assumption: data.assumption,
    category: data.category,
    rationale: data.rationale,
    source: data.source,
    uncertainty: data.uncertainty,
    materiality: data.materiality,
    ownerUserId: data.ownerUserId,
    processId: data.processId,
    inventoryItemId: data.inventoryItemId,
    actorUserId: check.orgContext!.userId,
  });

  revalidatePath(`/assessments/${data.assessmentId}`, "layout");
  return { error: null, success: true, message: "Assumption recorded." };
}

export async function approveAssumptionAction(formData: FormData): Promise<void> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const assumptionId = String(formData.get("assumptionId") ?? "");
  const context = await getLcaContext();
  const permission = checkCanApprove(context);
  if (!permission.ok || !assumptionId) return;

  await approveAssumption(context!, assumptionId, context!.userId);
  revalidatePath(`/assessments/${assessmentId}`, "layout");
}

export async function deleteAssumptionAction(formData: FormData): Promise<void> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const assumptionId = String(formData.get("assumptionId") ?? "");
  const check = await guard(assessmentId);
  if (check.error || !assumptionId) return;

  await deleteAssumption(check.orgContext!, assumptionId, check.orgContext!.userId);
  revalidatePath(`/assessments/${assessmentId}`, "layout");
}

const exclusionSchema = z.object({
  assessmentId: z.string().min(1),
  exclusionId: z.string().optional(),
  excludedItem: z.string().min(1, "Say what has been excluded."),
  rationale: z.string().min(1, "Record why it is excluded."),
  estimatedRelevance: z.string().min(1, "Estimate how much it would have contributed."),
  estimatedPercentOfTotal: z.string().optional(),
  ownerUserId: z.string().optional(),
  processId: z.string().optional(),
});

export async function saveExclusionAction(
  _prev: AssessmentFormState,
  formData: FormData,
): Promise<AssessmentFormState> {
  const parsed = exclusionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  const check = await guard(data.assessmentId);
  if (check.error) return { error: check.error, success: false };

  if (data.estimatedPercentOfTotal?.trim()) {
    const percent = Number(data.estimatedPercentOfTotal);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return { error: "The estimated share must be a percentage between 0 and 100.", success: false };
    }
  }

  await upsertExclusion(check.orgContext!, {
    id: data.exclusionId || null,
    assessmentId: data.assessmentId,
    excludedItem: data.excludedItem,
    rationale: data.rationale,
    estimatedRelevance: data.estimatedRelevance,
    estimatedPercentOfTotal: data.estimatedPercentOfTotal?.trim() || null,
    ownerUserId: data.ownerUserId,
    processId: data.processId,
    actorUserId: check.orgContext!.userId,
  });

  revalidatePath(`/assessments/${data.assessmentId}`, "layout");
  return { error: null, success: true, message: "Exclusion recorded. It stays visible to reviewers." };
}

export async function approveExclusionAction(formData: FormData): Promise<void> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const exclusionId = String(formData.get("exclusionId") ?? "");
  const context = await getLcaContext();
  const permission = checkCanApprove(context);
  if (!permission.ok || !exclusionId) return;

  await approveExclusion(context!, exclusionId, context!.userId);
  revalidatePath(`/assessments/${assessmentId}`, "layout");
}

export async function deleteExclusionAction(formData: FormData): Promise<void> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const exclusionId = String(formData.get("exclusionId") ?? "");
  const check = await guard(assessmentId);
  if (check.error || !exclusionId) return;

  await deleteExclusion(check.orgContext!, exclusionId, check.orgContext!.userId);
  revalidatePath(`/assessments/${assessmentId}`, "layout");
}

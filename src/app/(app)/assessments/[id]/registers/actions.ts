"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { LcaMateriality } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  approveAssumption,
  approveExclusion,
  deleteAssumption,
  deleteExclusion,
  upsertAssumption,
  upsertExclusion,
} from "@/lib/lca/registers-service";
import { checkCanApprove, checkCanEditAssessment, getLcaActor } from "@/lib/lca/permissions";
import type { AssessmentFormState } from "@/lib/lca/form-state";


async function guard(assessmentId: string) {
  const actor = await getLcaActor();
  const assessment = await prisma.lcaAssessment.findUnique({ where: { id: assessmentId } });
  if (!assessment) return { error: "That assessment no longer exists.", actor: null };
  const permission = checkCanEditAssessment(actor, assessment.status);
  if (!permission.ok) return { error: permission.reason, actor: null };
  return { error: null, actor: actor! };
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

  await upsertAssumption({
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
    actorUserId: check.actor!.id,
  });

  revalidatePath(`/assessments/${data.assessmentId}`, "layout");
  return { error: null, success: true, message: "Assumption recorded." };
}

export async function approveAssumptionAction(formData: FormData): Promise<void> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const assumptionId = String(formData.get("assumptionId") ?? "");
  const actor = await getLcaActor();
  const permission = checkCanApprove(actor);
  if (!permission.ok || !assumptionId) return;

  await approveAssumption(assumptionId, actor!.id);
  revalidatePath(`/assessments/${assessmentId}`, "layout");
}

export async function deleteAssumptionAction(formData: FormData): Promise<void> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const assumptionId = String(formData.get("assumptionId") ?? "");
  const check = await guard(assessmentId);
  if (check.error || !assumptionId) return;

  await deleteAssumption(assumptionId, check.actor!.id);
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

  await upsertExclusion({
    id: data.exclusionId || null,
    assessmentId: data.assessmentId,
    excludedItem: data.excludedItem,
    rationale: data.rationale,
    estimatedRelevance: data.estimatedRelevance,
    estimatedPercentOfTotal: data.estimatedPercentOfTotal?.trim() || null,
    ownerUserId: data.ownerUserId,
    processId: data.processId,
    actorUserId: check.actor!.id,
  });

  revalidatePath(`/assessments/${data.assessmentId}`, "layout");
  return { error: null, success: true, message: "Exclusion recorded. It stays visible to reviewers." };
}

export async function approveExclusionAction(formData: FormData): Promise<void> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const exclusionId = String(formData.get("exclusionId") ?? "");
  const actor = await getLcaActor();
  const permission = checkCanApprove(actor);
  if (!permission.ok || !exclusionId) return;

  await approveExclusion(exclusionId, actor!.id);
  revalidatePath(`/assessments/${assessmentId}`, "layout");
}

export async function deleteExclusionAction(formData: FormData): Promise<void> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const exclusionId = String(formData.get("exclusionId") ?? "");
  const check = await guard(assessmentId);
  if (check.error || !exclusionId) return;

  await deleteExclusion(exclusionId, check.actor!.id);
  revalidatePath(`/assessments/${assessmentId}`, "layout");
}

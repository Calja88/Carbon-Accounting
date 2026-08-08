"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { LcaAllocationMethod, LcaLifecycleStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  deleteProcess,
  deleteProcessOutput,
  upsertProcess,
  upsertProcessOutput,
} from "@/lib/lca/model-service";
import { checkCanEditAssessment, getLcaActor } from "@/lib/lca/permissions";
import type { AssessmentFormState } from "@/lib/lca/form-state";


async function guard(assessmentId: string) {
  const actor = await getLcaActor();
  const assessment = await prisma.lcaAssessment.findUnique({ where: { id: assessmentId } });
  if (!assessment) return { error: "That assessment no longer exists.", actor: null };
  const permission = checkCanEditAssessment(actor, assessment.status);
  if (!permission.ok) return { error: permission.reason, actor: null };
  return { error: null, actor: actor! };
}

const processSchema = z.object({
  assessmentId: z.string().min(1),
  processId: z.string().optional(),
  parentProcessId: z.string().optional(),
  stage: z.enum(LcaLifecycleStage),
  name: z.string().min(1, "Give the process a name."),
  description: z.string().optional(),
  isIncluded: z.string().optional(),
  allocationMethod: z.enum(LcaAllocationMethod),
  allocationPercent: z.string().optional(),
  allocationRationale: z.string().optional(),
  allocationBasisDescription: z.string().optional(),
  geography: z.string().optional(),
  notes: z.string().optional(),
});

export async function saveProcessAction(
  _prev: AssessmentFormState,
  formData: FormData,
): Promise<AssessmentFormState> {
  const parsed = processSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  const check = await guard(data.assessmentId);
  if (check.error) return { error: check.error, success: false };

  if (data.allocationMethod === LcaAllocationMethod.MANUAL) {
    const percent = Number(data.allocationPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return { error: "A manual allocation must be a percentage between 0 and 100.", success: false };
    }
    if (!data.allocationRationale?.trim()) {
      return { error: "A manual allocation needs a rationale — a bare percentage cannot be checked by anyone.", success: false };
    }
  }

  // A process cannot be its own parent, and a parent must belong to the same
  // assessment, or the allocation cascade would walk off into another model.
  if (data.parentProcessId) {
    if (data.parentProcessId === data.processId) {
      return { error: "A process cannot be nested inside itself.", success: false };
    }
    const parent = await prisma.lcaProcess.findUnique({ where: { id: data.parentProcessId } });
    if (!parent || parent.assessmentId !== data.assessmentId) {
      return { error: "The parent process must belong to this assessment.", success: false };
    }
    if (data.processId) {
      const descendants = await collectDescendantIds(data.processId);
      if (descendants.has(data.parentProcessId)) {
        return { error: "That would create a loop: the chosen parent already sits underneath this process.", success: false };
      }
    }
  }

  await upsertProcess({
    id: data.processId || null,
    assessmentId: data.assessmentId,
    parentProcessId: data.parentProcessId || null,
    stage: data.stage,
    name: data.name,
    description: data.description,
    isIncluded: data.isIncluded !== "off",
    allocationMethod: data.allocationMethod,
    allocationPercent: data.allocationMethod === LcaAllocationMethod.MANUAL ? data.allocationPercent ?? "100" : "100",
    allocationRationale: data.allocationRationale,
    allocationBasisDescription: data.allocationBasisDescription,
    geography: data.geography,
    notes: data.notes,
    actorUserId: check.actor!.id,
  });

  revalidatePath(`/assessments/${data.assessmentId}`, "layout");
  return { error: null, success: true, message: "Saved." };
}

async function collectDescendantIds(processId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let frontier = [processId];
  while (frontier.length > 0) {
    const children = await prisma.lcaProcess.findMany({
      where: { parentProcessId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((c) => c.id).filter((cid) => !ids.has(cid));
    for (const cid of frontier) ids.add(cid);
  }
  return ids;
}

export async function deleteProcessAction(formData: FormData): Promise<void> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const processId = String(formData.get("processId") ?? "");
  const check = await guard(assessmentId);
  if (check.error || !processId) return;

  await deleteProcess(processId, check.actor!.id);
  revalidatePath(`/assessments/${assessmentId}`, "layout");
}

const outputSchema = z.object({
  assessmentId: z.string().min(1),
  processId: z.string().min(1),
  outputId: z.string().optional(),
  name: z.string().min(1, "Name the output."),
  isAssessedProduct: z.string().optional(),
  massValue: z.string().optional(),
  massUnit: z.string().optional(),
  physicalValue: z.string().optional(),
  physicalUnit: z.string().optional(),
  economicValue: z.string().optional(),
  economicCurrency: z.string().optional(),
  notes: z.string().optional(),
});

export async function saveProcessOutputAction(
  _prev: AssessmentFormState,
  formData: FormData,
): Promise<AssessmentFormState> {
  const parsed = outputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  const check = await guard(data.assessmentId);
  if (check.error) return { error: check.error, success: false };

  await upsertProcessOutput({
    id: data.outputId || null,
    processId: data.processId,
    assessmentId: data.assessmentId,
    name: data.name,
    isAssessedProduct: data.isAssessedProduct === "on",
    massValue: data.massValue,
    massUnit: data.massUnit,
    physicalValue: data.physicalValue,
    physicalUnit: data.physicalUnit,
    economicValue: data.economicValue,
    economicCurrency: data.economicCurrency,
    notes: data.notes,
    actorUserId: check.actor!.id,
  });

  revalidatePath(`/assessments/${data.assessmentId}`, "layout");
  return { error: null, success: true, message: "Co-product saved. The allocation split is derived from these outputs." };
}

export async function deleteProcessOutputAction(formData: FormData): Promise<void> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const outputId = String(formData.get("outputId") ?? "");
  const check = await guard(assessmentId);
  if (check.error || !outputId) return;

  await deleteProcessOutput(outputId, assessmentId, check.actor!.id);
  revalidatePath(`/assessments/${assessmentId}`, "layout");
}

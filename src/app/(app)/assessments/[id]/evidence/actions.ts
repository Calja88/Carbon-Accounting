"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createEvidence, deleteEvidence, EvidenceError, MAX_EVIDENCE_BYTES } from "@/lib/lca/evidence-service";
import { checkCanEditAssessment, getLcaActor } from "@/lib/lca/permissions";
import type { AssessmentFormState } from "@/lib/lca/form-state";


export async function uploadEvidenceAction(
  _prev: AssessmentFormState,
  formData: FormData,
): Promise<AssessmentFormState> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const actor = await getLcaActor();
  const assessment = await prisma.lcaAssessment.findUnique({ where: { id: assessmentId } });
  if (!assessment) return { error: "That assessment no longer exists.", success: false };

  const permission = checkCanEditAssessment(actor, assessment.status);
  if (!permission.ok) return { error: permission.reason, success: false };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Give the evidence a title.", success: false };

  const file = formData.get("file");
  const externalUrl = String(formData.get("externalUrl") ?? "").trim();

  let filePayload: { fileName: string; mimeType: string; bytes: Buffer } | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_EVIDENCE_BYTES) {
      return {
        error: `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is ${MAX_EVIDENCE_BYTES / (1024 * 1024)} MB — link to it instead, or upload a smaller extract.`,
        success: false,
      };
    }
    filePayload = {
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes: Buffer.from(await file.arrayBuffer()),
    };
  }

  try {
    await createEvidence({
      assessmentId,
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      actorUserId: actor!.id,
      externalUrl: externalUrl || null,
      file: filePayload,
      processId: String(formData.get("processId") ?? "") || null,
      inventoryItemId: String(formData.get("inventoryItemId") ?? "") || null,
      supplierPcfId: String(formData.get("supplierPcfId") ?? "") || null,
      assumptionId: String(formData.get("assumptionId") ?? "") || null,
      exclusionId: String(formData.get("exclusionId") ?? "") || null,
      verificationId: String(formData.get("verificationId") ?? "") || null,
    });
  } catch (error) {
    if (error instanceof EvidenceError) return { error: error.message, success: false };
    throw error;
  }

  revalidatePath(`/assessments/${assessmentId}`, "layout");
  return { error: null, success: true, message: "Evidence attached." };
}

export async function deleteEvidenceAction(formData: FormData): Promise<void> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const evidenceId = String(formData.get("evidenceId") ?? "");
  const actor = await getLcaActor();
  const assessment = await prisma.lcaAssessment.findUnique({ where: { id: assessmentId } });
  if (!assessment) return;

  const permission = checkCanEditAssessment(actor, assessment.status);
  if (!permission.ok || !evidenceId) return;

  await deleteEvidence(evidenceId, actor!.id);
  revalidatePath(`/assessments/${assessmentId}`, "layout");
}

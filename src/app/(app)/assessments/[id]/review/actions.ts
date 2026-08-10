"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { LcaAssuranceType } from "@prisma/client";
import { recordVerification, deleteVerification } from "@/lib/lca/registers-service";
import { checkCanApprove, getLcaContext } from "@/lib/lca/permissions";
import type { AssessmentFormState } from "@/lib/lca/form-state";


const verificationSchema = z.object({
  assessmentId: z.string().min(1),
  organisation: z.string().min(1, "Name the verifying organisation."),
  verifierName: z.string().min(1, "Name the verifier."),
  verificationDate: z.string().min(1, "Record the verification date."),
  assuranceType: z.enum(LcaAssuranceType),
  scopeOfVerification: z.string().min(1, "Record what the verification covered."),
  statementReference: z.string().optional(),
  statementUrl: z.string().optional(),
  conclusion: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * Records what an external verifier concluded. The platform never generates
 * this: it stores a third party's statement, attributed to them, and the
 * assessment's status cannot claim "verified" until such a record exists.
 */
export async function recordVerificationAction(
  _prev: AssessmentFormState,
  formData: FormData,
): Promise<AssessmentFormState> {
  const context = await getLcaContext();
  const permission = checkCanApprove(context);
  if (!permission.ok) return { error: permission.reason, success: false };

  const parsed = verificationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  if (data.assuranceType === LcaAssuranceType.NONE) {
    return { error: "Choose the kind of review or assurance that was actually carried out.", success: false };
  }
  if (data.statementUrl?.trim() && !/^https?:\/\//i.test(data.statementUrl)) {
    return { error: "The statement link must be an http or https URL.", success: false };
  }

  await recordVerification(context!, {
    assessmentId: data.assessmentId,
    organisation: data.organisation,
    verifierName: data.verifierName,
    verificationDate: new Date(data.verificationDate),
    assuranceType: data.assuranceType,
    scopeOfVerification: data.scopeOfVerification,
    statementReference: data.statementReference,
    statementUrl: data.statementUrl,
    conclusion: data.conclusion,
    notes: data.notes,
    actorUserId: context!.userId,
  });

  revalidatePath(`/assessments/${data.assessmentId}`, "layout");
  return { error: null, success: true, message: "Verification recorded." };
}

export async function deleteVerificationAction(formData: FormData): Promise<void> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const verificationId = String(formData.get("verificationId") ?? "");
  const context = await getLcaContext();
  const permission = checkCanApprove(context);
  if (!permission.ok || !verificationId) return;

  await deleteVerification(context!, verificationId, context!.userId);
  revalidatePath(`/assessments/${assessmentId}`, "layout");
}

"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  CompetenceEvidenceError,
  submitCompetenceEvidence,
  verifyCompetenceEvidence,
  rejectCompetenceEvidence,
} from "@/lib/ems/competence/evidence-service";
import {
  CompetenceAssessmentError,
  createCompetenceAssessment,
  completeCompetenceAssessment,
} from "@/lib/ems/competence/assessment-service";
import type { CompetenceEvidenceType, CompetenceAssessmentOutcome } from "@prisma/client";
import {
  submitCompetenceEvidenceFormSchema,
  rejectCompetenceEvidenceFormSchema,
  createCompetenceAssessmentFormSchema,
  completeCompetenceAssessmentFormSchema,
} from "@/lib/ems/competence/evidence-schemas";

export interface CompetenceEvidenceActionState {
  error: string | null;
  message: string | null;
}

const emptyState: CompetenceEvidenceActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation or scope.";
  if (error instanceof CompetenceEvidenceError) return error.message;
  if (error instanceof CompetenceAssessmentError) return error.message;
  throw error;
}

function revalidateAssignment(assignmentId: string, personId?: string) {
  revalidatePath(`/ems/competence/assignments/${assignmentId}`);
  revalidatePath("/ems/competence/assignments");
  revalidatePath("/ems/competence/gaps");
  revalidatePath("/ems/competence/expiry");
  if (personId) revalidatePath(`/ems/competence/people/${personId}`);
}

export async function submitCompetenceEvidenceAction(
  _previous: CompetenceEvidenceActionState,
  formData: FormData,
): Promise<CompetenceEvidenceActionState> {
  try {
    const context = await requireOrganisationContext();
    const assignmentId = String(formData.get("assignmentId") ?? "");
    const file = formData.get("file");
    if (!assignmentId) return { ...emptyState, error: "Choose an assignment." };
    if (!(file instanceof File) || file.size === 0) return { ...emptyState, error: "Choose a file to upload." };
    const parsed = submitCompetenceEvidenceFormSchema.safeParse({
      evidenceType: formData.get("evidenceType"),
      issuedDate: formData.get("issuedDate"),
      expiryDate: formData.get("expiryDate"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the evidence details." };
    const bytes = Buffer.from(await file.arrayBuffer());
    await submitCompetenceEvidence(context, {
      assignmentId,
      evidenceType: parsed.data.evidenceType as CompetenceEvidenceType,
      issuedDate: parsed.data.issuedDate ? new Date(parsed.data.issuedDate) : null,
      expiryDate: parsed.data.expiryDate ? new Date(parsed.data.expiryDate) : null,
      file: { fileName: file.name, mimeType: file.type || "application/octet-stream", bytes },
      actorUserId: context.userId,
    });
    revalidateAssignment(assignmentId);
    return { ...emptyState, message: "Evidence submitted." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function verifyCompetenceEvidenceAction(
  _previous: CompetenceEvidenceActionState,
  formData: FormData,
): Promise<CompetenceEvidenceActionState> {
  try {
    const context = await requireOrganisationContext();
    const evidenceId = String(formData.get("evidenceId") ?? "");
    const assignmentId = String(formData.get("assignmentId") ?? "");
    if (!evidenceId) return { ...emptyState, error: "Choose evidence to verify." };
    await verifyCompetenceEvidence(context, evidenceId, context.userId);
    revalidateAssignment(assignmentId);
    return { ...emptyState, message: "Evidence verified." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function rejectCompetenceEvidenceAction(
  _previous: CompetenceEvidenceActionState,
  formData: FormData,
): Promise<CompetenceEvidenceActionState> {
  try {
    const context = await requireOrganisationContext();
    const evidenceId = String(formData.get("evidenceId") ?? "");
    const assignmentId = String(formData.get("assignmentId") ?? "");
    const parsed = rejectCompetenceEvidenceFormSchema.safeParse({ reason: formData.get("reason") });
    if (!evidenceId || !parsed.success) {
      return { ...emptyState, error: parsed.success ? "Choose evidence to reject." : parsed.error.issues[0]?.message ?? "Enter a reason." };
    }
    await rejectCompetenceEvidence(context, evidenceId, parsed.data.reason, context.userId);
    revalidateAssignment(assignmentId);
    return { ...emptyState, message: "Evidence rejected." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createCompetenceAssessmentAction(
  _previous: CompetenceEvidenceActionState,
  formData: FormData,
): Promise<CompetenceEvidenceActionState> {
  try {
    const context = await requireOrganisationContext();
    const assignmentId = String(formData.get("assignmentId") ?? "");
    const parsed = createCompetenceAssessmentFormSchema.safeParse({
      method: formData.get("method"),
      criteria: formData.get("criteria"),
    });
    if (!assignmentId || !parsed.success) {
      return { ...emptyState, error: parsed.success ? "Choose an assignment." : parsed.error.issues[0]?.message ?? "Check the assessment details." };
    }
    await createCompetenceAssessment(context, {
      assignmentId,
      method: parsed.data.method,
      criteria: parsed.data.criteria || null,
      actorUserId: context.userId,
    });
    revalidateAssignment(assignmentId);
    return { ...emptyState, message: "Assessment drafted." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function completeCompetenceAssessmentAction(
  _previous: CompetenceEvidenceActionState,
  formData: FormData,
): Promise<CompetenceEvidenceActionState> {
  try {
    const context = await requireOrganisationContext();
    const assessmentId = String(formData.get("assessmentId") ?? "");
    const assignmentId = String(formData.get("assignmentId") ?? "");
    const parsed = completeCompetenceAssessmentFormSchema.safeParse({
      outcome: formData.get("outcome"),
      rationale: formData.get("rationale"),
      reassessmentDueDate: formData.get("reassessmentDueDate"),
    });
    if (!assessmentId || !parsed.success) {
      return { ...emptyState, error: parsed.success ? "Choose an assessment." : parsed.error.issues[0]?.message ?? "Check the outcome." };
    }
    await completeCompetenceAssessment(context, assessmentId, {
      assessorUserId: context.userId,
      outcome: parsed.data.outcome as CompetenceAssessmentOutcome,
      rationale: parsed.data.rationale || null,
      reassessmentDueDate: parsed.data.reassessmentDueDate ? new Date(parsed.data.reassessmentDueDate) : null,
      actorUserId: context.userId,
    });
    revalidateAssignment(assignmentId);
    return { ...emptyState, message: "Assessment completed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

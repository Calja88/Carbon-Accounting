"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  ComplianceEvaluationError,
  createComplianceEvaluationProgramme,
  createComplianceEvaluation,
  startComplianceEvaluation,
  recordComplianceEvaluationItemResult,
  requestComplianceEvaluationFindingLink,
  completeComplianceEvaluation,
  issueComplianceEvaluation,
  closeComplianceEvaluationProgramme,
  type ComplianceEvaluationScopeInput,
} from "@/lib/ems/legal/evaluation-service";
import {
  createComplianceEvaluationProgrammeFormSchema,
  createComplianceEvaluationFormSchema,
  recordComplianceEvaluationItemResultFormSchema,
  requestComplianceEvaluationFindingLinkFormSchema,
} from "@/lib/ems/legal/evaluation-schemas";

export interface EvaluationActionState {
  error: string | null;
  message: string | null;
}

const emptyState: EvaluationActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation or scope.";
  if (error instanceof ComplianceEvaluationError) return error.message;
  throw error;
}

function revalidateEvaluations() {
  revalidatePath("/ems/legal/evaluations");
}

export async function createComplianceEvaluationProgrammeAction(
  _previous: EvaluationActionState,
  formData: FormData,
): Promise<EvaluationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createComplianceEvaluationProgrammeFormSchema.safeParse({
      name: formData.get("name"),
      description: formData.get("description"),
      periodStart: formData.get("periodStart"),
      periodEnd: formData.get("periodEnd"),
      recurrence: formData.get("recurrence"),
      leadMembershipId: formData.get("leadMembershipId"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the programme details." };
    await createComplianceEvaluationProgramme(context, {
      name: parsed.data.name,
      description: parsed.data.description || null,
      periodStart: parsed.data.periodStart,
      periodEnd: parsed.data.periodEnd,
      recurrence: parsed.data.recurrence || null,
      leadMembershipId: parsed.data.leadMembershipId,
      actorUserId: context.userId,
    });
    revalidateEvaluations();
    return { ...emptyState, message: "Evaluation programme created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

function scopesFromForm(parsed: { entityIds: string[]; siteIds: string[] }): ComplianceEvaluationScopeInput[] {
  return [...parsed.entityIds.map((entityId) => ({ entityId })), ...parsed.siteIds.map((siteId) => ({ siteId }))];
}

export async function createComplianceEvaluationAction(
  _previous: EvaluationActionState,
  formData: FormData,
): Promise<EvaluationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createComplianceEvaluationFormSchema.safeParse({
      programmeId: formData.get("programmeId"),
      periodStart: formData.get("periodStart"),
      periodEnd: formData.get("periodEnd"),
      leadMembershipId: formData.get("leadMembershipId"),
      entityIds: formData.getAll("entityIds").map(String),
      siteIds: formData.getAll("siteIds").map(String),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the evaluation details." };
    await createComplianceEvaluation(context, {
      programmeId: parsed.data.programmeId,
      periodStart: parsed.data.periodStart,
      periodEnd: parsed.data.periodEnd,
      leadMembershipId: parsed.data.leadMembershipId,
      scopes: scopesFromForm(parsed.data),
      actorUserId: context.userId,
    });
    revalidateEvaluations();
    return { ...emptyState, message: "Evaluation cycle created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function startComplianceEvaluationAction(
  _previous: EvaluationActionState,
  formData: FormData,
): Promise<EvaluationActionState> {
  try {
    const context = await requireOrganisationContext();
    const evaluationId = String(formData.get("evaluationId") ?? "");
    if (!evaluationId) return { ...emptyState, error: "Choose an evaluation." };
    await startComplianceEvaluation(context, evaluationId, context.userId);
    revalidateEvaluations();
    return { ...emptyState, message: "Evaluation started." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function recordComplianceEvaluationItemResultAction(
  _previous: EvaluationActionState,
  formData: FormData,
): Promise<EvaluationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = recordComplianceEvaluationItemResultFormSchema.safeParse({
      evaluationItemId: formData.get("evaluationItemId"),
      status: formData.get("status"),
      rationale: formData.get("rationale"),
      followUpDate: formData.get("followUpDate") || undefined,
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the outcome details." };
    await recordComplianceEvaluationItemResult(context, parsed.data.evaluationItemId, {
      status: parsed.data.status,
      rationale: parsed.data.rationale,
      followUpDate: parsed.data.followUpDate ?? null,
      actorUserId: context.userId,
    });
    revalidateEvaluations();
    return { ...emptyState, message: "Outcome recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function requestComplianceEvaluationFindingLinkAction(
  _previous: EvaluationActionState,
  formData: FormData,
): Promise<EvaluationActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = requestComplianceEvaluationFindingLinkFormSchema.safeParse({
      evaluationItemId: formData.get("evaluationItemId"),
      linkType: formData.get("linkType"),
      referenceNote: formData.get("referenceNote"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the finding-link details." };
    await requestComplianceEvaluationFindingLink(context, parsed.data.evaluationItemId, {
      linkType: parsed.data.linkType,
      referenceNote: parsed.data.referenceNote,
      actorUserId: context.userId,
    });
    revalidateEvaluations();
    return { ...emptyState, message: "Finding link requested." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function completeComplianceEvaluationAction(
  _previous: EvaluationActionState,
  formData: FormData,
): Promise<EvaluationActionState> {
  try {
    const context = await requireOrganisationContext();
    const evaluationId = String(formData.get("evaluationId") ?? "");
    if (!evaluationId) return { ...emptyState, error: "Choose an evaluation." };
    await completeComplianceEvaluation(context, evaluationId, context.userId);
    revalidateEvaluations();
    return { ...emptyState, message: "Evaluation completed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function closeComplianceEvaluationProgrammeAction(
  _previous: EvaluationActionState,
  formData: FormData,
): Promise<EvaluationActionState> {
  try {
    const context = await requireOrganisationContext();
    const programmeId = String(formData.get("programmeId") ?? "");
    if (!programmeId) return { ...emptyState, error: "Choose a programme." };
    await closeComplianceEvaluationProgramme(context, programmeId, context.userId);
    revalidateEvaluations();
    return { ...emptyState, message: "Evaluation programme closed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function issueComplianceEvaluationAction(
  _previous: EvaluationActionState,
  formData: FormData,
): Promise<EvaluationActionState> {
  try {
    const context = await requireOrganisationContext();
    const evaluationId = String(formData.get("evaluationId") ?? "");
    if (!evaluationId) return { ...emptyState, error: "Choose an evaluation." };
    await issueComplianceEvaluation(context, evaluationId, context.userId);
    revalidateEvaluations();
    return { ...emptyState, message: "Evaluation issued. The report is now frozen." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

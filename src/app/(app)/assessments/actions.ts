"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LcaAssessmentStatus, LcaBoundary, LcaLifecycleStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  changeStatus,
  cloneAssessment,
  createAssessment,
  issueVersion,
  supersedeWithRevision,
} from "@/lib/lca/assessment-service";
import { runCalculation } from "@/lib/lca/calculation-service";
import { checkStatusTransition } from "@/lib/lca/readiness-service";
import { recordAuditEvent, diffRecords } from "@/lib/lca/audit-service";
import { canEditLcaData, checkCanApprove, checkCanEditAssessment, getLcaContext } from "@/lib/lca/permissions";
import { requireAssessmentInScope } from "@/lib/repositories/lca-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import type { AssessmentFormState } from "@/lib/lca/form-state";


function fail(error: string): AssessmentFormState {
  return { error, success: false, message: null };
}

function ok(message?: string): AssessmentFormState {
  return { error: null, success: true, message: message ?? null };
}

/** Loads the assessment (tenant-scoped) and checks the actor may change it. */
async function guardEdit(assessmentId: string) {
  const context = await getLcaContext();
  if (!context) return { error: "You must be signed in." as const, context: null, assessment: null };
  let assessment;
  try {
    assessment = await requireAssessmentInScope(context, assessmentId);
  } catch (err) {
    if (err instanceof TenantOwnershipError) {
      return { error: "That assessment no longer exists." as const, context: null, assessment: null };
    }
    throw err;
  }
  const permission = checkCanEditAssessment(context, assessment.status);
  if (!permission.ok) return { error: permission.reason, context: null, assessment: null };
  return { error: null, context, assessment };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const createSchema = z.object({
  productVersionId: z.string().min(1, "Choose the product version being assessed."),
  entityId: z.string().min(1),
  reference: z.string().min(1, "Give the assessment a reference."),
  title: z.string().min(1, "Give the assessment a title."),
  boundary: z.enum(LcaBoundary),
  methodologyProfileId: z.string().optional(),
  ownerUserId: z.string().optional(),
});

export async function createAssessmentAction(
  _prev: AssessmentFormState,
  formData: FormData,
): Promise<AssessmentFormState> {
  const context = await getLcaContext();
  if (!canEditLcaData(context)) return fail("Your permissions do not allow creating assessments.");

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const data = parsed.data;

  const duplicate = await prisma.lcaAssessment.findFirst({
    where: { entityId: data.entityId, reference: data.reference },
  });
  if (duplicate) return fail(`An assessment with reference "${data.reference}" already exists for this operating unit.`);

  const assessment = await createAssessment(context!, {
    entityId: data.entityId,
    productVersionId: data.productVersionId,
    reference: data.reference,
    title: data.title,
    boundary: data.boundary,
    methodologyProfileId: data.methodologyProfileId || null,
    ownerUserId: data.ownerUserId || context?.userId || null,
    actorUserId: context!.userId,
  });

  revalidatePath("/assessments");
  redirect(`/assessments/${assessment.id}/goal-scope`);
}

// ---------------------------------------------------------------------------
// Goal and scope
// ---------------------------------------------------------------------------

const goalScopeSchema = z.object({
  assessmentId: z.string().min(1),
  title: z.string().min(1, "Give the assessment a title."),
  goal: z.string().optional(),
  intendedApplication: z.string().optional(),
  intendedAudience: z.string().optional(),
  comparativeAssertionDisclosed: z.string().optional(),
  scopeDescription: z.string().optional(),
  boundary: z.enum(LcaBoundary),
  boundaryNotes: z.string().optional(),
  includedStages: z.array(z.enum(LcaLifecycleStage)).optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  ownerUserId: z.string().optional(),
  methodologyProfileId: z.string().optional(),
  methodologyNotes: z.string().optional(),
  functionalUnitDescription: z.string().optional(),
  functionalUnitQuantity: z.string().optional(),
  functionalUnitUnit: z.string().optional(),
  isDeclaredUnit: z.string().optional(),
  declaredUnitDescription: z.string().optional(),
  referenceFlowDescription: z.string().optional(),
  referenceFlowQuantity: z.string().optional(),
  referenceFlowUnit: z.string().optional(),
  modelledOutputQuantity: z.string().optional(),
  modelledOutputUnit: z.string().optional(),
  modelledOutputDescription: z.string().optional(),
  usePhaseLifetimeYears: z.string().optional(),
  usePhaseAssumptions: z.string().optional(),
  completenessNotes: z.string().optional(),
  limitations: z.string().optional(),
  interpretation: z.string().optional(),
});

export async function saveGoalScopeAction(
  _prev: AssessmentFormState,
  formData: FormData,
): Promise<AssessmentFormState> {
  const raw = Object.fromEntries(formData);
  const includedStages = formData.getAll("includedStages").map(String);

  const parsed = goalScopeSchema.safeParse({ ...raw, includedStages });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const data = parsed.data;

  const guard = await guardEdit(data.assessmentId);
  if (guard.error || !guard.assessment) return fail(guard.error ?? "That assessment no longer exists.");

  const numeric = (value: string | undefined, fallback: string) => {
    if (!value?.trim()) return fallback;
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? value.trim() : fallback;
  };

  const before = guard.assessment;
  const update = {
    title: data.title,
    goal: data.goal || null,
    intendedApplication: data.intendedApplication || null,
    intendedAudience: data.intendedAudience || null,
    comparativeAssertionDisclosed: data.comparativeAssertionDisclosed === "on",
    scopeDescription: data.scopeDescription || null,
    boundary: data.boundary,
    boundaryNotes: data.boundaryNotes || null,
    includedStages: (data.includedStages ?? []) as LcaLifecycleStage[],
    periodStart: data.periodStart ? new Date(data.periodStart) : null,
    periodEnd: data.periodEnd ? new Date(data.periodEnd) : null,
    ownerUserId: data.ownerUserId || null,
    methodologyProfileId: data.methodologyProfileId || null,
    methodologyNotes: data.methodologyNotes || null,
    functionalUnitDescription: data.functionalUnitDescription || null,
    functionalUnitQuantity: numeric(data.functionalUnitQuantity, "1"),
    functionalUnitUnit: data.functionalUnitUnit || null,
    isDeclaredUnit: data.isDeclaredUnit === "on",
    declaredUnitDescription: data.declaredUnitDescription || null,
    referenceFlowDescription: data.referenceFlowDescription || null,
    referenceFlowQuantity: numeric(data.referenceFlowQuantity, "1"),
    referenceFlowUnit: data.referenceFlowUnit || null,
    modelledOutputQuantity: numeric(data.modelledOutputQuantity, "1"),
    modelledOutputUnit: data.modelledOutputUnit || null,
    modelledOutputDescription: data.modelledOutputDescription || null,
    usePhaseLifetimeYears: data.usePhaseLifetimeYears?.trim() || null,
    usePhaseAssumptions: data.usePhaseAssumptions || null,
    completenessNotes: data.completenessNotes || null,
    limitations: data.limitations || null,
    interpretation: data.interpretation || null,
  };

  await prisma.lcaAssessment.update({ where: { id: data.assessmentId }, data: update });

  const methodologyChanged = before.methodologyProfileId !== update.methodologyProfileId;
  const diff = diffRecords(
    before as unknown as Record<string, unknown>,
    update as unknown as Record<string, unknown>,
    ["title", "goal", "boundary", "functionalUnitDescription", "functionalUnitUnit", "modelledOutputQuantity", "periodStart", "periodEnd", "methodologyProfileId"],
  );

  await recordAuditEvent({
    assessmentId: data.assessmentId,
    entityType: methodologyChanged ? "methodology" : "assessment",
    entityId: data.assessmentId,
    action: "updated",
    actorUserId: guard.context.userId,
    summary: methodologyChanged
      ? "Methodology profile changed. Every figure in this assessment is calculated under the new profile's rules from the next calculation run."
      : diff.changedFields.length > 0
        ? `Goal and scope updated: ${diff.changedFields.join(", ")}.`
        : "Goal and scope saved with no material change.",
    before: diff.before,
    after: diff.after,
  });

  revalidatePath(`/assessments/${data.assessmentId}`, "layout");
  return ok("Saved. Run the calculation again so the results reflect the change.");
}

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------

export async function runCalculationAction(formData: FormData): Promise<void> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  if (!assessmentId) return;

  const context = await getLcaContext();
  if (!context || !canEditLcaData(context)) return;
  await requireAssessmentInScope(context, assessmentId);

  await runCalculation({ assessmentId, actorUserId: context.userId });

  revalidatePath(`/assessments/${assessmentId}`, "layout");
}

// ---------------------------------------------------------------------------
// Status workflow
// ---------------------------------------------------------------------------

export async function changeStatusAction(
  _prev: AssessmentFormState,
  formData: FormData,
): Promise<AssessmentFormState> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const to = String(formData.get("status") ?? "") as LcaAssessmentStatus;
  const note = String(formData.get("note") ?? "").trim() || null;

  const context = await getLcaContext();
  const permission = checkCanApprove(context);
  if (!permission.ok) return fail(permission.reason);

  let assessment;
  try {
    assessment = await requireAssessmentInScope(context!, assessmentId);
  } catch (err) {
    if (err instanceof TenantOwnershipError) return fail("That assessment no longer exists.");
    throw err;
  }

  const check = await checkStatusTransition(assessmentId, assessment.status, to);
  if (!check.allowed) return fail(check.reason ?? "That status change is not allowed.");

  await changeStatus(context!, assessmentId, to, context!.userId, note);

  revalidatePath(`/assessments/${assessmentId}`, "layout");
  return ok(`Status moved to ${to.replace(/_/g, " ").toLowerCase()}.`);
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export async function issueVersionAction(
  _prev: AssessmentFormState,
  formData: FormData,
): Promise<AssessmentFormState> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const label = String(formData.get("label") ?? "").trim() || null;

  const context = await getLcaContext();
  const permission = checkCanApprove(context);
  if (!permission.ok) return fail(permission.reason);

  const version = await issueVersion(context!, { assessmentId, label, actorUserId: context!.userId });

  revalidatePath(`/assessments/${assessmentId}`, "layout");
  return ok(`Version ${version.version} issued and frozen. It will not change if the assessment is edited later.`);
}

export async function createRevisionAction(
  _prev: AssessmentFormState,
  formData: FormData,
): Promise<AssessmentFormState> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const reference = String(formData.get("reference") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();

  const context = await getLcaContext();
  const permission = checkCanApprove(context);
  if (!permission.ok) return fail(permission.reason);
  if (!reference || !title) return fail("Give the revision a reference and a title.");

  let source;
  try {
    source = await requireAssessmentInScope(context!, assessmentId);
  } catch (err) {
    if (err instanceof TenantOwnershipError) return fail("That assessment no longer exists.");
    throw err;
  }

  const duplicate = await prisma.lcaAssessment.findFirst({ where: { entityId: source.entityId, reference } });
  if (duplicate) return fail(`An assessment with reference "${reference}" already exists.`);

  const revision = await cloneAssessment(context!, {
    sourceAssessmentId: assessmentId,
    actorUserId: context!.userId,
    reference,
    title,
    kind: "revision",
  });

  await supersedeWithRevision(context!, assessmentId, revision.id, context!.userId);

  revalidatePath("/assessments");
  redirect(`/assessments/${revision.id}`);
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export async function createScenarioAction(
  _prev: AssessmentFormState,
  formData: FormData,
): Promise<AssessmentFormState> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const reference = String(formData.get("reference") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("scenarioDescription") ?? "").trim() || null;

  const context = await getLcaContext();
  if (!canEditLcaData(context)) return fail("Your permissions do not allow creating scenarios.");
  if (!reference || !title) return fail("Give the scenario a reference and a name.");

  let source;
  try {
    source = await requireAssessmentInScope(context!, assessmentId);
  } catch (err) {
    if (err instanceof TenantOwnershipError) return fail("That assessment no longer exists.");
    throw err;
  }

  const duplicate = await prisma.lcaAssessment.findFirst({ where: { entityId: source.entityId, reference } });
  if (duplicate) return fail(`An assessment or scenario with reference "${reference}" already exists.`);

  const scenario = await cloneAssessment(context!, {
    sourceAssessmentId: assessmentId,
    actorUserId: context!.userId,
    reference,
    title,
    kind: "scenario",
    scenarioDescription: description,
  });

  // A scenario is only useful once it has a figure to compare, and the copy is
  // identical at this point, so calculate it immediately.
  await runCalculation({ assessmentId: scenario.id, actorUserId: context!.userId, notes: "Initial run of a newly created scenario." });

  revalidatePath(`/assessments/${assessmentId}/scenarios`);
  return ok(`Scenario "${title}" created as an independent copy. Editing it cannot change the baseline.`);
}

export async function recalculateScenarioAction(formData: FormData): Promise<void> {
  const scenarioId = String(formData.get("scenarioId") ?? "");
  const baselineId = String(formData.get("baselineId") ?? "");
  if (!scenarioId) return;

  const context = await getLcaContext();
  if (!context || !canEditLcaData(context)) return;
  await requireAssessmentInScope(context, scenarioId);

  await runCalculation({ assessmentId: scenarioId, actorUserId: context.userId });
  revalidatePath(`/assessments/${baselineId}/scenarios`);
}

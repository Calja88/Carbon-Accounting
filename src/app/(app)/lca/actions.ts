"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  DataOrigin,
  LcaAllocationMethod,
  LcaBoundaryType,
  LcaDataType,
  LcaFindingSeverity,
  LcaFindingSource,
  LcaFlowDirection,
  LcaFlowType,
  LcaProjectStatus,
  LcaReviewStatus,
  LcaStageKey,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AiUnavailableError, carbonAI, resolveAiActor } from "@/lib/ai";
import { AiAuthorizationError, assertLcaProjectInScope } from "@/lib/ai/authorization";
import { createLcaProject, getLcaProject, runAndStoreLcaResult, runLcaCalculation, scenarioOverridesFor } from "@/lib/lca/service";
import { compareScenario, runScenario } from "@/lib/lca/scenarios";
import { toCalculationInput } from "@/lib/lca/service";
import { calculateLca } from "@/lib/lca/calc";
import { stagesForBoundary } from "@/lib/lca/stages";

/**
 * Server actions for the LCA workspace.
 *
 * Two rules run through all of them:
 *
 *  - Authorization is re-checked from the session on every call. An id in a
 *    form field is a request, never an entitlement.
 *  - Methodological choices are stored because a person submitted them.
 *    Nothing here lets AI write to a study; the copilot returns suggestions,
 *    and a suggestion only becomes part of the study when someone submits it
 *    through one of these forms.
 */

async function requireProjectAccess(projectId: string) {
  const actor = await resolveAiActor();
  if (!actor) throw new AiAuthorizationError("You must be signed in.");
  await assertLcaProjectInScope(actor, projectId);
  return actor;
}

// --- Project ---------------------------------------------------------------

export interface CreateProjectState {
  error: string | null;
}

const createSchema = z.object({
  name: z.string().min(1, "Give the study a name."),
  productName: z.string().min(1, "Name the product being assessed."),
  description: z.string().max(2000).optional(),
  entityId: z.string().optional(),
  siteId: z.string().optional(),
  boundaryType: z.enum(["CRADLE_TO_GATE", "CRADLE_TO_GRAVE", "GATE_TO_GATE", "CRADLE_TO_CRADLE", "OTHER"]),
});

export async function createLcaProjectAction(_prev: CreateProjectState, formData: FormData): Promise<CreateProjectState> {
  const actor = await resolveAiActor();
  if (!actor) return { error: "You must be signed in." };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const entityId = parsed.data.entityId?.trim() || null;
  if (entityId && !actor.entityIds.includes(entityId)) {
    return { error: "That entity isn't available to you." };
  }
  const siteId = parsed.data.siteId?.trim() || null;
  if (siteId && !actor.siteIds.includes(siteId)) {
    return { error: "That site isn't available to you." };
  }

  const project = await createLcaProject({
    name: parsed.data.name,
    productName: parsed.data.productName,
    description: parsed.data.description || null,
    entityId,
    siteId,
    boundaryType: parsed.data.boundaryType as LcaBoundaryType,
    createdByUserId: actor.userId,
  });

  revalidatePath("/lca");
  redirect(`/lca/${project.id}/goal-scope`);
}

// --- Goal and scope --------------------------------------------------------

export interface GoalScopeState {
  error: string | null;
  saved: boolean;
}

const goalScopeSchema = z.object({
  projectId: z.string().min(1),
  purpose: z.string().max(2000).optional(),
  intendedApplication: z.string().max(2000).optional(),
  intendedAudience: z.string().max(1000).optional(),
  functionalUnitDescription: z.string().max(1000).optional(),
  functionalUnitQuantity: z.string().optional(),
  functionalUnitUnit: z.string().max(60).optional(),
  referenceFlowDescription: z.string().max(1000).optional(),
  referenceFlowQuantity: z.string().optional(),
  referenceFlowUnit: z.string().max(60).optional(),
  systemBoundaryType: z.enum(["CRADLE_TO_GATE", "CRADLE_TO_GRAVE", "GATE_TO_GATE", "CRADLE_TO_CRADLE", "OTHER"]),
  systemBoundaryNotes: z.string().max(2000).optional(),
  geography: z.string().max(300).optional(),
  timePeriodStart: z.string().optional(),
  timePeriodEnd: z.string().optional(),
  technologyDescription: z.string().max(2000).optional(),
  cutOffCriteria: z.string().max(2000).optional(),
  exclusions: z.string().max(2000).optional(),
  allocationMethod: z.enum([
    "NOT_APPLICABLE",
    "NONE_SUBDIVISION",
    "MASS",
    "ECONOMIC",
    "ENERGY",
    "PHYSICAL_CAUSALITY",
    "SYSTEM_EXPANSION",
    "OTHER",
  ]),
  allocationRationale: z.string().max(2000).optional(),
  impactCategories: z.string().max(1000).optional(),
  dataQualityRequirements: z.string().max(2000).optional(),
  limitations: z.string().max(2000).optional(),
  criticalReviewStatus: z.enum(["NOT_REVIEWED", "INTERNAL_REVIEW", "EXTERNAL_REVIEW", "PANEL_REVIEW"]),
  criticalReviewNotes: z.string().max(2000).optional(),
});

function optionalNumber(value: string | undefined): number | null {
  if (!value || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function optionalDate(value: string | undefined): Date | null {
  if (!value || value.trim() === "") return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Saves goal and scope. `confirm` is a separate, explicit act: a methodological
 * choice isn't settled because a field has text in it, it's settled because
 * someone said so — and that person and time are recorded.
 */
export async function saveGoalScopeAction(_prev: GoalScopeState, formData: FormData): Promise<GoalScopeState> {
  const parsed = goalScopeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", saved: false };

  const data = parsed.data;
  let actor;
  try {
    actor = await requireProjectAccess(data.projectId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Not allowed.", saved: false };
  }

  const confirming = formData.get("confirm") !== null;

  const impactCategories = (data.impactCategories ?? "")
    .split(/\r?\n|;/)
    .map((s) => s.trim())
    .filter(Boolean);

  const payload = {
    purpose: data.purpose || null,
    intendedApplication: data.intendedApplication || null,
    intendedAudience: data.intendedAudience || null,
    comparativeAssertion: formData.get("comparativeAssertion") !== null,
    functionalUnitDescription: data.functionalUnitDescription || null,
    functionalUnitQuantity: optionalNumber(data.functionalUnitQuantity),
    functionalUnitUnit: data.functionalUnitUnit || null,
    referenceFlowDescription: data.referenceFlowDescription || null,
    referenceFlowQuantity: optionalNumber(data.referenceFlowQuantity),
    referenceFlowUnit: data.referenceFlowUnit || null,
    systemBoundaryType: data.systemBoundaryType as LcaBoundaryType,
    systemBoundaryNotes: data.systemBoundaryNotes || null,
    geography: data.geography || null,
    timePeriodStart: optionalDate(data.timePeriodStart),
    timePeriodEnd: optionalDate(data.timePeriodEnd),
    technologyDescription: data.technologyDescription || null,
    cutOffCriteria: data.cutOffCriteria || null,
    exclusions: data.exclusions || null,
    allocationMethod: data.allocationMethod as LcaAllocationMethod,
    allocationRationale: data.allocationRationale || null,
    impactCategories: impactCategories.length > 0 ? impactCategories : ["Climate change (GWP100, kgCO2e)"],
    dataQualityRequirements: data.dataQualityRequirements || null,
    limitations: data.limitations || null,
    criticalReviewStatus: data.criticalReviewStatus as LcaReviewStatus,
    criticalReviewNotes: data.criticalReviewNotes || null,
    ...(confirming ? { confirmedByUserId: actor.userId, confirmedAt: new Date() } : {}),
  };

  await prisma.lcaGoalScope.upsert({
    where: { projectId: data.projectId },
    update: payload,
    create: { projectId: data.projectId, ...payload },
  });

  await prisma.lcaProject.update({
    where: { id: data.projectId },
    data: { status: confirming ? LcaProjectStatus.IN_PROGRESS : undefined },
  });

  revalidatePath(`/lca/${data.projectId}`);
  revalidatePath(`/lca/${data.projectId}/goal-scope`);
  return { error: null, saved: true };
}

/** Re-seeds the stage skeleton when the declared boundary changes. */
export async function resyncStagesAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;
  await requireProjectAccess(projectId);

  const project = await prisma.lcaProject.findUnique({
    where: { id: projectId },
    include: { goalScope: true, stages: true },
  });
  if (!project?.goalScope?.systemBoundaryType) return;

  const wanted = stagesForBoundary(project.goalScope.systemBoundaryType);
  const existing = new Map(project.stages.map((s) => [s.key, s]));

  for (const stage of wanted) {
    const found = existing.get(stage.key);
    if (found) {
      // Only the boundary-driven inclusion is re-synced; a name or reason the
      // user has edited is left exactly as they left it.
      await prisma.lcaStage.update({
        where: { id: found.id },
        data: {
          included: stage.included,
          exclusionReason: stage.included ? null : found.exclusionReason ?? stage.exclusionReason,
        },
      });
    } else {
      await prisma.lcaStage.create({
        data: {
          projectId,
          key: stage.key,
          name: stage.name,
          description: stage.description,
          included: stage.included,
          exclusionReason: stage.exclusionReason,
          sortOrder: stage.sortOrder,
        },
      });
    }
  }

  revalidatePath(`/lca/${projectId}/boundary`);
}

// --- Stages and processes --------------------------------------------------

export async function updateStageAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const stageId = String(formData.get("stageId") ?? "");
  if (!projectId || !stageId) return;
  await requireProjectAccess(projectId);

  const included = formData.get("included") !== null;
  const exclusionReason = String(formData.get("exclusionReason") ?? "").trim();

  await prisma.lcaStage.update({
    where: { id: stageId },
    data: {
      name: String(formData.get("name") ?? "").trim() || undefined,
      included,
      // An exclusion without a reason is a hole in the study, so the default
      // says so rather than leaving it blank.
      exclusionReason: included ? null : exclusionReason || "No reason recorded yet.",
    },
  });

  revalidatePath(`/lca/${projectId}/boundary`);
  revalidatePath(`/lca/${projectId}`);
}

export async function addStageAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!projectId || !name) return;
  await requireProjectAccess(projectId);

  const last = await prisma.lcaStage.findFirst({ where: { projectId }, orderBy: { sortOrder: "desc" } });

  await prisma.lcaStage.create({
    data: {
      projectId,
      key: LcaStageKey.OTHER,
      name,
      description: String(formData.get("description") ?? "").trim() || null,
      included: true,
      sortOrder: (last?.sortOrder ?? 0) + 10,
    },
  });

  revalidatePath(`/lca/${projectId}/boundary`);
}

export async function addProcessAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const stageId = String(formData.get("stageId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!projectId || !stageId || !name) return;
  await requireProjectAccess(projectId);

  const last = await prisma.lcaProcess.findFirst({ where: { stageId }, orderBy: { sortOrder: "desc" } });

  await prisma.lcaProcess.create({
    data: {
      stageId,
      name,
      description: String(formData.get("description") ?? "").trim() || null,
      geography: String(formData.get("geography") ?? "").trim() || null,
      referenceYear: optionalNumber(String(formData.get("referenceYear") ?? "")) ?? null,
      sortOrder: (last?.sortOrder ?? 0) + 10,
    },
  });

  revalidatePath(`/lca/${projectId}/boundary`);
  revalidatePath(`/lca/${projectId}/inventory`);
}

export async function deleteProcessAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const processId = String(formData.get("processId") ?? "");
  if (!projectId || !processId) return;
  await requireProjectAccess(projectId);

  await prisma.lcaProcess.delete({ where: { id: processId } });
  revalidatePath(`/lca/${projectId}/boundary`);
  revalidatePath(`/lca/${projectId}/inventory`);
}

// --- Inventory flows -------------------------------------------------------

export interface FlowState {
  error: string | null;
  saved: boolean;
}

const flowSchema = z.object({
  projectId: z.string().min(1),
  processId: z.string().min(1),
  flowId: z.string().optional(),
  name: z.string().min(1, "Name the flow."),
  direction: z.enum(["INPUT", "OUTPUT"]),
  flowType: z.enum([
    "MATERIAL",
    "ENERGY",
    "FUEL",
    "ELECTRICITY",
    "WATER",
    "TRANSPORT",
    "WASTE",
    "EMISSION",
    "PRODUCT",
    "CO_PRODUCT",
  ]),
  quantity: z.coerce.number().min(0, "Quantity can't be negative."),
  unit: z.string().min(1, "Give the unit."),
  transportMassTonnes: z.string().optional(),
  transportDistanceKm: z.string().optional(),
  allocationPercent: z.coerce.number().min(0).max(100).default(100),
  dataSource: z.string().max(500).optional(),
  dataType: z.enum(["PRIMARY", "SECONDARY", ""]).optional(),
  geography: z.string().max(200).optional(),
  referenceYear: z.string().optional(),
  supplierName: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  dqReliability: z.string().optional(),
  dqCompleteness: z.string().optional(),
  dqTemporal: z.string().optional(),
  dqGeographical: z.string().optional(),
  dqTechnological: z.string().optional(),
});

function dqScore(value: string | undefined): number | null {
  if (!value || value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

export async function saveFlowAction(_prev: FlowState, formData: FormData): Promise<FlowState> {
  const parsed = flowSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", saved: false };

  const data = parsed.data;
  try {
    await requireProjectAccess(data.projectId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Not allowed.", saved: false };
  }

  const payload = {
    name: data.name,
    direction: data.direction as LcaFlowDirection,
    flowType: data.flowType as LcaFlowType,
    quantity: data.quantity,
    unit: data.unit,
    perFunctionalUnit: formData.get("perFunctionalUnit") !== null,
    transportMassTonnes: optionalNumber(data.transportMassTonnes),
    transportDistanceKm: optionalNumber(data.transportDistanceKm),
    allocationPercent: data.allocationPercent,
    dataSource: data.dataSource || null,
    dataType: data.dataType ? (data.dataType as LcaDataType) : null,
    geography: data.geography || null,
    referenceYear: optionalNumber(data.referenceYear),
    supplierName: data.supplierName || null,
    notes: data.notes || null,
    dqReliability: dqScore(data.dqReliability),
    dqCompleteness: dqScore(data.dqCompleteness),
    dqTemporal: dqScore(data.dqTemporal),
    dqGeographical: dqScore(data.dqGeographical),
    dqTechnological: dqScore(data.dqTechnological),
  };

  if (data.flowId) {
    await prisma.lcaFlow.update({ where: { id: data.flowId }, data: payload });
  } else {
    await prisma.lcaFlow.create({
      data: { processId: data.processId, dataOrigin: DataOrigin.USER_ENTERED, ...payload },
    });
  }

  revalidatePath(`/lca/${data.projectId}/inventory`);
  revalidatePath(`/lca/${data.projectId}`);
  return { error: null, saved: true };
}

export async function deleteFlowAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const flowId = String(formData.get("flowId") ?? "");
  if (!projectId || !flowId) return;
  await requireProjectAccess(projectId);

  await prisma.lcaFlow.delete({ where: { id: flowId } });
  revalidatePath(`/lca/${projectId}/inventory`);
  revalidatePath(`/lca/${projectId}`);
}

/**
 * Maps a flow to a factor from the platform's approved catalogue. The id is
 * verified to exist before it is stored — a suggestion is a proposal, and
 * this is where it stops being one.
 */
export async function mapFactorAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const flowId = String(formData.get("flowId") ?? "");
  const factorId = String(formData.get("emissionFactorId") ?? "").trim();
  if (!projectId || !flowId) return;
  await requireProjectAccess(projectId);

  if (factorId) {
    const factor = await prisma.emissionFactor.findUnique({ where: { id: factorId }, select: { id: true } });
    if (!factor) return;
  }

  await prisma.lcaFlow.update({
    where: { id: flowId },
    data: {
      emissionFactorId: factorId || null,
      // Records that a person accepted an AI-proposed mapping, so the study
      // can disclose where AI assisted.
      aiAssisted: formData.get("fromAiSuggestion") !== null ? true : undefined,
    },
  });

  revalidatePath(`/lca/${projectId}/inventory`);
  revalidatePath(`/lca/${projectId}`);
}

export interface FactorSuggestionState {
  error: string | null;
  aiUnavailable: boolean;
  flowId: string | null;
  suggestedFactorId: string | null;
  reason: string | null;
  confidence: number | null;
  candidates: {
    id: string;
    label: string;
    unit: string;
    source: string;
    vintage: number;
    value: string;
    isSuggested: boolean;
  }[];
}

const suggestionInitial: FactorSuggestionState = {
  error: null,
  aiUnavailable: false,
  flowId: null,
  suggestedFactorId: null,
  reason: null,
  confidence: null,
  candidates: [],
};

/**
 * Asks for a factor mapping suggestion: the shortlist is a database query,
 * the ranking is AI, and nothing is written. The factor *values* are read
 * here for display to the reviewer — they were never sent to the model.
 */
export async function suggestFlowFactorAction(
  _prev: FactorSuggestionState,
  formData: FormData,
): Promise<FactorSuggestionState> {
  const projectId = String(formData.get("projectId") ?? "");
  const flowId = String(formData.get("flowId") ?? "");
  if (!projectId || !flowId) return { ...suggestionInitial, error: "Missing flow." };

  let actor;
  try {
    actor = await requireProjectAccess(projectId);
  } catch (err) {
    return { ...suggestionInitial, error: err instanceof Error ? err.message : "Not allowed." };
  }

  const flow = await prisma.lcaFlow.findUnique({
    where: { id: flowId },
    include: { process: { include: { stage: true } } },
  });
  if (!flow) return { ...suggestionInitial, error: "That flow no longer exists." };

  const description = [
    `${flow.flowType} ${flow.direction === "INPUT" ? "input" : "output"}: ${flow.name}`,
    `recorded in ${flow.unit}`,
    flow.geography ? `geography ${flow.geography}` : null,
    flow.supplierName ? `supplier ${flow.supplierName}` : null,
    `life cycle stage: ${flow.process.stage.name}`,
    `process: ${flow.process.name}`,
  ]
    .filter(Boolean)
    .join(", ");

  try {
    const outcome = await carbonAI.suggestEmissionFactor(actor, {
      description,
      unit: flow.unit,
      asOfDate: flow.referenceYear ? new Date(Date.UTC(flow.referenceYear, 6, 1)) : new Date(),
    });

    return {
      error: outcome.noFactorFound ? null : null,
      aiUnavailable: false,
      flowId,
      suggestedFactorId: outcome.suggestedFactorId,
      reason: outcome.reason,
      confidence: outcome.confidence,
      candidates: outcome.candidates.map((c) => ({
        id: c.id,
        label: `${c.category}${c.subtypeKey ? ` / ${c.subtypeKey}` : ""} (${c.region})`,
        unit: c.unit,
        source: `${c.publisher} — ${c.factorSetName}`,
        vintage: c.vintageYear,
        value: c.co2eFactor,
        isSuggested: c.id === outcome.suggestedFactorId,
      })),
    };
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      // Still show the shortlist: the database query worked even though the
      // ranking didn't, so the user can pick by hand.
      const candidates = await carbonAI.findFactorCandidates({ description, unit: flow.unit });
      return {
        error: err.message,
        aiUnavailable: true,
        flowId,
        suggestedFactorId: null,
        reason: null,
        confidence: null,
        candidates: candidates.map((c) => ({
          id: c.id,
          label: `${c.category}${c.subtypeKey ? ` / ${c.subtypeKey}` : ""} (${c.region})`,
          unit: c.unit,
          source: `${c.publisher} — ${c.factorSetName}`,
          vintage: c.vintageYear,
          value: c.co2eFactor,
          isSuggested: false,
        })),
      };
    }
    return { ...suggestionInitial, error: "Could not look up candidate factors.", flowId };
  }
}

// --- Assumptions -----------------------------------------------------------

export async function addAssumptionAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const topic = String(formData.get("topic") ?? "").trim();
  const statement = String(formData.get("statement") ?? "").trim();
  if (!projectId || !topic || !statement) return;

  const actor = await requireProjectAccess(projectId);

  await prisma.lcaAssumption.create({
    data: {
      projectId,
      topic,
      statement,
      rationale: String(formData.get("rationale") ?? "").trim() || null,
      aiAssisted: formData.get("aiAssisted") !== null,
      createdByUserId: actor.userId,
    },
  });

  revalidatePath(`/lca/${projectId}`);
}

// --- Calculation, scenarios, review ---------------------------------------

export async function calculateProjectAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;
  const actor = await requireProjectAccess(projectId);

  await runAndStoreLcaResult(projectId, actor.userId, String(formData.get("scenarioId") ?? "") || null);
  revalidatePath(`/lca/${projectId}`);
  revalidatePath(`/lca/${projectId}/scenarios`);
}

export async function createScenarioAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!projectId || !name) return;
  const actor = await requireProjectAccess(projectId);

  await prisma.lcaScenario.create({
    data: {
      projectId,
      name,
      description: String(formData.get("description") ?? "").trim() || null,
      createdByUserId: actor.userId,
    },
  });

  revalidatePath(`/lca/${projectId}/scenarios`);
}

export async function saveScenarioOverrideAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const scenarioId = String(formData.get("scenarioId") ?? "");
  const flowId = String(formData.get("flowId") ?? "");
  if (!projectId || !scenarioId || !flowId) return;
  await requireProjectAccess(projectId);

  const quantity = optionalNumber(String(formData.get("overrideQuantity") ?? ""));
  const distance = optionalNumber(String(formData.get("overrideTransportDistanceKm") ?? ""));
  const factorId = String(formData.get("overrideEmissionFactorId") ?? "").trim() || null;
  const excluded = formData.get("excluded") !== null;

  // An override that changes nothing is noise in the study record — remove it
  // rather than storing an empty row.
  if (quantity === null && distance === null && !factorId && !excluded) {
    await prisma.lcaScenarioOverride.deleteMany({ where: { scenarioId, flowId } });
  } else {
    await prisma.lcaScenarioOverride.upsert({
      where: { scenarioId_flowId: { scenarioId, flowId } },
      update: {
        overrideQuantity: quantity,
        overrideTransportDistanceKm: distance,
        overrideEmissionFactorId: factorId,
        excluded,
        note: String(formData.get("note") ?? "").trim() || null,
      },
      create: {
        scenarioId,
        flowId,
        overrideQuantity: quantity,
        overrideTransportDistanceKm: distance,
        overrideEmissionFactorId: factorId,
        excluded,
        note: String(formData.get("note") ?? "").trim() || null,
      },
    });
  }

  revalidatePath(`/lca/${projectId}/scenarios`);
}

export interface ScenarioInterpretationState {
  error: string | null;
  aiUnavailable: boolean;
  scenarioId: string | null;
  interpretation: string | null;
  model: string | null;
}

export async function interpretScenarioAction(
  _prev: ScenarioInterpretationState,
  formData: FormData,
): Promise<ScenarioInterpretationState> {
  const projectId = String(formData.get("projectId") ?? "");
  const scenarioId = String(formData.get("scenarioId") ?? "");
  const base: ScenarioInterpretationState = {
    error: null,
    aiUnavailable: false,
    scenarioId,
    interpretation: null,
    model: null,
  };
  if (!projectId || !scenarioId) return { ...base, error: "Missing scenario." };

  let actor;
  try {
    actor = await requireProjectAccess(projectId);
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : "Not allowed." };
  }

  const project = await getLcaProject(projectId);
  if (!project) return { ...base, error: "Study not found." };

  const scenario = project.scenarios.find((s) => s.id === scenarioId);
  if (!scenario) return { ...base, error: "Scenario not found." };

  // Both runs go through the same deterministic engine — the AI only ever
  // sees the finished comparison.
  const baselineInput = toCalculationInput(project);
  const baselineResult = calculateLca(baselineInput);
  const scenarioResult = runScenario(baselineInput, await scenarioOverridesFor(scenarioId));
  const comparison = compareScenario(scenario.name, baselineResult, scenarioResult);

  try {
    const outcome = await carbonAI.interpretScenario(actor, projectId, comparison);
    return { ...base, interpretation: outcome.answer, model: outcome.meta.modelUsed };
  } catch (err) {
    if (err instanceof AiUnavailableError) return { ...base, aiUnavailable: true, error: err.message };
    return { ...base, error: "Could not interpret that scenario." };
  }
}

export interface LcaReviewState {
  error: string | null;
  aiUnavailable: boolean;
  summary: string | null;
  model: string | null;
  recommendations: {
    area: string;
    severity: string;
    title: string;
    detail: string;
    suggestedAction: string | null;
    confidence: number;
  }[];
}

const reviewInitial: LcaReviewState = {
  error: null,
  aiUnavailable: false,
  summary: null,
  model: null,
  recommendations: [],
};

export async function reviewProjectAction(_prev: LcaReviewState, formData: FormData): Promise<LcaReviewState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { ...reviewInitial, error: "Missing study." };

  let actor;
  try {
    actor = await requireProjectAccess(projectId);
  } catch (err) {
    return { ...reviewInitial, error: err instanceof Error ? err.message : "Not allowed." };
  }

  try {
    const outcome = await carbonAI.reviewLCA(actor, projectId);
    return {
      error: null,
      aiUnavailable: false,
      summary: outcome.review.summary,
      model: outcome.meta.modelUsed,
      recommendations: outcome.review.recommendations.map((r) => ({
        area: r.area,
        severity: r.severity,
        title: r.title,
        detail: r.detail,
        suggestedAction: r.suggestedAction,
        confidence: r.confidence,
      })),
    };
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      return { ...reviewInitial, aiUnavailable: true, error: err.message };
    }
    return { ...reviewInitial, error: "Could not review this study." };
  }
}

/** Keeps an AI recommendation as a labelled, advisory finding on the study. */
export async function keepFindingAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const finding = String(formData.get("finding") ?? "").trim();
  const category = String(formData.get("category") ?? "GENERAL").trim();
  if (!projectId || !finding) return;

  const actor = await requireProjectAccess(projectId);
  const severityRaw = String(formData.get("severity") ?? "INFO");
  const severity = (["INFO", "LOW", "MEDIUM", "HIGH"] as const).includes(severityRaw as LcaFindingSeverity)
    ? (severityRaw as LcaFindingSeverity)
    : LcaFindingSeverity.INFO;

  await prisma.lcaReviewFinding.create({
    data: {
      projectId,
      source: LcaFindingSource.AI,
      severity,
      category,
      finding,
      suggestion: String(formData.get("suggestion") ?? "").trim() || null,
      raisedByUserId: actor.userId,
    },
  });

  revalidatePath(`/lca/${projectId}`);
}

export async function resolveFindingAction(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const findingId = String(formData.get("findingId") ?? "");
  if (!projectId || !findingId) return;
  await requireProjectAccess(projectId);

  await prisma.lcaReviewFinding.update({
    where: { id: findingId },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });

  revalidatePath(`/lca/${projectId}`);
}

/** Used by the results page to show live figures without persisting a run. */
export async function previewCalculation(projectId: string) {
  await requireProjectAccess(projectId);
  const project = await getLcaProject(projectId);
  if (!project) return null;
  return runLcaCalculation(project);
}

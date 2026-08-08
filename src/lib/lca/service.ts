/**
 * Database layer for LCA projects.
 *
 * Reads the stored study into the pure engine's input shape, runs the
 * deterministic calculation, and freezes the full drill-down as an LcaResult
 * so a figure quoted today can still be traced tomorrow after the inventory
 * has moved on.
 *
 * Emission factor values are read here, from the platform's own approved
 * catalogue, and passed to the engine. They never travel through an AI call.
 */

import { LcaBoundaryType, LcaProjectStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calculateLca, LcaCalculationInput, LcaCalculationResult, LcaFactorSnapshot, LcaFlowInput } from "./calc";
import { analyseHotspots, HotspotAnalysis } from "./aggregation";
import { assessStudyDataQuality, StudyDataQuality } from "./data-quality";
import { LcaFlowOverride, applyScenarioOverrides } from "./scenarios";
import { stagesForBoundary } from "./stages";

const projectInclude = {
  goalScope: true,
  stages: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      processes: {
        orderBy: { sortOrder: "asc" as const },
        include: {
          flows: {
            orderBy: { createdAt: "asc" as const },
            include: { emissionFactor: { include: { factorSet: true } } },
          },
        },
      },
    },
  },
  assumptions: { orderBy: { createdAt: "asc" as const } },
  scenarios: { orderBy: { createdAt: "asc" as const }, include: { overrides: true } },
  reviewFindings: { orderBy: { createdAt: "desc" as const } },
  evidence: { include: { document: { select: { id: true, filename: true, uploadedAt: true } } } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.LcaProjectInclude;

export type LcaProjectWithGraph = Prisma.LcaProjectGetPayload<{ include: typeof projectInclude }>;

export async function listLcaProjects(entityIds: string[]) {
  return prisma.lcaProject.findMany({
    where: { OR: [{ entityId: null }, { entityId: { in: entityIds } }] },
    orderBy: { updatedAt: "desc" },
    include: {
      goalScope: { select: { functionalUnitDescription: true, systemBoundaryType: true, confirmedAt: true } },
      createdBy: { select: { name: true } },
      _count: { select: { stages: true, scenarios: true } },
      results: { orderBy: { calculatedAt: "desc" }, take: 1 },
    },
  });
}

export async function getLcaProject(projectId: string): Promise<LcaProjectWithGraph | null> {
  return prisma.lcaProject.findUnique({ where: { id: projectId }, include: projectInclude });
}

export interface CreateLcaProjectInput {
  name: string;
  productName: string;
  description?: string | null;
  entityId?: string | null;
  siteId?: string | null;
  boundaryType: LcaBoundaryType;
  createdByUserId: string;
}

/**
 * Creates a study with its goal-and-scope record and the stage skeleton its
 * boundary implies. The goal and scope starts unconfirmed: the wizard makes a
 * person confirm each methodological choice before the study counts as
 * defined.
 */
export async function createLcaProject(input: CreateLcaProjectInput) {
  const stages = stagesForBoundary(input.boundaryType);

  return prisma.lcaProject.create({
    data: {
      name: input.name,
      productName: input.productName,
      description: input.description ?? null,
      entityId: input.entityId ?? null,
      siteId: input.siteId ?? null,
      status: LcaProjectStatus.DRAFT,
      createdByUserId: input.createdByUserId,
      goalScope: {
        create: {
          systemBoundaryType: input.boundaryType,
          impactCategories: ["Climate change (GWP100, kgCO2e)"],
        },
      },
      stages: {
        create: stages.map((s) => ({
          key: s.key,
          name: s.name,
          description: s.description,
          included: s.included,
          exclusionReason: s.exclusionReason,
          sortOrder: s.sortOrder,
        })),
      },
    },
    include: { goalScope: true, stages: true },
  });
}

function toFactorSnapshot(
  factor: Prisma.EmissionFactorGetPayload<{ include: { factorSet: true } }> | null,
): LcaFactorSnapshot | null {
  if (!factor) return null;
  return {
    id: factor.id,
    value: Number(factor.co2eFactor),
    unit: factor.unit,
    source: `${factor.factorSet.publisher} — ${factor.factorSet.name}`,
    vintage: String(factor.factorSet.vintageYear),
    category: factor.category,
    subtypeKey: factor.subtypeKey,
    region: factor.region,
    isPlaceholder: factor.factorSet.isPlaceholder,
    sourceUrl: factor.factorSet.sourceUrl,
  };
}

/** Turns the stored study into the pure engine's input. */
export function toCalculationInput(project: LcaProjectWithGraph): LcaCalculationInput {
  const goal = project.goalScope;
  const functionalUnitLabel = goal?.functionalUnitDescription
    ? goal.functionalUnitQuantity && goal.functionalUnitUnit
      ? `${Number(goal.functionalUnitQuantity)} ${goal.functionalUnitUnit} — ${goal.functionalUnitDescription}`
      : goal.functionalUnitDescription
    : null;

  return {
    functionalUnitLabel,
    referenceFlowQuantity: goal?.referenceFlowQuantity ? Number(goal.referenceFlowQuantity) : null,
    stages: project.stages.map((stage) => ({
      id: stage.id,
      key: stage.key,
      name: stage.name,
      included: stage.included,
      exclusionReason: stage.exclusionReason,
      processes: stage.processes.map((process) => ({
        id: process.id,
        name: process.name,
        flows: process.flows.map(
          (flow): LcaFlowInput => ({
            id: flow.id,
            name: flow.name,
            direction: flow.direction,
            flowType: flow.flowType,
            quantity: Number(flow.quantity),
            unit: flow.unit,
            perFunctionalUnit: flow.perFunctionalUnit,
            transportMassTonnes: flow.transportMassTonnes === null ? null : Number(flow.transportMassTonnes),
            transportDistanceKm: flow.transportDistanceKm === null ? null : Number(flow.transportDistanceKm),
            allocationPercent: Number(flow.allocationPercent),
            factor: toFactorSnapshot(flow.emissionFactor),
            dataSource: flow.dataSource,
            dataType: flow.dataType,
            geography: flow.geography,
            referenceYear: flow.referenceYear,
            supplierName: flow.supplierName,
            dq: {
              reliability: flow.dqReliability,
              completeness: flow.dqCompleteness,
              temporal: flow.dqTemporal,
              geographical: flow.dqGeographical,
              technological: flow.dqTechnological,
            },
          }),
        ),
      })),
    })),
  };
}

/** All flows keyed by id — for the data-quality assessment. */
export function flowsById(input: LcaCalculationInput): Map<string, LcaFlowInput> {
  const map = new Map<string, LcaFlowInput>();
  for (const stage of input.stages) {
    for (const process of stage.processes) {
      for (const flow of process.flows) map.set(flow.id, flow);
    }
  }
  return map;
}

export async function scenarioOverridesFor(scenarioId: string): Promise<LcaFlowOverride[]> {
  const overrides = await prisma.lcaScenarioOverride.findMany({
    where: { scenarioId },
    include: { overrideEmissionFactor: { include: { factorSet: true } } },
  });

  return overrides.map((o) => ({
    flowId: o.flowId,
    quantity: o.overrideQuantity === null ? null : Number(o.overrideQuantity),
    transportDistanceKm: o.overrideTransportDistanceKm === null ? null : Number(o.overrideTransportDistanceKm),
    factor: o.overrideEmissionFactorId ? toFactorSnapshot(o.overrideEmissionFactor) : undefined,
    excluded: o.excluded,
  }));
}

export interface LcaRunOutput {
  result: LcaCalculationResult;
  hotspots: HotspotAnalysis;
  dataQuality: StudyDataQuality;
  input: LcaCalculationInput;
}

/** Calculates a project (optionally under a scenario) without persisting. */
export async function runLcaCalculation(project: LcaProjectWithGraph, scenarioId?: string | null): Promise<LcaRunOutput> {
  const baseline = toCalculationInput(project);
  const input = scenarioId ? applyScenarioOverrides(baseline, await scenarioOverridesFor(scenarioId)) : baseline;

  const result = calculateLca(input);
  return {
    result,
    hotspots: analyseHotspots(result),
    dataQuality: assessStudyDataQuality(result, flowsById(input)),
    input,
  };
}

/**
 * Calculates and freezes the result, including the full drill-down, so the
 * figure stays explainable after the inventory changes.
 */
export async function runAndStoreLcaResult(
  projectId: string,
  userId: string,
  scenarioId?: string | null,
): Promise<{ run: LcaRunOutput; resultId: string }> {
  const project = await getLcaProject(projectId);
  if (!project) throw new Error("LCA project not found.");

  const run = await runLcaCalculation(project, scenarioId ?? null);

  const stored = await prisma.lcaResult.create({
    data: {
      projectId,
      scenarioId: scenarioId ?? null,
      totalKgCo2e: run.result.totalKgCo2e,
      functionalUnitLabel: run.result.functionalUnitLabel,
      unmappedFlowCount: run.result.unmappedFlowCount,
      engineVersion: run.result.engineVersion,
      payload: JSON.parse(
        JSON.stringify({ result: run.result, hotspots: run.hotspots, dataQuality: run.dataQuality }),
      ),
      calculatedByUserId: userId,
    },
    select: { id: true },
  });

  return { run, resultId: stored.id };
}

export async function latestResultFor(projectId: string, scenarioId?: string | null) {
  return prisma.lcaResult.findFirst({
    where: { projectId, scenarioId: scenarioId ?? null },
    orderBy: { calculatedAt: "desc" },
    include: { calculatedBy: { select: { name: true } } },
  });
}

/**
 * Completeness of the study's *methodology* record — how much of goal and
 * scope has actually been decided. Deterministic; the LCA copilot is given
 * this rather than being asked to work it out.
 */
export interface GoalScopeCompleteness {
  answered: number;
  total: number;
  missing: { field: string; label: string }[];
  confirmed: boolean;
}

const GOAL_SCOPE_FIELDS: { field: string; label: string }[] = [
  { field: "purpose", label: "Purpose of the study" },
  { field: "intendedApplication", label: "Intended application" },
  { field: "intendedAudience", label: "Intended audience" },
  { field: "functionalUnitDescription", label: "Functional unit" },
  { field: "referenceFlowDescription", label: "Reference flow" },
  { field: "systemBoundaryType", label: "System boundary" },
  { field: "geography", label: "Geographic scope" },
  { field: "technologyDescription", label: "Technology represented" },
  { field: "cutOffCriteria", label: "Cut-off criteria" },
  { field: "allocationRationale", label: "Allocation rationale" },
  { field: "dataQualityRequirements", label: "Data quality requirements" },
  { field: "limitations", label: "Limitations" },
];

export function assessGoalScopeCompleteness(project: LcaProjectWithGraph): GoalScopeCompleteness {
  const goal = project.goalScope as Record<string, unknown> | null;
  const missing: { field: string; label: string }[] = [];

  for (const item of GOAL_SCOPE_FIELDS) {
    const value = goal?.[item.field];
    const filled =
      value !== null &&
      value !== undefined &&
      (typeof value !== "string" || value.trim().length > 0) &&
      !(item.field === "allocationRationale" && project.goalScope?.allocationMethod === "NOT_APPLICABLE" && !value);
    if (!filled) missing.push(item);
  }

  // Allocation rationale isn't required when there are no co-products to
  // allocate between — that's a legitimate answer, not a gap.
  const allocationNotApplicable = project.goalScope?.allocationMethod === "NOT_APPLICABLE";
  const filteredMissing = allocationNotApplicable
    ? missing.filter((m) => m.field !== "allocationRationale")
    : missing;
  const total = allocationNotApplicable ? GOAL_SCOPE_FIELDS.length - 1 : GOAL_SCOPE_FIELDS.length;

  return {
    answered: total - filteredMissing.length,
    total,
    missing: filteredMissing,
    confirmed: Boolean(project.goalScope?.confirmedAt),
  };
}

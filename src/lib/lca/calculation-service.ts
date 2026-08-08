/**
 * The bridge between the database and the pure calculation engine.
 *
 * Loads an assessment in full, turns it into the engine's plain-data snapshot,
 * runs the engine, and writes the results back with everything a later reader
 * needs: the factor values as they were, the methodology as it was, and the
 * step-by-step provenance of each figure.
 *
 * Runs are never overwritten. Each recalculation is a new LcaCalculationRun,
 * so the history of what an assessment said, and when, stays intact.
 */

import {
  LcaFactorBoundary,
  LcaFactorSelectionMode,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { D, DOrNull, ONE, toNumber } from "./decimal";
import { toMethodologyConfig } from "./methodology";
import { calculateAssessment, LCA_ENGINE_VERSION } from "./engine/engine";
import type {
  EngineAssessment,
  EngineEndOfLifeRoute,
  EngineFactor,
  EngineInventoryItem,
  EngineOutput,
  EngineProcess,
  EngineTransportLeg,
} from "./engine/types";
import { recordAuditEvent } from "./audit-service";
import type { AnalysisRow } from "./analysis";

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const factorInclude = { factorSet: true } as const;

const assessmentInclude = {
  methodologyProfile: true,
  productVersion: { include: { product: true, manufacturingLocations: { include: { site: true } } } },
  entity: true,
  owner: true,
  processes: { include: { outputs: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  inventoryItems: {
    include: {
      supplier: true,
      emissionFactor: { include: factorInclude },
      recycledEmissionFactor: { include: factorInclude },
      supplierPcf: { include: { supplier: true } },
      transportLegs: { include: { emissionFactor: { include: factorInclude } }, orderBy: { sequence: "asc" } },
      endOfLifeRoutes: { include: { emissionFactor: { include: factorInclude } } },
      corporateLinks: true,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  },
} satisfies Prisma.LcaAssessmentInclude;

export type LoadedAssessment = Prisma.LcaAssessmentGetPayload<{ include: typeof assessmentInclude }>;
export type LoadedInventoryItem = LoadedAssessment["inventoryItems"][number];
export type LoadedProcess = LoadedAssessment["processes"][number];

export async function loadAssessment(assessmentId: string): Promise<LoadedAssessment | null> {
  return prisma.lcaAssessment.findUnique({ where: { id: assessmentId }, include: assessmentInclude });
}

export async function loadAssessmentOrThrow(assessmentId: string): Promise<LoadedAssessment> {
  return prisma.lcaAssessment.findUniqueOrThrow({ where: { id: assessmentId }, include: assessmentInclude });
}

// ---------------------------------------------------------------------------
// Factor resolution
// ---------------------------------------------------------------------------

type FactorWithSet = Prisma.EmissionFactorGetPayload<{ include: typeof factorInclude }>;

/**
 * A library factor, with the version metadata that makes it auditable. The
 * factor set's publisher and vintage are the "version" — the library is
 * append-only, so a set never changes under a stored result.
 */
export function libraryFactorToEngine(factor: FactorWithSet): EngineFactor {
  return {
    emissionFactorId: factor.id,
    selectionMode: LcaFactorSelectionMode.LIBRARY_FACTOR,
    value: D(factor.co2eFactor),
    unit: factor.unit,
    source: factor.factorSet.isPlaceholder
      ? `${factor.factorSet.publisher} — ${factor.factorSet.name} (PLACEHOLDER — not verified)`
      : `${factor.factorSet.publisher} — ${factor.factorSet.name}`,
    version: String(factor.factorSet.vintageYear),
    boundary: factor.boundary ?? LcaFactorBoundary.UNKNOWN,
    geography: factor.region,
    year: factor.referenceYear ?? factor.factorSet.vintageYear,
    gwpBasis: factor.gwpBasis,
    isPlaceholder: factor.factorSet.isPlaceholder,
    uncertaintyPercent: DOrNull(factor.uncertaintyPercent),
  };
}

/**
 * A supplier's own product footprint, expressed per one of its declared units
 * so it can be applied like any other factor. A supplier PCF of 12 kgCO2e per
 * 100 units becomes 0.12 kgCO2e per unit.
 */
export function supplierPcfToEngine(
  pcf: Prisma.LcaSupplierPcfGetPayload<{ include: { supplier: true } }>,
): EngineFactor {
  const declaredQuantity = D(pcf.declaredUnitQuantity);
  const perUnit = declaredQuantity.isZero() ? D(pcf.pcfValue) : D(pcf.pcfValue).div(declaredQuantity);
  return {
    emissionFactorId: null,
    selectionMode: LcaFactorSelectionMode.SUPPLIER_PCF,
    value: perUnit,
    unit: pcf.declaredUnitUnit,
    source: `${pcf.supplier.name} — supplier PCF for ${pcf.productName}${pcf.verificationStatus === "THIRD_PARTY_VERIFIED" ? " (third-party verified)" : ""}`,
    version: [pcf.methodology, pcf.methodologyVersion, pcf.reportingPeriodEnd?.toISOString().slice(0, 10)]
      .filter(Boolean)
      .join(" / ") || "as supplied",
    boundary: boundaryFromAssessmentBoundary(pcf.boundary),
    geography: pcf.geography,
    year: pcf.reportingPeriodEnd?.getUTCFullYear() ?? null,
    gwpBasis: pcf.gwpBasis,
    isPlaceholder: false,
    uncertaintyPercent: DOrNull(pcf.uncertaintyPercent),
  };
}

function boundaryFromAssessmentBoundary(boundary: string): LcaFactorBoundary {
  switch (boundary) {
    case "CRADLE_TO_GATE":
      return LcaFactorBoundary.CRADLE_TO_GATE;
    case "CRADLE_TO_GRAVE":
    case "CRADLE_TO_CRADLE":
      return LcaFactorBoundary.CRADLE_TO_GRAVE;
    case "GATE_TO_GATE":
      return LcaFactorBoundary.GATE_TO_GATE;
    case "GATE_TO_GRAVE":
      return LcaFactorBoundary.DOWNSTREAM;
    default:
      return LcaFactorBoundary.UNKNOWN;
  }
}

function manualFactorToEngine(item: LoadedInventoryItem): EngineFactor | null {
  if (item.manualFactorValue === null || !item.manualFactorUnit) return null;
  return {
    emissionFactorId: null,
    selectionMode: LcaFactorSelectionMode.MANUAL,
    value: D(item.manualFactorValue),
    unit: item.manualFactorUnit,
    source: item.manualFactorSource ?? "Manually entered factor (no source recorded)",
    version: item.manualFactorVersion ?? "not stated",
    boundary: item.manualFactorBoundary ?? LcaFactorBoundary.UNKNOWN,
    geography: item.manualFactorGeography,
    year: item.manualFactorYear,
    gwpBasis: item.manualFactorGwpBasis,
    isPlaceholder: false,
    uncertaintyPercent: null,
  };
}

/** The factor an item will actually be priced at, following its selection mode. */
export function resolveItemFactor(item: LoadedInventoryItem): EngineFactor | null {
  switch (item.factorSelectionMode) {
    case LcaFactorSelectionMode.LIBRARY_FACTOR:
      return item.emissionFactor ? libraryFactorToEngine(item.emissionFactor) : null;
    case LcaFactorSelectionMode.SUPPLIER_PCF:
      return item.supplierPcf ? supplierPcfToEngine(item.supplierPcf) : null;
    case LcaFactorSelectionMode.MANUAL:
      return manualFactorToEngine(item);
    default:
      return null;
  }
}

function legFactorToEngine(
  leg: LoadedInventoryItem["transportLegs"][number],
): EngineFactor | null {
  if (leg.emissionFactor) return libraryFactorToEngine(leg.emissionFactor);
  if (leg.manualFactorValue !== null && leg.manualFactorUnit) {
    return {
      emissionFactorId: null,
      selectionMode: LcaFactorSelectionMode.MANUAL,
      value: D(leg.manualFactorValue),
      unit: leg.manualFactorUnit,
      source: leg.manualFactorSource ?? "Manually entered freight factor (no source recorded)",
      version: "not stated",
      boundary: LcaFactorBoundary.WELL_TO_WHEEL,
      geography: null,
      year: null,
      gwpBasis: null,
      isPlaceholder: false,
      uncertaintyPercent: null,
    };
  }
  return null;
}

function routeFactorToEngine(
  route: LoadedInventoryItem["endOfLifeRoutes"][number],
): EngineFactor | null {
  if (route.emissionFactor) return libraryFactorToEngine(route.emissionFactor);
  if (route.manualFactorValue !== null && route.manualFactorUnit) {
    return {
      emissionFactorId: null,
      selectionMode: LcaFactorSelectionMode.MANUAL,
      value: D(route.manualFactorValue),
      unit: route.manualFactorUnit,
      source: route.manualFactorSource ?? "Manually entered end-of-life factor (no source recorded)",
      version: "not stated",
      boundary: LcaFactorBoundary.END_OF_LIFE,
      geography: null,
      year: null,
      gwpBasis: null,
      isPlaceholder: false,
      uncertaintyPercent: null,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Database -> engine snapshot
// ---------------------------------------------------------------------------

export function toEngineAssessment(assessment: LoadedAssessment): EngineAssessment {
  const processes: EngineProcess[] = assessment.processes.map((p) => ({
    id: p.id,
    parentProcessId: p.parentProcessId,
    stage: p.stage,
    name: p.name,
    isIncluded: p.isIncluded,
    allocationMethod: p.allocationMethod,
    allocationPercent: D(p.allocationPercent),
    allocationRationale: p.allocationRationale,
    outputs: p.outputs.map((o) => ({
      id: o.id,
      name: o.name,
      isAssessedProduct: o.isAssessedProduct,
      massValue: DOrNull(o.massValue),
      massUnit: o.massUnit,
      physicalValue: DOrNull(o.physicalValue),
      physicalUnit: o.physicalUnit,
      economicValue: DOrNull(o.economicValue),
      economicCurrency: o.economicCurrency,
      manualPercent: DOrNull(o.manualPercent),
    })),
  }));

  const items: EngineInventoryItem[] = assessment.inventoryItems.map((item) => {
    const transportLegs: EngineTransportLeg[] = item.transportLegs.map((leg) => ({
      id: leg.id,
      sequence: leg.sequence,
      mode: leg.mode,
      modeDescription: leg.modeDescription,
      originName: leg.originName,
      destinationName: leg.destinationName,
      distanceValue: D(leg.distanceValue),
      distanceUnit: leg.distanceUnit,
      massValue: D(leg.massValue),
      massUnit: leg.massUnit,
      loadFactorPercent: DOrNull(leg.loadFactorPercent),
      includesReturnTrip: leg.includesReturnTrip,
      factor: legFactorToEngine(leg),
      assumptions: leg.assumptions,
    }));

    const endOfLifeRoutes: EngineEndOfLifeRoute[] = item.endOfLifeRoutes.map((route) => ({
      id: route.id,
      route: route.route,
      routeDescription: route.routeDescription,
      percent: D(route.percent),
      factor: routeFactorToEngine(route),
      recoveryRatePercent: DOrNull(route.recoveryRatePercent),
      avoidedFactorValue: DOrNull(route.avoidedFactorValue),
      avoidedFactorUnit: route.avoidedFactorUnit,
      avoidedFactorSource: route.avoidedFactorSource,
      recoveryAssumptions: route.recoveryAssumptions,
    }));

    return {
      id: item.id,
      processId: item.processId,
      itemType: item.itemType,
      name: item.name,
      classification: item.classification,
      quantity: D(item.quantity),
      unit: item.unit,
      adjustmentFactor: D(item.adjustmentFactor, 1),
      adjustmentRationale: item.adjustmentRationale,
      wastePercent: DOrNull(item.wastePercent),
      recycledContentPercent: DOrNull(item.recycledContentPercent),
      dataType: item.dataType,
      supplierName: item.supplier?.name ?? null,
      materialName: item.materialName,
      componentName: item.componentName,
      geography: item.geography,
      factor: resolveItemFactor(item),
      recycledFactor: item.recycledEmissionFactor ? libraryFactorToEngine(item.recycledEmissionFactor) : null,
      biogenicUptakePerUnit: DOrNull(item.biogenicUptakePerUnit),
      storedCarbonPerUnit: DOrNull(item.storedCarbonPerUnit),
      dataQuality: {
        temporal: item.temporalScore,
        geographical: item.geographicalScore,
        technological: item.technologicalScore,
        completeness: item.completenessScore,
        reliability: item.reliabilityScore,
      },
      uncertaintyPercent: DOrNull(item.uncertaintyPercent),
      isExcluded: item.isExcluded,
      exclusionReason: item.exclusionReason,
      transportLegs,
      endOfLifeRoutes,
    };
  });

  return {
    id: assessment.id,
    reference: assessment.reference,
    title: assessment.title,
    functionalUnit: {
      description: assessment.functionalUnitDescription,
      quantity: D(assessment.functionalUnitQuantity, 1),
      unit: assessment.functionalUnitUnit,
      isDeclaredUnit: assessment.isDeclaredUnit,
      declaredUnitDescription: assessment.declaredUnitDescription,
      referenceFlowDescription: assessment.referenceFlowDescription,
      referenceFlowQuantity: D(assessment.referenceFlowQuantity, 1),
      referenceFlowUnit: assessment.referenceFlowUnit,
      modelledOutputQuantity: D(assessment.modelledOutputQuantity, 1),
      modelledOutputUnit: assessment.modelledOutputUnit,
    },
    methodology: toMethodologyConfig(assessment.methodologyProfile),
    processes,
    items,
  };
}

/** Runs the engine over a stored assessment without writing anything. */
export async function previewCalculation(assessmentId: string): Promise<EngineOutput> {
  const assessment = await loadAssessmentOrThrow(assessmentId);
  return calculateAssessment(toEngineAssessment(assessment));
}

// ---------------------------------------------------------------------------
// Persisting a run
// ---------------------------------------------------------------------------

export interface RunCalculationOptions {
  assessmentId: string;
  actorUserId?: string | null;
  notes?: string | null;
}

export interface RunCalculationOutcome {
  runId: string;
  output: EngineOutput;
  rowCount: number;
  errorCount: number;
}

/** Serialisable summary of a run's totals, stored on the run row. */
export function serialiseTotals(output: EngineOutput) {
  const { totals } = output;
  return {
    model: {
      fossil: toNumber(totals.model.fossil),
      biogenicEmissions: toNumber(totals.model.biogenicEmissions),
      biogenicRemovals: toNumber(totals.model.biogenicRemovals),
      technologicalRemovals: toNumber(totals.model.technologicalRemovals),
      storedCarbon: toNumber(totals.model.storedCarbon),
      avoidedBurden: toNumber(totals.model.avoidedBurden),
      offsets: toNumber(totals.model.offsets),
    },
    perFunctionalUnit: {
      fossil: toNumber(totals.perFunctionalUnit.fossil),
      biogenicEmissions: toNumber(totals.perFunctionalUnit.biogenicEmissions),
      biogenicRemovals: toNumber(totals.perFunctionalUnit.biogenicRemovals),
      technologicalRemovals: toNumber(totals.perFunctionalUnit.technologicalRemovals),
      storedCarbon: toNumber(totals.perFunctionalUnit.storedCarbon),
      avoidedBurden: toNumber(totals.perFunctionalUnit.avoidedBurden),
      offsets: toNumber(totals.perFunctionalUnit.offsets),
    },
    headlineModelKgCo2e: toNumber(totals.headlineModelKgCo2e),
    headlinePerFunctionalUnitKgCo2e: toNumber(totals.headlinePerFunctionalUnitKgCo2e),
    includingBiogenicPerFunctionalUnitKgCo2e: toNumber(totals.includingBiogenicPerFunctionalUnitKgCo2e),
    functionalUnitsInModel: toNumber(totals.functionalUnitsInModel),
    functionalUnitResolved: totals.functionalUnitResolved,
    functionalUnitNote: totals.functionalUnitNote,
    diagnostics: output.diagnostics,
  };
}

export type SerialisedTotals = ReturnType<typeof serialiseTotals>;

/**
 * Calculates and stores a run. Writing the run, its result rows, the
 * normalised quantities back onto the inventory and the assessment's pointer
 * to the latest run all happen in one transaction: a half-written run would
 * make the results page disagree with the register export.
 */
export async function runCalculation(options: RunCalculationOptions): Promise<RunCalculationOutcome> {
  const assessment = await loadAssessmentOrThrow(options.assessmentId);
  const engineAssessment = toEngineAssessment(assessment);
  const output = calculateAssessment(engineAssessment);

  const totals = serialiseTotals(output);
  const errorCount = output.diagnostics.filter((d) => d.severity === "error").length;

  const runId = await prisma.$transaction(async (tx) => {
    const run = await tx.lcaCalculationRun.create({
      data: {
        assessmentId: assessment.id,
        runByUserId: options.actorUserId ?? null,
        engineVersion: output.engineVersion,
        methodologyVersion: assessment.methodologyProfile
          ? `${assessment.methodologyProfile.name} ${assessment.methodologyProfile.version}`
          : null,
        methodologySnapshot: JSON.parse(JSON.stringify(engineAssessment.methodology)),
        factorSnapshot: JSON.parse(JSON.stringify(output.factorsUsed)),
        totals: totals as unknown as Prisma.InputJsonValue,
        itemCount: output.rows.length,
        notes: options.notes ?? null,
      },
    });

    if (output.rows.length > 0) {
      await tx.lcaCalculationResult.createMany({
        data: output.rows.map((row) => ({
          runId: run.id,
          assessmentId: assessment.id,
          inventoryItemId: row.inventoryItemId,
          processId: row.processId,
          transportLegId: row.transportLegId,
          endOfLifeRouteId: row.endOfLifeRouteId,
          stage: row.stage,
          processName: row.processName,
          itemName: row.itemName,
          itemType: row.itemType,
          classification: row.classification,
          supplierName: row.supplierName,
          materialName: row.materialName,
          activityValue: row.activityValue.toFixed(10),
          activityUnit: row.activityUnit,
          conversionFactor: row.conversionFactor.toFixed(15),
          normalizedValue: row.normalizedValue.toFixed(10),
          normalizedUnit: row.normalizedUnit,
          factorValue: row.factorValue.toFixed(10),
          factorUnit: row.factorUnit,
          factorSource: row.factorSource,
          factorVersion: row.factorVersion,
          factorBoundary: row.factorBoundary,
          factorGeography: row.factorGeography,
          factorYear: row.factorYear,
          factorGwpBasis: row.factorGwpBasis,
          factorSelectionMode: row.factorSelectionMode,
          emissionFactorId: row.emissionFactorId,
          isPlaceholderFactor: row.isPlaceholderFactor,
          allocationMethod: row.allocationMethod,
          allocationFactor: row.allocationFactor.toFixed(10),
          adjustmentFactor: row.adjustmentFactor.toFixed(10),
          grossKgCo2e: row.grossKgCo2e.toFixed(10),
          allocatedKgCo2e: row.allocatedKgCo2e.toFixed(10),
          perFunctionalUnitKgCo2e: row.perFunctionalUnitKgCo2e.toFixed(10),
          dataType: row.dataType,
          dataQualityScore: row.dataQualityScore ? row.dataQualityScore.toFixed(3) : null,
          uncertaintyPercent: row.uncertaintyPercent ? row.uncertaintyPercent.toFixed(4) : null,
          formula: row.formula,
          provenance: JSON.parse(JSON.stringify(row.provenance)),
        })),
      });
    }

    const updatedAssessment = await tx.lcaAssessment.update({
      where: { id: assessment.id },
      data: { lastCalculationRunId: run.id, engineVersion: output.engineVersion },
    });

    // Storing a run touches the assessment row, so the run records where the
    // assessment's updatedAt landed once that write was done. Staleness is
    // measured from here; without it every assessment would read as out of
    // date the instant it was calculated.
    await tx.lcaCalculationRun.update({
      where: { id: run.id },
      data: { assessmentUpdatedAt: updatedAssessment.updatedAt },
    });

    return run.id;
  });

  await recordAuditEvent({
    assessmentId: assessment.id,
    entityType: "calculation_run",
    entityId: runId,
    action: "calculated",
    actorUserId: options.actorUserId ?? null,
    summary: `Calculation run produced ${output.rows.length} result line(s); headline ${toNumber(output.totals.headlinePerFunctionalUnitKgCo2e).toFixed(4)} kgCO2e per functional unit${errorCount > 0 ? `, with ${errorCount} line(s) that could not be calculated` : ""}.`,
    after: { totals, engineVersion: output.engineVersion },
    metadata: { factorsUsed: output.factorsUsed.length, diagnostics: output.diagnostics.length },
  });

  return { runId, output, rowCount: output.rows.length, errorCount };
}

// ---------------------------------------------------------------------------
// Reading a stored run
// ---------------------------------------------------------------------------

const runInclude = {
  results: { orderBy: [{ stage: "asc" }, { allocatedKgCo2e: "desc" }] },
  runBy: true,
} satisfies Prisma.LcaCalculationRunInclude;

export type LoadedRun = Prisma.LcaCalculationRunGetPayload<{ include: typeof runInclude }>;
export type LoadedResult = LoadedRun["results"][number];

export async function getLatestRun(assessmentId: string): Promise<LoadedRun | null> {
  return prisma.lcaCalculationRun.findFirst({
    where: { assessmentId },
    include: runInclude,
    orderBy: { runAt: "desc" },
  });
}

export async function getRun(runId: string): Promise<LoadedRun | null> {
  return prisma.lcaCalculationRun.findUnique({ where: { id: runId }, include: runInclude });
}

export async function listRuns(assessmentId: string, take = 25) {
  return prisma.lcaCalculationRun.findMany({
    where: { assessmentId },
    include: { runBy: true, _count: { select: { results: true } } },
    orderBy: { runAt: "desc" },
    take,
  });
}

export async function getResult(resultId: string) {
  return prisma.lcaCalculationResult.findUnique({
    where: { id: resultId },
    include: {
      run: { include: { runBy: true } },
      assessment: true,
      inventoryItem: { include: { supplier: true, process: true } },
      emissionFactor: { include: { factorSet: true } },
      transportLeg: true,
      endOfLifeRoute: true,
    },
  });
}

/** Stored result rows in the shape the analysis functions expect. */
export function resultsToAnalysisRows(results: LoadedResult[]): AnalysisRow[] {
  return results.map((r) => ({
    stage: r.stage,
    processId: r.processId,
    processName: r.processName,
    inventoryItemId: r.inventoryItemId,
    itemName: r.itemName,
    itemType: r.itemType,
    classification: r.classification,
    materialName: r.materialName,
    supplierName: r.supplierName,
    dataType: r.dataType,
    dataQualityScore: DOrNull(r.dataQualityScore),
    uncertaintyPercent: DOrNull(r.uncertaintyPercent),
    allocatedKgCo2e: D(r.allocatedKgCo2e),
    perFunctionalUnitKgCo2e: D(r.perFunctionalUnitKgCo2e),
    factorSource: r.factorSource,
    isPlaceholderFactor: r.isPlaceholderFactor,
  }));
}

/** Engine rows in the same shape, so a preview can be analysed before saving. */
export function engineRowsToAnalysisRows(output: EngineOutput): AnalysisRow[] {
  return output.rows.map((r) => ({
    stage: r.stage,
    processId: r.processId,
    processName: r.processName,
    inventoryItemId: r.inventoryItemId,
    itemName: r.itemName,
    itemType: r.itemType,
    classification: r.classification,
    materialName: r.materialName,
    supplierName: r.supplierName,
    dataType: r.dataType,
    dataQualityScore: r.dataQualityScore,
    uncertaintyPercent: r.uncertaintyPercent,
    allocatedKgCo2e: r.allocatedKgCo2e,
    perFunctionalUnitKgCo2e: r.perFunctionalUnitKgCo2e,
    factorSource: r.factorSource,
    isPlaceholderFactor: r.isPlaceholderFactor,
  }));
}

/** Totals as stored on a run row, typed. */
export function runTotals(run: { totals: Prisma.JsonValue }): SerialisedTotals {
  return run.totals as unknown as SerialisedTotals;
}

/**
 * True when the inventory has changed since the last run, so the UI can say
 * the figures on screen are out of date rather than presenting stale numbers
 * as current.
 */
export async function isCalculationStale(assessmentId: string): Promise<{ stale: boolean; reason: string | null }> {
  const run = await prisma.lcaCalculationRun.findFirst({
    where: { assessmentId },
    orderBy: { runAt: "desc" },
    select: { id: true, runAt: true, engineVersion: true, assessmentUpdatedAt: true },
  });
  if (!run) return { stale: true, reason: "This assessment has not been calculated yet." };

  const [assessment, newerItem, newerProcess] = await Promise.all([
    prisma.lcaAssessment.findUnique({ where: { id: assessmentId }, select: { updatedAt: true } }),
    prisma.lcaInventoryItem.findFirst({
      where: { assessmentId, updatedAt: { gt: run.runAt } },
      select: { id: true, name: true },
    }),
    prisma.lcaProcess.findFirst({
      where: { assessmentId, updatedAt: { gt: run.runAt } },
      select: { id: true, name: true },
    }),
  ]);

  if (newerItem) return { stale: true, reason: `Inventory has changed since the last run (most recently "${newerItem.name}").` };
  if (newerProcess) return { stale: true, reason: `The lifecycle model has changed since the last run (most recently "${newerProcess.name}").` };
  // Compared against where the assessment's updatedAt landed when the run
  // finished, not against runAt: storing the run updates the assessment row.
  const assessmentBaseline = run.assessmentUpdatedAt ?? run.runAt;
  if (assessment && assessment.updatedAt > assessmentBaseline) {
    return { stale: true, reason: "The assessment's goal, scope or methodology has changed since the last run." };
  }
  if (run.engineVersion !== LCA_ENGINE_VERSION) {
    return { stale: true, reason: `The last run used calculation engine ${run.engineVersion}; the current engine is ${LCA_ENGINE_VERSION}.` };
  }
  return { stale: false, reason: null };
}

export { ONE as CALCULATION_ONE };

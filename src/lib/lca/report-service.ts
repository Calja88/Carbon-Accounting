/**
 * Assessment reporting.
 *
 * Builds the complete report an independent reviewer would work from, and the
 * exports that sit under it: the calculation register (every figure with its
 * arithmetic), a structured JSON export of the whole assessment, and the
 * PACT-aligned exchange document.
 *
 * The executive summary is generated from the figures rather than written by
 * hand, so it can never drift out of step with the results — and it says what
 * the assessment does not cover as plainly as what it does.
 */

import { LcaAssessmentStatus, LcaDataType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { D, toDisplayString, toExactString, toNumber } from "./decimal";
import { csvRow, toCsv } from "@/lib/csv";
import {
  analyseContributions,
  sensitivityAnalysis,
  summariseDataQuality,
  summariseUncertainty,
  type ContributionAnalysis,
  type DataQualitySummary,
  type SensitivityResult,
  type UncertaintySummary,
} from "./analysis";
import {
  getLatestRun,
  isCalculationStale,
  loadAssessmentOrThrow,
  resultsToAnalysisRows,
  runTotals,
  type LoadedAssessment,
  type LoadedRun,
  type SerialisedTotals,
} from "./calculation-service";
import { runValidation, type ValidationReport } from "./validation-service";
import { buildReadinessReport, type ReadinessReport } from "./readiness-service";
import { toMethodologyConfig, type MethodologyConfig } from "./methodology";
import { BOUNDARY_LABELS, STAGE_LABELS, STATUS_LABELS } from "./labels";
import { compareScenario, type ScenarioComparison } from "./analysis";
import { toPactFootprint, type PactExportOutcome } from "./pact/adapter";

// ---------------------------------------------------------------------------
// Report model
// ---------------------------------------------------------------------------

export interface ScenarioSummary {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  comparison: ScenarioComparison | null;
  calculated: boolean;
}

export interface AssessmentReport {
  assessment: LoadedAssessment;
  productName: string;
  productSku: string;
  productVersionLabel: string;
  manufacturingLocations: { name: string; country: string | null; siteName: string | null }[];
  entityName: string;
  status: LcaAssessmentStatus;
  statusLabel: string;
  methodology: MethodologyConfig;
  run: LoadedRun | null;
  totals: SerialisedTotals | null;
  staleness: { stale: boolean; reason: string | null };
  contributions: ContributionAnalysis | null;
  dataQuality: DataQualitySummary | null;
  uncertainty: UncertaintySummary | null;
  sensitivity: SensitivityResult | null;
  validation: ValidationReport;
  readiness: ReadinessReport;
  assumptions: Awaited<ReturnType<typeof loadAssumptions>>;
  exclusions: Awaited<ReturnType<typeof loadExclusions>>;
  evidence: Awaited<ReturnType<typeof loadEvidence>>;
  verifications: Awaited<ReturnType<typeof loadVerifications>>;
  corporateLinks: Awaited<ReturnType<typeof loadCorporateLinks>>;
  scenarios: ScenarioSummary[];
  versions: { id: string; version: number; label: string | null; status: string; issuedAt: Date | null; issuedByName: string | null }[];
  factorSources: { source: string; version: string; count: number; isPlaceholder: boolean }[];
  executiveSummary: string[];
  limitations: string[];
  generatedAt: string;
}

function loadAssumptions(assessmentId: string) {
  return prisma.lcaAssumption.findMany({
    where: { assessmentId },
    include: { owner: true, approvedBy: true, inventoryItem: { select: { name: true } }, process: { select: { name: true } }, evidence: true },
    orderBy: [{ materiality: "desc" }, { recordedAt: "asc" }],
  });
}

function loadExclusions(assessmentId: string) {
  return prisma.lcaExclusion.findMany({
    where: { assessmentId },
    include: { owner: true, approvedBy: true, process: { select: { name: true } }, evidence: true },
    orderBy: { recordedAt: "asc" },
  });
}

function loadEvidence(assessmentId: string) {
  return prisma.lcaEvidence.findMany({
    where: { assessmentId },
    include: {
      uploadedBy: true,
      inventoryItem: { select: { name: true } },
      process: { select: { name: true } },
      supplierPcf: { select: { productName: true } },
      assumption: { select: { assumption: true } },
      exclusion: { select: { excludedItem: true } },
      verification: { select: { organisation: true } },
    },
    orderBy: { uploadedAt: "asc" },
  });
}

function loadVerifications(assessmentId: string) {
  return prisma.lcaVerification.findMany({
    where: { assessmentId },
    include: { recordedBy: true, evidence: true },
    orderBy: { verificationDate: "desc" },
  });
}

function loadCorporateLinks(assessmentId: string) {
  return prisma.lcaCorporateDataLink.findMany({
    where: { inventoryItem: { assessmentId } },
    include: {
      inventoryItem: { select: { id: true, name: true } },
      site: { select: { name: true, entity: { select: { name: true } } } },
      activityEntry: {
        select: {
          id: true,
          periodStart: true,
          periodEnd: true,
          rawValue: true,
          rawUnit: true,
          activityDataPoint: { select: { code: true, dataPointName: true } },
        },
      },
    },
  });
}

export async function buildAssessmentReport(assessmentId: string): Promise<AssessmentReport> {
  const [assessment, run, staleness, validation, readiness, assumptions, exclusions, evidence, verifications, corporateLinks, versions, scenarioAssessments] =
    await Promise.all([
      loadAssessmentOrThrow(assessmentId),
      getLatestRun(assessmentId),
      isCalculationStale(assessmentId),
      runValidation(assessmentId),
      buildReadinessReport(assessmentId),
      loadAssumptions(assessmentId),
      loadExclusions(assessmentId),
      loadEvidence(assessmentId),
      loadVerifications(assessmentId),
      loadCorporateLinks(assessmentId),
      prisma.lcaAssessmentVersion.findMany({
        where: { assessmentId },
        include: { issuedBy: true },
        orderBy: { version: "desc" },
      }),
      prisma.lcaAssessment.findMany({
        where: { baselineAssessmentId: assessmentId },
        orderBy: { createdAt: "asc" },
      }),
    ]);

  const rows = run ? resultsToAnalysisRows(run.results) : [];
  const totals = run ? runTotals(run) : null;
  const methodology = toMethodologyConfig(assessment.methodologyProfile);

  const contributions = run ? analyseContributions(rows) : null;
  const dataQuality = run ? summariseDataQuality(rows) : null;
  const uncertainty = run ? summariseUncertainty(rows) : null;
  const sensitivity = run ? sensitivityAnalysis(rows) : null;

  // Scenario comparisons, each against this assessment's own latest run.
  const scenarios: ScenarioSummary[] = [];
  for (const scenario of scenarioAssessments) {
    const scenarioRun = await getLatestRun(scenario.id);
    const scenarioRows = scenarioRun ? resultsToAnalysisRows(scenarioRun.results) : [];
    const scenarioTotals = scenarioRun ? runTotals(scenarioRun) : null;
    scenarios.push({
      id: scenario.id,
      reference: scenario.reference,
      title: scenario.title,
      description: scenario.scenarioDescription,
      calculated: Boolean(scenarioRun),
      comparison:
        run && scenarioRun && totals && scenarioTotals
          ? compareScenario(
              rows,
              scenarioRows,
              D(totals.headlinePerFunctionalUnitKgCo2e),
              D(scenarioTotals.headlinePerFunctionalUnitKgCo2e),
            )
          : null,
    });
  }

  const factorSourceMap = new Map<string, { source: string; version: string; count: number; isPlaceholder: boolean }>();
  for (const result of run?.results ?? []) {
    const key = `${result.factorSource}|${result.factorVersion}`;
    const existing = factorSourceMap.get(key);
    if (existing) existing.count += 1;
    else
      factorSourceMap.set(key, {
        source: result.factorSource,
        version: result.factorVersion,
        count: 1,
        isPlaceholder: result.isPlaceholderFactor,
      });
  }

  return {
    assessment,
    productName: assessment.productVersion.product.name,
    productSku: assessment.productVersion.product.sku,
    productVersionLabel: assessment.productVersion.versionLabel,
    manufacturingLocations: assessment.productVersion.manufacturingLocations.map((l) => ({
      name: l.name,
      country: l.country,
      siteName: l.site?.name ?? null,
    })),
    entityName: assessment.entity.name,
    status: assessment.status,
    statusLabel: STATUS_LABELS[assessment.status],
    methodology,
    run,
    totals,
    staleness,
    contributions,
    dataQuality,
    uncertainty,
    sensitivity,
    validation,
    readiness,
    assumptions,
    exclusions,
    evidence,
    verifications,
    corporateLinks,
    scenarios,
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      label: v.label,
      status: v.status,
      issuedAt: v.issuedAt,
      issuedByName: v.issuedBy?.name ?? null,
    })),
    factorSources: Array.from(factorSourceMap.values()).sort((a, b) => b.count - a.count),
    executiveSummary: buildExecutiveSummary({
      assessment,
      methodology,
      totals,
      contributions,
      dataQuality,
      uncertainty,
      validation,
      exclusionCount: exclusions.length,
      verified: verifications.length > 0,
      staleness,
    }),
    limitations: buildLimitations({ assessment, methodology, dataQuality, uncertainty, validation, exclusions: exclusions.length }),
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

function buildExecutiveSummary(args: {
  assessment: LoadedAssessment;
  methodology: MethodologyConfig;
  totals: SerialisedTotals | null;
  contributions: ContributionAnalysis | null;
  dataQuality: DataQualitySummary | null;
  uncertainty: UncertaintySummary | null;
  validation: ValidationReport;
  exclusionCount: number;
  verified: boolean;
  staleness: { stale: boolean; reason: string | null };
}): string[] {
  const { assessment, methodology, totals, contributions, dataQuality, uncertainty, validation } = args;
  const parts: string[] = [];

  const unitLabel = assessment.isDeclaredUnit ? "declared unit" : "functional unit";
  const unitDescription =
    assessment.functionalUnitDescription ??
    (assessment.functionalUnitUnit ? `${assessment.functionalUnitQuantity.toString()} ${assessment.functionalUnitUnit}` : "an unstated unit");

  if (!totals) {
    parts.push(
      `This assessment of ${assessment.productVersion.product.name} (${assessment.productVersion.versionLabel}) has not yet been calculated, so it carries no result. The sections below describe the model as it stands.`,
    );
    return parts;
  }

  parts.push(
    `The product carbon footprint of ${assessment.productVersion.product.name} (${assessment.productVersion.versionLabel}) is ${toDisplayString(D(totals.headlinePerFunctionalUnitKgCo2e), 4)} kgCO2e per ${unitLabel}, where the ${unitLabel} is ${unitDescription}. The assessment covers a ${BOUNDARY_LABELS[assessment.boundary].toLowerCase()} boundary${assessment.periodStart && assessment.periodEnd ? `, using activity data for the period ${assessment.periodStart.toISOString().slice(0, 10)} to ${assessment.periodEnd.toISOString().slice(0, 10)}` : ""}.`,
  );

  parts.push(
    `The model as entered represents ${toDisplayString(assessment.modelledOutputQuantity)} ${assessment.modelledOutputUnit ?? "units"} of output and totals ${toDisplayString(D(totals.headlineModelKgCo2e), 2)} kgCO2e, which is ${toDisplayString(D(totals.functionalUnitsInModel))} ${unitLabel}s.`,
  );

  if (contributions && contributions.byStage.length > 0) {
    const top = contributions.byStage.slice(0, 3);
    parts.push(
      `The largest contributions come from ${top
        .map((s) => `${s.label.toLowerCase()} (${s.percent.toFixed(1)}%)`)
        .join(", ")}${contributions.byStage.length > 3 ? ", with the remaining stages making up the balance" : ""}.`,
    );
  }

  if (contributions && contributions.hotspots.length > 0) {
    const hotspot = contributions.hotspots[0];
    parts.push(
      `The single largest line is ${hotspot.label} at ${hotspot.percent.toFixed(1)}% of gross emissions — the first place to look for a reduction, and the first place a reviewer will look at the data.`,
    );
  }

  // Carbon classes are reported separately and said so out loud, because the
  // difference between a gross figure and a netted one is the whole argument.
  const classNotes: string[] = [];
  if (totals.model.biogenicRemovals !== 0 || totals.model.biogenicEmissions !== 0) {
    classNotes.push(
      `biogenic emissions of ${toDisplayString(D(totals.perFunctionalUnit.biogenicEmissions), 4)} and biogenic removals of ${toDisplayString(D(totals.perFunctionalUnit.biogenicRemovals), 4)} kgCO2e per ${unitLabel}, ${methodology.biogenicTreatment === "INCLUDED_IN_TOTAL" ? "which are included in the headline figure" : "which are reported separately and are not in the headline figure"}`,
    );
  }
  if (totals.model.storedCarbon !== 0) {
    classNotes.push(`${toDisplayString(D(totals.perFunctionalUnit.storedCarbon), 4)} kgCO2e per ${unitLabel} of carbon held in the product, recorded as a memo item only`);
  }
  if (totals.model.avoidedBurden !== 0) {
    classNotes.push(`an avoided-burden credit of ${toDisplayString(D(totals.perFunctionalUnit.avoidedBurden), 4)} kgCO2e per ${unitLabel} under the assessment's ${methodology.recyclingMethod.replace(/_/g, " ").toLowerCase()} treatment`);
  }
  if (totals.model.offsets !== 0) {
    classNotes.push(`${toDisplayString(D(totals.perFunctionalUnit.offsets), 4)} kgCO2e per ${unitLabel} of purchased offsets, which do not reduce the reported footprint`);
  }
  if (classNotes.length > 0) {
    parts.push(`Alongside the headline figure the assessment records ${classNotes.join("; ")}.`);
  }

  if (dataQuality) {
    const primary = dataQuality.coverage.find((c) => c.dataType === LcaDataType.PRIMARY)?.percent ?? 0;
    const supplier = dataQuality.coverage.find((c) => c.dataType === LcaDataType.SUPPLIER_SPECIFIC)?.percent ?? 0;
    const proxy = dataQuality.coverage.find((c) => c.dataType === LcaDataType.PROXY)?.percent ?? 0;
    parts.push(
      `Primary data covers ${primary.toFixed(1)}% of the footprint and supplier-specific data a further ${supplier.toFixed(1)}%${proxy > 0 ? `, with ${proxy.toFixed(1)}% resting on proxy data` : ""}. The footprint-weighted data-quality score is ${dataQuality.footprintWeightedScore !== null ? dataQuality.footprintWeightedScore.toFixed(2) : "not available, because no lines have been scored"}${dataQuality.footprintWeightedScore !== null ? " on a scale where 1 is best and 5 is worst" : ""}.`,
    );
    if (dataQuality.placeholderFactorPercent > 0) {
      parts.push(
        `${dataQuality.placeholderFactorPercent.toFixed(1)}% of the footprint is priced from placeholder emission factors. Those values are illustrative and must be replaced before this figure is relied on.`,
      );
    }
  }

  if (uncertainty?.combinedPercent !== null && uncertainty !== null) {
    parts.push(
      `Combining the line-level uncertainties that have been recorded gives an indicative range of ±${uncertainty.combinedPercent?.toFixed(1)}%, covering ${uncertainty.coveragePercent.toFixed(1)}% of emissions. ${uncertainty.caveat}`,
    );
  }

  if (args.staleness.stale) {
    parts.push(`These figures are out of date: ${args.staleness.reason}`);
  }
  if (validation.errorCount > 0) {
    parts.push(
      `${validation.errorCount} validation error(s) are outstanding, so this assessment is not in a state to be offered for independent verification.`,
    );
  }
  if (args.exclusionCount > 0) {
    parts.push(`${args.exclusionCount} exclusion(s) are recorded in the exclusions register and remain visible to reviewers.`);
  }
  parts.push(
    args.verified
      ? "Verification details are recorded in the review section. The conclusions of any independent verification are the verifier's, not this platform's."
      : "This assessment has not been independently verified. Nothing in this report constitutes a certification or a conformity claim.",
  );

  return parts;
}

function buildLimitations(args: {
  assessment: LoadedAssessment;
  methodology: MethodologyConfig;
  dataQuality: DataQualitySummary | null;
  uncertainty: UncertaintySummary | null;
  validation: ValidationReport;
  exclusions: number;
}): string[] {
  const limitations: string[] = [];

  if (args.assessment.boundary !== "CRADLE_TO_GRAVE" && args.assessment.boundary !== "CRADLE_TO_CRADLE") {
    limitations.push(
      `The boundary is ${BOUNDARY_LABELS[args.assessment.boundary].toLowerCase()}, so stages outside it are not represented in the result. Comparing this figure with a footprint drawn on a different boundary would be misleading.`,
    );
  }
  if (args.assessment.isDeclaredUnit) {
    limitations.push(
      "The result is expressed against a declared unit rather than a functional unit, because the boundary stops before the product delivers its function. It is not a basis for comparing products on the service they provide.",
    );
  }
  if (args.dataQuality && args.dataQuality.unscoredEmissionsPercent > 0) {
    limitations.push(
      `${args.dataQuality.unscoredEmissionsPercent.toFixed(1)}% of the footprint sits on lines with no data-quality scores, so the weighted quality figure describes only part of the result.`,
    );
  }
  if (args.uncertainty && args.uncertainty.coveragePercent < 100) {
    limitations.push(
      `Uncertainty has been recorded for lines covering ${args.uncertainty.coveragePercent.toFixed(1)}% of emissions. The stated range therefore understates total uncertainty, and it assumes the line uncertainties are independent, which they are not where lines share a data source. No Monte Carlo simulation has been run.`,
    );
  }
  if (args.exclusions > 0) {
    limitations.push(
      `${args.exclusions} item(s) are excluded under the assessment's cut-off rules. Their estimated relevance is recorded in the exclusions register.`,
    );
  }
  if (args.methodology.recyclingMethod === "CUT_OFF") {
    limitations.push(
      "End-of-life recycling earns no credit under the cut-off treatment used here. A different recycling methodology would give a different figure for the same physical product, which is why the treatment is stated rather than assumed.",
    );
  }
  limitations.push(
    "This is a greenhouse gas assessment expressed as CO2 equivalent. It says nothing about water, land use, toxicity, biodiversity or any other environmental impact, and a low carbon footprint does not imply a low impact overall.",
  );
  if (args.validation.warningCount > 0) {
    limitations.push(`${args.validation.warningCount} validation warning(s) remain open; each is listed in the review section with its reasoning.`);
  }

  return limitations;
}

// ---------------------------------------------------------------------------
// Calculation register export
// ---------------------------------------------------------------------------

export const CALCULATION_REGISTER_COLUMNS = [
  "Stage",
  "Process",
  "Input",
  "Item type",
  "Carbon classification",
  "Supplier",
  "Material",
  "Activity",
  "Activity unit",
  "Conversion factor",
  "Normalized activity",
  "Normalized unit",
  "Factor",
  "Factor value (kgCO2e per unit)",
  "Factor unit",
  "Factor source",
  "Factor version",
  "Factor boundary",
  "Factor geography",
  "Factor year",
  "GWP basis",
  "Placeholder factor",
  "Data type",
  "Allocation method",
  "Allocation factor",
  "Adjustment factor",
  "Calculation",
  "Gross kgCO2e",
  "Allocated kgCO2e",
  "kgCO2e per functional unit",
  "Data quality score (1 best - 5 worst)",
  "Uncertainty %",
];

export async function buildCalculationRegisterCsv(assessmentId: string): Promise<{ csv: string; fileName: string } | null> {
  const [assessment, run] = await Promise.all([loadAssessmentOrThrow(assessmentId), getLatestRun(assessmentId)]);
  if (!run) return null;

  const header =
    `# Calculation register — ${assessment.reference} ${assessment.title}\n` +
    `# Product: ${assessment.productVersion.product.name} (${assessment.productVersion.versionLabel})\n` +
    `# Calculation run ${run.id} at ${run.runAt.toISOString()} on engine ${run.engineVersion}\n` +
    `# Functional unit: ${assessment.functionalUnitDescription ?? "not stated"}\n` +
    `# Every figure below is reproducible from the columns on its own row.\n`;

  const rows = run.results.map((r) => [
    STAGE_LABELS[r.stage],
    r.processName,
    r.itemName,
    r.itemType,
    r.classification,
    r.supplierName ?? "",
    r.materialName ?? "",
    toExactString(r.activityValue),
    r.activityUnit,
    toExactString(r.conversionFactor),
    toExactString(r.normalizedValue),
    r.normalizedUnit,
    r.emissionFactorId ?? r.factorSelectionMode,
    toExactString(r.factorValue),
    r.factorUnit,
    r.factorSource,
    r.factorVersion,
    r.factorBoundary,
    r.factorGeography ?? "",
    r.factorYear ?? "",
    r.factorGwpBasis ?? "",
    r.isPlaceholderFactor ? "YES — illustrative only" : "no",
    r.dataType,
    r.allocationMethod,
    toExactString(r.allocationFactor),
    toExactString(r.adjustmentFactor),
    r.formula,
    toExactString(r.grossKgCo2e),
    toExactString(r.allocatedKgCo2e),
    toExactString(r.perFunctionalUnitKgCo2e),
    r.dataQualityScore ? toExactString(r.dataQualityScore) : "",
    r.uncertaintyPercent ? toExactString(r.uncertaintyPercent) : "",
  ]);

  const totals = runTotals(run);
  const footer =
    csvRow([]) +
    csvRow(["TOTALS", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", toExactString(D(totals.model.fossil)), toExactString(D(totals.perFunctionalUnit.fossil)), "", ""]) +
    csvRow([`# Headline: ${totals.headlinePerFunctionalUnitKgCo2e} kgCO2e per functional unit (${totals.functionalUnitsInModel} functional units in the model).`]) +
    csvRow([`# Fossil ${totals.model.fossil}; biogenic emissions ${totals.model.biogenicEmissions}; biogenic removals ${totals.model.biogenicRemovals}; technological removals ${totals.model.technologicalRemovals}; stored carbon ${totals.model.storedCarbon}; avoided burden ${totals.model.avoidedBurden}; offsets ${totals.model.offsets} (all kgCO2e over the whole model).`]);

  return {
    csv: header + toCsv(CALCULATION_REGISTER_COLUMNS, rows) + footer,
    fileName: `${assessment.reference}-calculation-register.csv`,
  };
}

// ---------------------------------------------------------------------------
// Structured export
// ---------------------------------------------------------------------------

export async function buildStructuredExport(assessmentId: string) {
  const report = await buildAssessmentReport(assessmentId);
  return {
    schema: "paragon-id-carbon.product-assessment.v1",
    exportedAt: new Date().toISOString(),
    assessment: {
      id: report.assessment.id,
      reference: report.assessment.reference,
      title: report.assessment.title,
      status: report.assessment.status,
      version: report.assessment.version,
      entity: report.entityName,
      product: {
        name: report.productName,
        sku: report.productSku,
        version: report.productVersionLabel,
        manufacturingLocations: report.manufacturingLocations,
      },
      goal: report.assessment.goal,
      intendedApplication: report.assessment.intendedApplication,
      intendedAudience: report.assessment.intendedAudience,
      comparativeAssertionDisclosed: report.assessment.comparativeAssertionDisclosed,
      scope: report.assessment.scopeDescription,
      boundary: report.assessment.boundary,
      boundaryNotes: report.assessment.boundaryNotes,
      includedStages: report.assessment.includedStages,
      period: {
        start: report.assessment.periodStart?.toISOString() ?? null,
        end: report.assessment.periodEnd?.toISOString() ?? null,
      },
      functionalUnit: {
        description: report.assessment.functionalUnitDescription,
        quantity: report.assessment.functionalUnitQuantity.toString(),
        unit: report.assessment.functionalUnitUnit,
        isDeclaredUnit: report.assessment.isDeclaredUnit,
        declaredUnitDescription: report.assessment.declaredUnitDescription,
      },
      referenceFlow: {
        description: report.assessment.referenceFlowDescription,
        quantity: report.assessment.referenceFlowQuantity.toString(),
        unit: report.assessment.referenceFlowUnit,
      },
      modelledOutput: {
        quantity: report.assessment.modelledOutputQuantity.toString(),
        unit: report.assessment.modelledOutputUnit,
        description: report.assessment.modelledOutputDescription,
      },
    },
    methodology: report.methodology,
    model: {
      processes: report.assessment.processes.map((p) => ({
        id: p.id,
        parentProcessId: p.parentProcessId,
        stage: p.stage,
        name: p.name,
        description: p.description,
        isIncluded: p.isIncluded,
        allocationMethod: p.allocationMethod,
        allocationPercent: p.allocationPercent.toString(),
        allocationRationale: p.allocationRationale,
        outputs: p.outputs.map((o) => ({
          name: o.name,
          isAssessedProduct: o.isAssessedProduct,
          mass: o.massValue ? `${o.massValue.toString()} ${o.massUnit ?? ""}` : null,
          physical: o.physicalValue ? `${o.physicalValue.toString()} ${o.physicalUnit ?? ""}` : null,
          economic: o.economicValue ? `${o.economicValue.toString()} ${o.economicCurrency ?? ""}` : null,
        })),
      })),
      inventory: report.assessment.inventoryItems.map((i) => ({
        id: i.id,
        processId: i.processId,
        itemType: i.itemType,
        name: i.name,
        component: i.componentName,
        partNumber: i.partNumber,
        material: i.materialName,
        supplier: i.supplier?.name ?? null,
        quantity: i.quantity.toString(),
        unit: i.unit,
        recycledContentPercent: i.recycledContentPercent?.toString() ?? null,
        wastePercent: i.wastePercent?.toString() ?? null,
        adjustmentFactor: i.adjustmentFactor.toString(),
        dataType: i.dataType,
        dataSource: i.dataSource,
        geography: i.geography,
        classification: i.classification,
        factorSelectionMode: i.factorSelectionMode,
        dataQuality: {
          temporal: i.temporalScore,
          geographical: i.geographicalScore,
          technological: i.technologicalScore,
          completeness: i.completenessScore,
          reliability: i.reliabilityScore,
        },
        uncertainty: {
          status: i.uncertaintyStatus,
          percent: i.uncertaintyPercent?.toString() ?? null,
          lower: i.uncertaintyLower?.toString() ?? null,
          upper: i.uncertaintyUpper?.toString() ?? null,
          notes: i.uncertaintyNotes,
        },
        isExcluded: i.isExcluded,
        exclusionReason: i.exclusionReason,
        transportLegs: i.transportLegs.map((l) => ({
          sequence: l.sequence,
          mode: l.mode,
          origin: l.originName,
          destination: l.destinationName,
          distance: `${l.distanceValue.toString()} ${l.distanceUnit}`,
          mass: `${l.massValue.toString()} ${l.massUnit}`,
          loadFactorPercent: l.loadFactorPercent?.toString() ?? null,
          includesReturnTrip: l.includesReturnTrip,
          assumptions: l.assumptions,
        })),
        endOfLifeRoutes: i.endOfLifeRoutes.map((r) => ({
          route: r.route,
          percent: r.percent.toString(),
          recoveryRatePercent: r.recoveryRatePercent?.toString() ?? null,
          avoidedFactorValue: r.avoidedFactorValue?.toString() ?? null,
          avoidedFactorSource: r.avoidedFactorSource,
          recoveryAssumptions: r.recoveryAssumptions,
        })),
      })),
    },
    results: report.totals,
    contributions: report.contributions,
    dataQuality: report.dataQuality,
    uncertainty: report.uncertainty,
    sensitivity: report.sensitivity,
    factorSnapshot: report.run?.factorSnapshot ?? null,
    calculationRegister:
      report.run?.results.map((r) => ({
        stage: r.stage,
        process: r.processName,
        item: r.itemName,
        activity: `${r.activityValue.toString()} ${r.activityUnit}`,
        normalized: `${r.normalizedValue.toString()} ${r.normalizedUnit}`,
        factor: `${r.factorValue.toString()} kgCO2e/${r.factorUnit}`,
        factorSource: r.factorSource,
        factorVersion: r.factorVersion,
        formula: r.formula,
        allocatedKgCo2e: r.allocatedKgCo2e.toString(),
        perFunctionalUnitKgCo2e: r.perFunctionalUnitKgCo2e.toString(),
        provenance: r.provenance,
      })) ?? [],
    registers: {
      assumptions: report.assumptions.map((a) => ({
        assumption: a.assumption,
        category: a.category,
        rationale: a.rationale,
        source: a.source,
        uncertainty: a.uncertainty,
        materiality: a.materiality,
        owner: a.owner?.name ?? null,
        approvedBy: a.approvedBy?.name ?? null,
        approvedAt: a.approvedAt?.toISOString() ?? null,
        recordedAt: a.recordedAt.toISOString(),
        linkedTo: a.inventoryItem?.name ?? a.process?.name ?? null,
      })),
      exclusions: report.exclusions.map((e) => ({
        excludedItem: e.excludedItem,
        rationale: e.rationale,
        estimatedRelevance: e.estimatedRelevance,
        estimatedPercentOfTotal: e.estimatedPercentOfTotal?.toString() ?? null,
        owner: e.owner?.name ?? null,
        approvedBy: e.approvedBy?.name ?? null,
        approvedAt: e.approvedAt?.toISOString() ?? null,
        recordedAt: e.recordedAt.toISOString(),
      })),
    },
    evidence: report.evidence.map((e) => ({
      title: e.title,
      kind: e.kind,
      fileName: e.fileName,
      checksumSha256: e.checksumSha256,
      externalUrl: e.externalUrl,
      uploadedAt: e.uploadedAt.toISOString(),
      uploadedBy: e.uploadedBy?.name ?? null,
    })),
    corporateLinks: report.corporateLinks.map((l) => ({
      inventoryItem: l.inventoryItem.name,
      linkType: l.linkType,
      site: l.site?.name ?? null,
      corporateRecord: l.activityEntry
        ? `${l.activityEntry.activityDataPoint.code} ${l.activityEntry.activityDataPoint.dataPointName} (${l.activityEntry.rawValue.toString()} ${l.activityEntry.rawUnit})`
        : null,
      allocationPercent: l.allocationPercent.toString(),
      allocationBasis: l.allocationBasis,
      note: "Reference only. No emissions are transferred between the corporate inventory and this product footprint in either direction.",
    })),
    validation: report.validation,
    readiness: report.readiness,
    verifications: report.verifications.map((v) => ({
      organisation: v.organisation,
      verifier: v.verifierName,
      date: v.verificationDate.toISOString(),
      assuranceType: v.assuranceType,
      scope: v.scopeOfVerification,
      statementReference: v.statementReference,
      conclusion: v.conclusion,
    })),
    versions: report.versions,
    executiveSummary: report.executiveSummary,
    limitations: report.limitations,
    interpretation: report.assessment.interpretation,
    notice:
      "Produced by an internal carbon accounting platform. Nothing in this export is a certification, a verification opinion or a claim of conformity with any standard.",
  };
}

// ---------------------------------------------------------------------------
// PACT-aligned export
// ---------------------------------------------------------------------------

export async function buildPactExport(assessmentId: string): Promise<PactExportOutcome> {
  const report = await buildAssessmentReport(assessmentId);
  const { assessment, totals, dataQuality } = report;

  if (!totals) {
    throw new Error("This assessment has not been calculated, so there is no footprint to export.");
  }

  const verification = report.verifications[0] ?? null;
  const packagingKg =
    report.contributions?.byStage.find((s) => s.key === "PACKAGING")?.perFunctionalUnitKgCo2e ?? null;

  return toPactFootprint({
    id: assessment.id,
    reference: assessment.reference,
    title: assessment.title,
    companyName: report.entityName,
    companyIds: [],
    productName: report.productName,
    productDescription: [report.productName, assessment.productVersion.product.description].filter(Boolean).join(" — "),
    productIds: [report.productSku],
    productCategoryCpc: assessment.productVersion.product.category ?? null,
    version: assessment.version,
    createdAt: assessment.createdAt,
    issuedAt: assessment.issuedAt,
    boundary: assessment.boundary,
    boundaryNotes: assessment.boundaryNotes,
    periodStart: assessment.periodStart,
    periodEnd: assessment.periodEnd,
    geographyCountry: assessment.productVersion.manufacturingLocations[0]?.country ?? null,
    gwpBasis: report.methodology.gwpBasis,
    allocationRules: report.methodology.allocationRules,
    biogenicRules: report.methodology.biogenicRules,
    standardsReferenced: report.methodology.standardsReferenced,
    uncertaintyDescription: report.uncertainty
      ? `${report.uncertainty.method} ${report.uncertainty.caveat}`
      : null,
    exemptedEmissionsPercent: report.exclusions.reduce(
      (sum, e) => sum + (e.estimatedPercentOfTotal ? toNumber(e.estimatedPercentOfTotal) : 0),
      0,
    ),
    exemptedEmissionsDescription:
      report.exclusions.length > 0 ? report.exclusions.map((e) => `${e.excludedItem}: ${e.rationale}`).join("; ") : null,
    packagingIncluded: assessment.includedStages.includes("PACKAGING"),
    packagingKgCo2e: packagingKg,
    primaryDataSharePercent:
      dataQuality?.coverage.find((c) => c.dataType === LcaDataType.PRIMARY)?.percent ?? null,
    dataQuality: {
      coveragePercent: dataQuality ? 100 - dataQuality.unscoredEmissionsPercent : undefined,
      technological: dataQuality?.footprintWeightedScore ?? undefined,
      temporal: dataQuality?.footprintWeightedScore ?? undefined,
      geographical: dataQuality?.footprintWeightedScore ?? undefined,
      completeness: dataQuality?.footprintWeightedScore ?? undefined,
      reliability: dataQuality?.footprintWeightedScore ?? undefined,
    },
    verification: verification
      ? {
          verified: true,
          providerName: verification.organisation,
          level: verification.assuranceType,
          coverage: verification.scopeOfVerification,
          boundary: assessment.boundary,
          completedAt: verification.verificationDate,
          standardName: verification.statementReference,
          comments: verification.conclusion,
        }
      : null,
    functionalUnitQuantity: D(assessment.functionalUnitQuantity),
    functionalUnitUnit: assessment.functionalUnitUnit,
    results: {
      fossilKgCo2ePerFunctionalUnit: D(totals.perFunctionalUnit.fossil),
      biogenicEmissionsKgCo2ePerFunctionalUnit: D(totals.perFunctionalUnit.biogenicEmissions),
      biogenicRemovalsKgCo2ePerFunctionalUnit: D(totals.perFunctionalUnit.biogenicRemovals),
    },
    secondaryFactorSources: report.factorSources.map((f) => `${f.source} (${f.version})`),
  });
}

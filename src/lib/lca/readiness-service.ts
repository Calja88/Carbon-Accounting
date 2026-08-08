/**
 * Verification readiness.
 *
 * Answers one question — "if an independent reviewer looked at this today,
 * what would they find?" — across the areas a reviewer actually works
 * through, and says *why* for each one.
 *
 * Deliberately not a score, a percentage or a badge. Readiness is a statement
 * about whether the work can be reviewed, not a claim that it conforms to any
 * standard: only an independent verifier can say that, and this software
 * never will.
 */

import { LcaAssessmentStatus, LcaDataType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getLatestRun,
  isCalculationStale,
  loadAssessmentOrThrow,
  resultsToAnalysisRows,
  type LoadedAssessment,
  type LoadedRun,
} from "./calculation-service";
import { summariseDataQuality, summariseUncertainty } from "./analysis";
import { runValidation, type ValidationReport } from "./validation-service";
import { toMethodologyConfig } from "./methodology";
import { STAGE_LABELS } from "./labels";

export type ReadinessState = "NOT_READY" | "SIGNIFICANT_GAPS" | "REVIEW_RECOMMENDED" | "READY_FOR_INDEPENDENT_REVIEW";

export const READINESS_LABELS: Record<ReadinessState, string> = {
  NOT_READY: "Not ready",
  SIGNIFICANT_GAPS: "Significant gaps",
  REVIEW_RECOMMENDED: "Internal review recommended",
  READY_FOR_INDEPENDENT_REVIEW: "Ready for independent review",
};

export const READINESS_TONES: Record<ReadinessState, "danger" | "warning" | "info" | "success"> = {
  NOT_READY: "danger",
  SIGNIFICANT_GAPS: "danger",
  REVIEW_RECOMMENDED: "warning",
  READY_FOR_INDEPENDENT_REVIEW: "success",
};

export const READINESS_DESCRIPTIONS: Record<ReadinessState, string> = {
  NOT_READY: "Something essential is missing or wrong. A reviewer could not form a view on the figures as they stand.",
  SIGNIFICANT_GAPS: "The assessment holds together, but there are gaps a reviewer would raise immediately.",
  REVIEW_RECOMMENDED: "Nothing blocking remains. Work through the outstanding warnings internally before commissioning an independent review.",
  READY_FOR_INDEPENDENT_REVIEW: "The assessment is complete, calculated, documented and traceable. An independent reviewer has what they need to start.",
};

export type ReadinessArea =
  | "goal_and_scope"
  | "lifecycle_completeness"
  | "inventory_completeness"
  | "factors"
  | "data_quality"
  | "methodology"
  | "assumptions"
  | "exclusions"
  | "evidence"
  | "validation"
  | "auditability";

export const AREA_LABELS: Record<ReadinessArea, string> = {
  goal_and_scope: "Goal and scope",
  lifecycle_completeness: "Lifecycle completeness",
  inventory_completeness: "Inventory completeness",
  factors: "Emission factors",
  data_quality: "Data quality",
  methodology: "Methodology",
  assumptions: "Assumptions register",
  exclusions: "Exclusions register",
  evidence: "Evidence",
  validation: "Validation",
  auditability: "Auditability",
};

export interface ReadinessAreaResult {
  area: ReadinessArea;
  label: string;
  state: ReadinessState;
  /** Plain-English reason, always populated — never a bare state. */
  explanation: string;
  /** What would move this area forward, when anything would. */
  nextStep: string | null;
  facts: string[];
}

export interface ReadinessReport {
  overall: ReadinessState;
  overallExplanation: string;
  areas: ReadinessAreaResult[];
  validation: ValidationReport;
  assessedAt: string;
  disclaimer: string;
}

const WORST_FIRST: ReadinessState[] = ["NOT_READY", "SIGNIFICANT_GAPS", "REVIEW_RECOMMENDED", "READY_FOR_INDEPENDENT_REVIEW"];

function worst(states: ReadinessState[]): ReadinessState {
  for (const state of WORST_FIRST) {
    if (states.includes(state)) return state;
  }
  return "READY_FOR_INDEPENDENT_REVIEW";
}

export interface ReadinessInput {
  assessment: LoadedAssessment;
  run: LoadedRun | null;
  staleness: { stale: boolean; reason: string | null };
  validation: ValidationReport;
  counts: {
    assumptions: number;
    approvedAssumptions: number;
    exclusions: number;
    approvedExclusions: number;
    evidence: number;
    auditEvents: number;
    verifications: number;
    versions: number;
  };
}

export function assessReadiness(input: ReadinessInput): ReadinessReport {
  const { assessment, run, staleness, validation, counts } = input;
  const methodology = toMethodologyConfig(assessment.methodologyProfile);
  const errorsIn = (codes: string[]) => validation.issues.filter((i) => i.severity === "ERROR" && codes.includes(i.code));
  const bySection = (section: string, severity?: string) =>
    validation.issues.filter((i) => i.section === section && (!severity || i.severity === severity));

  const areas: ReadinessAreaResult[] = [];

  // --- goal and scope ---------------------------------------------------
  {
    const errors = bySection("goal_and_scope", "ERROR");
    const warnings = bySection("goal_and_scope", "WARNING");
    const facts = [
      assessment.goal?.trim() ? "Goal recorded." : "No goal recorded.",
      assessment.functionalUnitDescription?.trim()
        ? `${assessment.isDeclaredUnit ? "Declared" : "Functional"} unit: ${assessment.functionalUnitDescription}.`
        : "No functional or declared unit recorded.",
      assessment.periodStart && assessment.periodEnd
        ? `Assessment period ${assessment.periodStart.toISOString().slice(0, 10)} to ${assessment.periodEnd.toISOString().slice(0, 10)}.`
        : "No assessment period recorded.",
      `Boundary: ${assessment.boundary.replace(/_/g, " ").toLowerCase()}, covering ${assessment.includedStages.length} stage(s).`,
    ];
    areas.push({
      area: "goal_and_scope",
      label: AREA_LABELS.goal_and_scope,
      state: errors.length > 0 ? "NOT_READY" : warnings.length > 0 ? "REVIEW_RECOMMENDED" : "READY_FOR_INDEPENDENT_REVIEW",
      explanation:
        errors.length > 0
          ? `${errors.length} essential element${errors.length === 1 ? " is" : "s are"} missing: ${errors.map((e) => e.title.toLowerCase()).join("; ")}. A reviewer cannot judge whether the data is fit for purpose without them.`
          : warnings.length > 0
            ? `Goal, functional unit, period and boundary are all recorded. ${warnings.length} supporting detail${warnings.length === 1 ? "" : "s"} would still be queried: ${warnings.map((w) => w.title.toLowerCase()).join("; ")}.`
            : "Goal, intended application, scope, boundary, period and functional unit are all recorded and internally consistent.",
      nextStep: errors.length > 0 ? "Complete the goal and scope page." : warnings.length > 0 ? "Fill in the remaining scope detail." : null,
      facts,
    });
  }

  // --- lifecycle completeness -------------------------------------------
  {
    const includedProcesses = assessment.processes.filter((p) => p.isIncluded);
    const modelledStages = new Set(includedProcesses.map((p) => p.stage));
    const declared = assessment.includedStages;
    const missing = declared.filter((s) => !modelledStages.has(s));
    const emptyProcesses = includedProcesses.filter(
      (p) => !assessment.inventoryItems.some((i) => i.processId === p.id && !i.isExcluded),
    );

    const state: ReadinessState =
      includedProcesses.length === 0
        ? "NOT_READY"
        : missing.length > 0
          ? "SIGNIFICANT_GAPS"
          : emptyProcesses.length > 0
            ? "REVIEW_RECOMMENDED"
            : "READY_FOR_INDEPENDENT_REVIEW";

    areas.push({
      area: "lifecycle_completeness",
      label: AREA_LABELS.lifecycle_completeness,
      state,
      explanation:
        includedProcesses.length === 0
          ? "The lifecycle model is empty — no processes have been added."
          : missing.length > 0
            ? `${missing.length} stage${missing.length === 1 ? " is" : "s are"} inside the declared boundary but ${missing.length === 1 ? "has" : "have"} no process: ${missing.map((s) => STAGE_LABELS[s]).join(", ")}. Either model them or move them into the exclusions register with a reason.`
            : emptyProcesses.length > 0
              ? `Every declared stage is modelled. ${emptyProcesses.length} process${emptyProcesses.length === 1 ? " has" : "es have"} no inventory yet: ${emptyProcesses.map((p) => p.name).join(", ")}.`
              : `All ${declared.length} declared stage(s) are modelled across ${includedProcesses.length} process(es), and every process carries inventory.`,
      nextStep:
        includedProcesses.length === 0
          ? "Add the processes that make up the product's lifecycle."
          : missing.length > 0
            ? "Model the missing stages, or exclude them explicitly."
            : emptyProcesses.length > 0
              ? "Add inventory to the empty processes."
              : null,
      facts: [
        `${includedProcesses.length} included process(es), ${assessment.processes.length - includedProcesses.length} excluded.`,
        `${modelledStages.size} of ${declared.length} declared stage(s) modelled.`,
      ],
    });
  }

  // --- inventory completeness -------------------------------------------
  {
    const items = assessment.inventoryItems;
    const included = items.filter((i) => !i.isExcluded);
    const errors = bySection("inventory", "ERROR");
    const state: ReadinessState =
      included.length === 0 ? "NOT_READY" : errors.length > 0 ? "SIGNIFICANT_GAPS" : bySection("inventory", "WARNING").length > 0 ? "REVIEW_RECOMMENDED" : "READY_FOR_INDEPENDENT_REVIEW";
    areas.push({
      area: "inventory_completeness",
      label: AREA_LABELS.inventory_completeness,
      state,
      explanation:
        included.length === 0
          ? "No inventory has been entered, so there is nothing to review."
          : errors.length > 0
            ? `${included.length} inventory line(s) recorded, but ${errors.length} ${errors.length === 1 ? "has" : "have"} a problem that stops them calculating.`
            : `${included.length} inventory line(s) recorded across ${new Set(included.map((i) => i.processId)).size} process(es), with ${items.length - included.length} excluded.`,
      nextStep: included.length === 0 ? "Enter the bill of materials and activity data." : errors.length > 0 ? "Fix the inventory errors listed under Validation." : null,
      facts: [
        `${included.length} included line(s), ${items.length - included.length} excluded.`,
        `${included.filter((i) => i.itemType === "TRANSPORT").length} transport line(s), ${included.filter((i) => i.endOfLifeRoutes.length > 0).length} line(s) with end-of-life routes.`,
      ],
    });
  }

  // --- factors ----------------------------------------------------------
  {
    const errors = bySection("factors", "ERROR");
    const warnings = bySection("factors", "WARNING");
    const placeholderErrors = errorsIn(["PLACEHOLDER_FACTOR"]);
    const state: ReadinessState =
      placeholderErrors.length > 0 || errors.length > 0 ? "NOT_READY" : warnings.length > 2 ? "SIGNIFICANT_GAPS" : warnings.length > 0 ? "REVIEW_RECOMMENDED" : "READY_FOR_INDEPENDENT_REVIEW";
    areas.push({
      area: "factors",
      label: AREA_LABELS.factors,
      state,
      explanation:
        placeholderErrors.length > 0
          ? `${placeholderErrors.length} line(s) are still priced from placeholder factors. Placeholder values are illustrative only and must be replaced with real published figures before any result is reported.`
          : errors.length > 0
            ? `${errors.length} factor problem(s) block the calculation: unassigned, unsourced, or with a unit that does not match the activity data.`
            : warnings.length > 0
              ? `Every line has a sourced factor. ${warnings.length} would be queried on vintage, geography or stated boundary.`
              : "Every line has a factor with a recorded source, version, boundary, geography and vintage consistent with the assessment period.",
      nextStep: errors.length > 0 ? "Assign or source the missing factors." : warnings.length > 0 ? "Review the flagged vintage and geography mismatches." : null,
      facts: run
        ? [`${new Set(run.results.map((r) => r.factorSource)).size} distinct factor source(s) used in the last run.`]
        : ["No calculation run yet."],
    });
  }

  // --- data quality -----------------------------------------------------
  {
    const rows = run ? resultsToAnalysisRows(run.results) : [];
    const dq = summariseDataQuality(rows);
    const uncertainty = summariseUncertainty(rows);
    const minimum = methodology.minimumDataQualityScore;
    const primaryShare =
      dq.coverage.find((c) => c.dataType === LcaDataType.PRIMARY)?.percent ??
      0;
    const supplierShare = dq.coverage.find((c) => c.dataType === LcaDataType.SUPPLIER_SPECIFIC)?.percent ?? 0;

    let state: ReadinessState;
    let explanation: string;
    if (!run || rows.length === 0) {
      state = "NOT_READY";
      explanation = "There are no calculated results to assess data quality against.";
    } else if (dq.footprintWeightedScore === null) {
      state = "SIGNIFICANT_GAPS";
      explanation = "No line has been scored on any data-quality dimension, so there is nothing to weight.";
    } else if (dq.unscoredEmissionsPercent > 25) {
      state = "SIGNIFICANT_GAPS";
      explanation = `${dq.unscoredEmissionsPercent.toFixed(1)}% of the footprint sits on lines with no data-quality scores — too much of the answer is unassessed to draw a conclusion from the weighted score of ${dq.footprintWeightedScore.toFixed(2)}.`;
    } else if (minimum !== null && dq.footprintWeightedScore > minimum) {
      state = "REVIEW_RECOMMENDED";
      explanation = `The footprint-weighted data-quality score is ${dq.footprintWeightedScore.toFixed(2)}, weaker than the ${minimum} this assessment's methodology asks for. Improving the largest contributors would move it most.`;
    } else {
      state = "READY_FOR_INDEPENDENT_REVIEW";
      explanation = `The footprint-weighted data-quality score is ${dq.footprintWeightedScore.toFixed(2)} (1 is best, 5 worst), with ${dq.unscoredEmissionsPercent.toFixed(1)}% of the footprint unscored. Primary and supplier-specific data cover ${(primaryShare + supplierShare).toFixed(1)}% of emissions.`;
    }

    areas.push({
      area: "data_quality",
      label: AREA_LABELS.data_quality,
      state,
      explanation,
      nextStep:
        state === "READY_FOR_INDEPENDENT_REVIEW"
          ? null
          : "Score the unscored lines, then replace secondary data on the largest contributors with primary or supplier-specific figures.",
      facts: [
        `Primary ${primaryShare.toFixed(1)}%, supplier-specific ${supplierShare.toFixed(1)}%, secondary ${(dq.coverage.find((c) => c.dataType === LcaDataType.SECONDARY)?.percent ?? 0).toFixed(1)}%, proxy ${(dq.coverage.find((c) => c.dataType === LcaDataType.PROXY)?.percent ?? 0).toFixed(1)}% of emissions.`,
        uncertainty.combinedPercent !== null
          ? `Indicative combined uncertainty ±${uncertainty.combinedPercent.toFixed(1)}%, covering ${uncertainty.coveragePercent.toFixed(1)}% of emissions.`
          : "No line-level uncertainty recorded.",
      ],
    });
  }

  // --- methodology ------------------------------------------------------
  {
    const hasProfile = Boolean(assessment.methodologyProfileId);
    const allocationIssues = bySection("allocation", "ERROR");
    const state: ReadinessState = !hasProfile
      ? "NOT_READY"
      : allocationIssues.length > 0
        ? "SIGNIFICANT_GAPS"
        : bySection("allocation", "WARNING").length > 0
          ? "REVIEW_RECOMMENDED"
          : "READY_FOR_INDEPENDENT_REVIEW";
    areas.push({
      area: "methodology",
      label: AREA_LABELS.methodology,
      state,
      explanation: !hasProfile
        ? "No methodology profile is attached, so the rules that decide allocation, recycling treatment, electricity approach, biogenic accounting and offsets are undefined."
        : allocationIssues.length > 0
          ? `The methodology "${methodology.name} ${methodology.version}" is attached, but ${allocationIssues.length} multi-output process(es) have no usable allocation.`
          : `Methodology "${methodology.name} ${methodology.version}" is attached and applied: ${methodology.recyclingMethod.replace(/_/g, " ").toLowerCase()} recycling, ${methodology.electricityApproach.replace(/_/g, " ").toLowerCase()} electricity, biogenic carbon ${methodology.biogenicTreatment.replace(/_/g, " ").toLowerCase()}, offsets ${methodology.offsetTreatment.replace(/_/g, " ").toLowerCase()}.`,
      nextStep: !hasProfile ? "Select a methodology profile on the goal and scope page." : allocationIssues.length > 0 ? "Resolve the allocation on the flagged processes." : null,
      facts: [`GWP basis: ${methodology.gwpBasis}.`, `Cut-off: ${methodology.cutOffThresholdPercent !== null ? `${methodology.cutOffThresholdPercent}%` : "not set"}.`],
    });
  }

  // --- assumptions ------------------------------------------------------
  {
    const proxyLines = assessment.inventoryItems.filter((i) => !i.isExcluded && i.dataType === LcaDataType.PROXY).length;
    const state: ReadinessState =
      counts.assumptions === 0 && proxyLines > 0
        ? "SIGNIFICANT_GAPS"
        : counts.assumptions === 0
          ? "REVIEW_RECOMMENDED"
          : counts.approvedAssumptions < counts.assumptions
            ? "REVIEW_RECOMMENDED"
            : "READY_FOR_INDEPENDENT_REVIEW";
    areas.push({
      area: "assumptions",
      label: AREA_LABELS.assumptions,
      state,
      explanation:
        counts.assumptions === 0 && proxyLines > 0
          ? `${proxyLines} line(s) use proxy data but the assumptions register is empty. Every substitution a reviewer would question needs to be written down.`
          : counts.assumptions === 0
            ? "The assumptions register is empty. Most product assessments rest on assumptions worth stating even when the data is good."
            : counts.approvedAssumptions < counts.assumptions
              ? `${counts.assumptions} assumption(s) recorded, ${counts.assumptions - counts.approvedAssumptions} still awaiting approval.`
              : `All ${counts.assumptions} assumption(s) are recorded with a rationale, source, materiality and approval.`,
      nextStep: counts.approvedAssumptions < counts.assumptions ? "Have the outstanding assumptions approved." : counts.assumptions === 0 ? "Record the assumptions behind the model." : null,
      facts: [`${counts.assumptions} assumption(s), ${counts.approvedAssumptions} approved.`],
    });
  }

  // --- exclusions -------------------------------------------------------
  {
    const excludedLines = assessment.inventoryItems.filter((i) => i.isExcluded).length;
    const undocumented = errorsIn(["UNDOCUMENTED_EXCLUSION"]).length;
    const state: ReadinessState =
      undocumented > 0
        ? "NOT_READY"
        : excludedLines > 0 && counts.exclusions === 0
          ? "SIGNIFICANT_GAPS"
          : counts.approvedExclusions < counts.exclusions
            ? "REVIEW_RECOMMENDED"
            : "READY_FOR_INDEPENDENT_REVIEW";
    areas.push({
      area: "exclusions",
      label: AREA_LABELS.exclusions,
      state,
      explanation:
        undocumented > 0
          ? `${undocumented} inventory line(s) are excluded without a recorded reason. An undocumented exclusion is indistinguishable from an omission.`
          : excludedLines > 0 && counts.exclusions === 0
            ? `${excludedLines} line(s) are excluded from the model but the exclusions register is empty.`
            : counts.exclusions === 0
              ? "Nothing is excluded from the model and the register is empty, which is consistent."
              : `${counts.exclusions} exclusion(s) recorded with rationale and estimated relevance, ${counts.approvedExclusions} approved. All remain visible to reviewers.`,
      nextStep: undocumented > 0 ? "Record a reason for every excluded line." : counts.approvedExclusions < counts.exclusions ? "Have the outstanding exclusions approved." : null,
      facts: [`${excludedLines} excluded inventory line(s), ${counts.exclusions} register entr${counts.exclusions === 1 ? "y" : "ies"}.`],
    });
  }

  // --- evidence ---------------------------------------------------------
  {
    const missingEvidence = bySection("evidence", "WARNING").length;
    const state: ReadinessState =
      counts.evidence === 0 ? "SIGNIFICANT_GAPS" : missingEvidence > 0 ? "REVIEW_RECOMMENDED" : "READY_FOR_INDEPENDENT_REVIEW";
    areas.push({
      area: "evidence",
      label: AREA_LABELS.evidence,
      state,
      explanation:
        counts.evidence === 0
          ? "No evidence has been attached. A reviewer works from source documents, not from figures typed into a system."
          : missingEvidence > 0
            ? `${counts.evidence} evidence item(s) attached, but ${missingEvidence} primary or supplier-specific line(s) still have none.`
            : `${counts.evidence} evidence item(s) attached and linked to the records they support.`,
      nextStep: counts.evidence === 0 || missingEvidence > 0 ? "Attach source documents to the primary and supplier-specific lines." : null,
      facts: [`${counts.evidence} evidence item(s) held.`],
    });
  }

  // --- validation -------------------------------------------------------
  {
    const state: ReadinessState =
      validation.errorCount > 0
        ? "NOT_READY"
        : validation.warningCount > 5
          ? "SIGNIFICANT_GAPS"
          : validation.warningCount > 0
            ? "REVIEW_RECOMMENDED"
            : "READY_FOR_INDEPENDENT_REVIEW";
    areas.push({
      area: "validation",
      label: AREA_LABELS.validation,
      state,
      explanation:
        validation.errorCount > 0
          ? `${validation.errorCount} error(s) remain. Errors mean a figure is wrong or missing, and they block the assessment from being offered for verification.`
          : validation.warningCount > 0
            ? `No errors remain. ${validation.warningCount} warning(s) and ${validation.advisoryCount} advisory item(s) are outstanding — a reviewer will ask about the warnings.`
            : `No errors or warnings. ${validation.advisoryCount} advisory item(s) outstanding.`,
      nextStep: validation.errorCount > 0 ? "Clear the errors listed on the review page." : validation.warningCount > 0 ? "Work through the outstanding warnings." : null,
      facts: [`${validation.errorCount} error(s), ${validation.warningCount} warning(s), ${validation.advisoryCount} advisory.`],
    });
  }

  // --- auditability -----------------------------------------------------
  {
    const calculated = Boolean(run);
    const state: ReadinessState = !calculated
      ? "NOT_READY"
      : staleness.stale
        ? "SIGNIFICANT_GAPS"
        : counts.auditEvents < 5
          ? "REVIEW_RECOMMENDED"
          : "READY_FOR_INDEPENDENT_REVIEW";
    areas.push({
      area: "auditability",
      label: AREA_LABELS.auditability,
      state,
      explanation: !calculated
        ? "Nothing has been calculated, so there is no run to trace back to."
        : staleness.stale
          ? `The stored results no longer match the data behind them: ${staleness.reason}`
          : `Every result line carries its own activity data, conversion, factor snapshot, methodology, allocation and arithmetic. ${counts.auditEvents} audit event(s) record how the assessment reached its current state, and ${counts.versions} version(s) have been issued.`,
      nextStep: !calculated ? "Run the calculation." : staleness.stale ? "Re-run the calculation so the stored results match the model." : null,
      facts: [
        run ? `Last run ${run.runAt.toISOString().slice(0, 16).replace("T", " ")} on engine ${run.engineVersion}, ${run.results.length} result line(s).` : "No calculation run.",
        `${counts.auditEvents} audit event(s), ${counts.versions} issued version(s), ${counts.verifications} verification record(s).`,
      ],
    });
  }

  const overall = worst(areas.map((a) => a.state));
  const blocking = areas.filter((a) => a.state === "NOT_READY").map((a) => a.label);
  const gaps = areas.filter((a) => a.state === "SIGNIFICANT_GAPS").map((a) => a.label);

  const overallExplanation =
    overall === "NOT_READY"
      ? `Not ready: ${blocking.join(", ")} ${blocking.length === 1 ? "has" : "have"} something essential missing or wrong.`
      : overall === "SIGNIFICANT_GAPS"
        ? `Significant gaps in ${gaps.join(", ")}. Nothing is arithmetically broken, but a reviewer would stop on these.`
        : overall === "REVIEW_RECOMMENDED"
          ? "Nothing blocking remains. Work through the outstanding warnings internally before commissioning an independent review."
          : "Every area is complete, calculated, documented and traceable. An independent reviewer has what they need to start.";

  return {
    overall,
    overallExplanation,
    areas,
    validation,
    assessedAt: new Date().toISOString(),
    disclaimer:
      "This is an internal readiness view of whether the assessment can be reviewed. It is not a conformity score, a certification, or a statement that any standard has been met — only an independent verifier can give that.",
  };
}

export async function buildReadinessReport(assessmentId: string): Promise<ReadinessReport> {
  const [assessment, run, staleness, validation] = await Promise.all([
    loadAssessmentOrThrow(assessmentId),
    getLatestRun(assessmentId),
    isCalculationStale(assessmentId),
    runValidation(assessmentId),
  ]);

  const [assumptions, approvedAssumptions, exclusions, approvedExclusions, evidence, auditEvents, verifications, versions] =
    await Promise.all([
      prisma.lcaAssumption.count({ where: { assessmentId } }),
      prisma.lcaAssumption.count({ where: { assessmentId, approvedAt: { not: null } } }),
      prisma.lcaExclusion.count({ where: { assessmentId } }),
      prisma.lcaExclusion.count({ where: { assessmentId, approvedAt: { not: null } } }),
      prisma.lcaEvidence.count({ where: { assessmentId } }),
      prisma.lcaAuditEvent.count({ where: { assessmentId } }),
      prisma.lcaVerification.count({ where: { assessmentId } }),
      prisma.lcaAssessmentVersion.count({ where: { assessmentId, status: "ISSUED" } }),
    ]);

  return assessReadiness({
    assessment,
    run,
    staleness,
    validation,
    counts: {
      assumptions,
      approvedAssumptions,
      exclusions,
      approvedExclusions,
      evidence,
      auditEvents,
      verifications,
      versions,
    },
  });
}

/**
 * Status transitions. Forward movement past internal review requires the
 * validation engine to be clean, and verified requires a verification record —
 * the software will not let a status claim more than the evidence supports.
 */
export const ALLOWED_TRANSITIONS: Record<LcaAssessmentStatus, LcaAssessmentStatus[]> = {
  DRAFT: [LcaAssessmentStatus.DATA_COLLECTION],
  DATA_COLLECTION: [LcaAssessmentStatus.DRAFT, LcaAssessmentStatus.CALCULATION],
  CALCULATION: [LcaAssessmentStatus.DATA_COLLECTION, LcaAssessmentStatus.INTERNAL_REVIEW],
  INTERNAL_REVIEW: [LcaAssessmentStatus.CALCULATION, LcaAssessmentStatus.READY_FOR_VERIFICATION],
  READY_FOR_VERIFICATION: [LcaAssessmentStatus.INTERNAL_REVIEW, LcaAssessmentStatus.VERIFIED],
  VERIFIED: [LcaAssessmentStatus.SUPERSEDED],
  SUPERSEDED: [],
};

export interface TransitionCheck {
  allowed: boolean;
  reason: string | null;
}

export async function checkStatusTransition(
  assessmentId: string,
  from: LcaAssessmentStatus,
  to: LcaAssessmentStatus,
): Promise<TransitionCheck> {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    return {
      allowed: false,
      reason: `An assessment cannot move straight from ${from.replace(/_/g, " ").toLowerCase()} to ${to.replace(/_/g, " ").toLowerCase()}.`,
    };
  }

  if (to === LcaAssessmentStatus.READY_FOR_VERIFICATION) {
    const validation = await runValidation(assessmentId);
    if (validation.errorCount > 0) {
      return {
        allowed: false,
        reason: `${validation.errorCount} validation error(s) must be cleared before this assessment can be marked ready for verification.`,
      };
    }
  }

  if (to === LcaAssessmentStatus.VERIFIED) {
    const verification = await prisma.lcaVerification.findFirst({ where: { assessmentId } });
    if (!verification) {
      return {
        allowed: false,
        reason:
          "Record the verification details first — verifying organisation, verifier, date, assurance type, scope and statement reference. The platform will not mark an assessment verified on its own say-so.",
      };
    }
    const issued = await prisma.lcaAssessmentVersion.count({ where: { assessmentId, status: "ISSUED" } });
    if (issued === 0) {
      return {
        allowed: false,
        reason: "Issue a version first, so what was verified is frozen and cannot change afterwards.",
      };
    }
  }

  return { allowed: true, reason: null };
}

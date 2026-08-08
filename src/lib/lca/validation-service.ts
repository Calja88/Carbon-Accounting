/**
 * The validation engine.
 *
 * Checks an assessment against the things that make a product footprint
 * unusable — a missing functional unit, activity data with no factor, units
 * that don't match, end-of-life routes that don't add up, a factor from the
 * wrong decade or the wrong country, an exclusion nobody wrote down.
 *
 * Three severities, and they mean different things:
 *
 *   ERROR    — the number is wrong or unusable. Blocks the assessment from
 *              being marked ready for verification.
 *   WARNING  — the number is probably defensible but something material is
 *              undocumented or looks inconsistent. Does not block, but a
 *              reviewer will ask.
 *   ADVISORY — good practice not yet followed.
 *
 * Computed on demand from current data rather than stored, so it can never go
 * stale against the assessment it describes.
 */

import {
  LcaAllocationMethod,
  LcaAssessmentStatus,
  LcaBoundary,
  LcaDataType,
  LcaFactorBoundary,
  LcaFactorSelectionMode,
  LcaItemType,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { D, HUNDRED, ZERO } from "./decimal";
import { areUnitsCompatible, findUnit } from "./units";
import { STAGES_IN_BOUNDARY, STAGE_LABELS } from "./labels";
import {
  getLatestRun,
  isCalculationStale,
  loadAssessmentOrThrow,
  resolveItemFactor,
  type LoadedAssessment,
  type LoadedRun,
} from "./calculation-service";
import { toMethodologyConfig } from "./methodology";

export type ValidationSeverity = "ERROR" | "WARNING" | "ADVISORY";

export type ValidationSection =
  | "goal_and_scope"
  | "lifecycle_model"
  | "inventory"
  | "factors"
  | "allocation"
  | "end_of_life"
  | "data_quality"
  | "registers"
  | "evidence"
  | "calculation"
  | "verification";

export const SECTION_LABELS: Record<ValidationSection, string> = {
  goal_and_scope: "Goal and scope",
  lifecycle_model: "Lifecycle model",
  inventory: "Inventory",
  factors: "Emission factors",
  allocation: "Allocation",
  end_of_life: "Recycling and end of life",
  data_quality: "Data quality and uncertainty",
  registers: "Assumptions and exclusions",
  evidence: "Evidence",
  calculation: "Calculation",
  verification: "Review and verification",
};

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  section: ValidationSection;
  title: string;
  detail: string;
  guidance?: string;
  target?: { type: string; id: string; label: string };
}

export interface ValidationReport {
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
  advisoryCount: number;
  /** True when nothing blocks the assessment from being offered for verification. */
  canIssueForVerification: boolean;
  checkedAt: string;
}

/** Everything the pure validator reads. */
export interface ValidationInput {
  assessment: LoadedAssessment;
  run: LoadedRun | null;
  staleness: { stale: boolean; reason: string | null };
  assumptions: { id: string; assumption: string; approvedAt: Date | null; inventoryItemId: string | null }[];
  exclusions: { id: string; excludedItem: string; approvedAt: Date | null; processId: string | null }[];
  evidence: {
    id: string;
    inventoryItemId: string | null;
    processId: string | null;
    supplierPcfId: string | null;
    assumptionId: string | null;
    exclusionId: string | null;
    verificationId: string | null;
  }[];
  verifications: { id: string }[];
}

/**
 * How old a factor may be, relative to the assessment period, before it is
 * flagged. Not a rule from any standard — a house default that makes stale
 * data visible, and one a reviewer can argue with because it is stated.
 */
const FACTOR_AGE_WARNING_YEARS = 5;

function issue(
  severity: ValidationSeverity,
  section: ValidationSection,
  code: string,
  title: string,
  detail: string,
  extra?: { guidance?: string; target?: ValidationIssue["target"] },
): ValidationIssue {
  return { code, severity, section, title, detail, guidance: extra?.guidance, target: extra?.target };
}

export function validateAssessment(input: ValidationInput): ValidationReport {
  const { assessment, run, staleness } = input;
  const issues: ValidationIssue[] = [];
  const methodology = toMethodologyConfig(assessment.methodologyProfile);

  // --- goal and scope ---------------------------------------------------
  if (!assessment.goal?.trim()) {
    issues.push(
      issue("ERROR", "goal_and_scope", "MISSING_GOAL", "No goal recorded", "The assessment has no stated goal.", {
        guidance: "Say what the assessment is for and what decision it supports. Without it, nobody can judge whether the scope and data are fit for purpose.",
      }),
    );
  }
  if (!assessment.intendedApplication?.trim()) {
    issues.push(
      issue("ADVISORY", "goal_and_scope", "MISSING_INTENDED_APPLICATION", "No intended application recorded", "The assessment does not say how the result will be used."),
    );
  }
  if (!assessment.scopeDescription?.trim()) {
    issues.push(
      issue("WARNING", "goal_and_scope", "MISSING_SCOPE", "No scope description", "The assessment has no written scope statement to sit alongside the boundary setting."),
    );
  }
  if (assessment.boundary === LcaBoundary.CUSTOM && !assessment.boundaryNotes?.trim()) {
    issues.push(
      issue("ERROR", "goal_and_scope", "MISSING_BOUNDARY_DEFINITION", "Custom boundary is not defined", "The boundary is set to custom but nothing describes what it includes and excludes.", {
        guidance: "Describe exactly which stages and processes are inside the boundary.",
      }),
    );
  }
  if (assessment.includedStages.length === 0) {
    issues.push(
      issue("ERROR", "goal_and_scope", "MISSING_BOUNDARY_STAGES", "No lifecycle stages selected", "The assessment's boundary does not list any lifecycle stages."),
    );
  }
  if (!assessment.periodStart || !assessment.periodEnd) {
    issues.push(
      issue("ERROR", "goal_and_scope", "MISSING_PERIOD", "No assessment period", "The reporting/reference period for the data has not been set.", {
        guidance: "The period tells a reader which production year the activity data represents, and lets factor vintages be checked against it.",
      }),
    );
  } else if (assessment.periodEnd < assessment.periodStart) {
    issues.push(
      issue("ERROR", "goal_and_scope", "INVALID_PERIOD", "Assessment period ends before it starts", "The period end date is earlier than the period start date."),
    );
  }

  const fuMissing = !assessment.functionalUnitDescription?.trim() || !assessment.functionalUnitUnit?.trim();
  if (fuMissing) {
    issues.push(
      issue("ERROR", "goal_and_scope", "MISSING_FUNCTIONAL_UNIT", "No functional unit", "The functional unit has not been fully described (a quantity, a unit and what it delivers).", {
        guidance: "Every result is per functional unit. Without one, the numbers cannot be compared with anything, including a later version of this same product.",
      }),
    );
  }
  if (assessment.boundary === LcaBoundary.CRADLE_TO_GATE && !assessment.isDeclaredUnit) {
    issues.push(
      issue("ADVISORY", "goal_and_scope", "GATE_WITHOUT_DECLARED_UNIT", "Cradle-to-gate result described as a functional unit", "A cradle-to-gate assessment stops before the product delivers its function, so a declared unit is usually the honest description.", {
        guidance: "Switch the assessment to a declared unit, or explain in the scope why a functional unit is still appropriate.",
      }),
    );
  }
  if (D(assessment.modelledOutputQuantity).lte(ZERO)) {
    issues.push(
      issue("ERROR", "goal_and_scope", "MISSING_MODELLED_OUTPUT", "Modelled output quantity not set", "Nothing records how much product the entered inventory represents, so no per-functional-unit figure can be produced."),
    );
  }
  if (!assessment.ownerUserId) {
    issues.push(issue("ADVISORY", "goal_and_scope", "NO_OWNER", "No assessment owner", "Nobody is named as responsible for this assessment."));
  }
  if (assessment.comparativeAssertionDisclosed && input.verifications.length === 0) {
    issues.push(
      issue("WARNING", "verification", "COMPARATIVE_WITHOUT_REVIEW", "Comparative assertion with no independent review", "This assessment is marked as supporting a comparative assertion, but no verification or critical review record exists.", {
        guidance: "Comparative claims disclosed to the public normally need independent review before they are made.",
      }),
    );
  }

  // --- methodology ------------------------------------------------------
  if (!assessment.methodologyProfileId) {
    issues.push(
      issue("ERROR", "goal_and_scope", "NO_METHODOLOGY", "No methodology profile selected", "The assessment is not linked to a methodology profile, so its allocation, recycling, electricity, biogenic and offset rules are undefined.", {
        guidance: "Pick a methodology profile in Goal and scope. The engine reads it directly — it is not just documentation.",
      }),
    );
  } else if (methodology.gwpBasis === "Not stated") {
    issues.push(issue("WARNING", "factors", "NO_GWP_BASIS", "No GWP basis stated", "The methodology profile does not say which global warming potential set the figures use."));
  }

  // --- lifecycle model --------------------------------------------------
  const processes = assessment.processes;
  if (processes.length === 0) {
    issues.push(
      issue("ERROR", "lifecycle_model", "NO_PROCESSES", "The lifecycle model is empty", "No processes have been added, so there is nothing to calculate."),
    );
  }

  const modelledStages = new Set(processes.filter((p) => p.isIncluded).map((p) => p.stage));
  const expectedStages = STAGES_IN_BOUNDARY[assessment.boundary] ?? [];
  const declaredStages = assessment.includedStages;
  for (const stage of declaredStages) {
    if (!modelledStages.has(stage)) {
      issues.push(
        issue("WARNING", "lifecycle_model", "STAGE_NOT_MODELLED", `${STAGE_LABELS[stage]} is in scope but not modelled`, `The boundary includes ${STAGE_LABELS[stage].toLowerCase()}, but no included process covers it.`, {
          guidance: "Either add a process for this stage, or take it out of the boundary and record why in the exclusions register.",
        }),
      );
    }
  }
  for (const stage of expectedStages) {
    if (!declaredStages.includes(stage)) {
      issues.push(
        issue("ADVISORY", "lifecycle_model", "STAGE_OUTSIDE_BOUNDARY", `${STAGE_LABELS[stage]} is not in scope`, `A ${assessment.boundary.replace(/_/g, " ").toLowerCase()} assessment would normally include ${STAGE_LABELS[stage].toLowerCase()}.`),
      );
    }
  }

  // --- allocation -------------------------------------------------------
  for (const process of processes) {
    const coProducts = process.outputs.length;
    if (coProducts > 1 && process.allocationMethod === LcaAllocationMethod.NONE) {
      issues.push(
        issue("ERROR", "allocation", "MISSING_ALLOCATION", `"${process.name}" has co-products but no allocation`, `The process records ${coProducts} outputs but is set to no allocation, so the whole burden is being attributed to the assessed product.`, {
          target: { type: "process", id: process.id, label: process.name },
          guidance: "Choose a mass, physical, economic or manual split, and record why that basis is the right one.",
        }),
      );
    }
    if (process.allocationMethod === LcaAllocationMethod.MANUAL && !process.allocationRationale?.trim()) {
      issues.push(
        issue("WARNING", "allocation", "MANUAL_ALLOCATION_NO_RATIONALE", `"${process.name}" uses a manual split with no rationale`, "A manual allocation percentage has been entered without an explanation of how it was arrived at.", {
          target: { type: "process", id: process.id, label: process.name },
        }),
      );
    }
    if (process.allocationMethod !== LcaAllocationMethod.NONE && process.allocationMethod !== LcaAllocationMethod.MANUAL) {
      const assessed = process.outputs.filter((o) => o.isAssessedProduct);
      if (process.outputs.length > 0 && assessed.length === 0) {
        issues.push(
          issue("ERROR", "allocation", "NO_ASSESSED_OUTPUT", `"${process.name}" does not identify the assessed product`, "None of the process outputs is marked as the product being assessed, so no split can be derived.", {
            target: { type: "process", id: process.id, label: process.name },
          }),
        );
      }
    }
  }

  // --- inventory, factors, data quality ---------------------------------
  const includedItems = assessment.inventoryItems.filter((item) => !item.isExcluded);
  if (includedItems.length === 0) {
    issues.push(issue("ERROR", "inventory", "NO_INVENTORY", "The inventory is empty", "No inventory items have been recorded, so there is nothing to calculate."));
  }

  const evidenceByItem = new Set(input.evidence.map((e) => e.inventoryItemId).filter(Boolean) as string[]);
  const assumptionByItem = new Set(input.assumptions.map((a) => a.inventoryItemId).filter(Boolean) as string[]);

  for (const item of assessment.inventoryItems) {
    const target = { type: "inventory_item", id: item.id, label: item.name };

    if (item.isExcluded) {
      if (!item.exclusionReason?.trim()) {
        issues.push(
          issue("ERROR", "registers", "UNDOCUMENTED_EXCLUSION", `"${item.name}" is excluded with no reason`, "An inventory item has been excluded from the model without a recorded reason.", {
            target,
            guidance: "Record the reason on the item and add it to the exclusions register with an estimate of how much it would have contributed.",
          }),
        );
      }
      continue;
    }

    // Factor assignment
    if (item.itemType === LcaItemType.TRANSPORT) {
      if (item.transportLegs.length === 0) {
        issues.push(
          issue("ERROR", "inventory", "TRANSPORT_NO_LEGS", `"${item.name}" has no transport legs`, "A transport item with no legs produces no figure.", { target }),
        );
      }
      for (const leg of item.transportLegs) {
        if (!leg.emissionFactor && leg.manualFactorValue === null) {
          issues.push(
            issue("ERROR", "factors", "LEG_NO_FACTOR", `Leg ${leg.sequence + 1} of "${item.name}" has no factor`, `The ${leg.mode.toLowerCase().replace(/_/g, " ")} leg has no emission factor assigned.`, { target }),
          );
        }
        if (leg.manualFactorValue !== null && !leg.manualFactorSource?.trim()) {
          issues.push(
            issue("ERROR", "factors", "LEG_FACTOR_UNSOURCED", `Leg ${leg.sequence + 1} of "${item.name}" uses an unsourced factor`, "A manually entered freight factor has no source recorded.", { target }),
          );
        }
        if (D(leg.distanceValue).lte(ZERO)) {
          issues.push(
            issue("ERROR", "inventory", "LEG_NO_DISTANCE", `Leg ${leg.sequence + 1} of "${item.name}" has no distance`, "A freight leg needs a distance greater than zero.", {
              target,
              guidance: "Enter the distance from the shipping record, or record the routing assumption you used to estimate it.",
            }),
          );
        }
        if (D(leg.massValue).lte(ZERO)) {
          issues.push(
            issue("ERROR", "inventory", "LEG_NO_MASS", `Leg ${leg.sequence + 1} of "${item.name}" has no mass`, "A freight leg needs a consignment mass greater than zero.", { target }),
          );
        }
        if (!leg.assumptions?.trim()) {
          issues.push(
            issue("ADVISORY", "inventory", "LEG_NO_ASSUMPTIONS", `Leg ${leg.sequence + 1} of "${item.name}" has no assumptions recorded`, "Freight figures usually rest on assumptions about routing, load and return trips that a reviewer will want to see.", { target }),
          );
        }
      }
    } else if (item.endOfLifeRoutes.length > 0) {
      const totalPercent = item.endOfLifeRoutes.reduce((sum, r) => sum.plus(D(r.percent)), ZERO);
      if (!totalPercent.equals(HUNDRED)) {
        issues.push(
          issue("ERROR", "end_of_life", "EOL_PERCENT_NOT_100", `End-of-life routes for "${item.name}" total ${totalPercent.toString()}%`, "Route percentages must add up to exactly 100% so every kilogram is accounted for once.", {
            target,
            guidance: "Adjust the route percentages. Do not leave a remainder unallocated — an unstated route is a silent exclusion.",
          }),
        );
      }
      for (const route of item.endOfLifeRoutes) {
        if (!route.emissionFactor && route.manualFactorValue === null) {
          issues.push(
            issue("ERROR", "factors", "EOL_NO_FACTOR", `The ${route.route.toLowerCase().replace(/_/g, " ")} route on "${item.name}" has no factor`, "An end-of-life route with no factor produces no figure.", { target }),
          );
        }
        if (route.avoidedFactorValue !== null && !route.avoidedFactorSource?.trim()) {
          issues.push(
            issue("ERROR", "factors", "AVOIDED_FACTOR_UNSOURCED", `Avoided-burden credit on "${item.name}" is unsourced`, "A recovery credit has been entered without a source for the avoided factor.", { target }),
          );
        }
        if (route.avoidedFactorValue !== null && !route.recoveryAssumptions?.trim()) {
          issues.push(
            issue("WARNING", "end_of_life", "RECOVERY_NO_ASSUMPTIONS", `Recovery assumptions missing on "${item.name}"`, "A recovery credit is claimed without recording the recovery-rate assumptions behind it.", { target }),
          );
        }
      }
    } else {
      const factor = resolveItemFactor(item);
      if (!factor) {
        issues.push(
          issue("ERROR", "factors", "ITEM_NO_FACTOR", `"${item.name}" has no emission factor`, "Activity data has been entered but no factor is assigned, so this line contributes nothing to the footprint.", {
            target,
            guidance: "Assign a factor from the library, attach a supplier PCF, or enter a sourced factor manually.",
          }),
        );
      } else {
        // Unit compatibility
        if (!areUnitsCompatible(item.unit, factor.unit)) {
          issues.push(
            issue("ERROR", "inventory", "INCOMPATIBLE_UNIT", `"${item.name}" is in ${item.unit} but its factor is per ${factor.unit}`, "The activity unit and the factor's unit measure different things, so the two cannot be multiplied.", {
              target,
              guidance: "Either pick a factor expressed per a compatible unit, or convert the activity data and record the conversion.",
            }),
          );
        }
        if (!findUnit(item.unit)) {
          issues.push(
            issue("ERROR", "inventory", "UNKNOWN_UNIT", `"${item.name}" uses an unrecognised unit (${item.unit})`, "The platform cannot convert this unit, so the line cannot be calculated.", { target }),
          );
        }

        // Factor sourcing
        if (factor.selectionMode === LcaFactorSelectionMode.MANUAL && !item.manualFactorSource?.trim()) {
          issues.push(
            issue("ERROR", "factors", "FACTOR_UNSOURCED", `"${item.name}" uses an unsourced factor`, "A manually entered factor has no source recorded, so the figure cannot be traced back to anything.", {
              target,
              guidance: "Record the publication, dataset or supplier document the value came from, and its version or year.",
            }),
          );
        }
        if (factor.isPlaceholder) {
          issues.push(
            issue("ERROR", "factors", "PLACEHOLDER_FACTOR", `"${item.name}" is priced from a placeholder factor`, "This factor comes from a factor set flagged as a placeholder, which is illustrative only and must not reach a reported figure.", {
              target,
              guidance: "Import the real published factor set through Admin → Emission factors and reassign the item.",
            }),
          );
        }
        if (factor.boundary === LcaFactorBoundary.UNKNOWN) {
          issues.push(
            issue("WARNING", "factors", "FACTOR_BOUNDARY_UNKNOWN", `"${item.name}" uses a factor with no stated boundary`, "Without knowing what the factor covers, there is no way to tell whether this line double-counts or leaves a gap against neighbouring stages.", { target }),
          );
        }

        // Factor vintage against the assessment period
        const periodYear = assessment.periodEnd?.getUTCFullYear() ?? null;
        if (periodYear && factor.year) {
          const age = periodYear - factor.year;
          if (age > FACTOR_AGE_WARNING_YEARS) {
            issues.push(
              issue("WARNING", "factors", "FACTOR_OUT_OF_PERIOD", `"${item.name}" uses a factor ${age} years older than the assessment period`, `The factor represents ${factor.year} data; the assessment period ends in ${periodYear}.`, {
                target,
                guidance: `Anything more than ${FACTOR_AGE_WARNING_YEARS} years out is flagged here. Either update the factor or record the age as an assumption.`,
              }),
            );
          } else if (factor.year > periodYear + 1) {
            issues.push(
              issue("WARNING", "factors", "FACTOR_AFTER_PERIOD", `"${item.name}" uses a factor from after the assessment period`, `The factor represents ${factor.year} data but the assessment period ends in ${periodYear}.`, { target }),
            );
          }
        }

        // Geography
        if (item.geography && factor.geography && normaliseGeography(item.geography) !== normaliseGeography(factor.geography)) {
          issues.push(
            issue("WARNING", "factors", "GEOGRAPHY_MISMATCH", `"${item.name}" is from ${item.geography} but its factor is for ${factor.geography}`, "The factor's geography does not match where the input actually comes from.", {
              target,
              guidance: "Use a factor for the right region where one exists, or record the substitution as an assumption.",
            }),
          );
        }

        if (factor.selectionMode === LcaFactorSelectionMode.SUPPLIER_PCF && item.supplierPcf) {
          if (item.supplierPcf.boundary === LcaBoundary.CUSTOM && !item.supplierPcf.boundaryNotes?.trim()) {
            issues.push(
              issue("ERROR", "factors", "SUPPLIER_PCF_BOUNDARY_UNKNOWN", `The supplier PCF used for "${item.name}" has an undefined boundary`, "The supplier's footprint is recorded with a custom boundary that is not described, so what it covers is unknown.", {
                target,
                guidance: "Ask the supplier what the figure includes, and record it on the supplier PCF.",
              }),
            );
          }
          if (!item.supplierPcf.methodology?.trim()) {
            issues.push(
              issue("WARNING", "factors", "SUPPLIER_PCF_NO_METHODOLOGY", `The supplier PCF used for "${item.name}" states no methodology`, "Without the supplier's methodology, their figure cannot be checked for consistency with this assessment.", { target }),
            );
          }
        }
      }
    }

    // Data quality and sourcing
    if (item.dataType === LcaDataType.PROXY && !item.dataSource?.trim() && !item.notes?.trim() && !assumptionByItem.has(item.id)) {
      issues.push(
        issue("WARNING", "data_quality", "UNEXPLAINED_PROXY", `"${item.name}" uses proxy data with no explanation`, "A stand-in has been used without recording what it stands in for or why it is a reasonable substitute.", {
          target,
          guidance: "Record the substitution in the assumptions register, or write the reasoning into the item's notes.",
        }),
      );
    }

    const scores = [item.temporalScore, item.geographicalScore, item.technologicalScore, item.completenessScore, item.reliabilityScore];
    if (scores.every((s) => s === null)) {
      issues.push(
        issue("WARNING", "data_quality", "NO_DATA_QUALITY_SCORES", `"${item.name}" has no data-quality scores`, "None of the five data-quality dimensions has been scored for this line.", { target }),
      );
    } else if (scores.some((s) => s === null)) {
      issues.push(
        issue("ADVISORY", "data_quality", "PARTIAL_DATA_QUALITY_SCORES", `"${item.name}" is only partly scored for data quality`, "Some data-quality dimensions are still unscored.", { target }),
      );
    }

    if (item.uncertaintyStatus === "NOT_ASSESSED") {
      issues.push(
        issue("ADVISORY", "data_quality", "NO_UNCERTAINTY", `"${item.name}" has no uncertainty assessment`, "Uncertainty has not been considered for this line.", { target }),
      );
    }

    if (
      methodology.requireEvidenceForPrimary &&
      (item.dataType === LcaDataType.PRIMARY || item.dataType === LcaDataType.SUPPLIER_SPECIFIC) &&
      !evidenceByItem.has(item.id)
    ) {
      issues.push(
        issue("WARNING", "evidence", "MISSING_EVIDENCE", `"${item.name}" is primary data with no evidence attached`, "The methodology profile requires supporting evidence for primary and supplier-specific data.", {
          target,
          guidance: "Attach the meter reading, invoice, bill of materials extract or supplier declaration the figure came from.",
        }),
      );
    }

    if (D(item.quantity).lte(ZERO)) {
      issues.push(
        issue("WARNING", "inventory", "ZERO_QUANTITY", `"${item.name}" has a quantity of ${D(item.quantity).toString()}`, "A zero or negative quantity contributes nothing and is usually an unfinished entry.", { target }),
      );
    }

    const waste = item.wastePercent ? D(item.wastePercent) : null;
    if (waste && (waste.lt(ZERO) || waste.gte(HUNDRED))) {
      issues.push(
        issue("ERROR", "inventory", "INVALID_WASTE", `"${item.name}" has a manufacturing loss of ${waste.toString()}%`, "Loss must be at least 0% and less than 100%.", { target }),
      );
    }

    const recycled = item.recycledContentPercent ? D(item.recycledContentPercent) : null;
    if (recycled && (recycled.lt(ZERO) || recycled.gt(HUNDRED))) {
      issues.push(
        issue("ERROR", "inventory", "INVALID_RECYCLED_CONTENT", `"${item.name}" has recycled content of ${recycled.toString()}%`, "Recycled content must be between 0% and 100%.", { target }),
      );
    }
  }

  // --- registers --------------------------------------------------------
  for (const assumption of input.assumptions) {
    if (!assumption.approvedAt) {
      issues.push(
        issue("ADVISORY", "registers", "ASSUMPTION_UNAPPROVED", `Assumption not approved: "${truncate(assumption.assumption)}"`, "This assumption has not been approved by anyone.", {
          target: { type: "assumption", id: assumption.id, label: truncate(assumption.assumption) },
        }),
      );
    }
  }
  for (const exclusion of input.exclusions) {
    if (!exclusion.approvedAt) {
      issues.push(
        issue("ADVISORY", "registers", "EXCLUSION_UNAPPROVED", `Exclusion not approved: "${truncate(exclusion.excludedItem)}"`, "This exclusion has not been approved by anyone.", {
          target: { type: "exclusion", id: exclusion.id, label: truncate(exclusion.excludedItem) },
        }),
      );
    }
  }
  const excludedItemsWithoutRegisterEntry = assessment.inventoryItems.filter((i) => i.isExcluded).length - input.exclusions.length;
  if (excludedItemsWithoutRegisterEntry > 0) {
    issues.push(
      issue("WARNING", "registers", "EXCLUSIONS_NOT_REGISTERED", "Excluded inventory is not fully reflected in the exclusions register", `${assessment.inventoryItems.filter((i) => i.isExcluded).length} inventory line(s) are excluded but the register holds ${input.exclusions.length} entr${input.exclusions.length === 1 ? "y" : "ies"}.`, {
        guidance: "Every exclusion a reviewer would care about should appear in the register with its estimated relevance.",
      }),
    );
  }

  // --- calculation ------------------------------------------------------
  if (!run) {
    issues.push(
      issue("ERROR", "calculation", "NOT_CALCULATED", "The assessment has not been calculated", "No calculation run exists, so there are no results to review."),
    );
  } else if (staleness.stale) {
    issues.push(
      issue("ERROR", "calculation", "STALE_CALCULATION", "Results are out of date", staleness.reason ?? "The model has changed since the last calculation run.", {
        guidance: "Run the calculation again so the figures on screen match the data behind them.",
      }),
    );
  }

  if (run) {
    const totals = run.totals as unknown as { functionalUnitResolved?: boolean; functionalUnitNote?: string };
    if (totals?.functionalUnitResolved === false) {
      issues.push(
        issue("ERROR", "calculation", "FUNCTIONAL_UNIT_UNRESOLVED", "Per-functional-unit figures could not be produced", totals.functionalUnitNote ?? "The functional unit could not be resolved from the recorded quantities and units."),
      );
    }
    if (run.results.length === 0) {
      issues.push(issue("ERROR", "calculation", "NO_RESULTS", "The last run produced no results", "Every inventory line failed to calculate or was excluded."));
    }
  }

  // --- verification -----------------------------------------------------
  if (assessment.status === LcaAssessmentStatus.VERIFIED && input.verifications.length === 0) {
    issues.push(
      issue("ERROR", "verification", "VERIFIED_WITHOUT_RECORD", "Marked verified with no verification record", "The assessment's status says verified but no verification details have been recorded.", {
        guidance: "Record the verifying organisation, verifier, date, assurance type, scope and statement reference.",
      }),
    );
  }
  for (const verification of input.verifications) {
    const hasEvidence = input.evidence.some((e) => e.verificationId === verification.id);
    if (!hasEvidence) {
      issues.push(
        issue("WARNING", "verification", "VERIFICATION_NO_EVIDENCE", "Verification record has no statement attached", "No evidence file or link is attached to the verification record.", {
          target: { type: "verification", id: verification.id, label: "Verification record" },
        }),
      );
    }
  }

  const errorCount = issues.filter((i) => i.severity === "ERROR").length;
  const warningCount = issues.filter((i) => i.severity === "WARNING").length;
  const advisoryCount = issues.filter((i) => i.severity === "ADVISORY").length;

  return {
    issues,
    errorCount,
    warningCount,
    advisoryCount,
    canIssueForVerification: errorCount === 0,
    checkedAt: new Date().toISOString(),
  };
}

function truncate(text: string, length = 60): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** "United Kingdom", "uk", "GB" all describe the same place for this check. */
function normaliseGeography(value: string): string {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z]/g, "");
  const synonyms: Record<string, string> = {
    uk: "gb",
    gb: "gb",
    unitedkingdom: "gb",
    greatbritain: "gb",
    england: "gb",
    scotland: "gb",
    wales: "gb",
    usa: "us",
    us: "us",
    unitedstates: "us",
    unitedstatesofamerica: "us",
    eu: "eu",
    europe: "eu",
    europeanunion: "eu",
    global: "glo",
    glo: "glo",
    world: "glo",
    rer: "eu",
  };
  return synonyms[cleaned] ?? cleaned;
}

/** Loads everything the validator needs and runs it. */
export async function runValidation(assessmentId: string): Promise<ValidationReport> {
  const assessment = await loadAssessmentOrThrow(assessmentId);
  const [run, staleness, assumptions, exclusions, evidence, verifications] = await Promise.all([
    getLatestRun(assessmentId),
    isCalculationStale(assessmentId),
    prisma.lcaAssumption.findMany({
      where: { assessmentId },
      select: { id: true, assumption: true, approvedAt: true, inventoryItemId: true },
    }),
    prisma.lcaExclusion.findMany({
      where: { assessmentId },
      select: { id: true, excludedItem: true, approvedAt: true, processId: true },
    }),
    prisma.lcaEvidence.findMany({
      where: { assessmentId },
      select: {
        id: true,
        inventoryItemId: true,
        processId: true,
        supplierPcfId: true,
        assumptionId: true,
        exclusionId: true,
        verificationId: true,
      },
    }),
    prisma.lcaVerification.findMany({ where: { assessmentId }, select: { id: true } }),
  ]);

  return validateAssessment({ assessment, run, staleness, assumptions, exclusions, evidence, verifications });
}

export function groupIssuesBySection(report: ValidationReport): { section: ValidationSection; label: string; issues: ValidationIssue[] }[] {
  const sections = Object.keys(SECTION_LABELS) as ValidationSection[];
  return sections
    .map((section) => ({
      section,
      label: SECTION_LABELS[section],
      issues: report.issues.filter((i) => i.section === section),
    }))
    .filter((g) => g.issues.length > 0);
}

export const SEVERITY_TONES: Record<ValidationSeverity, "danger" | "warning" | "info"> = {
  ERROR: "danger",
  WARNING: "warning",
  ADVISORY: "info",
};

export type { Prisma as ValidationPrisma };

/**
 * Pure comparability logic for BD07's LCA scenario summary. Kept free of
 * Prisma/auth imports (same reason as live-overview-helpers.ts) so it can be
 * unit-tested directly and reused by `live-lca.ts`.
 */

export interface AssessmentComparabilityInput {
  functionalUnitUnit: string | null;
  functionalUnitDescription: string | null;
  isDeclaredUnit: boolean;
  /** Decimal compared as an exact string, never coerced to a float. */
  functionalUnitQuantity: string;
  boundary: string;
  hasRun: boolean;
  stale: boolean;
  staleReason: string | null;
}

export interface ScenarioComparabilityResult {
  comparable: boolean;
  reason: string | null;
  unitLabel: string;
}

/**
 * A scenario only compares to its baseline when the functional unit, unit
 * type, quantity and system boundary genuinely match and both results are
 * current — never a silent unit conversion, never an unqualified percentage
 * from stale or incompatible results (BD07 stop condition).
 */
export function buildScenarioComparability(input: {
  baseline: AssessmentComparabilityInput;
  scenario: AssessmentComparabilityInput;
}): ScenarioComparabilityResult {
  const { baseline, scenario } = input;
  const unitLabel =
    baseline.functionalUnitDescription ??
    baseline.functionalUnitUnit ??
    scenario.functionalUnitDescription ??
    scenario.functionalUnitUnit ??
    "functional unit";

  if (!baseline.hasRun) return { comparable: false, reason: "The baseline has not been calculated yet.", unitLabel };
  if (!scenario.hasRun) return { comparable: false, reason: "This scenario has not been calculated yet.", unitLabel };

  if (baseline.isDeclaredUnit !== scenario.isDeclaredUnit) {
    return {
      comparable: false,
      reason: "Baseline and scenario use different unit types (functional vs declared unit); not comparable.",
      unitLabel,
    };
  }
  if (baseline.functionalUnitUnit !== scenario.functionalUnitUnit) {
    return {
      comparable: false,
      reason: `Functional units differ ("${baseline.functionalUnitUnit ?? "unset"}" vs "${scenario.functionalUnitUnit ?? "unset"}"); not comparable.`,
      unitLabel,
    };
  }
  if (baseline.functionalUnitQuantity !== scenario.functionalUnitQuantity) {
    return {
      comparable: false,
      reason: "Functional unit quantities differ between baseline and scenario; not comparable.",
      unitLabel,
    };
  }
  if (baseline.boundary !== scenario.boundary) {
    return {
      comparable: false,
      reason: `System boundaries differ ("${baseline.boundary}" vs "${scenario.boundary}"); not comparable.`,
      unitLabel,
    };
  }
  if (baseline.stale || scenario.stale) {
    const reasons = [
      baseline.stale ? `Baseline: ${baseline.staleReason}` : null,
      scenario.stale ? `Scenario: ${scenario.staleReason}` : null,
    ]
      .filter((r): r is string => Boolean(r))
      .join(" ");
    return { comparable: false, reason: `Results are out of date. ${reasons}`.trim(), unitLabel };
  }

  return { comparable: true, reason: null, unitLabel };
}

export interface StageContribution {
  key: string;
  label: string;
  perFunctionalUnitKgCo2e: number;
}

export interface MergedStageContribution {
  stage: string;
  baselineKg: number;
  scenarioKg: number;
}

/** Merges two independently computed per-stage contribution lists by stage key, keeping every stage present on either side. */
export function mergeStageContributions(
  baseline: StageContribution[],
  scenario: StageContribution[],
): MergedStageContribution[] {
  const stages = new Map<string, { label: string; baselineKg: number; scenarioKg: number }>();
  for (const c of baseline) {
    stages.set(c.key, { label: c.label, baselineKg: c.perFunctionalUnitKgCo2e, scenarioKg: 0 });
  }
  for (const c of scenario) {
    const existing = stages.get(c.key);
    if (existing) existing.scenarioKg = c.perFunctionalUnitKgCo2e;
    else stages.set(c.key, { label: c.label, baselineKg: 0, scenarioKg: c.perFunctionalUnitKgCo2e });
  }
  return Array.from(stages.values()).map((v) => ({ stage: v.label, baselineKg: v.baselineKg, scenarioKg: v.scenarioKg }));
}

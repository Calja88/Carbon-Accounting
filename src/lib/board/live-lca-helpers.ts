/**
 * Pure comparability logic for BD07's LCA scenario summary. Kept free of
 * Prisma/auth imports (same reason as live-overview-helpers.ts) so it can be
 * unit-tested directly and reused by `live-lca.ts`. `@/lib/lca/decimal`'s
 * `D` builds a `Prisma.Decimal` (decimal.js under the hood) purely from a
 * string/number — no database or auth dependency, safe here the same way
 * this module already used plain string comparison before.
 */

import { Decimal } from "@/lib/lca/decimal";

export interface AssessmentComparabilityInput {
  functionalUnitUnit: string | null;
  functionalUnitDescription: string | null;
  isDeclaredUnit: boolean;
  /** Decimal compared numerically (finite, positive, equal), never as a string or a coerced float. */
  functionalUnitQuantity: string;
  boundary: string;
  /** Every stage this assessment includes in its own model — order-independent. */
  includedLifecycleStages: readonly string[];
  engineVersion: string | null;
  methodologyVersion: string | null;
  /** Serialisable methodology configuration snapshot (factor-selection mode, allocation defaults, …) — compared structurally, excluding display-only profile names/IDs by the caller before this input is built. */
  methodologySnapshot: unknown;
  hasRun: boolean;
  stale: boolean;
  staleReason: string | null;
}

export interface ScenarioComparabilityResult {
  comparable: boolean;
  reason: string | null;
  unitLabel: string;
}

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * A scenario only compares to its baseline when the functional unit, unit
 * type, quantity, system boundary, included lifecycle-stage set and
 * calculation-method configuration genuinely match and both results are
 * current — never a silent unit conversion, never an unqualified percentage
 * from stale or incompatible results (BD07 stop condition).
 *
 * Checks run in this order (Checkpoint B corrective handoff §3):
 *  1. both runs exist;
 *  2. functional/declared unit kind matches; the effective description is
 *     non-empty on both sides;
 *  3. quantity is finite, positive and numerically equal (Decimal, not
 *     string/float);
 *  4. unit code, boundary and included lifecycle-stage set match;
 *  5. methodology configuration + engine version are both known and equal —
 *     absent on both sides is never treated as equal;
 *  6. neither result is stale.
 *
 * Deliberately NOT compared: inventory contents, supplier factors or factor
 * values — those may be exactly the scenario change being assessed.
 */
export function buildScenarioComparability(input: {
  baseline: AssessmentComparabilityInput;
  scenario: AssessmentComparabilityInput;
}): ScenarioComparabilityResult {
  const { baseline, scenario } = input;
  const effectiveDescription = (a: AssessmentComparabilityInput) => (a.isDeclaredUnit ? a.functionalUnitDescription : a.functionalUnitDescription ?? a.functionalUnitUnit);
  const unitLabel = effectiveDescription(baseline)?.trim() || effectiveDescription(scenario)?.trim() || baseline.functionalUnitUnit || "functional unit";

  // 1. Both runs exist.
  if (!baseline.hasRun) return { comparable: false, reason: "The baseline has not been calculated yet.", unitLabel };
  if (!scenario.hasRun) return { comparable: false, reason: "This scenario has not been calculated yet.", unitLabel };

  // 2. Unit kind matches; effective description non-empty on both sides.
  if (baseline.isDeclaredUnit !== scenario.isDeclaredUnit) {
    return {
      comparable: false,
      reason: "Baseline and scenario use different unit types (functional vs declared unit); not comparable.",
      unitLabel,
    };
  }
  const baselineDescription = effectiveDescription(baseline)?.trim() ?? "";
  const scenarioDescription = effectiveDescription(scenario)?.trim() ?? "";
  if (!baselineDescription || !scenarioDescription) {
    return { comparable: false, reason: "One side has no functional/declared unit description recorded; not comparable.", unitLabel };
  }

  // 3. Quantity is finite, positive and numerically equal (Decimal).
  let baselineQty: Decimal, scenarioQty: Decimal;
  try {
    baselineQty = new Decimal(baseline.functionalUnitQuantity);
    scenarioQty = new Decimal(scenario.functionalUnitQuantity);
  } catch {
    return { comparable: false, reason: "Functional unit quantity is not a valid number; not comparable.", unitLabel };
  }
  if (!baselineQty.isFinite() || !scenarioQty.isFinite() || baselineQty.lte(0) || scenarioQty.lte(0)) {
    return { comparable: false, reason: "Functional unit quantity must be finite and positive; not comparable.", unitLabel };
  }
  if (!baselineQty.equals(scenarioQty)) {
    return {
      comparable: false,
      reason: "Functional unit quantities differ between baseline and scenario; not comparable.",
      unitLabel,
    };
  }

  // 4. Unit code, boundary and included lifecycle-stage set match.
  if (baseline.functionalUnitUnit !== scenario.functionalUnitUnit) {
    return {
      comparable: false,
      reason: `Functional units differ ("${baseline.functionalUnitUnit ?? "unset"}" vs "${scenario.functionalUnitUnit ?? "unset"}"); not comparable.`,
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
  const baselineStages = new Set(baseline.includedLifecycleStages);
  const scenarioStages = new Set(scenario.includedLifecycleStages);
  const stagesMatch = baselineStages.size === scenarioStages.size && [...baselineStages].every((s) => scenarioStages.has(s));
  if (!stagesMatch) {
    return { comparable: false, reason: "The included lifecycle stages differ between baseline and scenario; not comparable.", unitLabel };
  }

  // 5. Methodology configuration + engine version known and equal — absent
  // on both sides is never treated as equal, since unknown provenance
  // proves nothing.
  if (baseline.engineVersion === null || scenario.engineVersion === null) {
    return { comparable: false, reason: "Engine version is not recorded for one side; not comparable.", unitLabel };
  }
  if (baseline.engineVersion !== scenario.engineVersion) {
    return { comparable: false, reason: `Calculation engine versions differ ("${baseline.engineVersion}" vs "${scenario.engineVersion}"); not comparable.`, unitLabel };
  }
  if (baseline.methodologyVersion !== scenario.methodologyVersion) {
    return { comparable: false, reason: `Methodology versions differ ("${baseline.methodologyVersion ?? "unset"}" vs "${scenario.methodologyVersion ?? "unset"}"); not comparable.`, unitLabel };
  }
  if (baseline.methodologySnapshot === null || baseline.methodologySnapshot === undefined || scenario.methodologySnapshot === null || scenario.methodologySnapshot === undefined) {
    return { comparable: false, reason: "Methodology configuration is not recorded for one side; not comparable.", unitLabel };
  }
  if (canonicalJson(baseline.methodologySnapshot) !== canonicalJson(scenario.methodologySnapshot)) {
    return { comparable: false, reason: "Methodology configuration differs between baseline and scenario; not comparable.", unitLabel };
  }

  // 6. Freshness.
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

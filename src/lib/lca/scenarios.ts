/**
 * Scenario and sensitivity analysis.
 *
 * A scenario is a set of overrides on the baseline inventory — a different
 * quantity, a different mapped factor, a shorter transport leg, a flow
 * excluded. Applying them produces a new `LcaCalculationInput`, which goes
 * through exactly the same deterministic engine as the baseline. There is no
 * separate "scenario maths" that could drift from the real thing.
 *
 * The comparison figures below are what the AI is later given to interpret.
 * When the assistant says "changing electricity supply reduces cradle-to-gate
 * emissions by about 18%", that 18% came from here.
 */

import { calculateLca, LcaCalculationInput, LcaCalculationResult, LcaFactorSnapshot, LcaFlowInput } from "./calc";

export interface LcaFlowOverride {
  flowId: string;
  quantity?: number | null;
  transportDistanceKm?: number | null;
  factor?: LcaFactorSnapshot | null;
  excluded?: boolean;
}

/**
 * Produces the scenario's inventory. The baseline input is never mutated —
 * a scenario that could corrupt the baseline would be worse than useless.
 */
export function applyScenarioOverrides(
  baseline: LcaCalculationInput,
  overrides: LcaFlowOverride[],
): LcaCalculationInput {
  const byFlowId = new Map(overrides.map((o) => [o.flowId, o]));

  return {
    ...baseline,
    stages: baseline.stages.map((stage) => ({
      ...stage,
      processes: stage.processes.map((process) => ({
        ...process,
        flows: process.flows
          .map((flow): LcaFlowInput | null => {
            const override = byFlowId.get(flow.id);
            if (!override) return flow;
            if (override.excluded) return null;

            return {
              ...flow,
              quantity: override.quantity ?? flow.quantity,
              transportDistanceKm:
                override.transportDistanceKm !== undefined && override.transportDistanceKm !== null
                  ? override.transportDistanceKm
                  : flow.transportDistanceKm,
              factor: override.factor !== undefined ? override.factor : flow.factor,
            };
          })
          .filter((flow): flow is LcaFlowInput => flow !== null),
      })),
    })),
  };
}

export function runScenario(baseline: LcaCalculationInput, overrides: LcaFlowOverride[]): LcaCalculationResult {
  return calculateLca(applyScenarioOverrides(baseline, overrides));
}

export interface ScenarioComparison {
  scenarioName: string;
  baselineKgCo2e: number;
  scenarioKgCo2e: number;
  deltaKgCo2e: number;
  /** Null when the baseline is zero — no honest percentage exists. */
  deltaPercent: number | null;
  /** For emissions, down is the good direction. Null when there's no baseline to judge against. */
  isImprovement: boolean | null;
  byStage: {
    stageId: string;
    name: string;
    baselineKgCo2e: number;
    scenarioKgCo2e: number;
    deltaKgCo2e: number;
  }[];
  /** Set when the two runs don't cover the same flows, so a delta needs caveating. */
  coverageChanged: boolean;
}

export function compareScenario(
  scenarioName: string,
  baseline: LcaCalculationResult,
  scenario: LcaCalculationResult,
): ScenarioComparison {
  const deltaKgCo2e = Number((scenario.totalKgCo2e - baseline.totalKgCo2e).toFixed(8));
  const deltaPercent = baseline.totalKgCo2e > 0 ? (deltaKgCo2e / baseline.totalKgCo2e) * 100 : null;

  const baselineStages = new Map(baseline.stages.map((s) => [s.stageId, s]));
  const byStage = scenario.stages.map((s) => {
    const base = baselineStages.get(s.stageId);
    return {
      stageId: s.stageId,
      name: s.name,
      baselineKgCo2e: base?.kgCo2e ?? 0,
      scenarioKgCo2e: s.kgCo2e,
      deltaKgCo2e: Number((s.kgCo2e - (base?.kgCo2e ?? 0)).toFixed(8)),
    };
  });

  return {
    scenarioName,
    baselineKgCo2e: baseline.totalKgCo2e,
    scenarioKgCo2e: scenario.totalKgCo2e,
    deltaKgCo2e,
    deltaPercent,
    isImprovement: deltaPercent === null ? null : deltaKgCo2e === 0 ? null : deltaKgCo2e < 0,
    byStage,
    coverageChanged:
      baseline.calculatedFlowCount !== scenario.calculatedFlowCount ||
      baseline.unmappedFlowCount !== scenario.unmappedFlowCount,
  };
}

export interface SensitivityResult {
  flowId: string;
  flowName: string;
  /** The change applied, e.g. +10% on the flow's quantity. */
  perturbationPercent: number;
  baselineKgCo2e: number;
  perturbedKgCo2e: number;
  /**
   * Percentage change in the total per 1% change in this flow — the standard
   * "which assumptions matter" reading. Null when the baseline total is zero.
   */
  elasticity: number | null;
}

/**
 * One-at-a-time sensitivity: nudge each calculated flow's quantity and see
 * how much the total moves. Deterministic, and the honest way to answer
 * "which assumptions have the biggest effect" — as opposed to asking a model
 * to intuit it.
 */
export function runSensitivityAnalysis(
  baseline: LcaCalculationInput,
  perturbationPercent = 10,
): SensitivityResult[] {
  const baseResult = calculateLca(baseline);
  const factor = 1 + perturbationPercent / 100;
  const results: SensitivityResult[] = [];

  for (const stage of baseline.stages) {
    if (!stage.included) continue;
    for (const process of stage.processes) {
      for (const flow of process.flows) {
        if (!flow.factor) continue;

        const perturbed = calculateLca(
          applyScenarioOverrides(baseline, [{ flowId: flow.id, quantity: flow.quantity * factor }]),
        );

        const totalChangePercent =
          baseResult.totalKgCo2e > 0
            ? ((perturbed.totalKgCo2e - baseResult.totalKgCo2e) / baseResult.totalKgCo2e) * 100
            : null;

        results.push({
          flowId: flow.id,
          flowName: flow.name,
          perturbationPercent,
          baselineKgCo2e: baseResult.totalKgCo2e,
          perturbedKgCo2e: perturbed.totalKgCo2e,
          elasticity: totalChangePercent === null ? null : Number((totalChangePercent / perturbationPercent).toFixed(6)),
        });
      }
    }
  }

  return results.sort((a, b) => Math.abs(b.elasticity ?? 0) - Math.abs(a.elasticity ?? 0));
}

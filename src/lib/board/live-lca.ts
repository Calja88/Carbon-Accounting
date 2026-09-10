/**
 * BD07 live adapter: binds Astra's `LcaScenario` board component to actual
 * comparable baseline/scenario runs. Deliberately no `import "server-only"`
 * — that package isn't a dependency of this repo (same documented exception
 * as live-nav.ts/live-overview.ts/live-records.ts) and breaks Vitest module
 * resolution; this module is only ever imported from a server component.
 *
 * The `comparable` judgment (unit, boundary, quantity, freshness) is made
 * here, server-side, from real assessment/run rows — the component itself
 * never computes or converts a footprint.
 */

import type { OrganisationContext } from "@/lib/organisation/context";
import { requireAssessmentInScope } from "@/lib/repositories/lca-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { canViewLca } from "@/lib/lca/permissions";
import { getLatestRun, isCalculationStale, resultsToAnalysisRows, runTotals } from "@/lib/lca/calculation-service";
import { contributionsByStage } from "@/lib/lca/analysis";
import { BOUNDARY_LABELS } from "@/lib/lca/labels";
import type { ScenarioComparison } from "@/components/board/lca-scenario";
import { buildScenarioComparability, mergeStageContributions } from "./live-lca-helpers";

/**
 * Resolves the board scenario summary for one scenario assessment against
 * its baseline. Returns `null` when the caller lacks access, the record
 * isn't a scenario, or its baseline can't be resolved in scope — never a
 * fabricated or partially-authorized model.
 */
export async function getLcaScenarioModel(
  context: OrganisationContext,
  scenarioAssessmentId: string,
): Promise<ScenarioComparison | null> {
  if (!canViewLca(context)) return null;

  let scenario;
  try {
    scenario = await requireAssessmentInScope(context, scenarioAssessmentId);
  } catch (err) {
    if (err instanceof TenantOwnershipError || err instanceof PermissionDeniedError) return null;
    throw err;
  }
  if (!scenario.isScenario || !scenario.baselineAssessmentId) return null;

  let baseline;
  try {
    baseline = await requireAssessmentInScope(context, scenario.baselineAssessmentId);
  } catch (err) {
    if (err instanceof TenantOwnershipError || err instanceof PermissionDeniedError) return null;
    throw err;
  }

  const [baselineRun, scenarioRun, baselineStale, scenarioStale] = await Promise.all([
    getLatestRun(baseline.id),
    getLatestRun(scenario.id),
    isCalculationStale(baseline.id),
    isCalculationStale(scenario.id),
  ]);

  const judgement = buildScenarioComparability({
    baseline: {
      functionalUnitUnit: baseline.functionalUnitUnit,
      functionalUnitDescription: baseline.functionalUnitDescription,
      isDeclaredUnit: baseline.isDeclaredUnit,
      functionalUnitQuantity: baseline.functionalUnitQuantity.toString(),
      boundary: baseline.boundary,
      hasRun: Boolean(baselineRun),
      stale: baselineStale.stale,
      staleReason: baselineStale.reason,
    },
    scenario: {
      functionalUnitUnit: scenario.functionalUnitUnit,
      functionalUnitDescription: scenario.functionalUnitDescription,
      isDeclaredUnit: scenario.isDeclaredUnit,
      functionalUnitQuantity: scenario.functionalUnitQuantity.toString(),
      boundary: scenario.boundary,
      hasRun: Boolean(scenarioRun),
      stale: scenarioStale.stale,
      staleReason: scenarioStale.reason,
    },
  });

  const baselineKgPerUnit = baselineRun ? runTotals(baselineRun).headlinePerFunctionalUnitKgCo2e : null;
  const scenarioKgPerUnit = scenarioRun ? runTotals(scenarioRun).headlinePerFunctionalUnitKgCo2e : null;

  const contributions = mergeStageContributions(
    baselineRun ? contributionsByStage(resultsToAnalysisRows(baselineRun.results)) : [],
    scenarioRun ? contributionsByStage(resultsToAnalysisRows(scenarioRun.results)) : [],
  );

  return {
    baseline: {
      title: `${baseline.reference} ${baseline.title}`,
      kgPerUnit: baselineKgPerUnit,
      source: { label: "Open baseline assessment", href: `/assessments/${baseline.id}` },
    },
    scenario: {
      title: `${scenario.reference} ${scenario.title}`,
      kgPerUnit: scenarioKgPerUnit,
      source: { label: "Open scenario assessment", href: `/assessments/${scenario.id}` },
    },
    unit: judgement.unitLabel,
    boundary: BOUNDARY_LABELS[baseline.boundary],
    comparable: judgement.comparable,
    reason: judgement.reason,
    contributions,
  };
}

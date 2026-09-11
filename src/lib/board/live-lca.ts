/**
 * BD07 live adapter: binds Astra's `LcaScenario` board component to actual
 * comparable baseline/scenario runs. Deliberately no `import "server-only"`
 * — that package isn't a dependency of this repo (same documented exception
 * as live-nav.ts/live-overview.ts/live-records.ts) and breaks Vitest module
 * resolution; this module is only ever imported from a server component.
 *
 * The `comparable` judgment (unit, boundary, quantity, method, freshness) is
 * made here, server-side, from real assessment/run rows — the component
 * itself never computes or converts a footprint.
 *
 * Checkpoint B corrective handoff §3: `resolveScenarioComparison` is the
 * SINGLE authorised resolution path for a scenario-vs-baseline comparison.
 * Both the compact board summary (`getLcaScenarioModel`) and the full
 * legacy per-stage/per-item breakdown (`getScenarioPageModel`) are derived
 * from its one result — neither independently re-fetches baseline/scenario
 * rows or re-runs `compareScenario` against data resolved outside this
 * authorization boundary.
 */

import type { LcaAssessmentStatus } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { prisma } from "@/lib/prisma";
import { requireAssessmentInScope, accessibleAssessmentFilter } from "@/lib/repositories/lca-repository";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { canViewLca } from "@/lib/lca/permissions";
import { getLatestRun, isCalculationStale, resultsToAnalysisRows, runTotals } from "@/lib/lca/calculation-service";
import { contributionsByStage, compareScenario, type ScenarioComparison as LegacyScenarioComparison } from "@/lib/lca/analysis";
import { D } from "@/lib/lca/decimal";
import { BOUNDARY_LABELS } from "@/lib/lca/labels";
import type { ScenarioComparison } from "@/components/board/lca-scenario";
import { buildScenarioComparability, mergeStageContributions } from "./live-lca-helpers";

/** Every lifecycle stage this assessment's own model currently includes — the assessmentId comes from an already-in-scope assessment, so no further tenant check is needed for this assessment-owned child table. */
async function includedLifecycleStages(assessmentId: string): Promise<string[]> {
  const rows = await prisma.lcaProcess.findMany({
    where: { assessmentId, isIncluded: true },
    select: { stage: true },
    distinct: ["stage"],
  });
  return rows.map((r) => r.stage);
}

interface ResolvedScenarioComparison {
  baseline: Awaited<ReturnType<typeof requireAssessmentInScope>>;
  scenario: Awaited<ReturnType<typeof requireAssessmentInScope>>;
  baselineRun: Awaited<ReturnType<typeof getLatestRun>>;
  scenarioRun: Awaited<ReturnType<typeof getLatestRun>>;
  comparable: boolean;
  reason: string | null;
  unitLabel: string;
}

/**
 * The one authorised resolution: confirms the caller can view LCA, that
 * `scenarioAssessmentId` is genuinely a scenario in scope, that its baseline
 * is also in scope, then judges comparability from real run/process rows.
 * Returns `null` for any authorization failure or structural mismatch
 * (not a scenario, no baseline) — callers must never render scenario
 * metadata when this returns `null`.
 */
async function resolveScenarioComparison(
  context: OrganisationContext,
  scenarioAssessmentId: string,
): Promise<ResolvedScenarioComparison | null> {
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

  const [baselineRun, scenarioRun, baselineStale, scenarioStale, baselineStages, scenarioStages] = await Promise.all([
    getLatestRun(baseline.id),
    getLatestRun(scenario.id),
    isCalculationStale(baseline.id),
    isCalculationStale(scenario.id),
    includedLifecycleStages(baseline.id),
    includedLifecycleStages(scenario.id),
  ]);

  const judgement = buildScenarioComparability({
    baseline: {
      functionalUnitUnit: baseline.functionalUnitUnit,
      functionalUnitDescription: baseline.functionalUnitDescription,
      isDeclaredUnit: baseline.isDeclaredUnit,
      functionalUnitQuantity: baseline.functionalUnitQuantity.toString(),
      boundary: baseline.boundary,
      includedLifecycleStages: baselineStages,
      engineVersion: baselineRun?.engineVersion ?? null,
      methodologyVersion: baselineRun?.methodologyVersion ?? null,
      methodologySnapshot: baselineRun?.methodologySnapshot ?? null,
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
      includedLifecycleStages: scenarioStages,
      engineVersion: scenarioRun?.engineVersion ?? null,
      methodologyVersion: scenarioRun?.methodologyVersion ?? null,
      methodologySnapshot: scenarioRun?.methodologySnapshot ?? null,
      hasRun: Boolean(scenarioRun),
      stale: scenarioStale.stale,
      staleReason: scenarioStale.reason,
    },
  });

  return {
    baseline,
    scenario,
    baselineRun,
    scenarioRun,
    comparable: judgement.comparable,
    reason: judgement.reason,
    unitLabel: judgement.unitLabel,
  };
}

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
  const resolved = await resolveScenarioComparison(context, scenarioAssessmentId);
  if (!resolved) return null;
  return buildBoardSummary(resolved);
}

function buildBoardSummary(resolved: ResolvedScenarioComparison): ScenarioComparison {
  const { baseline, scenario, baselineRun, scenarioRun, comparable, reason, unitLabel } = resolved;

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
    unit: unitLabel,
    boundary: BOUNDARY_LABELS[baseline.boundary],
    comparable,
    reason,
    contributions,
  };
}

export interface ScenarioPageModel {
  board: ScenarioComparison;
  /** Raw scenario record fields — safe to render only because they came from the same authorised resolution as `board`. */
  scenarioId: string;
  title: string;
  description: string | null;
  status: LcaAssessmentStatus;
  inventoryItemCount: number;
  hasRun: boolean;
  /** The full legacy per-stage/per-item breakdown, from the exact same authorised run data as `board` — null whenever either side has no run. */
  legacyComparison: LegacyScenarioComparison | null;
}

/**
 * Everything the scenarios page needs for one scenario card, resolved once
 * through the same authorization and run data as the board summary — the
 * page must never independently query LcaAssessment/LcaCalculationRun rows
 * or call `compareScenario` itself with data fetched outside this
 * boundary. Returns `null` under the same conditions as
 * `getLcaScenarioModel`; callers must render nothing scenario-identifying
 * (title, description, status, owner, inventory count, links, recalculate
 * control) when this is `null`.
 */
export async function getScenarioPageModel(
  context: OrganisationContext,
  scenarioAssessmentId: string,
): Promise<ScenarioPageModel | null> {
  const resolved = await resolveScenarioComparison(context, scenarioAssessmentId);
  if (!resolved) return null;
  const { scenario, baselineRun, scenarioRun, comparable } = resolved;
  const board = buildBoardSummary(resolved);

  const inventoryItemCount = await prisma.lcaInventoryItem.count({ where: { assessmentId: scenario.id } });

  const legacyComparison =
    baselineRun && scenarioRun
      ? compareScenario(
          resultsToAnalysisRows(baselineRun.results),
          resultsToAnalysisRows(scenarioRun.results),
          D(runTotals(baselineRun).headlinePerFunctionalUnitKgCo2e),
          D(runTotals(scenarioRun).headlinePerFunctionalUnitKgCo2e),
        )
      : null;

  return {
    board,
    scenarioId: scenario.id,
    title: scenario.title,
    description: scenario.scenarioDescription,
    status: scenario.status,
    inventoryItemCount,
    hasRun: Boolean(scenarioRun),
    legacyComparison: comparable ? legacyComparison : null,
  };
}

/**
 * Authorised child-scenario ids for a baseline assessment — the caller's
 * organisation + Entity access, never a raw `baselineAssessmentId` filter
 * with no tenant/access scoping.
 */
export async function listAuthorizedScenarioIds(context: OrganisationContext, baselineAssessmentId: string): Promise<string[]> {
  const ctx = toTenantRepositoryContext(context);
  const rows = await prisma.lcaAssessment.findMany({
    where: tenantWhere(ctx, { baselineAssessmentId, ...accessibleAssessmentFilter(context) }),
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.id);
}

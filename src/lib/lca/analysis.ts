/**
 * Interpretation of a calculation run: where the footprint actually comes
 * from, how good the data behind it is, and how much of the answer could
 * move.
 *
 * Works on a structural row shape rather than a Prisma model so the same code
 * serves a freshly computed run (engine output, still in memory) and a stored
 * historical run read back from LcaCalculationResult — a report and the live
 * dashboard therefore can never disagree about the same run.
 */

import {
  LcaDataType,
  LcaEmissionClassification,
  LcaItemType,
  LcaLifecycleStage,
} from "@prisma/client";
import { D, Decimal, ONE, ZERO, percentOf, toNumber } from "./decimal";
import { LIFECYCLE_STAGE_ORDER, STAGE_LABELS } from "./labels";

/** The minimum a row needs to expose to be analysable. */
export interface AnalysisRow {
  stage: LcaLifecycleStage;
  processId: string | null;
  processName: string;
  inventoryItemId: string | null;
  itemName: string;
  itemType: LcaItemType;
  classification: LcaEmissionClassification;
  materialName: string | null;
  supplierName: string | null;
  dataType: LcaDataType;
  dataQualityScore: Decimal | null;
  uncertaintyPercent: Decimal | null;
  allocatedKgCo2e: Decimal;
  perFunctionalUnitKgCo2e: Decimal;
  factorSource: string;
  isPlaceholderFactor: boolean;
}

export interface Contribution {
  key: string;
  label: string;
  sublabel?: string;
  kgCo2e: number;
  perFunctionalUnitKgCo2e: number;
  percent: number;
}

/**
 * Contribution shares are taken against the sum of the *positive* rows.
 *
 * If credits and removals were included in the denominator, a model with a
 * large avoided-burden credit could show contributions summing to well over
 * 100%, or a stage's share could swing wildly on a change elsewhere. Gross
 * emissions are the honest denominator for "where does this come from?", and
 * credits are reported separately in the totals.
 */
export function grossPositiveTotal(rows: AnalysisRow[]): Decimal {
  return rows.reduce<Decimal>((sum, r) => (r.allocatedKgCo2e.gt(ZERO) ? sum.plus(r.allocatedKgCo2e) : sum), ZERO);
}

function contributionsBy(
  rows: AnalysisRow[],
  keyFn: (row: AnalysisRow) => string | null,
  labelFn: (row: AnalysisRow) => string,
  sublabelFn?: (row: AnalysisRow) => string | undefined,
): Contribution[] {
  const denominator = grossPositiveTotal(rows);
  const groups = new Map<string, { label: string; sublabel?: string; kg: Decimal; perFu: Decimal }>();

  for (const row of rows) {
    const key = keyFn(row);
    if (key === null) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.kg = existing.kg.plus(row.allocatedKgCo2e);
      existing.perFu = existing.perFu.plus(row.perFunctionalUnitKgCo2e);
    } else {
      groups.set(key, {
        label: labelFn(row),
        sublabel: sublabelFn?.(row),
        kg: row.allocatedKgCo2e,
        perFu: row.perFunctionalUnitKgCo2e,
      });
    }
  }

  return Array.from(groups.entries())
    .map(([key, g]) => ({
      key,
      label: g.label,
      sublabel: g.sublabel,
      kgCo2e: toNumber(g.kg),
      perFunctionalUnitKgCo2e: toNumber(g.perFu),
      percent: toNumber(percentOf(g.kg, denominator)),
    }))
    .sort((a, b) => b.kgCo2e - a.kgCo2e);
}

/** Stage contributions in lifecycle order, including stages that are zero. */
export function contributionsByStage(rows: AnalysisRow[]): Contribution[] {
  const denominator = grossPositiveTotal(rows);
  const present = new Map<LcaLifecycleStage, { kg: Decimal; perFu: Decimal }>();
  for (const row of rows) {
    const g = present.get(row.stage) ?? { kg: ZERO, perFu: ZERO };
    present.set(row.stage, {
      kg: g.kg.plus(row.allocatedKgCo2e),
      perFu: g.perFu.plus(row.perFunctionalUnitKgCo2e),
    });
  }
  return LIFECYCLE_STAGE_ORDER.filter((stage) => present.has(stage)).map((stage) => {
    const g = present.get(stage) as { kg: Decimal; perFu: Decimal };
    return {
      key: stage,
      label: STAGE_LABELS[stage],
      kgCo2e: toNumber(g.kg),
      perFunctionalUnitKgCo2e: toNumber(g.perFu),
      percent: toNumber(percentOf(g.kg, denominator)),
    };
  });
}

export function contributionsByProcess(rows: AnalysisRow[]): Contribution[] {
  return contributionsBy(
    rows,
    (r) => r.processId ?? r.processName,
    (r) => r.processName,
    (r) => STAGE_LABELS[r.stage],
  );
}

export function contributionsByMaterial(rows: AnalysisRow[]): Contribution[] {
  return contributionsBy(
    rows.filter((r) => r.materialName || r.itemType === LcaItemType.MATERIAL || r.itemType === LcaItemType.PACKAGING),
    (r) => r.materialName ?? r.itemName,
    (r) => r.materialName ?? r.itemName,
  );
}

export function contributionsBySupplier(rows: AnalysisRow[]): Contribution[] {
  const withSupplier = contributionsBy(
    rows.filter((r) => r.supplierName),
    (r) => r.supplierName,
    (r) => r.supplierName as string,
  );
  const unattributed = rows.filter((r) => !r.supplierName);
  if (unattributed.length === 0) return withSupplier;

  const denominator = grossPositiveTotal(rows);
  const kg = unattributed.reduce<Decimal>((s, r) => s.plus(r.allocatedKgCo2e), ZERO);
  const perFu = unattributed.reduce<Decimal>((s, r) => s.plus(r.perFunctionalUnitKgCo2e), ZERO);
  return [
    ...withSupplier,
    {
      key: "__no_supplier__",
      label: "No supplier recorded",
      kgCo2e: toNumber(kg),
      perFunctionalUnitKgCo2e: toNumber(perFu),
      percent: toNumber(percentOf(kg, denominator)),
    },
  ].sort((a, b) => b.kgCo2e - a.kgCo2e);
}

export function contributionsByItem(rows: AnalysisRow[]): Contribution[] {
  return contributionsBy(
    rows,
    (r) => r.inventoryItemId ?? r.itemName,
    (r) => r.itemName,
    (r) => `${STAGE_LABELS[r.stage]} · ${r.processName}`,
  );
}

/** Highest-contributing lines, the natural starting point for improvement work. */
export function hotspots(rows: AnalysisRow[], limit = 10): Contribution[] {
  return contributionsByItem(rows.filter((r) => r.allocatedKgCo2e.gt(ZERO))).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------

export interface DataTypeCoverage {
  dataType: LcaDataType | "MISSING_QUALITY";
  label: string;
  kgCo2e: number;
  percent: number;
  lineCount: number;
}

export interface DataQualitySummary {
  /**
   * Mean pedigree score weighted by each line's share of gross emissions —
   * a poor score on a line that barely matters shouldn't drag the assessment
   * down, and a poor score on the dominant line shouldn't be averaged away.
   */
  footprintWeightedScore: number | null;
  /** Unweighted mean across scored lines, for comparison. */
  simpleMeanScore: number | null;
  scoredLineCount: number;
  totalLineCount: number;
  /** Share of gross emissions carried by lines with no data-quality scores. */
  unscoredEmissionsPercent: number;
  coverage: DataTypeCoverage[];
  /** Share of gross emissions still resting on a placeholder factor. */
  placeholderFactorPercent: number;
}

const DATA_TYPE_COVERAGE_LABELS: Record<LcaDataType | "MISSING_QUALITY", string> = {
  PRIMARY: "Primary data",
  SUPPLIER_SPECIFIC: "Supplier-specific data",
  SECONDARY: "Secondary data",
  PROXY: "Proxy data",
  MODELLED: "Modelled data",
  MISSING_QUALITY: "No data-quality scores recorded",
};

export function summariseDataQuality(rows: AnalysisRow[]): DataQualitySummary {
  const denominator = grossPositiveTotal(rows);
  const positiveRows = rows.filter((r) => r.allocatedKgCo2e.gt(ZERO));

  let weightedSum = ZERO;
  let weightUsed = ZERO;
  let scoreSum = ZERO;
  let scoredCount = 0;

  for (const row of rows) {
    if (row.dataQualityScore === null) continue;
    scoreSum = scoreSum.plus(row.dataQualityScore);
    scoredCount += 1;
    if (row.allocatedKgCo2e.gt(ZERO)) {
      weightedSum = weightedSum.plus(row.dataQualityScore.times(row.allocatedKgCo2e));
      weightUsed = weightUsed.plus(row.allocatedKgCo2e);
    }
  }

  const unscoredEmissions = positiveRows
    .filter((r) => r.dataQualityScore === null)
    .reduce<Decimal>((s, r) => s.plus(r.allocatedKgCo2e), ZERO);

  const placeholderEmissions = positiveRows
    .filter((r) => r.isPlaceholderFactor)
    .reduce<Decimal>((s, r) => s.plus(r.allocatedKgCo2e), ZERO);

  const coverage: DataTypeCoverage[] = (
    ["PRIMARY", "SUPPLIER_SPECIFIC", "SECONDARY", "PROXY", "MODELLED"] as LcaDataType[]
  ).map((dataType) => {
    const matching = rows.filter((r) => r.dataType === dataType);
    const kg = matching.reduce<Decimal>((s, r) => (r.allocatedKgCo2e.gt(ZERO) ? s.plus(r.allocatedKgCo2e) : s), ZERO);
    return {
      dataType,
      label: DATA_TYPE_COVERAGE_LABELS[dataType],
      kgCo2e: toNumber(kg),
      percent: toNumber(percentOf(kg, denominator)),
      lineCount: matching.length,
    };
  });

  coverage.push({
    dataType: "MISSING_QUALITY",
    label: DATA_TYPE_COVERAGE_LABELS.MISSING_QUALITY,
    kgCo2e: toNumber(unscoredEmissions),
    percent: toNumber(percentOf(unscoredEmissions, denominator)),
    lineCount: rows.filter((r) => r.dataQualityScore === null).length,
  });

  return {
    footprintWeightedScore: weightUsed.gt(ZERO) ? toNumber(weightedSum.div(weightUsed)) : null,
    simpleMeanScore: scoredCount > 0 ? toNumber(scoreSum.div(D(scoredCount))) : null,
    scoredLineCount: scoredCount,
    totalLineCount: rows.length,
    unscoredEmissionsPercent: toNumber(percentOf(unscoredEmissions, denominator)),
    coverage,
    placeholderFactorPercent: toNumber(percentOf(placeholderEmissions, denominator)),
  };
}

// ---------------------------------------------------------------------------
// Uncertainty and sensitivity
// ---------------------------------------------------------------------------

export interface UncertaintySummary {
  /** Share of gross emissions on lines carrying a quantified uncertainty. */
  coveragePercent: number;
  assessedLineCount: number;
  totalLineCount: number;
  /** Combined uncertainty on the total, as a percentage, or null if unusable. */
  combinedPercent: number | null;
  lowerKgCo2e: number | null;
  upperKgCo2e: number | null;
  totalKgCo2e: number;
  method: string;
  caveat: string;
}

/**
 * Combines line-level uncertainties in quadrature — the square root of the
 * sum of squared absolute uncertainties.
 *
 * That is the correct combination *only if* the line uncertainties are
 * independent of one another, which they often are not: two materials priced
 * from the same database share its systematic error. The result is therefore
 * reported as an indicative range with that assumption stated, not as a
 * confidence interval. Lines with no recorded uncertainty contribute nothing,
 * so the range narrows as coverage falls — which is why coverage is reported
 * next to it rather than buried.
 *
 * This is also the shape a Monte Carlo analysis would need: per-line
 * distributions over the same rows. Monte Carlo is NOT implemented here, and
 * nothing in this module should be read as if it were.
 */
export function summariseUncertainty(rows: AnalysisRow[]): UncertaintySummary {
  const total = rows.reduce<Decimal>((s, r) => s.plus(r.allocatedKgCo2e), ZERO);
  const denominator = grossPositiveTotal(rows);

  let sumOfSquares = ZERO;
  let assessedCount = 0;
  let assessedEmissions = ZERO;

  for (const row of rows) {
    if (!row.uncertaintyPercent || row.uncertaintyPercent.lte(ZERO)) continue;
    assessedCount += 1;
    if (row.allocatedKgCo2e.gt(ZERO)) assessedEmissions = assessedEmissions.plus(row.allocatedKgCo2e);
    const absolute = row.allocatedKgCo2e.abs().times(row.uncertaintyPercent).div(D(100));
    sumOfSquares = sumOfSquares.plus(absolute.times(absolute));
  }

  const combinedAbsolute = sumOfSquares.gt(ZERO) ? sumOfSquares.sqrt() : null;
  const combinedPercent = combinedAbsolute && total.abs().gt(ZERO) ? combinedAbsolute.div(total.abs()).times(D(100)) : null;

  return {
    coveragePercent: toNumber(percentOf(assessedEmissions, denominator)),
    assessedLineCount: assessedCount,
    totalLineCount: rows.length,
    combinedPercent: combinedPercent ? toNumber(combinedPercent) : null,
    lowerKgCo2e: combinedAbsolute ? toNumber(total.minus(combinedAbsolute)) : null,
    upperKgCo2e: combinedAbsolute ? toNumber(total.plus(combinedAbsolute)) : null,
    totalKgCo2e: toNumber(total),
    method: "Independent line uncertainties combined in quadrature (root sum of squares).",
    caveat:
      "Treats each line's uncertainty as independent. Lines drawn from the same dataset share systematic error, so the real range is wider than this. Lines with no recorded uncertainty contribute nothing to the range — read the coverage figure alongside it. This is an indicative range, not a statistical confidence interval, and no Monte Carlo simulation has been run.",
  };
}

export interface SensitivityEntry {
  key: string;
  label: string;
  sublabel?: string;
  kgCo2e: number;
  percentOfTotal: number;
  /** Change in the total if this line moved by the tested amount. */
  deltaKgCo2e: number;
  deltaTotalPercent: number;
  newTotalKgCo2e: number;
}

export interface SensitivityResult {
  testedChangePercent: number;
  baselineTotalKgCo2e: number;
  entries: SensitivityEntry[];
  method: string;
}

/**
 * One-at-a-time sensitivity: move each of the largest contributors by a fixed
 * percentage, holding everything else still, and report the effect on the
 * total. Deterministic, exactly reproducible, and it makes no claim about how
 * likely any of those moves is — which is precisely the claim a Monte Carlo
 * run would make and this does not.
 */
export function sensitivityAnalysis(rows: AnalysisRow[], changePercent = 10, limit = 10): SensitivityResult {
  const total = rows.reduce<Decimal>((s, r) => s.plus(r.allocatedKgCo2e), ZERO);
  const change = D(changePercent).div(D(100));
  const contributions = contributionsByItem(rows).slice(0, limit);

  const entries: SensitivityEntry[] = contributions.map((c) => {
    const delta = D(c.kgCo2e).times(change);
    const newTotal = total.plus(delta);
    return {
      key: c.key,
      label: c.label,
      sublabel: c.sublabel,
      kgCo2e: c.kgCo2e,
      percentOfTotal: c.percent,
      deltaKgCo2e: toNumber(delta),
      deltaTotalPercent: total.abs().gt(ZERO) ? toNumber(delta.div(total.abs()).times(D(100))) : 0,
      newTotalKgCo2e: toNumber(newTotal),
    };
  });

  return {
    testedChangePercent: changePercent,
    baselineTotalKgCo2e: toNumber(total),
    entries,
    method: `Each line moved by ${changePercent}% on its own, with every other line held at its current value.`,
  };
}

// ---------------------------------------------------------------------------
// Scenario comparison
// ---------------------------------------------------------------------------

export interface ChangeDriver {
  key: string;
  label: string;
  sublabel?: string;
  baselineKgCo2e: number;
  scenarioKgCo2e: number;
  deltaKgCo2e: number;
  deltaPercent: number | null;
  /** Share of the total change this driver accounts for. */
  shareOfChangePercent: number;
}

export interface ScenarioComparison {
  baselineTotalKgCo2e: number;
  scenarioTotalKgCo2e: number;
  absoluteReductionKgCo2e: number;
  percentReduction: number | null;
  baselinePerFunctionalUnit: number;
  scenarioPerFunctionalUnit: number;
  perFunctionalUnitReduction: number;
  perFunctionalUnitPercentReduction: number | null;
  driversByStage: ChangeDriver[];
  driversByItem: ChangeDriver[];
}

function buildDrivers(
  baseline: Contribution[],
  scenario: Contribution[],
  totalChange: Decimal,
): ChangeDriver[] {
  const keys = new Set([...baseline.map((c) => c.key), ...scenario.map((c) => c.key)]);
  const drivers: ChangeDriver[] = [];

  for (const key of keys) {
    const b = baseline.find((c) => c.key === key);
    const s = scenario.find((c) => c.key === key);
    const baseKg = D(b?.kgCo2e ?? 0);
    const scenKg = D(s?.kgCo2e ?? 0);
    const delta = scenKg.minus(baseKg);
    if (delta.isZero() && baseKg.isZero()) continue;
    drivers.push({
      key,
      label: s?.label ?? b?.label ?? key,
      sublabel: s?.sublabel ?? b?.sublabel,
      baselineKgCo2e: toNumber(baseKg),
      scenarioKgCo2e: toNumber(scenKg),
      deltaKgCo2e: toNumber(delta),
      deltaPercent: baseKg.abs().gt(ZERO) ? toNumber(delta.div(baseKg.abs()).times(D(100))) : null,
      shareOfChangePercent: totalChange.abs().gt(ZERO) ? toNumber(delta.div(totalChange.abs()).times(D(100))) : 0,
    });
  }

  return drivers.sort((a, b) => Math.abs(b.deltaKgCo2e) - Math.abs(a.deltaKgCo2e));
}

export function compareScenario(
  baselineRows: AnalysisRow[],
  scenarioRows: AnalysisRow[],
  baselinePerFu: Decimal,
  scenarioPerFu: Decimal,
): ScenarioComparison {
  const baselineTotal = baselineRows.reduce<Decimal>((s, r) => s.plus(r.allocatedKgCo2e), ZERO);
  const scenarioTotal = scenarioRows.reduce<Decimal>((s, r) => s.plus(r.allocatedKgCo2e), ZERO);
  const delta = scenarioTotal.minus(baselineTotal);
  const perFuDelta = scenarioPerFu.minus(baselinePerFu);

  return {
    baselineTotalKgCo2e: toNumber(baselineTotal),
    scenarioTotalKgCo2e: toNumber(scenarioTotal),
    // Positive means the scenario reduces emissions.
    absoluteReductionKgCo2e: toNumber(delta.negated()),
    percentReduction: baselineTotal.abs().gt(ZERO) ? toNumber(delta.negated().div(baselineTotal.abs()).times(D(100))) : null,
    baselinePerFunctionalUnit: toNumber(baselinePerFu),
    scenarioPerFunctionalUnit: toNumber(scenarioPerFu),
    perFunctionalUnitReduction: toNumber(perFuDelta.negated()),
    perFunctionalUnitPercentReduction: baselinePerFu.abs().gt(ZERO)
      ? toNumber(perFuDelta.negated().div(baselinePerFu.abs()).times(D(100)))
      : null,
    driversByStage: buildDrivers(contributionsByStage(baselineRows), contributionsByStage(scenarioRows), delta),
    driversByItem: buildDrivers(contributionsByItem(baselineRows), contributionsByItem(scenarioRows), delta),
  };
}

/** Every contribution view a results page or report needs, in one pass. */
export interface ContributionAnalysis {
  byStage: Contribution[];
  byProcess: Contribution[];
  byMaterial: Contribution[];
  bySupplier: Contribution[];
  byItem: Contribution[];
  hotspots: Contribution[];
  grossPositiveKgCo2e: number;
}

export function analyseContributions(rows: AnalysisRow[]): ContributionAnalysis {
  return {
    byStage: contributionsByStage(rows),
    byProcess: contributionsByProcess(rows),
    byMaterial: contributionsByMaterial(rows),
    bySupplier: contributionsBySupplier(rows),
    byItem: contributionsByItem(rows),
    hotspots: hotspots(rows),
    grossPositiveKgCo2e: toNumber(grossPositiveTotal(rows)),
  };
}

/** Used by the data-quality page: unit-normalised 0..1 quality indicator. */
export function qualityScoreToIndicator(score: number | null): { label: string; tone: "success" | "info" | "warning" | "danger" } {
  if (score === null) return { label: "Not scored", tone: "danger" };
  if (score <= 1.5) return { label: "Very good", tone: "success" };
  if (score <= 2.5) return { label: "Good", tone: "success" };
  if (score <= 3.5) return { label: "Fair", tone: "info" };
  if (score <= 4.5) return { label: "Weak", tone: "warning" };
  return { label: "Poor", tone: "danger" };
}

export { ONE as ANALYSIS_ONE };

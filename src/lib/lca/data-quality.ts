/**
 * Data quality assessment for an LCA inventory.
 *
 * Five dimensions, each scored 1 (best) to 5 (worst) by whoever entered the
 * flow: source reliability, completeness, temporal relevance, geographical
 * relevance and technological relevance. A dimension left unscored is
 * reported as unknown — never silently treated as good, and never averaged
 * away.
 *
 * This is *this platform's* transparent scheme, and the UI says so. It is
 * shaped like the pedigree matrices used in LCA practice, but it is not a
 * claim to implement any particular published matrix, and no score here is
 * converted into an uncertainty distribution — inventing precision is exactly
 * what this module is written to avoid.
 *
 * Weighting is by contribution: a poorly-evidenced flow that accounts for 40%
 * of the footprint matters far more than one that accounts for 0.1%, so the
 * study-level band is emissions-weighted, and the unweighted count is shown
 * beside it.
 */

import { LcaCalculationResult, LcaDataQualityScores, LcaFlowInput } from "./calc";

export type DataQualityBand = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export interface FlowDataQuality {
  flowId: string;
  name: string;
  band: DataQualityBand;
  /** Mean of the scored dimensions, 1 (best) to 5 (worst). Null when none are scored. */
  averageScore: number | null;
  scoredDimensions: number;
  unscoredDimensions: string[];
  isPrimaryData: boolean | null;
  explanation: string;
}

export interface StudyDataQuality {
  flows: FlowDataQuality[];
  /** Band of the study as a whole, weighted by each flow's share of the total. */
  weightedBand: DataQualityBand;
  weightedAverageScore: number | null;
  /** Share of calculated emissions whose flow has no data-quality scores at all. */
  unassessedShareOfTotalPercent: number;
  primaryDataSharePercent: number | null;
  countsByBand: Record<DataQualityBand, number>;
  explanation: string;
}

const DIMENSIONS: { key: keyof LcaDataQualityScores; label: string }[] = [
  { key: "reliability", label: "source reliability" },
  { key: "completeness", label: "completeness" },
  { key: "temporal", label: "temporal relevance" },
  { key: "geographical", label: "geographical relevance" },
  { key: "technological", label: "technological relevance" },
];

/**
 * Bands from the mean score. The thresholds are this platform's own, chosen
 * so that "HIGH" requires most dimensions to be at or near best — a study
 * should have to earn that label, not drift into it.
 */
export function bandForScore(averageScore: number | null): DataQualityBand {
  if (averageScore === null) return "UNKNOWN";
  if (averageScore <= 2) return "HIGH";
  if (averageScore <= 3.5) return "MEDIUM";
  return "LOW";
}

function isValidScore(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5;
}

export function assessFlowDataQuality(flow: Pick<LcaFlowInput, "id" | "name" | "dq" | "dataType">): FlowDataQuality {
  const scored: number[] = [];
  const unscored: string[] = [];

  for (const dim of DIMENSIONS) {
    const value = flow.dq[dim.key];
    if (isValidScore(value)) scored.push(value);
    else unscored.push(dim.label);
  }

  const averageScore = scored.length > 0 ? Number((scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(3)) : null;
  const band = bandForScore(averageScore);

  const explanation =
    averageScore === null
      ? "No data-quality dimensions have been scored for this flow, so its quality is unknown rather than assumed."
      : `${scored.length} of ${DIMENSIONS.length} dimensions scored, averaging ${averageScore.toFixed(2)} (1 is best, 5 is worst)${unscored.length > 0 ? `; not scored: ${unscored.join(", ")}` : ""}.`;

  return {
    flowId: flow.id,
    name: flow.name,
    band,
    averageScore,
    scoredDimensions: scored.length,
    unscoredDimensions: unscored,
    isPrimaryData: flow.dataType === null ? null : flow.dataType === "PRIMARY",
    explanation,
  };
}

/**
 * Study-level assessment, weighted by each flow's contribution to the
 * calculated total.
 */
export function assessStudyDataQuality(
  result: LcaCalculationResult,
  flowsById: Map<string, Pick<LcaFlowInput, "id" | "name" | "dq" | "dataType">>,
): StudyDataQuality {
  const flows: FlowDataQuality[] = [];
  const countsByBand: Record<DataQualityBand, number> = { HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };

  let weightedScoreSum = 0;
  let weightedWeightSum = 0;
  let unassessedKg = 0;
  let primaryKg = 0;
  let dataTypeKnownKg = 0;
  let calculatedKg = 0;

  for (const stage of result.stages) {
    if (!stage.included) continue;
    for (const process of stage.processes) {
      for (const flowResult of process.flows) {
        if (flowResult.status !== "CALCULATED" || flowResult.kgCo2e === null) continue;
        const source = flowsById.get(flowResult.flowId);
        if (!source) continue;

        const assessment = assessFlowDataQuality(source);
        flows.push(assessment);
        countsByBand[assessment.band]++;

        const weight = Math.abs(flowResult.kgCo2e);
        calculatedKg += weight;

        if (assessment.averageScore === null) {
          unassessedKg += weight;
        } else {
          weightedScoreSum += assessment.averageScore * weight;
          weightedWeightSum += weight;
        }

        if (assessment.isPrimaryData !== null) {
          dataTypeKnownKg += weight;
          if (assessment.isPrimaryData) primaryKg += weight;
        }
      }
    }
  }

  const weightedAverageScore =
    weightedWeightSum > 0 ? Number((weightedScoreSum / weightedWeightSum).toFixed(3)) : null;
  const unassessedShare = calculatedKg > 0 ? (unassessedKg / calculatedKg) * 100 : 0;

  // A band computed from a minority of the footprint would be misleading, so
  // it is withheld rather than qualified in small print.
  const weightedBand: DataQualityBand = unassessedShare > 50 ? "UNKNOWN" : bandForScore(weightedAverageScore);

  const explanation =
    weightedBand === "UNKNOWN"
      ? `Data quality can't be summarised for this study yet: ${unassessedShare.toFixed(0)}% of the calculated footprint comes from flows with no data-quality scores.`
      : `Weighted by contribution, the assessed flows average ${weightedAverageScore?.toFixed(2)} (1 is best, 5 is worst), giving a ${weightedBand} band. ${unassessedShare.toFixed(0)}% of the calculated footprint is not assessed and is excluded from that average.`;

  return {
    flows,
    weightedBand,
    weightedAverageScore,
    unassessedShareOfTotalPercent: Number(unassessedShare.toFixed(2)),
    primaryDataSharePercent: dataTypeKnownKg > 0 ? Number(((primaryKg / dataTypeKnownKg) * 100).toFixed(2)) : null,
    countsByBand,
    explanation,
  };
}

export const DATA_QUALITY_DIMENSIONS = DIMENSIONS;

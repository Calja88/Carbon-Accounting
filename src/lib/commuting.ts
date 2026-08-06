/**
 * Cat 7 employee commuting (data map row S3-07): "Mode + distance,
 * extrapolated across headcount" (methodology Section 9, average-data/
 * survey-based method). Neither source document specifies the exact
 * extrapolation formula or a default commuting-frequency figure, so this
 * is our interpretation, and `commutingDaysInPeriod` is always a value the
 * site enters, never a value the platform assumes — see README
 * assumptions.
 *
 * total commuter-miles for a mode
 *   = headcount
 *   x (percent of headcount using that mode / 100)
 *   x average one-way commute distance (miles)
 *   x 2                                (round trip)
 *   x commuting days in the period     (site-entered, not assumed)
 */

export interface CommutingModeInput {
  headcount: number;
  percentOfHeadcount: number;
  avgOneWayDistanceMiles: number;
  commutingDaysInPeriod: number;
}

export function computeCommutingMiles(input: CommutingModeInput): number {
  const { headcount, percentOfHeadcount, avgOneWayDistanceMiles, commutingDaysInPeriod } = input;
  if (headcount < 0 || percentOfHeadcount < 0 || avgOneWayDistanceMiles < 0 || commutingDaysInPeriod < 0) {
    throw new RangeError("Commuting survey inputs must be non-negative.");
  }
  return headcount * (percentOfHeadcount / 100) * avgOneWayDistanceMiles * 2 * commutingDaysInPeriod;
}

/**
 * Not a hard validation — a survey's modal split is a real-world estimate
 * and won't always sum to exactly 100%. This is informational only, shown
 * to whoever is entering the survey so an obviously wrong total (e.g. 40%)
 * is easy to notice before saving.
 */
export function totalPercentAssigned(percentages: number[]): number {
  return percentages.reduce((sum, p) => sum + p, 0);
}

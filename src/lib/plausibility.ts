/**
 * Plausibility checks on entry (methodology Section 8.1 / brief 3.1):
 * flag a site's consumption jumping sharply period-on-period for review
 * before it's accepted into a report.
 *
 * The methodology gives only one illustrative example (a 300% month-on-
 * month electricity jump) and no confirmed Group policy threshold — this
 * default is a provisional placeholder, flagged in the README, not a
 * validated policy figure.
 */
export const DEFAULT_PLAUSIBILITY_THRESHOLD_PCT = 300;

export interface PlausibilityCheckResult {
  flagged: boolean;
  reason: string | null;
  percentChange: number | null;
}

// Note: a decrease is mathematically bounded at -100% (a quantity can't go
// below zero), so a threshold >= 100 can only ever flag increases. Sites
// wanting sharp-drop detection should configure a smaller threshold.
export function checkPlausibility(
  currentValue: number,
  previousValue: number | null,
  thresholdPct: number = DEFAULT_PLAUSIBILITY_THRESHOLD_PCT,
): PlausibilityCheckResult {
  if (previousValue === null || previousValue === 0) {
    return { flagged: false, reason: null, percentChange: null };
  }

  const percentChange = ((currentValue - previousValue) / previousValue) * 100;

  if (Math.abs(percentChange) > thresholdPct) {
    const direction = percentChange > 0 ? "increase" : "decrease";
    return {
      flagged: true,
      reason: `${Math.abs(percentChange).toFixed(0)}% ${direction} vs. the previous period (threshold: ${thresholdPct}%) — flagged for review before inclusion in a report.`,
      percentChange,
    };
  }

  return { flagged: false, reason: null, percentChange };
}

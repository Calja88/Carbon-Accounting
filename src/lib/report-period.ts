/**
 * Shared parsing for the "YYYY-MM" month pickers used by the dashboard
 * period selector and the report generator, so both interpret a period the
 * same way (full calendar months, UTC, inclusive of the end month).
 */

export interface MonthRange {
  periodStart: Date;
  periodEnd: Date;
  startMonth: string;
  endMonth: string;
}

export function monthInputValue(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Year-to-date: 1 January of the current year through the end of the current month. */
export function defaultDashboardRange(now = new Date()): MonthRange {
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { periodStart: start, periodEnd: end, startMonth: monthInputValue(start), endMonth: monthInputValue(end) };
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/**
 * Resolves the two month pickers into a range, falling back to the default
 * year-to-date window for anything missing or malformed — a bad query
 * string shows the default dashboard rather than an error page.
 */
export function resolveMonthRange(from?: string, to?: string, now = new Date()): MonthRange {
  const fallback = defaultDashboardRange(now);
  if (!from || !to || !MONTH_PATTERN.test(from) || !MONTH_PATTERN.test(to)) return fallback;

  const [startYear, startMonth] = from.split("-").map(Number);
  const [endYear, endMonth] = to.split("-").map(Number);
  if (startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12) return fallback;

  const periodStart = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const periodEnd = new Date(Date.UTC(endYear, endMonth, 0));
  if (periodEnd < periodStart) return fallback;

  return { periodStart, periodEnd, startMonth: from, endMonth: to };
}

export function formatRangeLabel(periodStart: Date, periodEnd: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", year: "numeric", timeZone: "UTC" };
  return `${periodStart.toLocaleDateString("en-GB", opts)} – ${periodEnd.toLocaleDateString("en-GB", opts)}`;
}

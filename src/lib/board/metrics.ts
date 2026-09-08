import type { CarbonMetric, Comparison, Coverage } from "./contracts";

export function assertCoverage(c: Coverage): void {
  const values = [c.received, c.reviewed, c.excluded, c.awaitingFactor, c.flagged];
  if (c.expected !== null) values.push(c.expected);
  if (values.some(v => !Number.isSafeInteger(v) || v < 0)) throw new Error("Invalid coverage counts");
  if (c.reviewed > c.received || (c.expected !== null && c.received > c.expected)) throw new Error("Coverage exceeds its denominator");
}
export function isComplete(metric: CarbonMetric): boolean {
  assertCoverage(metric.coverage);
  return metric.state === "complete" && metric.kgCO2e !== null && Number.isFinite(metric.kgCO2e)
    && metric.coverage.expected !== null && metric.coverage.expected > 0
    && metric.coverage.reviewed === metric.coverage.expected && metric.coverage.excluded === 0
    && metric.coverage.awaitingFactor === 0 && metric.coverage.flagged === 0;
}
export function compareCarbon(current: CarbonMetric, previous: CarbonMetric): Comparison {
  if (!isComplete(current) || !isComplete(previous)) return { percent: null, differenceKg: null, reason: "Comparable, reviewed coverage is required in both periods." };
  if (!current.comparisonKey || current.comparisonKey !== previous.comparisonKey) return { percent: null, differenceKg: null, reason: "Boundary, method or covered sources differ." };
  if (previous.kgCO2e === null || previous.kgCO2e <= 0) return { percent: null, differenceKg: null, reason: "No positive comparable baseline." };
  const differenceKg = current.kgCO2e! - previous.kgCO2e;
  return { percent: differenceKg / previous.kgCO2e * 100, differenceKg, reason: null };
}
export function formatTonnes(kg: number | null, digits = 0): string {
  if (kg === null || !Number.isFinite(kg)) return "Not available";
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(kg / 1000);
}
export function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "Not comparable" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
export function coverageLabel(c: Coverage): string {
  assertCoverage(c);
  return c.expected === null ? "Expected coverage unknown" : `${c.reviewed}/${c.expected} expected returns reviewed`;
}
/** Strict date-only validation prevents clock/timezone changes turning today's work overdue. */
export function dateOnly(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Expected YYYY-MM-DD");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid calendar date");
  return value;
}
export function isOverdue(due: string | null, asOf: string): boolean {
  return due !== null && dateOnly(due) < dateOnly(asOf);
}

/**
 * Single source of truth for how a carbon quantity is written on screen.
 *
 * Display only: nothing here rounds, scales or stores a calculated value —
 * callers pass the kg figure the calc engine produced and get back the string
 * the user reads. Consolidates what used to be three near-identical tonne
 * formatters (board metrics, chart palette, page-local JSX) that disagreed on
 * "CO2e" vs "CO₂e", on "tCO2e" vs "t CO2e", and on what a missing figure looks
 * like.
 */

/** Always the subscript form on screen. Plain "CO2e" stays in CSV/file output. */
export const CO2E = "CO₂e";
export const TONNES_CO2E = `t${CO2E}`;
export const KG_CO2E = `kg${CO2E}`;

/** Prose reads better than a dash in a sentence; a table cell reads worse. */
export const NOT_AVAILABLE = "Not available";
export const EM_DASH = "—";

export type MissingStyle = "prose" | "inline";

/**
 * A figure we do not have is never a zero — zero is a real, defensible result
 * and claiming it for missing data misstates an inventory.
 */
export function formatMissing(style: MissingStyle = "prose"): string {
  return style === "inline" ? EM_DASH : NOT_AVAILABLE;
}

function isMissing(value: number | null | undefined): boolean {
  return value === null || value === undefined || !Number.isFinite(value);
}

type QuantityOptions = {
  /** Fixed decimal places. Omitted means precision follows the magnitude. */
  digits?: number;
  /** Append the unit symbol. Off by default so table columns can carry it. */
  unit?: boolean;
  missing?: MissingStyle;
};

/** Emissions span orders of magnitude, so precision follows the figure. */
function adaptiveTonnes(t: number): string {
  if (t === 0) return "0";
  const abs = Math.abs(t);
  if (abs < 0.01) return "<0.01";
  return t.toLocaleString("en-GB", { maximumFractionDigits: abs < 10 ? 2 : 1 });
}

export function formatTonnesCO2e(
  kg: number | null | undefined,
  { digits, unit = false, missing = "prose" }: QuantityOptions = {},
): string {
  if (isMissing(kg)) return formatMissing(missing);
  const tonnes = (kg as number) / 1000;
  const value =
    digits === undefined
      ? adaptiveTonnes(tonnes)
      : tonnes.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return unit ? `${value} ${TONNES_CO2E}` : value;
}

export function formatKgCO2e(
  kg: number | null | undefined,
  { digits, unit = false, missing = "prose" }: QuantityOptions = {},
): string {
  if (isMissing(kg)) return formatMissing(missing);
  const value = kg as number;
  if (digits !== undefined) {
    return withUnit(value.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits }), unit);
  }
  // Product-level figures are small; a flat 0dp would round them to nothing.
  const abs = Math.abs(value);
  if (abs === 0) return withUnit("0", unit);
  if (abs < 0.001) return withUnit(value.toExponential(2), unit);
  const maximumFractionDigits = abs < 1 ? 4 : abs < 1000 ? 2 : 0;
  return withUnit(value.toLocaleString("en-GB", { maximumFractionDigits }), unit);
}

function withUnit(value: string, unit: boolean): string {
  return unit ? `${value} ${KG_CO2E}` : value;
}

/**
 * Period-on-period change. Signed, because the direction is the point —
 * a bare magnitude reads as an improvement when it is an increase.
 */
export function formatPercentChange(
  percent: number | null | undefined,
  { fallback = "Not comparable", digits = 1 }: { fallback?: string; digits?: number } = {},
): string {
  if (isMissing(percent)) return fallback;
  const value = percent as number;
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

/** Unsigned magnitude, for places that already state the direction in words. */
export function formatPercentMagnitude(percent: number | null | undefined): string {
  if (isMissing(percent)) return EM_DASH;
  const abs = Math.abs(percent as number);
  return `${abs.toLocaleString("en-GB", { maximumFractionDigits: abs < 10 ? 1 : 0 })}%`;
}

/** Share of a total. Null total, or a zero denominator, is not a zero share. */
export function formatShare(part: number | null | undefined, total: number | null | undefined): string {
  if (isMissing(part) || isMissing(total) || (total as number) <= 0) return EM_DASH;
  return `${(((part as number) / (total as number)) * 100).toFixed(1)}%`;
}

/**
 * The two synthetic-demo factor-set names as they were recorded into
 * calculation snapshots before commit 3e94741 renamed them, and what a reader
 * sees instead.
 *
 * The stored values are NOT rewritten: `Calculation.factorSourceSnapshot`,
 * `LcaCalculationResult.factorSource` and the LCA run snapshots are the record
 * of what each calculation actually used, and the align script leaves them
 * exactly as they are. This is the display side of that decision, so a reader
 * is not shown a retired label next to the current one.
 *
 * Deliberately narrow: an exact prefix match on these two strings only. Every
 * other BOARD-1 mention — the fixture key, the source codes, the persona
 * names, and the BOARD-1 wording inside sealed audit and pack payloads — is
 * left alone, because those are identity and history rather than a stale
 * label.
 */
const LEGACY_FACTOR_SOURCES: readonly (readonly [string, string])[] = [
  ["BOARD-1 demo factors — not for reporting", "Demo factors — not for reporting"],
  ["BOARD-1 demonstration — not for reporting", "Demo — not for reporting"],
];

/**
 * A stored factor-source snapshot as it should read on screen or in an export.
 *
 * Prefix-only, so whatever the calculation appended survives:
 *   "BOARD-1 demo factors — not for reporting (PLACEHOLDER — not verified)"
 *   -> "Demo factors — not for reporting (PLACEHOLDER — not verified)"
 *
 * Anything else, including a value already carrying the current wording, is
 * returned unchanged.
 */
export function formatFactorSource(stored: string): string;
export function formatFactorSource(stored: string | null | undefined): string | null | undefined;
export function formatFactorSource(stored: string | null | undefined): string | null | undefined {
  if (typeof stored !== "string") return stored;
  for (const [legacy, current] of LEGACY_FACTOR_SOURCES) {
    if (stored.startsWith(legacy)) return current + stored.slice(legacy.length);
  }
  return stored;
}

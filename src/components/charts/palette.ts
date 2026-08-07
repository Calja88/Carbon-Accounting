/**
 * Chart palette and shared formatting helpers.
 *
 * The three scope hues are a validated categorical set (blue/orange/aqua,
 * checked for lightness band, chroma floor, colour-vision-deficiency
 * separation and normal-vision separation against a white card surface).
 * Aqua sits just under 3:1 contrast on white, so every chart that uses it
 * ships **visible labels and a table view** alongside — identity is never
 * carried by colour alone.
 *
 * Emissions invert the usual "up is good" convention: a rise is bad. That
 * judgement lives in analytics-service's Delta.isImprovement, and the
 * status colours below always ship with an icon and a word, never alone.
 */

export const SCOPE_COLORS = {
  scope1: "#2a78d6",
  scope2: "#eb6834",
  scope3: "#1baf7a",
} as const;

/** Time comparison is one measure at two times — one hue, two steps, not two identities. */
export const PERIOD_COLORS = {
  current: "#2a78d6",
  previous: "#86b6ef",
} as const;

export const STATUS_COLORS = {
  /** Emissions fell — good. */
  improvement: "#006300",
  /** Emissions rose — bad. */
  worsening: "#d03b3b",
  neutral: "#64748b",
} as const;

export const CHART_INK = {
  surface: "#ffffff",
  gridline: "#e2e8f0",
  axis: "#cbd5e1",
  muted: "#64748b",
  secondary: "#475569",
  primary: "#0f172a",
} as const;

export const SCOPE_SERIES = [
  { key: "scope1" as const, label: "Scope 1 — direct", color: SCOPE_COLORS.scope1 },
  { key: "scope2Location" as const, label: "Scope 2 — electricity", color: SCOPE_COLORS.scope2 },
  { key: "scope3" as const, label: "Scope 3 — value chain", color: SCOPE_COLORS.scope3 },
];

/** kg -> tonnes with sensible precision. Emissions figures span orders of magnitude. */
export function formatTonnes(kg: number): string {
  const t = kg / 1000;
  if (t === 0) return "0";
  if (Math.abs(t) < 0.01) return "<0.01";
  if (Math.abs(t) < 10) return t.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  return t.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

export function formatKg(kg: number): string {
  return kg.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

export function formatPercent(p: number | null): string {
  if (p === null) return "—";
  const abs = Math.abs(p);
  return `${abs.toLocaleString("en-GB", { maximumFractionDigits: abs < 10 ? 1 : 0 })}%`;
}

/** Round a max value up to a clean axis bound (1/2/2.5/5 x 10^n). */
export function niceAxisMax(value: number): number {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const magnitude = Math.pow(10, exponent);
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Cat 3 — fuel- and energy-related activities not already in Scope 1/2
 * (data map row S3-03): "Auto-calculated by the platform from Scope 1 and
 * Scope 2 activity data (well-to-tank, T&D losses)... No new data entry
 * required — build as a calculation, not a form." This module is that
 * calculation.
 *
 * It deliberately seeds no well-to-tank/T&D-losses factor values itself
 * (see instruction not to invent emission factors) — until those factors
 * are imported via the admin upload (src/lib/factor-import.ts), this
 * derivation simply finds nothing to calculate and produces zero rows,
 * same as any other Scope 3 entry awaiting a factor.
 */

export const SCOPE3_CAT3_LABEL = "Cat 3 — Fuel- and energy-related activities";

export interface WttTdMapping {
  /** The wtt_ or td_losses_ factorCategory to look up a companion factor in. */
  wttFactorCategory: string;
  /** Whether the WTT/T&D factor is keyed by the same subtypeKey as the source calculation (e.g. petrol vs diesel). */
  keepsSubtypeKey: boolean;
}

/**
 * Maps a Scope 1/2 ActivityDataPoint.factorCategory to the Cat 3
 * well-to-tank / T&D-losses companion factor category it needs.
 * Categories not listed here (refrigerants, purchased heat/steam) have no
 * WTT/T&D companion in this build — fugitive emissions have no "well" to
 * derive an upstream figure from, and heat/steam WTT isn't covered by
 * either source document.
 */
export const WTT_TD_FACTOR_MAP: Record<string, WttTdMapping> = {
  stationary_combustion_natural_gas: { wttFactorCategory: "wtt_natural_gas", keepsSubtypeKey: false },
  stationary_combustion_diesel: { wttFactorCategory: "wtt_diesel", keepsSubtypeKey: false },
  mobile_combustion_fuel: { wttFactorCategory: "wtt_road_fuel", keepsSubtypeKey: true },
  mobile_combustion_mileage: { wttFactorCategory: "wtt_mileage", keepsSubtypeKey: true },
  // Location-based only — see findDerivableSourceCalculations, which
  // excludes market-based/residual-mix rows so the market-based duplicate
  // figure doesn't also generate a (duplicate) T&D-losses companion.
  grid_electricity: { wttFactorCategory: "td_losses_electricity", keepsSubtypeKey: false },
};

export function wttMappingFor(factorCategory: string): WttTdMapping | null {
  return WTT_TD_FACTOR_MAP[factorCategory] ?? null;
}

/**
 * Unit conversion so a user can enter a value exactly as it appears on
 * their bill/invoice, while every stored EmissionFactor is expressed in a
 * single canonical unit per category.
 *
 * Only natural gas (S1-01) currently offers more than one entry unit
 * (kWh or m³) — everywhere else the data map's single "Format / Unit"
 * already matches the canonical unit an emission factor is defined in, so
 * conversion is a no-op there.
 */

// Standard UK gas billing conversion (Ofgem / DEFRA convention):
// kWh = m3 x volume correction factor x calorific value (MJ/m3) / 3.6
// These constants are national averages, not the specific figures on any
// one meter's bill — flagged as an assumption in the README.
const GAS_VOLUME_CORRECTION_FACTOR = 1.02264;
const GAS_CALORIFIC_VALUE_MJ_PER_M3 = 39.5;

export class UnsupportedUnitError extends Error {}

export function convertNaturalGasToKwh(value: number, unit: "kWh" | "m3"): number {
  if (unit === "kWh") return value;
  if (unit === "m3") {
    return (value * GAS_VOLUME_CORRECTION_FACTOR * GAS_CALORIFIC_VALUE_MJ_PER_M3) / 3.6;
  }
  throw new UnsupportedUnitError(`Unsupported natural gas unit: ${unit}`);
}

/**
 * Converts a raw entry value + unit into the canonical unit the matching
 * EmissionFactor category expects. Returns { value, unit }.
 */
export function toCanonicalUnit(
  factorCategory: string,
  rawValue: number,
  rawUnit: string,
): { value: number; unit: string } {
  if (factorCategory === "stationary_combustion_natural_gas") {
    if (rawUnit !== "kWh" && rawUnit !== "m3") {
      throw new UnsupportedUnitError(`Unsupported unit "${rawUnit}" for natural gas`);
    }
    return { value: convertNaturalGasToKwh(rawValue, rawUnit), unit: "kWh" };
  }

  // All other categories: the entry unit already is the canonical unit.
  return { value: rawValue, unit: rawUnit };
}

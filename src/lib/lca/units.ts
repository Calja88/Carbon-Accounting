/**
 * Dimension-aware unit conversion for the LCA engine.
 *
 * An emission factor is expressed per a specific unit. Activity data is
 * entered in whatever unit the source document uses. Multiplying the two
 * without converting — or converting between units that don't share a
 * dimension (kg and kWh) — is the single most common way a product footprint
 * ends up wrong by orders of magnitude, so conversion is explicit here and
 * incompatible units raise rather than fall back to a factor of 1.
 *
 * The corporate side has its own narrow converter (src/lib/units.ts) that
 * canonicalises an entry against a *data point's* configured unit (currently
 * only natural gas m3 -> kWh). That solves a different problem — form input
 * canonicalisation — and stays as it is. This module is the general
 * dimensional converter the product engine needs.
 *
 * Every conversion factor below is an exact definition (SI, or the
 * international yard/pound agreement of 1959), not an estimate.
 */

import { D, Decimal, ONE } from "./decimal";

export type UnitDimension =
  | "MASS"
  | "ENERGY"
  | "VOLUME"
  | "DISTANCE"
  | "AREA"
  | "TIME"
  | "COUNT"
  | "FREIGHT"
  | "CURRENCY";

export interface UnitDefinition {
  /** Canonical symbol, e.g. "kg". */
  symbol: string;
  label: string;
  dimension: UnitDimension;
  /** How many base units one of this unit is worth. */
  toBase: string;
  aliases: string[];
}

/** Base unit per dimension — what `toBase` is expressed in. */
export const BASE_UNITS: Record<UnitDimension, string> = {
  MASS: "kg",
  ENERGY: "kWh",
  VOLUME: "l",
  DISTANCE: "km",
  AREA: "m2",
  TIME: "h",
  COUNT: "item",
  FREIGHT: "t.km",
  CURRENCY: "GBP",
};

const UNITS: UnitDefinition[] = [
  // --- mass -------------------------------------------------------------
  { symbol: "kg", label: "kilogram", dimension: "MASS", toBase: "1", aliases: ["kgs", "kilogram", "kilograms", "kilo", "kilos"] },
  { symbol: "g", label: "gram", dimension: "MASS", toBase: "0.001", aliases: ["gram", "grams", "gr"] },
  { symbol: "mg", label: "milligram", dimension: "MASS", toBase: "0.000001", aliases: ["milligram", "milligrams"] },
  { symbol: "t", label: "tonne (metric)", dimension: "MASS", toBase: "1000", aliases: ["tonne", "tonnes", "mt", "metricton", "metrictonne", "metrictonnes", "te"] },
  { symbol: "kt", label: "kilotonne", dimension: "MASS", toBase: "1000000", aliases: ["kilotonne", "kilotonnes"] },
  { symbol: "lb", label: "pound", dimension: "MASS", toBase: "0.45359237", aliases: ["lbs", "pound", "pounds"] },
  { symbol: "oz", label: "ounce", dimension: "MASS", toBase: "0.028349523125", aliases: ["ounce", "ounces"] },

  // --- energy -----------------------------------------------------------
  { symbol: "kWh", label: "kilowatt hour", dimension: "ENERGY", toBase: "1", aliases: ["kwh", "kilowatthour", "kilowatthours"] },
  { symbol: "Wh", label: "watt hour", dimension: "ENERGY", toBase: "0.001", aliases: ["wh", "watthour", "watthours"] },
  { symbol: "MWh", label: "megawatt hour", dimension: "ENERGY", toBase: "1000", aliases: ["mwh", "megawatthour", "megawatthours"] },
  { symbol: "GWh", label: "gigawatt hour", dimension: "ENERGY", toBase: "1000000", aliases: ["gwh"] },
  { symbol: "MJ", label: "megajoule", dimension: "ENERGY", toBase: "0.2777777777777778", aliases: ["mj", "megajoule", "megajoules"] },
  { symbol: "GJ", label: "gigajoule", dimension: "ENERGY", toBase: "277.7777777777778", aliases: ["gj", "gigajoule", "gigajoules"] },
  { symbol: "kJ", label: "kilojoule", dimension: "ENERGY", toBase: "0.0002777777777777778", aliases: ["kj", "kilojoule", "kilojoules"] },
  { symbol: "J", label: "joule", dimension: "ENERGY", toBase: "0.0000002777777777777778", aliases: ["joule", "joules"] },
  // 1 therm = 105.505585262 MJ (exact by definition of the EC therm).
  { symbol: "therm", label: "therm", dimension: "ENERGY", toBase: "29.30710701666667", aliases: ["therms"] },

  // --- volume -----------------------------------------------------------
  { symbol: "l", label: "litre", dimension: "VOLUME", toBase: "1", aliases: ["litre", "litres", "liter", "liters", "ltr", "ltrs"] },
  { symbol: "ml", label: "millilitre", dimension: "VOLUME", toBase: "0.001", aliases: ["millilitre", "millilitres", "milliliter", "milliliters"] },
  { symbol: "m3", label: "cubic metre", dimension: "VOLUME", toBase: "1000", aliases: ["m^3", "cubicmetre", "cubicmetres", "cubicmeter", "cubicmeters", "m³"] },
  { symbol: "cm3", label: "cubic centimetre", dimension: "VOLUME", toBase: "0.001", aliases: ["cm^3", "cc", "cm³"] },
  { symbol: "galUK", label: "gallon (imperial)", dimension: "VOLUME", toBase: "4.54609", aliases: ["gallonuk", "impgal", "gallonimperial"] },
  { symbol: "galUS", label: "gallon (US liquid)", dimension: "VOLUME", toBase: "3.785411784", aliases: ["gallonus", "usgal"] },

  // --- distance ---------------------------------------------------------
  { symbol: "km", label: "kilometre", dimension: "DISTANCE", toBase: "1", aliases: ["kilometre", "kilometres", "kilometer", "kilometers", "kms"] },
  { symbol: "m", label: "metre", dimension: "DISTANCE", toBase: "0.001", aliases: ["metre", "metres", "meter", "meters"] },
  { symbol: "mi", label: "mile", dimension: "DISTANCE", toBase: "1.609344", aliases: ["mile", "miles"] },
  { symbol: "nmi", label: "nautical mile", dimension: "DISTANCE", toBase: "1.852", aliases: ["nauticalmile", "nauticalmiles", "nm"] },
  { symbol: "ft", label: "foot", dimension: "DISTANCE", toBase: "0.0003048", aliases: ["foot", "feet"] },

  // --- area -------------------------------------------------------------
  { symbol: "m2", label: "square metre", dimension: "AREA", toBase: "1", aliases: ["m^2", "sqm", "squaremetre", "squaremetres", "m²"] },
  { symbol: "cm2", label: "square centimetre", dimension: "AREA", toBase: "0.0001", aliases: ["cm^2", "sqcm", "cm²"] },
  { symbol: "km2", label: "square kilometre", dimension: "AREA", toBase: "1000000", aliases: ["km^2", "sqkm", "km²"] },
  { symbol: "ha", label: "hectare", dimension: "AREA", toBase: "10000", aliases: ["hectare", "hectares"] },
  { symbol: "ft2", label: "square foot", dimension: "AREA", toBase: "0.09290304", aliases: ["ft^2", "sqft", "squarefoot", "squarefeet"] },

  // --- time -------------------------------------------------------------
  { symbol: "h", label: "hour", dimension: "TIME", toBase: "1", aliases: ["hr", "hrs", "hour", "hours"] },
  { symbol: "min", label: "minute", dimension: "TIME", toBase: "0.016666666666666667", aliases: ["minute", "minutes", "mins"] },
  { symbol: "s", label: "second", dimension: "TIME", toBase: "0.0002777777777777778", aliases: ["sec", "secs", "second", "seconds"] },
  { symbol: "day", label: "day", dimension: "TIME", toBase: "24", aliases: ["days", "d"] },
  { symbol: "year", label: "year (365 days)", dimension: "TIME", toBase: "8760", aliases: ["years", "yr", "yrs", "annum"] },

  // --- count ------------------------------------------------------------
  { symbol: "item", label: "item", dimension: "COUNT", toBase: "1", aliases: ["items", "unit", "units", "each", "ea", "pc", "pcs", "piece", "pieces", "product", "products", "no", "count"] },
  { symbol: "pair", label: "pair", dimension: "COUNT", toBase: "2", aliases: ["pairs"] },
  { symbol: "dozen", label: "dozen", dimension: "COUNT", toBase: "12", aliases: ["doz"] },
  { symbol: "thousand", label: "thousand items", dimension: "COUNT", toBase: "1000", aliases: ["k", "1000items", "per1000"] },

  // --- freight work -----------------------------------------------------
  { symbol: "t.km", label: "tonne-kilometre", dimension: "FREIGHT", toBase: "1", aliases: ["tkm", "tonnekm", "tonnekilometre", "tonnekilometres", "tonnekilometer", "t*km", "tonne.km", "tkms"] },
  { symbol: "kg.km", label: "kilogram-kilometre", dimension: "FREIGHT", toBase: "0.001", aliases: ["kgkm", "kg*km"] },
  { symbol: "t.mi", label: "tonne-mile", dimension: "FREIGHT", toBase: "1.609344", aliases: ["tmi", "tonnemile", "tonnemiles", "t*mi"] },

  // --- money ------------------------------------------------------------
  // Currencies are never converted into one another: an exchange rate is a
  // point-in-time market figure this platform has no authoritative source
  // for, and guessing one would silently change a spend-based result.
  { symbol: "GBP", label: "pounds sterling", dimension: "CURRENCY", toBase: "1", aliases: ["£", "gbp", "pound", "pounds", "sterling"] },
  { symbol: "EUR", label: "euro", dimension: "CURRENCY", toBase: "1", aliases: ["€", "eur", "euro", "euros"] },
  { symbol: "USD", label: "US dollar", dimension: "CURRENCY", toBase: "1", aliases: ["$", "usd", "dollar", "dollars"] },
];

export class UnknownUnitError extends Error {}
export class IncompatibleUnitError extends Error {}

function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_\-]/g, "")
    .replace(/^per/, "");
}

const LOOKUP = new Map<string, UnitDefinition>();
for (const unit of UNITS) {
  LOOKUP.set(normalizeKey(unit.symbol), unit);
  for (const alias of unit.aliases) LOOKUP.set(normalizeKey(alias), unit);
}

export function findUnit(raw: string | null | undefined): UnitDefinition | null {
  if (!raw) return null;
  return LOOKUP.get(normalizeKey(raw)) ?? null;
}

export function requireUnit(raw: string | null | undefined): UnitDefinition {
  const unit = findUnit(raw);
  if (!unit) {
    throw new UnknownUnitError(
      `"${raw ?? ""}" is not a unit this platform recognises. Use one of the supported units, or record the conversion as an assumption and enter the converted figure.`,
    );
  }
  return unit;
}

/** Canonical symbol for a unit written any of its accepted ways. */
export function canonicalUnitSymbol(raw: string | null | undefined): string | null {
  return findUnit(raw)?.symbol ?? null;
}

export function unitDimension(raw: string | null | undefined): UnitDimension | null {
  return findUnit(raw)?.dimension ?? null;
}

export function areUnitsCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const ua = findUnit(a);
  const ub = findUnit(b);
  if (!ua || !ub) return false;
  if (ua.dimension !== ub.dimension) return false;
  // Different currencies share a dimension but are not interconvertible.
  if (ua.dimension === "CURRENCY") return ua.symbol === ub.symbol;
  return true;
}

/**
 * Multiplier that turns a quantity in `from` into the same quantity in `to`.
 * Raises rather than guessing when the units don't share a dimension.
 */
export function conversionFactor(from: string, to: string): Decimal {
  const uFrom = requireUnit(from);
  const uTo = requireUnit(to);

  if (uFrom.symbol === uTo.symbol) return ONE;

  if (uFrom.dimension !== uTo.dimension) {
    throw new IncompatibleUnitError(
      `Cannot convert ${uFrom.symbol} (${uFrom.dimension.toLowerCase()}) to ${uTo.symbol} (${uTo.dimension.toLowerCase()}) — they measure different things.`,
    );
  }

  if (uFrom.dimension === "CURRENCY") {
    throw new IncompatibleUnitError(
      `Cannot convert ${uFrom.symbol} to ${uTo.symbol} — this platform holds no exchange-rate source, so currency conversion must be done at a documented rate before entry.`,
    );
  }

  return D(uFrom.toBase).div(D(uTo.toBase));
}

export function convertQuantity(value: Decimal, from: string, to: string): Decimal {
  return value.times(conversionFactor(from, to));
}

export interface ConversionOutcome {
  value: Decimal;
  factor: Decimal;
  fromUnit: string;
  toUnit: string;
  /** Human-readable note for the provenance trail. */
  note: string;
}

/** Convert with the full trail the "How was this calculated?" view needs. */
export function convertWithTrail(value: Decimal, from: string, to: string): ConversionOutcome {
  const uFrom = requireUnit(from);
  const uTo = requireUnit(to);
  const factor = conversionFactor(from, to);
  return {
    value: value.times(factor),
    factor,
    fromUnit: uFrom.symbol,
    toUnit: uTo.symbol,
    note:
      uFrom.symbol === uTo.symbol
        ? `Already in ${uTo.symbol} — no conversion applied.`
        : `1 ${uFrom.symbol} = ${factor.toSignificantDigits(12).toString()} ${uTo.symbol}`,
  };
}

/** All recognised units, for pickers and help content. */
export function listUnits(dimension?: UnitDimension): UnitDefinition[] {
  return dimension ? UNITS.filter((u) => u.dimension === dimension) : [...UNITS];
}

export function unitsByDimension(): { dimension: UnitDimension; units: UnitDefinition[] }[] {
  const dims = Object.keys(BASE_UNITS) as UnitDimension[];
  return dims.map((dimension) => ({ dimension, units: UNITS.filter((u) => u.dimension === dimension) }));
}

/**
 * Tonne-kilometres from a mass and a distance in any recognised mass/distance
 * units. The freight factor libraries are all expressed per t.km, so this is
 * the one place the conversion happens.
 */
export function toTonneKilometres(mass: Decimal, massUnit: string, distance: Decimal, distanceUnit: string): Decimal {
  const massTonnes = convertQuantity(mass, massUnit, "t");
  const distanceKm = convertQuantity(distance, distanceUnit, "km");
  return massTonnes.times(distanceKm);
}

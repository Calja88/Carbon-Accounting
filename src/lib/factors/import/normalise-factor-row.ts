import { createHash } from "node:crypto";
import { FactorBasis, Prisma, Scope } from "@prisma/client";
import { FACTOR_CATEGORIES } from "@/lib/factor-categories";
import type { DatasetMetadata, FactorCandidate, SourceRow } from "./types";

const unitAliases: Record<string, string> = {
  kwh: "kWh", "kilowatt hour": "kWh", "kilowatt hours": "kWh",
  kg: "kg", kilogram: "kg", kilograms: "kg",
  t: "tonne", tonne: "tonne", tonnes: "tonne",
  km: "km", kilometre: "km", kilometres: "km", kilometer: "km", kilometers: "km",
  mile: "mile", miles: "mile",
  m3: "m3", "m³": "m3", "cubic metre": "m3", "cubic metres": "m3",
  l: "litre", litre: "litre", litres: "litre", liter: "litre", liters: "litre",
  night: "night", nights: "night", "passenger km": "passenger.km", "passenger.km": "passenger.km",
  "tonne km": "tonne.km", "tonne.km": "tonne.km",
};

/** Text aliases only. Deliberately no scale conversions or CV assumptions. */
export function normaliseUnit(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/[-\s]+/g, " ");
  return Object.hasOwn(unitAliases, key) ? unitAliases[key] : null;
}

export function factorHash(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Exact decimal validation avoids silently rounding the schema's Decimal(18,8). */
export function canonicalFactorValue(raw: string): string | null {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim())) return null;
  try {
    const value = new Prisma.Decimal(raw.trim());
    if (!value.isFinite() || value.isNegative() || value.gte("10000000000") || value.decimalPlaces() > 8) return null;
    return value.toFixed();
  } catch { return null; }
}

export function normaliseFactorRow(source: SourceRow, metadata: DatasetMetadata): FactorCandidate {
  const fields = source.fields;
  const trim = (key: string) => fields[key]?.trim() ?? "";
  const messages = [...source.messages];
  const error = (code: string, message: string) => messages.push({ code, message, severity: "error" });
  const warning = (code: string, message: string) => messages.push({ code, message, severity: "warning" });
  const rawUnit = fields.unit ?? "";
  const canonicalUnit = normaliseUnit(rawUnit);
  if (!trim("unit")) error("MISSING_UNIT", "A denominator unit is required.");
  else if (!canonicalUnit) error("UNKNOWN_UNIT", `Unsupported unit: ${trim("unit")}. No conversion was attempted.`);
  const value = trim("value");
  const factorValue = canonicalFactorValue(value);
  if (!value) error("MISSING_VALUE", "Missing factor value; it cannot be treated as zero.");
  else if (factorValue === null) error("INVALID_VALUE", "Factor must be a non-negative decimal fitting Decimal(18,8); no rounding or conversion is allowed.");

  const activity = trim("activity") || trim("subtypeKey");
  const categoryPath = trim("categoryPath") || trim("category");
  if (!activity || !categoryPath) error("MISSING_ACTIVITY_CATEGORY", "An explicit activity and category/path are required.");
  const definition = FACTOR_CATEGORIES.find((item) => item.key === trim("category"));
  const category = definition?.key ?? null;
  if (!category) warning("MAPPING_REQUIRED", "Source category needs an explicit reviewed mapping to a corporate factor category.");
  const scopeText = trim("scope").toUpperCase().replace(/[\s-]+/g, "_");
  const scope = Object.values(Scope).find((item) => item === scopeText) ?? definition?.scope ?? null;
  if (scopeText && !Object.values(Scope).some((item) => item === scopeText)) error("INVALID_SCOPE", "Unsupported scope; use SCOPE_1, SCOPE_2 or SCOPE_3.");
  if (definition && scope !== definition.scope) error("SCOPE_CONFLICT", "Scope conflicts with the mapped category.");
  const basisText = trim("basis").toUpperCase().replace(/[\s-]+/g, "_");
  const basis = Object.values(FactorBasis).find((item) => item === basisText) ?? (!basisText && scope !== Scope.SCOPE_2 ? FactorBasis.STANDARD : null);
  if (!basis || (scope === Scope.SCOPE_2 && basis === FactorBasis.STANDARD) || (scope !== Scope.SCOPE_2 && basis !== FactorBasis.STANDARD)) {
    error("AMBIGUOUS_BASIS", "An explicit compatible factor basis is required; Scope 2 methodology is never inferred.");
  }
  const gasText = trim("gas").toLowerCase();
  const gas = gasText === "co2e" ? "CO2e" : trim("gas") || null;
  if (gas !== "CO2e") error("UNSUPPORTED_GAS", "The existing emission factor model only stores CO2e; gas-specific values cannot be imported.");
  const kindText = trim("kind").toLowerCase().replace(/[\s-]+/g, "_");
  const kind = kindText === "well_to_tank" ? "wtt" : kindText || null;
  if (kind !== "direct" && kind !== "wtt") error("UNSUPPORTED_KIND", "An explicit direct or WTT kind is required. Total/lifecycle factors need a schema and mapping decision.");
  if (category && ((kind === "wtt" && !category.startsWith("wtt_")) || (kind === "direct" && category.startsWith("wtt_")))) {
    error("KIND_CONFLICT", "Factor kind conflicts with its mapped category.");
  }
  const unitText = trim("factorUnit");
  const numerator = unitText.match(/^kg\s*co2e(?:\s*(?:\/|per\s+)\s*(.+))?$/i);
  const factorUnit = numerator && canonicalUnit ? `kgCO2e/${canonicalUnit}` : null;
  if (!numerator || (numerator[1] && normaliseUnit(numerator[1]) !== canonicalUnit)) {
    error("UNSUPPORTED_FACTOR_UNIT", "Declare kgCO2e with the matching denominator unit; no numerator or denominator conversion is allowed.");
  }
  const region = trim("region") || null;
  if (!region) warning("MISSING_REGION", "Region is unspecified; resolve before persistence.");
  const candidate: FactorCandidate = {
    source, metadata: { ...metadata }, categoryPath, activity, rawUnit, canonicalUnit,
    factorValue, factorUnit, gas, kind, category, scope, basis, region,
    subtypeKey: trim("subtypeKey") || null, identity: "", sourceHash: "",
    messages, status: messages.some((m) => m.severity === "error") ? "rejected" : messages.length ? "warning" : "accepted",
  };
  candidate.identity = factorHash([
    metadata.publisher, metadata.year, metadata.release, source.sheet, categoryPath, activity,
    category, candidate.subtypeKey, scope, basis, region, canonicalUnit ?? rawUnit, gas, kind,
  ]);
  candidate.sourceHash = factorHash([candidate.identity, source.rowNumber, source.cells, fields, factorValue]);
  return candidate;
}

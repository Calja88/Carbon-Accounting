import { FactorBasis } from "@prisma/client";

/**
 * Pure calculation logic — no database access — so the rules that turn
 * activity data into an emissions figure can be unit-tested directly.
 * Every function here returns everything the compliance audit trail
 * requires: input, factor (snapshotted, not just referenced), formula,
 * and the result.
 */

export interface FactorRow {
  id: string;
  basis: FactorBasis;
  unit: string;
  co2eFactor: number;
  factorSetName: string;
  vintageYear: number;
  isPlaceholder: boolean;
}

export interface EmissionResult {
  emissionFactorId: string;
  basis: FactorBasis;
  inputValue: number;
  inputUnit: string;
  factorValueSnapshot: number;
  factorUnitSnapshot: string;
  factorSourceSnapshot: string;
  factorVintageSnapshot: string;
  formulaApplied: string;
  resultKgCo2e: number;
}

export class UnitMismatchError extends Error {}

function buildFormula(inputValue: number, inputUnit: string, factorValue: number, factorUnit: string, result: number) {
  return `${inputValue} ${inputUnit} × ${factorValue} kgCO2e/${factorUnit} = ${result.toFixed(6)} kgCO2e`;
}

function sourceLabel(factor: FactorRow): string {
  return factor.isPlaceholder ? `${factor.factorSetName} (PLACEHOLDER — not verified)` : factor.factorSetName;
}

/** A single input value x a single factor -> a single emission figure. */
export function calculateEmission(inputValue: number, inputUnit: string, factor: FactorRow): EmissionResult {
  if (factor.unit !== inputUnit) {
    throw new UnitMismatchError(
      `Cannot apply a "${factor.unit}"-based emission factor to a "${inputUnit}" input — the entry should have been converted to the canonical unit before calculation.`,
    );
  }
  const resultKgCo2e = inputValue * factor.co2eFactor;
  return {
    emissionFactorId: factor.id,
    basis: factor.basis,
    inputValue,
    inputUnit,
    factorValueSnapshot: factor.co2eFactor,
    factorUnitSnapshot: factor.unit,
    factorSourceSnapshot: sourceLabel(factor),
    factorVintageSnapshot: String(factor.vintageYear),
    formulaApplied: buildFormula(inputValue, inputUnit, factor.co2eFactor, factor.unit, resultKgCo2e),
    resultKgCo2e,
  };
}

/**
 * Scope 2 must always produce both figures side by side (methodology
 * Section 5) — never just one.
 */
export function calculateScope2Dual(
  inputValueKwh: number,
  locationFactor: FactorRow,
  marketFactor: FactorRow,
): { locationBased: EmissionResult; marketBased: EmissionResult } {
  return {
    locationBased: calculateEmission(inputValueKwh, "kWh", locationFactor),
    marketBased: calculateEmission(inputValueKwh, "kWh", marketFactor),
  };
}

export interface EnergyContractInfo {
  regoBacked: boolean;
  tariffType: "STANDARD" | "GREEN";
}

/**
 * Per methodology Table (Section 5): "Where no market-based instrument is
 * held, the relevant residual mix factor is used." A REGO certificate or a
 * green tariff counts as holding an instrument.
 */
export function selectMarketBasis(contract: EnergyContractInfo | null): "MARKET_BASED" | "RESIDUAL_MIX" {
  if (contract && (contract.regoBacked || contract.tariffType === "GREEN")) {
    return "MARKET_BASED";
  }
  return "RESIDUAL_MIX";
}

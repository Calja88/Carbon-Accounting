import { describe, expect, it } from "vitest";
import { FactorBasis } from "@prisma/client";
import {
  calculateEmission,
  calculateScope2Dual,
  selectMarketBasis,
  UnitMismatchError,
  FactorRow,
} from "@/lib/calc-engine";

function factor(overrides: Partial<FactorRow> = {}): FactorRow {
  return {
    id: "factor-1",
    basis: FactorBasis.STANDARD,
    unit: "kWh",
    co2eFactor: 0.18293,
    factorSetName: "Test Factor Set 2024",
    vintageYear: 2024,
    isPlaceholder: true,
    ...overrides,
  };
}

describe("calculateEmission", () => {
  it("multiplies input value by the factor and returns kgCO2e", () => {
    const result = calculateEmission(1000, "kWh", factor());
    expect(result.resultKgCo2e).toBeCloseTo(182.93, 5);
  });

  it("snapshots the factor value, unit, source and vintage onto the result (audit trail)", () => {
    const result = calculateEmission(500, "litres", factor({ unit: "litres", co2eFactor: 2.51233, vintageYear: 2023 }));
    expect(result.factorValueSnapshot).toBe(2.51233);
    expect(result.factorUnitSnapshot).toBe("litres");
    expect(result.factorVintageSnapshot).toBe("2023");
    expect(result.factorSourceSnapshot).toContain("PLACEHOLDER");
    expect(result.formulaApplied).toContain("500");
    expect(result.formulaApplied).toContain("2.51233");
  });

  it("does not label a non-placeholder factor set as a placeholder", () => {
    const result = calculateEmission(10, "kWh", factor({ isPlaceholder: false, factorSetName: "DEFRA 2026 Official" }));
    expect(result.factorSourceSnapshot).toBe("DEFRA 2026 Official");
  });

  it("throws when the input unit does not match the factor's unit", () => {
    expect(() => calculateEmission(100, "m3", factor({ unit: "kWh" }))).toThrow(UnitMismatchError);
  });

  it("handles a zero input value", () => {
    const result = calculateEmission(0, "kWh", factor());
    expect(result.resultKgCo2e).toBe(0);
  });
});

describe("calculateScope2Dual", () => {
  it("always returns both a location-based and a market-based figure", () => {
    const location = factor({ id: "loc", basis: FactorBasis.LOCATION_BASED, co2eFactor: 0.20705 });
    const market = factor({ id: "mkt", basis: FactorBasis.RESIDUAL_MIX, co2eFactor: 0.245 });

    const dual = calculateScope2Dual(1000, location, market);

    expect(dual.locationBased.resultKgCo2e).toBeCloseTo(207.05, 5);
    expect(dual.marketBased.resultKgCo2e).toBeCloseTo(245, 5);
    expect(dual.locationBased.basis).toBe(FactorBasis.LOCATION_BASED);
    expect(dual.marketBased.basis).toBe(FactorBasis.RESIDUAL_MIX);
  });

  it("produces different figures for location vs market basis from the same input", () => {
    const location = factor({ id: "loc", basis: FactorBasis.LOCATION_BASED, co2eFactor: 0.20705 });
    const market = factor({ id: "mkt", basis: FactorBasis.MARKET_BASED, co2eFactor: 0 });

    const dual = calculateScope2Dual(5000, location, market);

    expect(dual.locationBased.resultKgCo2e).toBeGreaterThan(0);
    expect(dual.marketBased.resultKgCo2e).toBe(0);
    expect(dual.locationBased.resultKgCo2e).not.toBe(dual.marketBased.resultKgCo2e);
  });
});

describe("selectMarketBasis", () => {
  it("selects RESIDUAL_MIX when there is no contract on file", () => {
    expect(selectMarketBasis(null)).toBe("RESIDUAL_MIX");
  });

  it("selects RESIDUAL_MIX for a standard tariff with no REGO", () => {
    expect(selectMarketBasis({ regoBacked: false, tariffType: "STANDARD" })).toBe("RESIDUAL_MIX");
  });

  it("selects MARKET_BASED when REGO-backed", () => {
    expect(selectMarketBasis({ regoBacked: true, tariffType: "STANDARD" })).toBe("MARKET_BASED");
  });

  it("selects MARKET_BASED for a green tariff even without an explicit REGO flag", () => {
    expect(selectMarketBasis({ regoBacked: false, tariffType: "GREEN" })).toBe("MARKET_BASED");
  });
});

// ---------------------------------------------------------------------------
// Regression invariant C-01: the factor value/source/vintage/unit snapshotted
// onto a Calculation is fixed at calculation time — replacing the catalogue
// factor afterwards (a new EmissionFactorSet import) must never alter a
// result already computed and persisted.
// ---------------------------------------------------------------------------

describe("factor snapshot immutability (invariant C-01)", () => {
  it("keeps a previously computed result's snapshot unchanged after the source factor is replaced", () => {
    const originalFactor = factor({ co2eFactor: 0.18293, factorSetName: "DEFRA 2024", vintageYear: 2024 });
    const originalResult = calculateEmission(1000, "kWh", originalFactor);

    // Simulate a catalogue re-import: a new EmissionFactorSet with a
    // different value/source/vintage replaces the one used above. The
    // already-computed result must not be affected by this — snapshotted
    // fields are values copied at calculation time, not a live reference.
    const replacementFactor = factor({
      id: "factor-1",
      co2eFactor: 0.4,
      factorSetName: "DEFRA 2026",
      vintageYear: 2026,
    });
    calculateEmission(1000, "kWh", replacementFactor);

    expect(originalResult.factorValueSnapshot).toBe(0.18293);
    expect(originalResult.factorVintageSnapshot).toBe("2024");
    expect(originalResult.factorSourceSnapshot).toContain("DEFRA 2024");
    expect(originalResult.resultKgCo2e).toBeCloseTo(182.93, 5);
  });

  it("is unaffected even when the caller mutates the same FactorRow object in place after the call", () => {
    const mutableFactor = factor({ co2eFactor: 1.5, factorSetName: "DEFRA 2024", vintageYear: 2024 });
    const result = calculateEmission(10, "kWh", mutableFactor);

    // Mutating the object post-hoc must not reach back into the already
    // returned snapshot — proves the snapshot fields are copies, not
    // references into the (mutable) catalogue row.
    mutableFactor.co2eFactor = 99;
    mutableFactor.factorSetName = "DEFRA 2026";
    mutableFactor.vintageYear = 2026;

    expect(result.factorValueSnapshot).toBe(1.5);
    expect(result.factorVintageSnapshot).toBe("2024");
    expect(result.factorSourceSnapshot).toContain("DEFRA 2024");
    expect(result.resultKgCo2e).toBeCloseTo(15, 5);
  });
});

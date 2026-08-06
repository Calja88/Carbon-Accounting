import { describe, expect, it } from "vitest";
import { convertNaturalGasToKwh, toCanonicalUnit, UnsupportedUnitError } from "@/lib/units";

describe("convertNaturalGasToKwh", () => {
  it("passes kWh through unchanged", () => {
    expect(convertNaturalGasToKwh(1000, "kWh")).toBe(1000);
  });

  it("converts m3 to kWh using the standard UK gas billing formula", () => {
    // 100 m3 x 1.02264 x 39.5 / 3.6 ≈ 1122.06 kWh
    expect(convertNaturalGasToKwh(100, "m3")).toBeCloseTo(1122.06, 1);
  });

  it("throws for an unsupported unit", () => {
    // @ts-expect-error - intentionally invalid input
    expect(() => convertNaturalGasToKwh(10, "litres")).toThrow(UnsupportedUnitError);
  });
});

describe("toCanonicalUnit", () => {
  it("converts natural gas m3 entries to kWh", () => {
    const { value, unit } = toCanonicalUnit("stationary_combustion_natural_gas", 50, "m3");
    expect(unit).toBe("kWh");
    expect(value).toBeCloseTo(561.03, 1);
  });

  it("passes through categories that only ever have one unit", () => {
    const { value, unit } = toCanonicalUnit("mobile_combustion_fuel", 250, "litres");
    expect(value).toBe(250);
    expect(unit).toBe("litres");
  });
});

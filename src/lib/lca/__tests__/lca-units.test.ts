import { describe, expect, it } from "vitest";
import {
  areUnitsCompatible,
  canonicalUnitSymbol,
  conversionFactor,
  convertQuantity,
  convertWithTrail,
  findUnit,
  IncompatibleUnitError,
  requireUnit,
  toTonneKilometres,
  UnknownUnitError,
  unitDimension,
} from "@/lib/lca/units";
import { D } from "@/lib/lca/decimal";

describe("unit recognition", () => {
  it("accepts a unit written several ways", () => {
    expect(canonicalUnitSymbol("kg")).toBe("kg");
    expect(canonicalUnitSymbol("KG")).toBe("kg");
    expect(canonicalUnitSymbol("kilograms")).toBe("kg");
    expect(canonicalUnitSymbol(" Kilo ")).toBe("kg");
  });

  it("recognises the freight work unit in its usual spellings", () => {
    expect(canonicalUnitSymbol("t.km")).toBe("t.km");
    expect(canonicalUnitSymbol("tkm")).toBe("t.km");
    expect(canonicalUnitSymbol("tonne-km")).toBe("t.km");
  });

  it("returns null rather than guessing at something unrecognised", () => {
    expect(findUnit("widgets")).toBeNull();
    expect(canonicalUnitSymbol("widgets")).toBeNull();
  });

  it("raises when a unit is required but unrecognised", () => {
    expect(() => requireUnit("widgets")).toThrow(UnknownUnitError);
  });

  it("assigns each unit a dimension", () => {
    expect(unitDimension("kg")).toBe("MASS");
    expect(unitDimension("kWh")).toBe("ENERGY");
    expect(unitDimension("t.km")).toBe("FREIGHT");
    expect(unitDimension("GBP")).toBe("CURRENCY");
  });
});

describe("compatibility", () => {
  it("treats units of the same dimension as compatible", () => {
    expect(areUnitsCompatible("kg", "t")).toBe(true);
    expect(areUnitsCompatible("kWh", "MJ")).toBe(true);
  });

  it("treats units of different dimensions as incompatible", () => {
    expect(areUnitsCompatible("kg", "kWh")).toBe(false);
    expect(areUnitsCompatible("km", "kg")).toBe(false);
  });

  it("treats different currencies as incompatible even though they share a dimension", () => {
    expect(areUnitsCompatible("GBP", "GBP")).toBe(true);
    expect(areUnitsCompatible("GBP", "EUR")).toBe(false);
  });

  it("treats an unrecognised unit as compatible with nothing", () => {
    expect(areUnitsCompatible("widgets", "kg")).toBe(false);
  });
});

describe("conversion", () => {
  it("converts mass exactly", () => {
    expect(conversionFactor("t", "kg").toString()).toBe("1000");
    expect(conversionFactor("g", "kg").toString()).toBe("0.001");
    expect(convertQuantity(D(2.5), "t", "kg").toString()).toBe("2500");
  });

  it("uses the international definitions for imperial units", () => {
    // 1 mile = 1.609344 km and 1 lb = 0.45359237 kg, both exact by definition.
    expect(conversionFactor("mi", "km").toString()).toBe("1.609344");
    expect(conversionFactor("lb", "kg").toString()).toBe("0.45359237");
  });

  it("converts energy between kWh and MJ", () => {
    // 1 kWh = 3.6 MJ
    expect(convertQuantity(D(1), "kWh", "MJ").toDecimalPlaces(10).toString()).toBe("3.6");
    expect(convertQuantity(D(3.6), "MJ", "kWh").toDecimalPlaces(10).toString()).toBe("1");
  });

  it("converts volume", () => {
    expect(convertQuantity(D(1), "m3", "l").toString()).toBe("1000");
  });

  it("is the identity for the same unit", () => {
    expect(conversionFactor("kg", "kg").toString()).toBe("1");
  });

  it("round-trips without drift", () => {
    const original = D("123.456");
    const roundTripped = convertQuantity(convertQuantity(original, "kg", "lb"), "lb", "kg");
    expect(roundTripped.toDecimalPlaces(9).toString()).toBe("123.456");
  });

  it("refuses to convert between dimensions", () => {
    expect(() => conversionFactor("kg", "kWh")).toThrow(IncompatibleUnitError);
  });

  it("refuses to convert between currencies rather than inventing a rate", () => {
    expect(() => conversionFactor("GBP", "EUR")).toThrow(IncompatibleUnitError);
    expect(() => conversionFactor("GBP", "EUR")).toThrow(/exchange-rate/);
  });

  it("produces a readable trail for the provenance view", () => {
    const outcome = convertWithTrail(D(1), "t", "kg");
    expect(outcome.value.toString()).toBe("1000");
    expect(outcome.fromUnit).toBe("t");
    expect(outcome.toUnit).toBe("kg");
    expect(outcome.note).toContain("1 t = 1000 kg");
  });

  it("says so when no conversion was needed", () => {
    expect(convertWithTrail(D(5), "kg", "kg").note).toContain("no conversion applied");
  });
});

describe("tonne-kilometres", () => {
  it("2 t carried 500 km is 1,000 t.km", () => {
    expect(toTonneKilometres(D(2), "t", D(500), "km").toString()).toBe("1000");
  });

  it("converts the mass and the distance first", () => {
    // 2,000 kg = 2 t; 500 km stays; = 1,000 t.km
    expect(toTonneKilometres(D(2000), "kg", D(500), "km").toString()).toBe("1000");
    // 1 t over 100 miles = 160.9344 t.km
    expect(toTonneKilometres(D(1), "t", D(100), "mi").toString()).toBe("160.9344");
  });

  it("raises when the mass is not a mass", () => {
    expect(() => toTonneKilometres(D(1), "kWh", D(100), "km")).toThrow(IncompatibleUnitError);
  });
});

import { describe, expect, it } from "vitest";
import {
  CO2E,
  EM_DASH,
  KG_CO2E,
  NOT_AVAILABLE,
  TONNES_CO2E,
  formatKgCO2e,
  formatMissing,
  formatPercentChange,
  formatShare,
  formatTonnesCO2e,
} from "../format";
import { formatPercent, formatTonnes } from "../board/metrics";

describe("carbon quantity formatting", () => {
  it("writes the unit one way everywhere", () => {
    expect(CO2E).toBe("CO₂e");
    expect(TONNES_CO2E).toBe("tCO₂e");
    expect(KG_CO2E).toBe("kgCO₂e");
  });

  it("never renders a missing figure as zero", () => {
    expect(formatTonnesCO2e(null)).toBe(NOT_AVAILABLE);
    expect(formatTonnesCO2e(undefined)).toBe(NOT_AVAILABLE);
    expect(formatTonnesCO2e(Number.NaN)).toBe(NOT_AVAILABLE);
    expect(formatTonnesCO2e(null, { missing: "inline" })).toBe(EM_DASH);
    expect(formatKgCO2e(null, { missing: "inline" })).toBe(EM_DASH);
    expect(formatMissing()).toBe(NOT_AVAILABLE);
    expect(formatMissing("inline")).toBe(EM_DASH);
  });

  it("keeps a real zero distinct from a missing figure", () => {
    expect(formatTonnesCO2e(0)).toBe("0");
    expect(formatKgCO2e(0)).toBe("0");
  });

  it("scales precision to the magnitude when no fixed precision is asked for", () => {
    expect(formatTonnesCO2e(5)).toBe("<0.01");
    expect(formatTonnesCO2e(1234)).toBe("1.23");
    expect(formatTonnesCO2e(1_248_000)).toBe("1,248");
  });

  it("honours fixed precision, which is what board columns rely on", () => {
    expect(formatTonnesCO2e(1_248_000, { digits: 0 })).toBe("1,248");
    expect(formatTonnesCO2e(1_248_400, { digits: 1 })).toBe("1,248.4");
  });

  it("appends the unit only when asked", () => {
    expect(formatTonnesCO2e(1_248_000, { digits: 0, unit: true })).toBe(`1,248 ${TONNES_CO2E}`);
    expect(formatKgCO2e(12.5, { unit: true })).toBe(`12.5 ${KG_CO2E}`);
  });

  it("signs a percentage change, because the direction is the point", () => {
    expect(formatPercentChange(-20)).toBe("-20.0%");
    expect(formatPercentChange(3.24)).toBe("+3.2%");
    expect(formatPercentChange(null)).toBe("Not comparable");
    expect(formatPercentChange(null, { fallback: EM_DASH })).toBe(EM_DASH);
  });

  it("treats a zero or missing denominator as no share, not a zero share", () => {
    expect(formatShare(50, 200)).toBe("25.0%");
    expect(formatShare(50, 0)).toBe(EM_DASH);
    expect(formatShare(50, null)).toBe(EM_DASH);
    expect(formatShare(null, 200)).toBe(EM_DASH);
  });

  it("leaves the board helpers behaving exactly as before", () => {
    expect(formatTonnes(1_248_000)).toBe("1,248");
    expect(formatTonnes(null)).toBe(NOT_AVAILABLE);
    expect(formatPercent(-20)).toBe("-20.0%");
    expect(formatPercent(null)).toBe("Not comparable");
  });
});

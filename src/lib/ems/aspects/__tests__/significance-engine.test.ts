import { describe, expect, it } from "vitest";
import { calculateSignificance, SignificanceValidationError } from "@/lib/ems/aspects/significance-engine";
import type { SignificanceSnapshot } from "@/lib/ems/aspects/types";

function weighted(overrides: Partial<SignificanceSnapshot> = {}): SignificanceSnapshot {
  return {
    methodKey: "synthetic-significance",
    version: 1,
    formula: "WEIGHTED_SUM",
    formulaConfig: { formula: "WEIGHTED_SUM" },
    threshold: "10",
    criteria: [
      { key: "severity", value: "4", weight: "2", required: true, scale: { kind: "NUMERIC", min: "1", max: "5" } },
      { key: "frequency", value: "2", weight: "1", required: true, scale: { kind: "NUMERIC", min: "1", max: "5" } },
    ],
    ...overrides,
  };
}

describe("calculateSignificance", () => {
  it("returns the exact same score and trace for the same snapshot", () => {
    const snapshot = weighted();
    expect(calculateSignificance(snapshot)).toEqual({
      score: "10",
      calculatedSignificant: true,
      trace: [
        { criterionKey: "severity", contribution: "8" },
        { criterionKey: "frequency", contribution: "2" },
      ],
    });
    expect(calculateSignificance(snapshot)).toEqual(calculateSignificance(snapshot));
  });

  it("does not let a later formula change alter an historic snapshot result", () => {
    const historic = weighted();
    const revised: SignificanceSnapshot = {
      ...historic,
      version: 2,
      formula: "MAX_CRITERION",
      formulaConfig: { formula: "MAX_CRITERION" },
      threshold: "4",
    };
    expect(calculateSignificance(revised).score).toBe("4");
    expect(calculateSignificance(historic).score).toBe("10");
  });

  it("evaluates rule sets deterministically and counts matching rules", () => {
    const result = calculateSignificance({
      ...weighted(),
      formula: "RULE_SET",
      formulaConfig: {
        formula: "RULE_SET",
        rules: [
          { criterionKey: "severity", operator: "GTE", compareTo: "4" },
          { criterionKey: "frequency", operator: "GT", compareTo: "3" },
        ],
      },
      threshold: "1",
    });
    expect(result).toEqual({
      score: "1",
      calculatedSignificant: true,
      trace: [
        { criterionKey: "severity", contribution: "1" },
        { criterionKey: "frequency", contribution: "0" },
      ],
    });
  });

  it("maps scored options to exact Decimal scores", () => {
    const result = calculateSignificance(weighted({
      threshold: "0.3",
      criteria: [{
        key: "control",
        value: "partial",
        weight: "0.1",
        scale: { kind: "SCORED_OPTIONS", options: [{ value: "partial", label: "Partial", score: "3" }] },
      }],
    }));
    expect(result.score).toBe("0.3");
    expect(result.calculatedSignificant).toBe(true);
  });

  it.each([
    ["missing required value", weighted({ criteria: [{ key: "severity", value: "", required: true }] }), "MISSING_CRITERION"],
    ["negative weight", weighted({ criteria: [{ key: "severity", value: "1", weight: "-1" }] }), "INVALID_WEIGHT"],
    ["bad threshold", weighted({ threshold: "not-a-number" }), "INVALID_THRESHOLD"],
    ["negative threshold", weighted({ threshold: "-0.1" }), "INVALID_THRESHOLD"],
    ["out-of-range value", weighted({ criteria: [{ key: "severity", value: "6", scale: { kind: "NUMERIC", min: "1", max: "5" } }] }), "INVALID_VALUE"],
    ["duplicate key", weighted({ criteria: [{ key: "same", value: "1" }, { key: "same", value: "2" }] }), "DUPLICATE_CRITERION"],
  ])("rejects %s with a typed error", (_label, snapshot, code) => {
    try {
      calculateSignificance(snapshot as SignificanceSnapshot);
      expect.unreachable("expected validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(SignificanceValidationError);
      expect((error as SignificanceValidationError).code).toBe(code);
    }
  });
});

import { describe, expect, it } from "vitest";
import { buildScenarioComparability, mergeStageContributions } from "@/lib/board/live-lca-helpers";
import type { AssessmentComparabilityInput } from "@/lib/board/live-lca-helpers";

function fresh(overrides: Partial<AssessmentComparabilityInput> = {}): AssessmentComparabilityInput {
  return {
    functionalUnitUnit: "card",
    functionalUnitDescription: "1 card",
    isDeclaredUnit: false,
    functionalUnitQuantity: "1",
    boundary: "CRADLE_TO_GATE",
    includedLifecycleStages: ["RAW_MATERIALS", "MANUFACTURING"],
    engineVersion: "1.0.0",
    methodologyVersion: null,
    methodologySnapshot: { factorSelectionMode: "AUTOMATIC" },
    hasRun: true,
    stale: false,
    staleReason: null,
    ...overrides,
  };
}

describe("buildScenarioComparability", () => {
  it("is comparable when unit, quantity, boundary match and both are fresh", () => {
    const result = buildScenarioComparability({ baseline: fresh(), scenario: fresh() });
    expect(result).toEqual({ comparable: true, reason: null, unitLabel: "1 card" });
  });

  it("is not comparable when the baseline has never been calculated", () => {
    const result = buildScenarioComparability({ baseline: fresh({ hasRun: false }), scenario: fresh() });
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/baseline has not been calculated/i);
  });

  it("is not comparable when the scenario has never been calculated", () => {
    const result = buildScenarioComparability({ baseline: fresh(), scenario: fresh({ hasRun: false }) });
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/scenario has not been calculated/i);
  });

  it("is not comparable across functional vs declared unit types", () => {
    const result = buildScenarioComparability({ baseline: fresh({ isDeclaredUnit: false }), scenario: fresh({ isDeclaredUnit: true }) });
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/different unit types/i);
  });

  it("is not comparable when functional units differ — never silently converted", () => {
    const result = buildScenarioComparability({
      baseline: fresh({ functionalUnitUnit: "card" }),
      scenario: fresh({ functionalUnitUnit: "pack of 10 cards" }),
    });
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/Functional units differ/);
  });

  it("is not comparable when functional unit quantities differ", () => {
    const result = buildScenarioComparability({
      baseline: fresh({ functionalUnitQuantity: "1" }),
      scenario: fresh({ functionalUnitQuantity: "10" }),
    });
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/quantities differ/);
  });

  it("is not comparable when system boundaries differ", () => {
    const result = buildScenarioComparability({
      baseline: fresh({ boundary: "CRADLE_TO_GATE" }),
      scenario: fresh({ boundary: "CRADLE_TO_GRAVE" }),
    });
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/System boundaries differ/);
  });

  it("labels a stale result honestly instead of showing an unqualified reduction", () => {
    const result = buildScenarioComparability({
      baseline: fresh({ stale: true, staleReason: "Inventory has changed since the last run." }),
      scenario: fresh(),
    });
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/out of date/i);
    expect(result.reason).toMatch(/Inventory has changed/);
  });

  it("falls back to the scenario's own functional unit description when the baseline has none", () => {
    const result = buildScenarioComparability({
      baseline: fresh({ functionalUnitDescription: null, functionalUnitUnit: null }),
      scenario: fresh({ functionalUnitDescription: "1 card" }),
    });
    expect(result.unitLabel).toBe("1 card");
  });

  it("is not comparable when the effective description is empty on either side", () => {
    const result = buildScenarioComparability({
      baseline: fresh({ functionalUnitDescription: "  ", functionalUnitUnit: null }),
      scenario: fresh(),
    });
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/no functional\/declared unit description/i);
  });

  it("treats Decimal-equivalent quantities as equal, not string-equal", () => {
    const result = buildScenarioComparability({
      baseline: fresh({ functionalUnitQuantity: "1" }),
      scenario: fresh({ functionalUnitQuantity: "1.0" }),
    });
    expect(result.comparable).toBe(true);
  });

  it("rejects a non-positive functional unit quantity", () => {
    const result = buildScenarioComparability({
      baseline: fresh({ functionalUnitQuantity: "0" }),
      scenario: fresh(),
    });
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/finite and positive/i);
  });

  it("rejects a non-numeric functional unit quantity", () => {
    const result = buildScenarioComparability({
      baseline: fresh({ functionalUnitQuantity: "not-a-number" }),
      scenario: fresh(),
    });
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/not a valid number/i);
  });

  it("is not comparable when included lifecycle stages differ", () => {
    const result = buildScenarioComparability({
      baseline: fresh({ includedLifecycleStages: ["RAW_MATERIALS", "MANUFACTURING"] }),
      scenario: fresh({ includedLifecycleStages: ["RAW_MATERIALS"] }),
    });
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/lifecycle stages differ/i);
  });

  it("is not comparable when engine versions differ", () => {
    const result = buildScenarioComparability({
      baseline: fresh({ engineVersion: "1.0.0" }),
      scenario: fresh({ engineVersion: "1.1.0" }),
    });
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/engine versions differ/i);
  });

  it("is not comparable when engine version is unrecorded on either side — absence is never equality", () => {
    const result = buildScenarioComparability({
      baseline: fresh({ engineVersion: null }),
      scenario: fresh({ engineVersion: null }),
    });
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/engine version is not recorded/i);
  });

  it("is not comparable when methodology configuration differs", () => {
    const result = buildScenarioComparability({
      baseline: fresh({ methodologySnapshot: { factorSelectionMode: "AUTOMATIC" } }),
      scenario: fresh({ methodologySnapshot: { factorSelectionMode: "MANUAL" } }),
    });
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/methodology configuration differs/i);
  });

  it("is not comparable when methodology configuration is unrecorded on either side", () => {
    const result = buildScenarioComparability({
      baseline: fresh({ methodologySnapshot: null }),
      scenario: fresh({ methodologySnapshot: null }),
    });
    expect(result.comparable).toBe(false);
    expect(result.reason).toMatch(/methodology configuration is not recorded/i);
  });

  it("ignores key order in the methodology snapshot comparison", () => {
    const result = buildScenarioComparability({
      baseline: fresh({ methodologySnapshot: { a: 1, b: 2 } }),
      scenario: fresh({ methodologySnapshot: { b: 2, a: 1 } }),
    });
    expect(result.comparable).toBe(true);
  });

  it("does not demand identical inventory, supplier factors or factor values — only compares method/unit/boundary/stage config", () => {
    // buildScenarioComparability's input never carries inventory/factor
    // fields at all — this test documents that omission is deliberate.
    const result = buildScenarioComparability({ baseline: fresh(), scenario: fresh() });
    expect(result.comparable).toBe(true);
  });
});

describe("mergeStageContributions", () => {
  it("merges matching stage keys from both sides", () => {
    const merged = mergeStageContributions(
      [{ key: "RAW_MATERIALS", label: "Raw materials", perFunctionalUnitKgCo2e: 0.1 }],
      [{ key: "RAW_MATERIALS", label: "Raw materials", perFunctionalUnitKgCo2e: 0.08 }],
    );
    expect(merged).toEqual([{ stage: "Raw materials", baselineKg: 0.1, scenarioKg: 0.08 }]);
  });

  it("keeps a stage present only on one side, defaulting the other to zero", () => {
    const merged = mergeStageContributions(
      [{ key: "RAW_MATERIALS", label: "Raw materials", perFunctionalUnitKgCo2e: 0.1 }],
      [{ key: "PACKAGING", label: "Packaging", perFunctionalUnitKgCo2e: 0.02 }],
    );
    expect(merged).toEqual(
      expect.arrayContaining([
        { stage: "Raw materials", baselineKg: 0.1, scenarioKg: 0 },
        { stage: "Packaging", baselineKg: 0, scenarioKg: 0.02 },
      ]),
    );
    expect(merged).toHaveLength(2);
  });
});

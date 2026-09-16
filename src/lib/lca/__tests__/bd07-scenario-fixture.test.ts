/**
 * BD07: proves the board demo's 0.120 -> 0.102 kgCO2e/card scenario (a 15%
 * reduction) is a genuine output of the existing, unmodified LCA engine
 * (`calculateAssessment`) against a minimal synthetic input fixture — never
 * a hard-coded UI value. Per the BD07 stop condition, only the fixture's
 * INPUT (one material's quantity) changes between baseline and scenario;
 * no calculation/allocation/factor semantics are touched.
 *
 * Uses the same builder pattern as lca-engine.test.ts (no Prisma, no
 * database — pure engine call), so this is a deterministic, always-run
 * check rather than a live-integration one.
 */
import { describe, expect, it } from "vitest";
import {
  LcaAllocationMethod,
  LcaDataType,
  LcaEmissionClassification,
  LcaFactorBoundary,
  LcaFactorSelectionMode,
  LcaItemType,
  LcaLifecycleStage,
} from "@prisma/client";
import { calculateAssessment } from "@/lib/lca/engine/engine";
import type { EngineAssessment, EngineFactor, EngineInventoryItem, EngineProcess } from "@/lib/lca/engine/types";
import { D } from "@/lib/lca/decimal";
import { FALLBACK_METHODOLOGY } from "@/lib/lca/methodology";

function factor(value: number, unit: string): EngineFactor {
  return {
    emissionFactorId: "factor-card-substrate",
    selectionMode: LcaFactorSelectionMode.LIBRARY_FACTOR,
    value: D(value),
    unit,
    source: "Synthetic board-demo factor library",
    version: "2026",
    boundary: LcaFactorBoundary.CRADLE_TO_GATE,
    geography: "UK",
    year: 2026,
    gwpBasis: "IPCC AR6 GWP100",
    isPlaceholder: false,
    uncertaintyPercent: null,
  };
}

function process(): EngineProcess {
  return {
    id: "process-card",
    parentProcessId: null,
    stage: LcaLifecycleStage.RAW_MATERIALS,
    name: "Card substrate production",
    isIncluded: true,
    allocationMethod: LcaAllocationMethod.NONE,
    allocationPercent: D(100),
    allocationRationale: null,
    outputs: [],
  };
}

/** One material line: `quantityKg` kg of substrate at 1 kgCO2e/kg. */
function substrateItem(quantityKg: number): EngineInventoryItem {
  return {
    id: "item-card-substrate",
    processId: "process-card",
    itemType: LcaItemType.MATERIAL,
    name: "Card substrate",
    classification: LcaEmissionClassification.FOSSIL,
    quantity: D(quantityKg),
    unit: "kg",
    adjustmentFactor: D(1),
    adjustmentRationale: null,
    wastePercent: null,
    recycledContentPercent: null,
    dataType: LcaDataType.PRIMARY,
    supplierName: "Synthetic board-demo supplier",
    materialName: "Paperboard",
    componentName: null,
    geography: "UK",
    factor: factor(1, "kg"),
    recycledFactor: null,
    biogenicUptakePerUnit: null,
    storedCarbonPerUnit: null,
    dataQuality: { temporal: 1, geographical: 1, technological: 1, completeness: 1, reliability: 1 },
    uncertaintyPercent: null,
    isExcluded: false,
    exclusionReason: null,
    transportLegs: [],
    endOfLifeRoutes: [],
  };
}

/** One functional unit = one card; the fixture's only input distinguishing baseline from scenario is `quantityKg`. */
function cardAssessment(reference: string, quantityKg: number): EngineAssessment {
  return {
    id: `assessment-${reference}`,
    reference,
    title: "Synthetic board-demo card",
    functionalUnit: {
      // "item" is the recognised COUNT unit symbol (src/lib/lca/units.ts); the
      // free-text description is what actually says "card" to a reader.
      description: "1 card",
      quantity: D(1),
      unit: "item",
      isDeclaredUnit: false,
      declaredUnitDescription: null,
      referenceFlowDescription: "1 card",
      referenceFlowQuantity: D(1),
      referenceFlowUnit: "item",
      modelledOutputQuantity: D(1),
      modelledOutputUnit: "item",
    },
    methodology: { ...FALLBACK_METHODOLOGY },
    processes: [process()],
    items: [substrateItem(quantityKg)],
  };
}

describe("BD07 synthetic card scenario fixture (real engine, no mocks)", () => {
  it("baseline: 0.120 kg substrate at 1 kgCO2e/kg = 0.120 kgCO2e per card", () => {
    const output = calculateAssessment(cardAssessment("PCF-BOARD-DEMO-001", 0.12));
    expect(output.totals.headlinePerFunctionalUnitKgCo2e.toNumber()).toBeCloseTo(0.12, 10);
  });

  it("scenario: 0.102 kg substrate (a lighter card) = 0.102 kgCO2e per card", () => {
    const output = calculateAssessment(cardAssessment("PCF-BOARD-DEMO-001-S1", 0.102));
    expect(output.totals.headlinePerFunctionalUnitKgCo2e.toNumber()).toBeCloseTo(0.102, 10);
  });

  it("is exactly a 15% reduction — computed, not hard-coded", () => {
    const baseline = calculateAssessment(cardAssessment("PCF-BOARD-DEMO-001", 0.12));
    const scenario = calculateAssessment(cardAssessment("PCF-BOARD-DEMO-001-S1", 0.102));
    const baselinePerFu = baseline.totals.headlinePerFunctionalUnitKgCo2e;
    const scenarioPerFu = scenario.totals.headlinePerFunctionalUnitKgCo2e;
    const percentReduction = baselinePerFu.minus(scenarioPerFu).div(baselinePerFu).times(100);
    expect(percentReduction.toNumber()).toBeCloseTo(15, 10);
  });

  it("changes only the fixture's material quantity between baseline and scenario, not any calculation semantic", () => {
    const baseline = cardAssessment("PCF-BOARD-DEMO-001", 0.12);
    const scenario = cardAssessment("PCF-BOARD-DEMO-001-S1", 0.102);
    expect(scenario.methodology).toEqual(baseline.methodology);
    expect(scenario.items[0].factor).toEqual(baseline.items[0].factor);
    expect(scenario.processes[0].allocationMethod).toBe(baseline.processes[0].allocationMethod);
    expect(scenario.functionalUnit).toEqual(baseline.functionalUnit);
    expect(scenario.items[0].quantity.toNumber()).not.toBe(baseline.items[0].quantity.toNumber());
  });
});

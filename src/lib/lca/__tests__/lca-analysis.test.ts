import { describe, expect, it } from "vitest";
import { LcaDataType, LcaEmissionClassification, LcaItemType, LcaLifecycleStage } from "@prisma/client";
import {
  analyseContributions,
  compareScenario,
  contributionsByStage,
  contributionsBySupplier,
  grossPositiveTotal,
  hotspots,
  qualityScoreToIndicator,
  sensitivityAnalysis,
  summariseDataQuality,
  summariseUncertainty,
  type AnalysisRow,
} from "@/lib/lca/analysis";
import { D } from "@/lib/lca/decimal";

function analysisRow(overrides: Partial<AnalysisRow> = {}): AnalysisRow {
  return {
    stage: LcaLifecycleStage.RAW_MATERIALS,
    processId: "process-1",
    processName: "Raw materials",
    inventoryItemId: "item-1",
    itemName: "Steel",
    itemType: LcaItemType.MATERIAL,
    classification: LcaEmissionClassification.FOSSIL,
    materialName: "Steel",
    supplierName: null,
    dataType: LcaDataType.SECONDARY,
    dataQualityScore: D(3),
    uncertaintyPercent: null,
    allocatedKgCo2e: D(10),
    perFunctionalUnitKgCo2e: D(1),
    factorSource: "Test library",
    isPlaceholderFactor: false,
    ...overrides,
  };
}

describe("contributions", () => {
  const rows = [
    analysisRow({ inventoryItemId: "a", itemName: "Steel", allocatedKgCo2e: D(60), perFunctionalUnitKgCo2e: D(6) }),
    analysisRow({
      inventoryItemId: "b",
      itemName: "Electricity",
      stage: LcaLifecycleStage.MANUFACTURING,
      processId: "process-2",
      processName: "Assembly",
      itemType: LcaItemType.ENERGY,
      materialName: null,
      allocatedKgCo2e: D(30),
      perFunctionalUnitKgCo2e: D(3),
    }),
    analysisRow({ inventoryItemId: "c", itemName: "Carton", allocatedKgCo2e: D(10), perFunctionalUnitKgCo2e: D(1) }),
  ];

  it("sums by stage and gives shares of gross emissions", () => {
    const byStage = contributionsByStage(rows);

    expect(byStage).toHaveLength(2);
    expect(byStage[0].key).toBe("RAW_MATERIALS");
    expect(byStage[0].kgCo2e).toBe(70);
    expect(byStage[0].percent).toBeCloseTo(70, 6);
  });

  it("returns stages in lifecycle order, not by size", () => {
    const byStage = contributionsByStage([
      analysisRow({ stage: LcaLifecycleStage.END_OF_LIFE, allocatedKgCo2e: D(90) }),
      analysisRow({ stage: LcaLifecycleStage.RAW_MATERIALS, allocatedKgCo2e: D(10) }),
    ]);
    expect(byStage.map((s) => s.key)).toEqual(["RAW_MATERIALS", "END_OF_LIFE"]);
  });

  it("ranks hotspots largest first", () => {
    const ranked = hotspots(rows);
    expect(ranked.map((h) => h.label)).toEqual(["Steel", "Electricity", "Carton"]);
  });

  it("takes shares against gross positive emissions so credits cannot push a share over 100%", () => {
    const withCredit = [
      ...rows,
      analysisRow({
        inventoryItemId: "credit",
        itemName: "Recovery credit",
        classification: LcaEmissionClassification.AVOIDED_BURDEN,
        allocatedKgCo2e: D(-50),
        perFunctionalUnitKgCo2e: D(-5),
      }),
    ];

    expect(grossPositiveTotal(withCredit).toNumber()).toBe(100);
    const byStage = contributionsByStage(withCredit);
    const total = byStage.reduce((sum, s) => sum + s.percent, 0);
    expect(total).toBeCloseTo(50, 6); // 100 gross - 50 credit = 50 net, over a 100 gross denominator
  });

  it("groups lines with no supplier rather than hiding them", () => {
    const bySupplier = contributionsBySupplier([
      analysisRow({ supplierName: "Supplier A", allocatedKgCo2e: D(70) }),
      analysisRow({ inventoryItemId: "b", supplierName: null, allocatedKgCo2e: D(30) }),
    ]);

    expect(bySupplier.map((s) => s.label)).toContain("No supplier recorded");
    expect(bySupplier.reduce((sum, s) => sum + s.kgCo2e, 0)).toBe(100);
  });

  it("produces every breakdown in one pass", () => {
    const analysis = analyseContributions(rows);

    expect(analysis.byStage.length).toBeGreaterThan(0);
    expect(analysis.byProcess.length).toBe(2);
    expect(analysis.byItem.length).toBe(3);
    expect(analysis.grossPositiveKgCo2e).toBe(100);
  });
});

describe("data quality", () => {
  it("weights the score by each line's share of the footprint", () => {
    // A poor score on a tiny line should not drag the assessment down.
    const summary = summariseDataQuality([
      analysisRow({ inventoryItemId: "big", allocatedKgCo2e: D(99), dataQualityScore: D(1) }),
      analysisRow({ inventoryItemId: "small", allocatedKgCo2e: D(1), dataQualityScore: D(5) }),
    ]);

    expect(summary.footprintWeightedScore).toBeCloseTo(1.04, 2);
    expect(summary.simpleMeanScore).toBe(3);
  });

  it("reports how much of the footprint has no scores at all", () => {
    const summary = summariseDataQuality([
      analysisRow({ inventoryItemId: "scored", allocatedKgCo2e: D(75), dataQualityScore: D(2) }),
      analysisRow({ inventoryItemId: "unscored", allocatedKgCo2e: D(25), dataQualityScore: null }),
    ]);

    expect(summary.unscoredEmissionsPercent).toBeCloseTo(25, 6);
    expect(summary.scoredLineCount).toBe(1);
  });

  it("breaks coverage down by data type", () => {
    const summary = summariseDataQuality([
      analysisRow({ inventoryItemId: "p", dataType: LcaDataType.PRIMARY, allocatedKgCo2e: D(50) }),
      analysisRow({ inventoryItemId: "s", dataType: LcaDataType.SECONDARY, allocatedKgCo2e: D(30) }),
      analysisRow({ inventoryItemId: "x", dataType: LcaDataType.PROXY, allocatedKgCo2e: D(20) }),
    ]);

    const primary = summary.coverage.find((c) => c.dataType === LcaDataType.PRIMARY);
    const proxy = summary.coverage.find((c) => c.dataType === LcaDataType.PROXY);
    expect(primary?.percent).toBeCloseTo(50, 6);
    expect(proxy?.percent).toBeCloseTo(20, 6);
  });

  it("reports the share of the footprint resting on placeholder factors", () => {
    const summary = summariseDataQuality([
      analysisRow({ inventoryItemId: "real", allocatedKgCo2e: D(80), isPlaceholderFactor: false }),
      analysisRow({ inventoryItemId: "placeholder", allocatedKgCo2e: D(20), isPlaceholderFactor: true }),
    ]);
    expect(summary.placeholderFactorPercent).toBeCloseTo(20, 6);
  });

  it("returns null rather than zero when nothing is scored", () => {
    const summary = summariseDataQuality([analysisRow({ dataQualityScore: null })]);
    expect(summary.footprintWeightedScore).toBeNull();
    expect(qualityScoreToIndicator(null).label).toBe("Not scored");
  });
});

describe("uncertainty", () => {
  it("combines independent uncertainties in quadrature", () => {
    // 100 ± 30% = ±30; 100 ± 40% = ±40; sqrt(30² + 40²) = 50 on a total of 200.
    const summary = summariseUncertainty([
      analysisRow({ inventoryItemId: "a", allocatedKgCo2e: D(100), uncertaintyPercent: D(30) }),
      analysisRow({ inventoryItemId: "b", allocatedKgCo2e: D(100), uncertaintyPercent: D(40) }),
    ]);

    expect(summary.combinedPercent).toBeCloseTo(25, 6);
    expect(summary.lowerKgCo2e).toBeCloseTo(150, 6);
    expect(summary.upperKgCo2e).toBeCloseTo(250, 6);
  });

  it("reports coverage so a narrow range on thin coverage is visible", () => {
    const summary = summariseUncertainty([
      analysisRow({ inventoryItemId: "a", allocatedKgCo2e: D(10), uncertaintyPercent: D(20) }),
      analysisRow({ inventoryItemId: "b", allocatedKgCo2e: D(90), uncertaintyPercent: null }),
    ]);

    expect(summary.coveragePercent).toBeCloseTo(10, 6);
    expect(summary.assessedLineCount).toBe(1);
  });

  it("returns no range when nothing has been assessed", () => {
    const summary = summariseUncertainty([analysisRow({ uncertaintyPercent: null })]);
    expect(summary.combinedPercent).toBeNull();
    expect(summary.lowerKgCo2e).toBeNull();
  });

  it("states the independence assumption and that no Monte Carlo was run", () => {
    const summary = summariseUncertainty([analysisRow({ uncertaintyPercent: D(10) })]);
    expect(summary.caveat).toContain("independent");
    expect(summary.caveat).toContain("Monte Carlo");
  });
});

describe("sensitivity", () => {
  it("moves one line at a time and reports the effect on the total", () => {
    const result = sensitivityAnalysis(
      [
        analysisRow({ inventoryItemId: "a", itemName: "Steel", allocatedKgCo2e: D(80) }),
        analysisRow({ inventoryItemId: "b", itemName: "Carton", allocatedKgCo2e: D(20) }),
      ],
      10,
    );

    expect(result.baselineTotalKgCo2e).toBe(100);
    const steel = result.entries.find((e) => e.label === "Steel");
    expect(steel?.deltaKgCo2e).toBeCloseTo(8, 6);
    expect(steel?.newTotalKgCo2e).toBeCloseTo(108, 6);
    expect(steel?.deltaTotalPercent).toBeCloseTo(8, 6);
  });

  it("orders entries by contribution", () => {
    const result = sensitivityAnalysis([
      analysisRow({ inventoryItemId: "small", itemName: "Small", allocatedKgCo2e: D(1) }),
      analysisRow({ inventoryItemId: "big", itemName: "Big", allocatedKgCo2e: D(99) }),
    ]);
    expect(result.entries[0].label).toBe("Big");
  });
});

describe("scenario comparison", () => {
  const baseline = [
    analysisRow({ inventoryItemId: "steel", itemName: "Steel", allocatedKgCo2e: D(80), perFunctionalUnitKgCo2e: D(8) }),
    analysisRow({ inventoryItemId: "carton", itemName: "Carton", allocatedKgCo2e: D(20), perFunctionalUnitKgCo2e: D(2) }),
  ];

  it("reports absolute and percentage reduction", () => {
    const scenario = [
      analysisRow({ inventoryItemId: "steel", itemName: "Steel", allocatedKgCo2e: D(40), perFunctionalUnitKgCo2e: D(4) }),
      analysisRow({ inventoryItemId: "carton", itemName: "Carton", allocatedKgCo2e: D(20), perFunctionalUnitKgCo2e: D(2) }),
    ];

    const comparison = compareScenario(baseline, scenario, D(10), D(6));

    expect(comparison.baselineTotalKgCo2e).toBe(100);
    expect(comparison.scenarioTotalKgCo2e).toBe(60);
    expect(comparison.absoluteReductionKgCo2e).toBe(40);
    expect(comparison.percentReduction).toBeCloseTo(40, 6);
    expect(comparison.perFunctionalUnitReduction).toBe(4);
    expect(comparison.perFunctionalUnitPercentReduction).toBeCloseTo(40, 6);
  });

  it("attributes the change to the lines that moved", () => {
    const scenario = [
      analysisRow({ inventoryItemId: "steel", itemName: "Steel", allocatedKgCo2e: D(40), perFunctionalUnitKgCo2e: D(4) }),
      analysisRow({ inventoryItemId: "carton", itemName: "Carton", allocatedKgCo2e: D(20), perFunctionalUnitKgCo2e: D(2) }),
    ];

    const comparison = compareScenario(baseline, scenario, D(10), D(6));
    const steel = comparison.driversByItem.find((d) => d.label === "Steel");
    const carton = comparison.driversByItem.find((d) => d.label === "Carton");

    expect(steel?.deltaKgCo2e).toBe(-40);
    expect(steel?.shareOfChangePercent).toBeCloseTo(-100, 6);
    expect(carton?.deltaKgCo2e ?? 0).toBe(0);
  });

  it("reports a scenario that makes things worse as a negative reduction", () => {
    const scenario = [
      analysisRow({ inventoryItemId: "steel", itemName: "Steel", allocatedKgCo2e: D(120), perFunctionalUnitKgCo2e: D(12) }),
      analysisRow({ inventoryItemId: "carton", itemName: "Carton", allocatedKgCo2e: D(20), perFunctionalUnitKgCo2e: D(2) }),
    ];

    const comparison = compareScenario(baseline, scenario, D(10), D(14));
    expect(comparison.absoluteReductionKgCo2e).toBe(-40);
    expect(comparison.perFunctionalUnitPercentReduction).toBeCloseTo(-40, 6);
  });

  it("picks up a line that exists only in the scenario", () => {
    const scenario = [
      ...baseline,
      analysisRow({ inventoryItemId: "new", itemName: "New coating", allocatedKgCo2e: D(5), perFunctionalUnitKgCo2e: D("0.5") }),
    ];

    const comparison = compareScenario(baseline, scenario, D(10), D("10.5"));
    const added = comparison.driversByItem.find((d) => d.label === "New coating");
    expect(added?.baselineKgCo2e).toBe(0);
    expect(added?.deltaKgCo2e).toBe(5);
  });
});

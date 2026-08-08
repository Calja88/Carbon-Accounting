import { describe, expect, it } from "vitest";
import { calculateLca, type LcaCalculationInput, type LcaFactorSnapshot, type LcaFlowInput } from "@/lib/lca/calc";
import { analyseHotspots } from "@/lib/lca/aggregation";
import { applyScenarioOverrides, compareScenario, runScenario, runSensitivityAnalysis } from "@/lib/lca/scenarios";
import { assessFlowDataQuality, assessStudyDataQuality, bandForScore } from "@/lib/lca/data-quality";

/**
 * Hotspots, scenarios, sensitivity and data quality — all of it computed
 * before any AI is involved, which is exactly why it can be tested this way.
 */

function factor(value: number, unit = "kg"): LcaFactorSnapshot {
  return {
    id: `factor-${value}`,
    value,
    unit,
    source: "Test publisher — Test set",
    vintage: "2026",
    category: "test",
    subtypeKey: null,
    region: "UK",
    isPlaceholder: false,
    sourceUrl: null,
  };
}

function flow(overrides: Partial<LcaFlowInput>): LcaFlowInput {
  return {
    id: "flow",
    name: "flow",
    direction: "INPUT",
    flowType: "MATERIAL",
    quantity: 1,
    unit: "kg",
    perFunctionalUnit: true,
    transportMassTonnes: null,
    transportDistanceKm: null,
    allocationPercent: 100,
    factor: factor(1),
    dataSource: null,
    dataType: null,
    geography: null,
    referenceYear: null,
    supplierName: null,
    dq: { reliability: null, completeness: null, temporal: null, geographical: null, technological: null },
    ...overrides,
  };
}

/** Materials 8 kg, electricity 2 kg, transport 0 — a clear single hotspot. */
const STUDY: LcaCalculationInput = {
  functionalUnitLabel: "1 inlay",
  referenceFlowQuantity: null,
  stages: [
    {
      id: "raw",
      key: "RAW_MATERIALS",
      name: "Raw materials",
      included: true,
      exclusionReason: null,
      processes: [
        {
          id: "p-raw",
          name: "Aluminium supply",
          flows: [flow({ id: "f-alu", name: "Aluminium", quantity: 4, factor: factor(2) })],
        },
      ],
    },
    {
      id: "mfg",
      key: "MANUFACTURING",
      name: "Manufacturing",
      included: true,
      exclusionReason: null,
      processes: [
        {
          id: "p-mfg",
          name: "Assembly",
          flows: [
            flow({
              id: "f-elec",
              name: "Grid electricity",
              flowType: "ELECTRICITY",
              quantity: 10,
              unit: "kWh",
              factor: factor(0.2, "kWh"),
              dataType: "PRIMARY",
              dq: { reliability: 1, completeness: 2, temporal: 1, geographical: 1, technological: 2 },
            }),
            flow({ id: "f-missing", name: "Process water", flowType: "WATER", quantity: 5, unit: "m3", factor: null }),
          ],
        },
      ],
    },
  ],
};

describe("analyseHotspots", () => {
  const result = calculateLca(STUDY);
  const hotspots = analyseHotspots(result);

  it("ranks stages by contribution, largest first", () => {
    expect(hotspots.byStage[0].label).toBe("Raw materials");
    expect(hotspots.byStage[0].kgCo2e).toBe(8);
    expect(hotspots.byStage[0].percentOfTotal).toBeCloseTo(80, 6);
    expect(hotspots.byStage[1].kgCo2e).toBe(2);
  });

  it("rolls up by process, flow type and material", () => {
    expect(hotspots.byProcess[0].label).toBe("Raw materials → Aluminium supply");
    expect(hotspots.byFlowType.find((t) => t.key === "ELECTRICITY")?.kgCo2e).toBe(2);
    expect(hotspots.byMaterial[0].label).toBe("Aluminium");
  });

  it("carries the count of flows with no figure alongside the ranking", () => {
    expect(hotspots.unmappedFlowCount).toBe(1);
    expect(hotspots.byFlowType.find((t) => t.key === "WATER")?.unmappedFlowCount).toBe(1);
  });

  it("says when coverage is too thin for a ranking to mean much", () => {
    const mostlyUnmapped = calculateLca({
      ...STUDY,
      stages: [
        {
          id: "s",
          key: "MANUFACTURING",
          name: "Manufacturing",
          included: true,
          exclusionReason: null,
          processes: [
            {
              id: "p",
              name: "Assembly",
              flows: [
                flow({ id: "a", factor: factor(1) }),
                flow({ id: "b", factor: null }),
                flow({ id: "c", factor: null }),
              ],
            },
          ],
        },
      ],
    });
    expect(analyseHotspots(mostlyUnmapped).coverageIsMeaningful).toBe(false);
    expect(analyseHotspots(calculateLca(STUDY)).coverageIsMeaningful).toBe(true);
  });
});

describe("scenarios", () => {
  const baseline = calculateLca(STUDY);

  it("does not mutate the baseline inventory when applying overrides", () => {
    const before = JSON.stringify(STUDY);
    applyScenarioOverrides(STUDY, [{ flowId: "f-alu", quantity: 1 }]);
    expect(JSON.stringify(STUDY)).toBe(before);
  });

  it("recalculates a quantity change through the same engine", () => {
    const scenario = runScenario(STUDY, [{ flowId: "f-alu", quantity: 2 }]);
    expect(scenario.totalKgCo2e).toBe(6);

    const comparison = compareScenario("Half the aluminium", baseline, scenario);
    expect(comparison.deltaKgCo2e).toBe(-4);
    expect(comparison.deltaPercent).toBeCloseTo(-40, 6);
    expect(comparison.isImprovement).toBe(true);
    expect(comparison.coverageChanged).toBe(false);
  });

  it("recalculates a swapped factor, e.g. moving to renewable electricity", () => {
    const scenario = runScenario(STUDY, [{ flowId: "f-elec", factor: factor(0, "kWh") }]);
    expect(scenario.totalKgCo2e).toBe(8);
    expect(compareScenario("Renewable electricity", baseline, scenario).deltaPercent).toBeCloseTo(-20, 6);
  });

  it("treats an excluded flow as a coverage change, so the delta gets caveated", () => {
    const scenario = runScenario(STUDY, [{ flowId: "f-missing", excluded: true }]);
    expect(compareScenario("Drop process water", baseline, scenario).coverageChanged).toBe(true);
  });

  it("recalculates a shortened transport leg", () => {
    const withTransport: LcaCalculationInput = {
      ...STUDY,
      stages: [
        {
          id: "t",
          key: "INBOUND_TRANSPORT",
          name: "Inbound transport",
          included: true,
          exclusionReason: null,
          processes: [
            {
              id: "pt",
              name: "Supplier to factory",
              flows: [
                flow({
                  id: "f-tr",
                  flowType: "TRANSPORT",
                  unit: "tonne.km",
                  quantity: 0,
                  transportMassTonnes: 1,
                  transportDistanceKm: 1000,
                  factor: factor(0.1, "tonne.km"),
                }),
              ],
            },
          ],
        },
      ],
    };
    const base = calculateLca(withTransport);
    expect(base.totalKgCo2e).toBeCloseTo(100, 6);

    const shorter = runScenario(withTransport, [{ flowId: "f-tr", transportDistanceKm: 400 }]);
    expect(shorter.totalKgCo2e).toBeCloseTo(40, 6);
  });

  it("passes no judgement on a change when the baseline is zero", () => {
    const empty = calculateLca({ functionalUnitLabel: null, referenceFlowQuantity: null, stages: [] });
    const comparison = compareScenario("anything", empty, empty);
    expect(comparison.deltaPercent).toBeNull();
    expect(comparison.isImprovement).toBeNull();
  });
});

describe("runSensitivityAnalysis", () => {
  it("ranks the inputs the total is most sensitive to", () => {
    const results = runSensitivityAnalysis(STUDY, 10);
    expect(results[0].flowId).toBe("f-alu");
    // Aluminium is 80% of the total, so +10% on it moves the total +8%.
    expect(results[0].elasticity).toBeCloseTo(0.8, 6);
    expect(results.find((r) => r.flowId === "f-elec")?.elasticity).toBeCloseTo(0.2, 6);
  });

  it("skips flows with no factor, which cannot move the total", () => {
    expect(runSensitivityAnalysis(STUDY, 10).some((r) => r.flowId === "f-missing")).toBe(false);
  });
});

describe("data quality", () => {
  it("bands a mean score, and reports unknown when nothing is scored", () => {
    expect(bandForScore(1.5)).toBe("HIGH");
    expect(bandForScore(3)).toBe("MEDIUM");
    expect(bandForScore(4.5)).toBe("LOW");
    expect(bandForScore(null)).toBe("UNKNOWN");
  });

  it("averages only the dimensions actually scored, and names the rest", () => {
    const assessment = assessFlowDataQuality({
      id: "f",
      name: "Aluminium",
      dataType: "SECONDARY",
      dq: { reliability: 2, completeness: 4, temporal: null, geographical: null, technological: null },
    });
    expect(assessment.averageScore).toBe(3);
    expect(assessment.scoredDimensions).toBe(2);
    expect(assessment.unscoredDimensions).toContain("temporal relevance");
    expect(assessment.isPrimaryData).toBe(false);
  });

  it("never treats an unscored flow as good quality", () => {
    const assessment = assessFlowDataQuality({
      id: "f",
      name: "Aluminium",
      dataType: null,
      dq: { reliability: null, completeness: null, temporal: null, geographical: null, technological: null },
    });
    expect(assessment.band).toBe("UNKNOWN");
    expect(assessment.averageScore).toBeNull();
    expect(assessment.isPrimaryData).toBeNull();
  });

  it("withholds a study-level band when most of the footprint is unassessed", () => {
    const result = calculateLca(STUDY);
    const flowsById = new Map(
      STUDY.stages.flatMap((s) => s.processes.flatMap((p) => p.flows.map((f) => [f.id, f] as const))),
    );
    const study = assessStudyDataQuality(result, flowsById);

    // Aluminium is 80% of the footprint and carries no scores at all.
    expect(study.weightedBand).toBe("UNKNOWN");
    expect(study.unassessedShareOfTotalPercent).toBeCloseTo(80, 4);
    expect(study.explanation).toMatch(/can't be summarised/);
  });

  it("gives a weighted band once the dominant flows are assessed", () => {
    const scored: LcaCalculationInput = {
      ...STUDY,
      stages: STUDY.stages.map((stage) => ({
        ...stage,
        processes: stage.processes.map((process) => ({
          ...process,
          flows: process.flows.map((f) =>
            f.id === "f-alu"
              ? { ...f, dataType: "PRIMARY" as const, dq: { reliability: 1, completeness: 1, temporal: 2, geographical: 1, technological: 2 } }
              : f,
          ),
        })),
      })),
    };
    const result = calculateLca(scored);
    const flowsById = new Map(
      scored.stages.flatMap((s) => s.processes.flatMap((p) => p.flows.map((f) => [f.id, f] as const))),
    );
    const assessment = assessStudyDataQuality(result, flowsById);

    expect(assessment.weightedBand).toBe("HIGH");
    expect(assessment.unassessedShareOfTotalPercent).toBe(0);
    // Both calculated flows in this study carry PRIMARY data.
    expect(assessment.primaryDataSharePercent).toBeCloseTo(100, 4);
  });
});

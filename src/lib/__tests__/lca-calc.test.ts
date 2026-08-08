import { describe, expect, it } from "vitest";
import {
  calculateFlow,
  calculateLca,
  LCA_ENGINE_VERSION,
  type LcaCalculationInput,
  type LcaFactorSnapshot,
  type LcaFlowInput,
} from "@/lib/lca/calc";

/**
 * The LCA engine, exercised directly. The behaviours that matter are the ones
 * where being "helpful" would be wrong: an unmapped flow is not zero, a unit
 * mismatch is not silently converted, and a product output is not counted as
 * an impact.
 */

function factor(overrides: Partial<LcaFactorSnapshot> = {}): LcaFactorSnapshot {
  return {
    id: "factor-1",
    value: 2,
    unit: "kg",
    source: "Test publisher — Test set",
    vintage: "2026",
    category: "material_aluminium",
    subtypeKey: null,
    region: "UK",
    isPlaceholder: false,
    sourceUrl: null,
    ...overrides,
  };
}

function flow(overrides: Partial<LcaFlowInput> = {}): LcaFlowInput {
  return {
    id: "flow-1",
    name: "Aluminium foil",
    direction: "INPUT",
    flowType: "MATERIAL",
    quantity: 3,
    unit: "kg",
    perFunctionalUnit: true,
    transportMassTonnes: null,
    transportDistanceKm: null,
    allocationPercent: 100,
    factor: factor(),
    dataSource: null,
    dataType: null,
    geography: null,
    referenceYear: null,
    supplierName: null,
    dq: { reliability: null, completeness: null, temporal: null, geographical: null, technological: null },
    ...overrides,
  };
}

function study(flows: LcaFlowInput[], referenceFlowQuantity: number | null = null): LcaCalculationInput {
  return {
    functionalUnitLabel: "1 unit",
    referenceFlowQuantity,
    stages: [
      {
        id: "stage-1",
        key: "MANUFACTURING",
        name: "Manufacturing",
        included: true,
        exclusionReason: null,
        processes: [{ id: "process-1", name: "Assembly", flows }],
      },
    ],
  };
}

describe("calculateFlow", () => {
  it("multiplies quantity by the mapped factor", () => {
    const result = calculateFlow(flow(), null);
    expect(result.status).toBe("CALCULATED");
    expect(result.kgCo2e).toBe(6);
    expect(result.equation).toContain("3 kg");
    expect(result.equation).toContain("2 kgCO2e/kg");
  });

  it("applies an allocation share and records it in the equation", () => {
    const result = calculateFlow(flow({ allocationPercent: 40 }), null);
    expect(result.kgCo2e).toBeCloseTo(2.4, 8);
    expect(result.equation).toContain("40% allocation");
  });

  it("reports a flow with no factor as unknown, not zero", () => {
    const result = calculateFlow(flow({ factor: null }), null);
    expect(result.status).toBe("NO_FACTOR");
    expect(result.kgCo2e).toBeNull();
    expect(result.statusReason).toMatch(/not zero — it is unknown/);
  });

  it("refuses to convert between mismatched units", () => {
    const result = calculateFlow(flow({ unit: "tonnes" }), null);
    expect(result.status).toBe("UNIT_MISMATCH");
    expect(result.kgCo2e).toBeNull();
    expect(result.statusReason).toMatch(/will not convert/);
  });

  it("computes tonne-kilometres from mass and distance rather than trusting a pre-multiplied figure", () => {
    const result = calculateFlow(
      flow({
        flowType: "TRANSPORT",
        name: "Supplier to factory",
        quantity: 0,
        unit: "tonne.km",
        transportMassTonnes: 2,
        transportDistanceKm: 150,
        factor: factor({ unit: "tonne.km", value: 0.1 }),
      }),
      null,
    );
    expect(result.status).toBe("CALCULATED");
    expect(result.effectiveQuantity).toBe(300);
    expect(result.kgCo2e).toBeCloseTo(30, 8);
    expect(result.equation).toContain("2 t × 150 km");
  });

  it("reports a half-specified transport flow rather than half-calculating it", () => {
    const result = calculateFlow(
      flow({ flowType: "TRANSPORT", unit: "tonne.km", transportMassTonnes: 2, transportDistanceKm: null }),
      null,
    );
    expect(result.status).toBe("INCOMPLETE_TRANSPORT");
    expect(result.kgCo2e).toBeNull();
  });

  it("normalises a per-reference-flow quantity by the reference flow", () => {
    const result = calculateFlow(flow({ perFunctionalUnit: false, quantity: 3000 }), 1000);
    expect(result.effectiveQuantity).toBe(3);
    expect(result.kgCo2e).toBe(6);
    expect(result.equation).toContain("÷ 1000 functional units");
  });

  it("refuses to normalise when no reference flow quantity is recorded", () => {
    const result = calculateFlow(flow({ perFunctionalUnit: false, quantity: 3000 }), null);
    expect(result.status).toBe("MISSING_REFERENCE_FLOW");
    expect(result.kgCo2e).toBeNull();
  });

  it("treats product and co-product outputs as flows that carry no impact", () => {
    for (const flowType of ["PRODUCT", "CO_PRODUCT"] as const) {
      const result = calculateFlow(flow({ direction: "OUTPUT", flowType }), null);
      expect(result.status).toBe("NOT_AN_IMPACT");
      expect(result.kgCo2e).toBeNull();
    }
  });

  it("counts waste and direct-emission outputs, which do carry a factor", () => {
    const waste = calculateFlow(
      flow({ direction: "OUTPUT", flowType: "WASTE", name: "Offcuts", factor: factor({ value: 0.5 }) }),
      null,
    );
    expect(waste.status).toBe("CALCULATED");
    expect(waste.kgCo2e).toBeCloseTo(1.5, 8);
  });

  it("does not calculate a flow in an excluded stage", () => {
    const result = calculateFlow(flow(), null, false);
    expect(result.status).toBe("STAGE_EXCLUDED");
    expect(result.kgCo2e).toBeNull();
  });

  it("handles a zero quantity as a real zero", () => {
    const result = calculateFlow(flow({ quantity: 0 }), null);
    expect(result.status).toBe("CALCULATED");
    expect(result.kgCo2e).toBe(0);
  });
});

describe("calculateLca", () => {
  it("sums stages and processes into a product total", () => {
    const result = calculateLca(study([flow(), flow({ id: "flow-2", quantity: 1 })]));
    expect(result.totalKgCo2e).toBe(8);
    expect(result.stages[0].kgCo2e).toBe(8);
    expect(result.stages[0].processes[0].kgCo2e).toBe(8);
    expect(result.calculatedFlowCount).toBe(2);
    expect(result.engineVersion).toBe(LCA_ENGINE_VERSION);
  });

  it("counts and surfaces every flow that produced no figure", () => {
    const result = calculateLca(study([flow(), flow({ id: "flow-2", factor: null })]));
    expect(result.totalKgCo2e).toBe(6);
    expect(result.unmappedFlowCount).toBe(1);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].status).toBe("NO_FACTOR");
  });

  it("excludes an out-of-boundary stage from the total without deleting it", () => {
    const input = study([flow()]);
    input.stages.push({
      id: "stage-2",
      key: "USE",
      name: "Use",
      included: false,
      exclusionReason: "Outside the cradle-to-gate boundary",
      processes: [{ id: "process-2", name: "In service", flows: [flow({ id: "flow-9", quantity: 100 })] }],
    });

    const result = calculateLca(input);
    expect(result.totalKgCo2e).toBe(6);
    expect(result.stages).toHaveLength(2);
    expect(result.stages[1].kgCo2e).toBe(0);
    expect(result.stages[1].processes[0].flows[0].status).toBe("STAGE_EXCLUDED");
    // An excluded stage's flows are not "gaps" — they are a stated exclusion.
    expect(result.unmappedFlowCount).toBe(0);
  });

  it("is deterministic — the same input gives the same output every time", () => {
    const input = study([flow(), flow({ id: "flow-2", quantity: 1.37, factor: factor({ value: 0.4567 }) })]);
    const a = calculateLca(input);
    const b = calculateLca(input);
    expect(a.totalKgCo2e).toBe(b.totalKgCo2e);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces a zero total, not a crash, for an empty study", () => {
    const result = calculateLca({ functionalUnitLabel: null, referenceFlowQuantity: null, stages: [] });
    expect(result.totalKgCo2e).toBe(0);
    expect(result.calculatedFlowCount).toBe(0);
  });
});

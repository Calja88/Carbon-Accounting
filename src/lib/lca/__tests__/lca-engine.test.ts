import { describe, expect, it } from "vitest";
import {
  LcaAllocationMethod,
  LcaBiogenicTreatment,
  LcaBoundary,
  LcaDataType,
  LcaEmissionClassification,
  LcaEndOfLifeRouteType,
  LcaFactorBoundary,
  LcaFactorSelectionMode,
  LcaItemType,
  LcaLifecycleStage,
  LcaOffsetTreatment,
  LcaRecyclingMethod,
  LcaTransportMode,
} from "@prisma/client";
import { calculateAssessment, resolveFunctionalUnits } from "@/lib/lca/engine/engine";
import type {
  EngineAssessment,
  EngineFactor,
  EngineInventoryItem,
  EngineProcess,
} from "@/lib/lca/engine/types";
import { D } from "@/lib/lca/decimal";
import { FALLBACK_METHODOLOGY, type MethodologyConfig } from "@/lib/lca/methodology";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function factor(value: number | string, unit: string, overrides: Partial<EngineFactor> = {}): EngineFactor {
  return {
    emissionFactorId: "factor-1",
    selectionMode: LcaFactorSelectionMode.LIBRARY_FACTOR,
    value: D(value),
    unit,
    source: "Test factor library",
    version: "2026",
    boundary: LcaFactorBoundary.CRADLE_TO_GATE,
    geography: "UK",
    year: 2026,
    gwpBasis: "IPCC AR6 GWP100",
    isPlaceholder: false,
    uncertaintyPercent: null,
    ...overrides,
  };
}

function process(overrides: Partial<EngineProcess> = {}): EngineProcess {
  return {
    id: "process-1",
    parentProcessId: null,
    stage: LcaLifecycleStage.RAW_MATERIALS,
    name: "Test process",
    isIncluded: true,
    allocationMethod: LcaAllocationMethod.NONE,
    allocationPercent: D(100),
    allocationRationale: null,
    outputs: [],
    ...overrides,
  };
}

function item(overrides: Partial<EngineInventoryItem> = {}): EngineInventoryItem {
  return {
    id: "item-1",
    processId: "process-1",
    itemType: LcaItemType.MATERIAL,
    name: "Test material",
    classification: LcaEmissionClassification.FOSSIL,
    quantity: D(1),
    unit: "kg",
    adjustmentFactor: D(1),
    adjustmentRationale: null,
    wastePercent: null,
    recycledContentPercent: null,
    dataType: LcaDataType.PRIMARY,
    supplierName: null,
    materialName: null,
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
    ...overrides,
  };
}

function assessment(overrides: Partial<EngineAssessment> = {}, methodology: Partial<MethodologyConfig> = {}): EngineAssessment {
  return {
    id: "assessment-1",
    reference: "PCF-TEST-001",
    title: "Test assessment",
    functionalUnit: {
      description: "1 unit of product",
      quantity: D(1),
      unit: "item",
      isDeclaredUnit: false,
      declaredUnitDescription: null,
      referenceFlowDescription: null,
      referenceFlowQuantity: D(1),
      referenceFlowUnit: "item",
      modelledOutputQuantity: D(1),
      modelledOutputUnit: "item",
    },
    methodology: { ...FALLBACK_METHODOLOGY, ...methodology },
    processes: [process()],
    items: [item()],
    ...overrides,
  };
}

function totalOf(output: ReturnType<typeof calculateAssessment>): number {
  return output.rows.reduce((sum, r) => sum + r.allocatedKgCo2e.toNumber(), 0);
}

// ---------------------------------------------------------------------------
// Known-answer checks
// ---------------------------------------------------------------------------

describe("material emissions", () => {
  it("10 kg x 2 kgCO2e/kg = 20 kgCO2e", () => {
    const output = calculateAssessment(
      assessment({ items: [item({ quantity: D(10), unit: "kg", factor: factor(2, "kg") })] }),
    );

    expect(output.rows).toHaveLength(1);
    expect(output.rows[0].grossKgCo2e.toNumber()).toBe(20);
    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(20);
    expect(output.totals.model.fossil.toNumber()).toBe(20);
  });

  it("converts a tonne to kilograms before applying a per-kg factor: 1 t x 2 kgCO2e/kg = 2,000 kgCO2e", () => {
    const output = calculateAssessment(
      assessment({ items: [item({ quantity: D(1), unit: "t", factor: factor(2, "kg") })] }),
    );

    expect(output.rows[0].conversionFactor.toNumber()).toBe(1000);
    expect(output.rows[0].normalizedValue.toNumber()).toBe(1000);
    expect(output.rows[0].normalizedUnit).toBe("kg");
    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(2000);
  });

  it("keeps precision that float arithmetic would lose", () => {
    // 0.1 + 0.2 !== 0.3 in float64; three lines of 0.1 kg must total exactly 0.3 kgCO2e.
    const output = calculateAssessment(
      assessment({
        items: [
          item({ id: "a", quantity: D("0.1"), factor: factor(1, "kg") }),
          item({ id: "b", quantity: D("0.2"), factor: factor(1, "kg") }),
        ],
      }),
    );

    expect(output.totals.model.fossil.toString()).toBe("0.3");
  });

  it("reports a diagnostic instead of a figure when no factor is assigned", () => {
    const output = calculateAssessment(assessment({ items: [item({ factor: null })] }));

    expect(output.rows).toHaveLength(0);
    expect(output.diagnostics.map((d) => d.code)).toContain("NO_FACTOR");
  });

  it("refuses to multiply an energy factor by a mass quantity", () => {
    const output = calculateAssessment(
      assessment({ items: [item({ quantity: D(10), unit: "kg", factor: factor(0.2, "kWh") })] }),
    );

    expect(output.rows).toHaveLength(0);
    const diagnostic = output.diagnostics.find((d) => d.code === "INCOMPATIBLE_UNIT");
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.severity).toBe("error");
  });
});

describe("energy, fuel and manufacturing emissions", () => {
  it("prices electricity per kWh, converting from MWh", () => {
    const output = calculateAssessment(
      assessment({
        items: [
          item({
            itemType: LcaItemType.ENERGY,
            quantity: D(2),
            unit: "MWh",
            factor: factor("0.2", "kWh"),
          }),
        ],
      }),
    );

    // 2 MWh = 2,000 kWh; 2,000 x 0.2 = 400 kgCO2e
    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(400);
  });

  it("prices fuel per litre", () => {
    const output = calculateAssessment(
      assessment({
        items: [item({ itemType: LcaItemType.FUEL, quantity: D(150), unit: "l", factor: factor("2.5", "l") })],
      }),
    );

    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(375);
  });
});

describe("manufacturing loss and adjustment factors", () => {
  it("grosses the input up for a 10% loss: 9 kg out needs 10 kg in", () => {
    const output = calculateAssessment(
      assessment({
        items: [item({ quantity: D(9), unit: "kg", wastePercent: D(10), factor: factor(1, "kg") })],
      }),
    );

    expect(output.rows[0].normalizedValue.toNumber()).toBe(10);
    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(10);
  });

  it("rejects a loss of 100% or more rather than dividing by zero", () => {
    const output = calculateAssessment(
      assessment({ items: [item({ quantity: D(10), wastePercent: D(100), factor: factor(1, "kg") })] }),
    );

    expect(output.diagnostics.map((d) => d.code)).toContain("INVALID_WASTE_PERCENT");
    // The quantity is used unmodified rather than the line being dropped.
    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(10);
  });

  it("applies an adjustment factor as its own provenance step", () => {
    const output = calculateAssessment(
      assessment({
        items: [
          item({
            itemType: LcaItemType.USE_PHASE,
            quantity: D(5),
            unit: "kWh",
            adjustmentFactor: D(1000),
            adjustmentRationale: "200 washes a year over 5 years",
            factor: factor("0.2", "kWh"),
          }),
        ],
      }),
    );

    // 5 kWh x 1,000 uses x 0.2 = 1,000 kgCO2e
    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(1000);
    expect(output.rows[0].provenance.some((s) => s.label === "Adjustment")).toBe(true);
  });
});

describe("allocation", () => {
  it("manual: a 100 kgCO2e process result at 40% allocation gives 40 kgCO2e", () => {
    const output = calculateAssessment(
      assessment({
        processes: [
          process({
            allocationMethod: LcaAllocationMethod.MANUAL,
            allocationPercent: D(40),
            allocationRationale: "Agreed split with production",
          }),
        ],
        items: [item({ quantity: D(100), unit: "kg", factor: factor(1, "kg") })],
      }),
    );

    expect(output.rows[0].grossKgCo2e.toNumber()).toBe(100);
    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(40);
    expect(output.rows[0].allocationFactor.toNumber()).toBe(0.4);
  });

  it("mass: derives the split from recorded output masses", () => {
    const output = calculateAssessment(
      assessment({
        processes: [
          process({
            allocationMethod: LcaAllocationMethod.MASS,
            outputs: [
              { id: "o1", name: "Assessed product", isAssessedProduct: true, massValue: D(300), massUnit: "kg", physicalValue: null, physicalUnit: null, economicValue: null, economicCurrency: null, manualPercent: null },
              { id: "o2", name: "Co-product", isAssessedProduct: false, massValue: D(700), massUnit: "kg", physicalValue: null, physicalUnit: null, economicValue: null, economicCurrency: null, manualPercent: null },
            ],
          }),
        ],
        items: [item({ quantity: D(1000), unit: "kg", factor: factor(1, "kg") })],
      }),
    );

    expect(output.rows[0].allocationFactor.toNumber()).toBe(0.3);
    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(300);
  });

  it("mass: converts output units before splitting", () => {
    const output = calculateAssessment(
      assessment({
        processes: [
          process({
            allocationMethod: LcaAllocationMethod.MASS,
            outputs: [
              { id: "o1", name: "Assessed", isAssessedProduct: true, massValue: D(1), massUnit: "t", physicalValue: null, physicalUnit: null, economicValue: null, economicCurrency: null, manualPercent: null },
              { id: "o2", name: "Co-product", isAssessedProduct: false, massValue: D(1000), massUnit: "kg", physicalValue: null, physicalUnit: null, economicValue: null, economicCurrency: null, manualPercent: null },
            ],
          }),
        ],
        items: [item({ quantity: D(100), unit: "kg", factor: factor(1, "kg") })],
      }),
    );

    expect(output.rows[0].allocationFactor.toNumber()).toBe(0.5);
  });

  it("economic: splits on output value", () => {
    const output = calculateAssessment(
      assessment({
        processes: [
          process({
            allocationMethod: LcaAllocationMethod.ECONOMIC,
            outputs: [
              { id: "o1", name: "Assessed", isAssessedProduct: true, massValue: null, massUnit: null, physicalValue: null, physicalUnit: null, economicValue: D(8000), economicCurrency: "GBP", manualPercent: null },
              { id: "o2", name: "Co-product", isAssessedProduct: false, massValue: null, massUnit: null, physicalValue: null, physicalUnit: null, economicValue: D(2000), economicCurrency: "GBP", manualPercent: null },
            ],
          }),
        ],
        items: [item({ quantity: D(100), unit: "kg", factor: factor(1, "kg") })],
      }),
    );

    expect(output.rows[0].allocationFactor.toNumber()).toBe(0.8);
    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(80);
  });

  it("physical: splits on a non-mass physical quantity", () => {
    const output = calculateAssessment(
      assessment({
        processes: [
          process({
            allocationMethod: LcaAllocationMethod.PHYSICAL,
            outputs: [
              { id: "o1", name: "Assessed", isAssessedProduct: true, massValue: null, massUnit: null, physicalValue: D(250), physicalUnit: "m2", economicValue: null, economicCurrency: null, manualPercent: null },
              { id: "o2", name: "Co-product", isAssessedProduct: false, massValue: null, massUnit: null, physicalValue: D(750), physicalUnit: "m2", economicValue: null, economicCurrency: null, manualPercent: null },
            ],
          }),
        ],
        items: [item({ quantity: D(100), unit: "kg", factor: factor(1, "kg") })],
      }),
    );

    expect(output.rows[0].allocationFactor.toNumber()).toBe(0.25);
  });

  it("cascades allocation through nested processes", () => {
    const parent = process({
      id: "parent",
      name: "Manufacturing",
      allocationMethod: LcaAllocationMethod.MANUAL,
      allocationPercent: D(50),
      allocationRationale: "Half the line's output is the assessed product",
    });
    const child = process({
      id: "child",
      parentProcessId: "parent",
      name: "Moulding",
      stage: LcaLifecycleStage.MANUFACTURING,
      allocationMethod: LcaAllocationMethod.MANUAL,
      allocationPercent: D(40),
      allocationRationale: "40% of moulding time",
    });

    const output = calculateAssessment(
      assessment({
        processes: [parent, child],
        items: [item({ processId: "child", quantity: D(100), unit: "kg", factor: factor(1, "kg") })],
      }),
    );

    // 100 kgCO2e x 40% x 50% = 20 kgCO2e
    expect(output.rows[0].allocationFactor.toNumber()).toBe(0.2);
    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(20);
  });

  it("attributes everything to the product and reports the problem when a split cannot be derived", () => {
    const output = calculateAssessment(
      assessment({
        processes: [
          process({
            allocationMethod: LcaAllocationMethod.MASS,
            outputs: [
              { id: "o1", name: "Assessed", isAssessedProduct: true, massValue: null, massUnit: null, physicalValue: null, physicalUnit: null, economicValue: null, economicCurrency: null, manualPercent: null },
            ],
          }),
        ],
        items: [item({ quantity: D(100), unit: "kg", factor: factor(1, "kg") })],
      }),
    );

    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(100);
    expect(output.diagnostics.map((d) => d.code)).toContain("ALLOCATION_UNRESOLVED");
  });
});

describe("functional unit normalisation", () => {
  it("1,000 kgCO2e of production emissions over 500 products = 2 kgCO2e per product", () => {
    const base = assessment({
      items: [item({ quantity: D(1000), unit: "kg", factor: factor(1, "kg") })],
    });
    base.functionalUnit.modelledOutputQuantity = D(500);
    base.functionalUnit.modelledOutputUnit = "item";

    const output = calculateAssessment(base);

    expect(output.totals.functionalUnitsInModel.toNumber()).toBe(500);
    expect(output.totals.model.fossil.toNumber()).toBe(1000);
    expect(output.totals.headlinePerFunctionalUnitKgCo2e.toNumber()).toBe(2);
    expect(output.rows[0].perFunctionalUnitKgCo2e.toNumber()).toBe(2);
  });

  it("handles a reference flow greater than one product per functional unit", () => {
    const base = assessment({ items: [item({ quantity: D(1000), unit: "kg", factor: factor(1, "kg") })] });
    base.functionalUnit.modelledOutputQuantity = D(500);
    base.functionalUnit.modelledOutputUnit = "item";
    // Two units are consumed to deliver one functional unit.
    base.functionalUnit.referenceFlowQuantity = D(2);
    base.functionalUnit.referenceFlowUnit = "item";

    const output = calculateAssessment(base);

    expect(output.totals.functionalUnitsInModel.toNumber()).toBe(250);
    expect(output.totals.headlinePerFunctionalUnitKgCo2e.toNumber()).toBe(4);
  });

  it("converts between comparable units when resolving the functional unit", () => {
    const base = assessment();
    base.functionalUnit.modelledOutputQuantity = D(2);
    base.functionalUnit.modelledOutputUnit = "t";
    base.functionalUnit.referenceFlowQuantity = D(1);
    base.functionalUnit.referenceFlowUnit = "kg";

    const resolution = resolveFunctionalUnits(base);

    expect(resolution.resolved).toBe(true);
    expect(resolution.functionalUnitsInModel.toNumber()).toBe(2000);
  });

  it("reports an unresolvable functional unit rather than inventing a divisor", () => {
    const base = assessment();
    base.functionalUnit.modelledOutputQuantity = D(500);
    base.functionalUnit.modelledOutputUnit = "kWh";
    base.functionalUnit.referenceFlowUnit = "item";

    const output = calculateAssessment(base);

    expect(output.totals.functionalUnitResolved).toBe(false);
    expect(output.totals.headlinePerFunctionalUnitKgCo2e.toNumber()).toBe(0);
    expect(output.diagnostics.map((d) => d.code)).toContain("NO_FUNCTIONAL_UNIT");
  });
});

describe("freight", () => {
  const transportItem = (overrides = {}) =>
    item({
      itemType: LcaItemType.TRANSPORT,
      name: "Inbound freight",
      quantity: D(1),
      unit: "item",
      transportLegs: [
        {
          id: "leg-1",
          sequence: 0,
          mode: LcaTransportMode.ROAD,
          modeDescription: null,
          originName: "Supplier",
          destinationName: "Factory",
          distanceValue: D(500),
          distanceUnit: "km",
          massValue: D(2000),
          massUnit: "kg",
          loadFactorPercent: null,
          includesReturnTrip: false,
          factor: factor("0.1", "t.km", { boundary: LcaFactorBoundary.WELL_TO_WHEEL }),
          assumptions: null,
        },
      ],
      ...overrides,
    });

  it("2 t carried 500 km = 1,000 t.km; at 0.1 kgCO2e/t.km = 100 kgCO2e", () => {
    const output = calculateAssessment(assessment({ items: [transportItem()] }));

    expect(output.rows).toHaveLength(1);
    expect(output.rows[0].activityValue.toNumber()).toBe(1000);
    expect(output.rows[0].activityUnit).toBe("t.km");
    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(100);
  });

  it("converts miles to kilometres in the tonne-kilometre calculation", () => {
    const legs = [
      {
        id: "leg-1",
        sequence: 0,
        mode: LcaTransportMode.ROAD,
        modeDescription: null,
        originName: null,
        destinationName: null,
        distanceValue: D(100),
        distanceUnit: "mi",
        massValue: D(1),
        massUnit: "t",
        loadFactorPercent: null,
        includesReturnTrip: false,
        factor: factor(1, "t.km"),
        assumptions: null,
      },
    ];
    const output = calculateAssessment(assessment({ items: [transportItem({ transportLegs: legs })] }));

    // 100 miles = 160.9344 km; 1 t x 160.9344 km = 160.9344 t.km
    expect(output.rows[0].activityValue.toString()).toBe("160.9344");
    expect(output.rows[0].allocatedKgCo2e.toString()).toBe("160.9344");
  });

  it("doubles the distance when the return trip is included", () => {
    const legs = [
      {
        id: "leg-1",
        sequence: 0,
        mode: LcaTransportMode.ROAD,
        modeDescription: null,
        originName: null,
        destinationName: null,
        distanceValue: D(500),
        distanceUnit: "km",
        massValue: D(2000),
        massUnit: "kg",
        loadFactorPercent: null,
        includesReturnTrip: true,
        factor: factor("0.1", "t.km"),
        assumptions: null,
      },
    ];
    const output = calculateAssessment(assessment({ items: [transportItem({ transportLegs: legs })] }));

    expect(output.rows[0].activityValue.toNumber()).toBe(2000);
    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(200);
  });

  it("sums a multimodal chain leg by leg", () => {
    const legs = [
      {
        id: "leg-1",
        sequence: 0,
        mode: LcaTransportMode.SEA,
        modeDescription: null,
        originName: "Shanghai",
        destinationName: "Felixstowe",
        distanceValue: D(19000),
        distanceUnit: "km",
        massValue: D(1),
        massUnit: "t",
        loadFactorPercent: null,
        includesReturnTrip: false,
        factor: factor("0.01", "t.km"),
        assumptions: null,
      },
      {
        id: "leg-2",
        sequence: 1,
        mode: LcaTransportMode.ROAD,
        modeDescription: null,
        originName: "Felixstowe",
        destinationName: "Hull",
        distanceValue: D(400),
        distanceUnit: "km",
        massValue: D(1),
        massUnit: "t",
        loadFactorPercent: null,
        includesReturnTrip: false,
        factor: factor("0.1", "t.km"),
        assumptions: null,
      },
    ];
    const output = calculateAssessment(assessment({ items: [transportItem({ transportLegs: legs })] }));

    expect(output.rows).toHaveLength(2);
    // 19,000 x 0.01 = 190; 400 x 0.1 = 40; total 230
    expect(totalOf(output)).toBe(230);
  });

  it("applies the consignment's share of the vehicle when the factor is per vehicle-kilometre", () => {
    const legs = [
      {
        id: "leg-1",
        sequence: 0,
        mode: LcaTransportMode.ROAD,
        modeDescription: null,
        originName: null,
        destinationName: null,
        distanceValue: D(200),
        distanceUnit: "km",
        massValue: D(1),
        massUnit: "t",
        loadFactorPercent: D(25),
        includesReturnTrip: false,
        factor: factor("0.8", "km", { boundary: LcaFactorBoundary.WELL_TO_WHEEL }),
        assumptions: null,
      },
    ];
    const output = calculateAssessment(assessment({ items: [transportItem({ transportLegs: legs })] }));

    // 200 km x 25% = 50 vehicle-km attributed; x 0.8 = 40 kgCO2e
    expect(output.rows[0].activityValue.toNumber()).toBe(50);
    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(40);
  });

  it("does not apply a load factor to a tonne-kilometre factor, and says so", () => {
    const legs = [
      {
        id: "leg-1",
        sequence: 0,
        mode: LcaTransportMode.ROAD,
        modeDescription: null,
        originName: null,
        destinationName: null,
        distanceValue: D(100),
        distanceUnit: "km",
        massValue: D(1),
        massUnit: "t",
        loadFactorPercent: D(50),
        includesReturnTrip: false,
        factor: factor(1, "t.km"),
        assumptions: null,
      },
    ];
    const output = calculateAssessment(assessment({ items: [transportItem({ transportLegs: legs })] }));

    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(100);
    const methodologyStep = output.rows[0].provenance.find((s) => s.label === "Methodology");
    expect(methodologyStep?.detail).toContain("load factor");
  });
});

describe("recycled content", () => {
  it("splits the quantity between virgin and recycled factors", () => {
    const output = calculateAssessment(
      assessment({
        items: [
          item({
            quantity: D(100),
            unit: "kg",
            recycledContentPercent: D(30),
            factor: factor(2, "kg"),
            recycledFactor: factor("0.5", "kg", { emissionFactorId: "recycled-factor" }),
          }),
        ],
      }),
    );

    expect(output.rows).toHaveLength(2);
    // 70 kg x 2 = 140; 30 kg x 0.5 = 15; total 155
    expect(totalOf(output)).toBe(155);
  });

  it("records recycled content as a disclosure when no recycled factor is assigned, without discounting", () => {
    const output = calculateAssessment(
      assessment({
        items: [item({ quantity: D(100), unit: "kg", recycledContentPercent: D(30), factor: factor(2, "kg") })],
      }),
    );

    expect(output.rows).toHaveLength(1);
    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(200);
    const methodologyStep = output.rows[0].provenance.find((s) => s.label === "Methodology");
    expect(methodologyStep?.detail).toContain("disclosed, not discounted");
  });
});

describe("end of life", () => {
  const eolItem = (routes: EngineInventoryItem["endOfLifeRoutes"] = []) =>
    item({
      itemType: LcaItemType.END_OF_LIFE,
      name: "Product at end of life",
      quantity: D(100),
      unit: "kg",
      factor: null,
      endOfLifeRoutes: routes,
    });

  const route = (
    id: string,
    routeType: LcaEndOfLifeRouteType,
    percent: number,
    factorValue: number,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    route: routeType,
    routeDescription: null,
    percent: D(percent),
    factor: factor(factorValue, "kg", { boundary: LcaFactorBoundary.END_OF_LIFE }),
    recoveryRatePercent: null,
    avoidedFactorValue: null,
    avoidedFactorUnit: null,
    avoidedFactorSource: null,
    recoveryAssumptions: null,
    ...extra,
  });

  it("splits the mass across routes by percentage", () => {
    const output = calculateAssessment(
      assessment({
        items: [
          eolItem([
            route("r1", LcaEndOfLifeRouteType.LANDFILL, 60, 1),
            route("r2", LcaEndOfLifeRouteType.RECYCLING, 30, "0.2" as unknown as number),
            route("r3", LcaEndOfLifeRouteType.INCINERATION_ENERGY_RECOVERY, 10, 2),
          ]),
        ],
      }),
    );

    // 60 kg x 1 + 30 kg x 0.2 + 10 kg x 2 = 60 + 6 + 20 = 86
    expect(output.rows).toHaveLength(3);
    expect(totalOf(output)).toBe(86);
  });

  it("ignores an avoided-burden credit under a cut-off methodology, and explains why", () => {
    const output = calculateAssessment(
      assessment(
        {
          items: [
            eolItem([
              route("r1", LcaEndOfLifeRouteType.RECYCLING, 100, "0.2" as unknown as number, {
                avoidedFactorValue: D(1.5),
                avoidedFactorUnit: "kg",
                avoidedFactorSource: "Test avoided-burden source",
                recoveryRatePercent: D(90),
              }),
            ]),
          ],
        },
        { recyclingMethod: LcaRecyclingMethod.CUT_OFF },
      ),
    );

    expect(output.rows).toHaveLength(1);
    expect(totalOf(output)).toBe(20);
    expect(output.diagnostics.some((d) => d.message.includes("has not been applied"))).toBe(true);
  });

  it("applies an avoided-burden credit as its own class under an avoided-burden methodology", () => {
    const output = calculateAssessment(
      assessment(
        {
          items: [
            eolItem([
              route("r1", LcaEndOfLifeRouteType.RECYCLING, 100, "0.2" as unknown as number, {
                avoidedFactorValue: D(1.5),
                avoidedFactorUnit: "kg",
                avoidedFactorSource: "Test avoided-burden source",
                recoveryRatePercent: D(90),
              }),
            ]),
          ],
        },
        { recyclingMethod: LcaRecyclingMethod.AVOIDED_BURDEN },
      ),
    );

    expect(output.rows).toHaveLength(2);
    // Treatment: 100 kg x 0.2 = 20. Credit: 100 kg x 90% recovered x 1.5 = -135.
    expect(output.totals.model.fossil.toNumber()).toBe(20);
    expect(output.totals.model.avoidedBurden.toNumber()).toBe(-135);
  });
});

describe("carbon classification", () => {
  it("keeps biogenic removals out of the fossil total and out of the headline by default", () => {
    const output = calculateAssessment(
      assessment({
        items: [
          item({
            name: "Kraft paper",
            quantity: D(10),
            unit: "kg",
            factor: factor(1, "kg"),
            biogenicUptakePerUnit: D("1.5"),
          }),
        ],
      }),
    );

    expect(output.totals.model.fossil.toNumber()).toBe(10);
    expect(output.totals.model.biogenicRemovals.toNumber()).toBe(-15);
    // Default methodology reports biogenic separately, so the headline is fossil only.
    expect(output.totals.headlineModelKgCo2e.toNumber()).toBe(10);
    expect(output.totals.includingBiogenicPerFunctionalUnitKgCo2e.toNumber()).toBe(-5);
  });

  it("includes biogenic terms in the headline when the methodology says to", () => {
    const output = calculateAssessment(
      assessment(
        {
          items: [
            item({ quantity: D(10), unit: "kg", factor: factor(1, "kg"), biogenicUptakePerUnit: D("0.4") }),
          ],
        },
        { biogenicTreatment: LcaBiogenicTreatment.INCLUDED_IN_TOTAL },
      ),
    );

    expect(output.totals.headlineModelKgCo2e.toNumber()).toBe(6);
  });

  it("drops biogenic tracking entirely when the methodology excludes it", () => {
    const output = calculateAssessment(
      assessment(
        { items: [item({ quantity: D(10), unit: "kg", factor: factor(1, "kg"), biogenicUptakePerUnit: D(2) })] },
        { biogenicTreatment: LcaBiogenicTreatment.EXCLUDED },
      ),
    );

    expect(output.rows).toHaveLength(1);
    expect(output.totals.model.biogenicRemovals.toNumber()).toBe(0);
  });

  it("carries stored carbon as a memo that never reduces the footprint", () => {
    const output = calculateAssessment(
      assessment({
        items: [item({ quantity: D(10), unit: "kg", factor: factor(1, "kg"), storedCarbonPerUnit: D("0.9") })],
      }),
    );

    expect(output.totals.model.storedCarbon.toNumber()).toBe(9);
    expect(output.totals.headlineModelKgCo2e.toNumber()).toBe(10);
  });

  it("never lets an offset reduce the gross footprint", () => {
    const output = calculateAssessment(
      assessment({
        items: [
          item({ id: "material", quantity: D(100), unit: "kg", factor: factor(1, "kg") }),
          item({
            id: "offset",
            name: "Purchased carbon credits",
            classification: LcaEmissionClassification.OFFSET,
            quantity: D(50),
            unit: "kg",
            factor: factor(1, "kg"),
          }),
        ],
      }),
    );

    expect(output.totals.model.fossil.toNumber()).toBe(100);
    expect(output.totals.model.offsets.toNumber()).toBe(50);
    expect(output.totals.headlineModelKgCo2e.toNumber()).toBe(100);
  });

  it("omits offsets entirely when the methodology excludes them", () => {
    const output = calculateAssessment(
      assessment(
        {
          items: [
            item({
              classification: LcaEmissionClassification.OFFSET,
              quantity: D(50),
              unit: "kg",
              factor: factor(1, "kg"),
            }),
          ],
        },
        { offsetTreatment: LcaOffsetTreatment.EXCLUDED },
      ),
    );

    expect(output.rows).toHaveLength(0);
    expect(output.totals.model.offsets.toNumber()).toBe(0);
  });
});

describe("exclusions", () => {
  it("skips an excluded item and records why", () => {
    const output = calculateAssessment(
      assessment({
        items: [item({ isExcluded: true, exclusionReason: "Below the 1% cut-off by mass and impact" })],
      }),
    );

    expect(output.rows).toHaveLength(0);
    const diagnostic = output.diagnostics.find((d) => d.code === "EXCLUDED_ITEM");
    expect(diagnostic?.message).toContain("Below the 1% cut-off");
  });

  it("skips items in an excluded process", () => {
    const output = calculateAssessment(
      assessment({ processes: [process({ isIncluded: false })], items: [item()] }),
    );

    expect(output.rows).toHaveLength(0);
    expect(output.diagnostics.map((d) => d.code)).toContain("EXCLUDED_PROCESS");
  });
});

describe("provenance", () => {
  it("records the full activity-to-result trail on every row", () => {
    const output = calculateAssessment(
      assessment({ items: [item({ quantity: D(10), unit: "kg", factor: factor(2, "kg") })] }),
    );

    const labels = output.rows[0].provenance.map((s) => s.label);
    expect(labels).toEqual([
      "Activity data",
      "Unit conversion",
      "Emission factor",
      "Methodology",
      "Allocation",
      "Calculation",
      "Result",
    ]);
    expect(output.rows[0].provenance.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(output.rows[0].formula).toContain("kgCO2e");
  });

  it("snapshots the factor's source, version, boundary, geography, year and GWP basis", () => {
    const output = calculateAssessment(assessment());
    const row = output.rows[0];

    expect(row.factorSource).toBe("Test factor library");
    expect(row.factorVersion).toBe("2026");
    expect(row.factorBoundary).toBe(LcaFactorBoundary.CRADLE_TO_GATE);
    expect(row.factorGeography).toBe("UK");
    expect(row.factorYear).toBe(2026);
    expect(row.factorGwpBasis).toBe("IPCC AR6 GWP100");
  });

  it("lists every distinct factor the run used", () => {
    const output = calculateAssessment(
      assessment({
        items: [
          item({ id: "a", factor: factor(1, "kg", { emissionFactorId: "f1" }) }),
          item({ id: "b", factor: factor(2, "kg", { emissionFactorId: "f2" }) }),
          item({ id: "c", factor: factor(1, "kg", { emissionFactorId: "f1" }) }),
        ],
      }),
    );

    expect(output.factorsUsed).toHaveLength(2);
  });

  it("marks results priced from a placeholder factor", () => {
    const output = calculateAssessment(
      assessment({ items: [item({ factor: factor(1, "kg", { isPlaceholder: true }) })] }),
    );

    expect(output.rows[0].isPlaceholderFactor).toBe(true);
  });
});

describe("combined scenarios", () => {
  it("handles loss, allocation and functional-unit normalisation together", () => {
    const base = assessment({
      processes: [
        process({
          allocationMethod: LcaAllocationMethod.MANUAL,
          allocationPercent: D(50),
          allocationRationale: "Half the line output is the assessed product",
        }),
      ],
      items: [
        item({
          // 90 kg net of a 10% loss means 100 kg gross input.
          quantity: D(90),
          unit: "kg",
          wastePercent: D(10),
          factor: factor(2, "kg"),
        }),
      ],
    });
    base.functionalUnit.modelledOutputQuantity = D(25);
    base.functionalUnit.modelledOutputUnit = "item";

    const output = calculateAssessment(base);

    // 100 kg x 2 = 200 gross; x 50% = 100 allocated; / 25 units = 4 per unit.
    expect(output.rows[0].grossKgCo2e.toNumber()).toBe(200);
    expect(output.rows[0].allocatedKgCo2e.toNumber()).toBe(100);
    expect(output.totals.headlinePerFunctionalUnitKgCo2e.toNumber()).toBe(4);
  });

  it("builds a whole cradle-to-grave model and reconciles stage totals to the headline", () => {
    const processes: EngineProcess[] = [
      process({ id: "p-materials", name: "Materials", stage: LcaLifecycleStage.RAW_MATERIALS }),
      process({ id: "p-inbound", name: "Inbound freight", stage: LcaLifecycleStage.INBOUND_TRANSPORT }),
      process({ id: "p-mfg", name: "Assembly", stage: LcaLifecycleStage.MANUFACTURING }),
      process({ id: "p-pack", name: "Packaging", stage: LcaLifecycleStage.PACKAGING }),
      process({ id: "p-eol", name: "Disposal", stage: LcaLifecycleStage.END_OF_LIFE }),
    ];

    const items: EngineInventoryItem[] = [
      item({ id: "i-steel", processId: "p-materials", name: "Steel", materialName: "Steel", quantity: D(20), unit: "kg", factor: factor(2, "kg") }),
      item({
        id: "i-freight",
        processId: "p-inbound",
        itemType: LcaItemType.TRANSPORT,
        name: "Supplier to factory",
        quantity: D(1),
        unit: "item",
        factor: null,
        transportLegs: [
          {
            id: "leg-1",
            sequence: 0,
            mode: LcaTransportMode.ROAD,
            modeDescription: null,
            originName: null,
            destinationName: null,
            distanceValue: D(300),
            distanceUnit: "km",
            massValue: D(20),
            massUnit: "kg",
            loadFactorPercent: null,
            includesReturnTrip: false,
            factor: factor("0.1", "t.km"),
            assumptions: null,
          },
        ],
      }),
      item({ id: "i-power", processId: "p-mfg", itemType: LcaItemType.ENERGY, name: "Electricity", quantity: D(100), unit: "kWh", factor: factor("0.2", "kWh") }),
      item({ id: "i-box", processId: "p-pack", itemType: LcaItemType.PACKAGING, name: "Carton", materialName: "Board", quantity: D(2), unit: "kg", factor: factor("0.8", "kg") }),
      item({
        id: "i-eol",
        processId: "p-eol",
        itemType: LcaItemType.END_OF_LIFE,
        name: "Product disposal",
        quantity: D(22),
        unit: "kg",
        factor: null,
        endOfLifeRoutes: [
          {
            id: "r-landfill",
            route: LcaEndOfLifeRouteType.LANDFILL,
            routeDescription: null,
            percent: D(50),
            factor: factor("0.5", "kg", { boundary: LcaFactorBoundary.END_OF_LIFE }),
            recoveryRatePercent: null,
            avoidedFactorValue: null,
            avoidedFactorUnit: null,
            avoidedFactorSource: null,
            recoveryAssumptions: null,
          },
          {
            id: "r-recycle",
            route: LcaEndOfLifeRouteType.RECYCLING,
            routeDescription: null,
            percent: D(50),
            factor: factor("0.1", "kg", { boundary: LcaFactorBoundary.END_OF_LIFE }),
            recoveryRatePercent: null,
            avoidedFactorValue: null,
            avoidedFactorUnit: null,
            avoidedFactorSource: null,
            recoveryAssumptions: null,
          },
        ],
      }),
    ];

    const base = assessment({ processes, items });
    base.functionalUnit.modelledOutputQuantity = D(10);
    base.functionalUnit.modelledOutputUnit = "item";
    base.methodology = { ...base.methodology, defaultBoundary: LcaBoundary.CRADLE_TO_GRAVE };

    const output = calculateAssessment(base);

    // Steel        20 kg x 2            =  40
    // Freight      0.02 t x 300 km x 0.1 = 0.6
    // Electricity  100 kWh x 0.2        =  20
    // Carton       2 kg x 0.8           =   1.6
    // Landfill     11 kg x 0.5          =   5.5
    // Recycling    11 kg x 0.1          =   1.1
    //                                   ------
    //                                     68.8
    expect(totalOf(output)).toBeCloseTo(68.8, 10);
    expect(output.totals.headlineModelKgCo2e.toNumber()).toBeCloseTo(68.8, 10);
    expect(output.totals.headlinePerFunctionalUnitKgCo2e.toNumber()).toBeCloseTo(6.88, 10);

    const stageTotals = new Map<string, number>();
    for (const row of output.rows) {
      stageTotals.set(row.stage, (stageTotals.get(row.stage) ?? 0) + row.allocatedKgCo2e.toNumber());
    }
    expect(stageTotals.get(LcaLifecycleStage.RAW_MATERIALS)).toBe(40);
    expect(stageTotals.get(LcaLifecycleStage.INBOUND_TRANSPORT)).toBeCloseTo(0.6, 10);
    expect(stageTotals.get(LcaLifecycleStage.MANUFACTURING)).toBe(20);
    expect(stageTotals.get(LcaLifecycleStage.PACKAGING)).toBeCloseTo(1.6, 10);
    expect(stageTotals.get(LcaLifecycleStage.END_OF_LIFE)).toBeCloseTo(6.6, 10);

    // Every stage total must add back up to the model total — no rounding drift.
    const summed = Array.from(stageTotals.values()).reduce((a, b) => a + b, 0);
    expect(summed).toBeCloseTo(output.totals.model.fossil.toNumber(), 10);
  });
});

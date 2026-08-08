import { describe, expect, it } from "vitest";
import {
  LcaAllocationMethod,
  LcaAssessmentStatus,
  LcaBoundary,
  LcaDataType,
  LcaEmissionClassification,
  LcaEndOfLifeRouteType,
  LcaFactorBoundary,
  LcaFactorSelectionMode,
  LcaItemType,
  LcaLifecycleStage,
  LcaTransportMode,
  LcaUncertaintyStatus,
  Prisma,
} from "@prisma/client";
import { validateAssessment, type ValidationInput } from "@/lib/lca/validation-service";
import type { LoadedAssessment, LoadedRun } from "@/lib/lca/calculation-service";

const D = (v: string | number) => new Prisma.Decimal(v);

/**
 * A minimal but valid assessment, built so each test can break exactly one
 * thing and see only that check fire.
 */
function baseAssessment(overrides: Partial<LoadedAssessment> = {}): LoadedAssessment {
  const factorSet = {
    id: "set-1",
    name: "Test factor set",
    publisher: "Test publisher",
    sourceType: "LCA_SECONDARY",
    supplierName: null,
    vintageYear: 2026,
    publishedDate: null,
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    sourceUrl: null,
    isPlaceholder: false,
    notes: null,
    sourceFileName: null,
    importedByUserId: null,
    createdAt: new Date(),
  };

  const factor = {
    id: "factor-1",
    factorSetId: "set-1",
    scope: "SCOPE_3",
    category: "lca_material_metal",
    subtypeKey: "steel",
    basis: "STANDARD",
    region: "UK",
    unit: "kg",
    co2eFactor: D(2),
    notes: null,
    boundary: LcaFactorBoundary.CRADLE_TO_GATE,
    gwpBasis: "IPCC AR6 GWP100",
    referenceYear: 2026,
    lcaDataSource: null,
    uncertaintyPercent: null,
    factorSet,
  };

  return {
    id: "assessment-1",
    entityId: "entity-1",
    productVersionId: "pv-1",
    reference: "PCF-001",
    title: "Test assessment",
    status: LcaAssessmentStatus.DATA_COLLECTION,
    version: 1,
    versionLabel: null,
    parentAssessmentId: null,
    supersededByAssessmentId: null,
    isScenario: false,
    baselineAssessmentId: null,
    scenarioDescription: null,
    goal: "Establish the cradle-to-gate footprint.",
    intendedApplication: "Customer questionnaires.",
    intendedAudience: "Customers.",
    comparativeAssertionDisclosed: false,
    scopeDescription: "Materials and manufacturing.",
    boundary: LcaBoundary.CRADLE_TO_GATE,
    boundaryNotes: null,
    includedStages: [LcaLifecycleStage.RAW_MATERIALS],
    periodStart: new Date("2026-01-01"),
    periodEnd: new Date("2026-12-31"),
    ownerUserId: "user-1",
    functionalUnitDescription: "1 unit of product",
    functionalUnitQuantity: D(1),
    functionalUnitUnit: "item",
    isDeclaredUnit: true,
    declaredUnitDescription: null,
    referenceFlowDescription: null,
    referenceFlowQuantity: D(1),
    referenceFlowUnit: "item",
    modelledOutputQuantity: D(100),
    modelledOutputUnit: "item",
    modelledOutputDescription: null,
    methodologyProfileId: "method-1",
    methodologySnapshot: null,
    methodologyNotes: null,
    usePhaseLifetimeYears: null,
    usePhaseAssumptions: null,
    completenessNotes: null,
    limitations: null,
    interpretation: null,
    engineVersion: "lca-engine-v1",
    lastCalculationRunId: "run-1",
    issuedAt: null,
    issuedByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    methodologyProfile: {
      id: "method-1",
      entityId: null,
      name: "Test methodology",
      version: "1.0",
      summary: null,
      defaultBoundary: LcaBoundary.CRADLE_TO_GATE,
      gwpBasis: "IPCC AR6 GWP100",
      defaultAllocationMethod: LcaAllocationMethod.MASS,
      allocationRules: null,
      recyclingMethod: "CUT_OFF",
      recyclingRules: null,
      electricityApproach: "LOCATION_BASED",
      electricityRules: null,
      biogenicTreatment: "REPORTED_SEPARATELY",
      biogenicRules: null,
      removalsRules: null,
      offsetTreatment: "DISCLOSED_SEPARATELY",
      offsetRules: null,
      cutOffRules: null,
      cutOffThresholdPercent: null,
      factorHierarchy: [],
      dataQualityRequirements: null,
      minimumDataQualityScore: null,
      requireEvidenceForPrimary: false,
      standardsReferenced: [],
      notes: null,
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    entity: { id: "entity-1", name: "Test Entity", consolidationApproach: "OPERATIONAL_CONTROL", createdAt: new Date() },
    owner: null,
    productVersion: {
      id: "pv-1",
      productId: "p-1",
      versionLabel: "Rev A",
      description: null,
      effectiveFrom: null,
      effectiveTo: null,
      isActive: true,
      createdAt: new Date(),
      product: {
        id: "p-1",
        entityId: "entity-1",
        name: "Test product",
        sku: "TP-1",
        description: null,
        category: null,
        status: "ACTIVE",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      manufacturingLocations: [],
    },
    processes: [
      {
        id: "process-1",
        assessmentId: "assessment-1",
        parentProcessId: null,
        stage: LcaLifecycleStage.RAW_MATERIALS,
        name: "Raw materials",
        description: null,
        sortOrder: 0,
        isIncluded: true,
        allocationMethod: LcaAllocationMethod.NONE,
        allocationPercent: D(100),
        allocationRationale: null,
        allocationBasisDescription: null,
        geography: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        outputs: [],
      },
    ],
    inventoryItems: [
      {
        id: "item-1",
        assessmentId: "assessment-1",
        processId: "process-1",
        itemType: LcaItemType.MATERIAL,
        name: "Steel",
        description: null,
        sortOrder: 0,
        componentName: null,
        partNumber: null,
        materialName: "Steel",
        recycledContentPercent: null,
        wastePercent: null,
        quantity: D(10),
        unit: "kg",
        adjustmentFactor: D(1),
        adjustmentRationale: null,
        dataType: LcaDataType.PRIMARY,
        dataSource: "Engineering BOM",
        supplierId: null,
        geography: "UK",
        periodStart: null,
        periodEnd: null,
        notes: null,
        factorSelectionMode: LcaFactorSelectionMode.LIBRARY_FACTOR,
        emissionFactorId: "factor-1",
        recycledEmissionFactorId: null,
        supplierPcfId: null,
        manualFactorValue: null,
        manualFactorUnit: null,
        manualFactorSource: null,
        manualFactorVersion: null,
        manualFactorBoundary: null,
        manualFactorGeography: null,
        manualFactorYear: null,
        manualFactorGwpBasis: null,
        manualFactorRationale: null,
        classification: LcaEmissionClassification.FOSSIL,
        biogenicUptakePerUnit: null,
        storedCarbonPerUnit: null,
        temporalScore: 1,
        geographicalScore: 1,
        technologicalScore: 1,
        completenessScore: 1,
        reliabilityScore: 1,
        uncertaintyStatus: LcaUncertaintyStatus.ESTIMATED,
        uncertaintyPercent: D(10),
        uncertaintyLower: null,
        uncertaintyUpper: null,
        uncertaintyNotes: null,
        isExcluded: false,
        exclusionReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        supplier: null,
        emissionFactor: factor,
        recycledEmissionFactor: null,
        supplierPcf: null,
        transportLegs: [],
        endOfLifeRoutes: [],
        corporateLinks: [],
      },
    ],
    ...overrides,
  } as unknown as LoadedAssessment;
}

function baseRun(): LoadedRun {
  return {
    id: "run-1",
    assessmentId: "assessment-1",
    runAt: new Date(),
    runByUserId: null,
    engineVersion: "lca-engine-v1",
    methodologyVersion: "Test methodology 1.0",
    methodologySnapshot: null,
    factorSnapshot: null,
    totals: { functionalUnitResolved: true },
    itemCount: 1,
    notes: null,
    runBy: null,
    results: [{ id: "result-1" }],
  } as unknown as LoadedRun;
}

function input(overrides: Partial<ValidationInput> = {}): ValidationInput {
  return {
    assessment: baseAssessment(),
    run: baseRun(),
    staleness: { stale: false, reason: null },
    assumptions: [],
    exclusions: [],
    evidence: [],
    verifications: [],
    ...overrides,
  };
}

function codes(report: ReturnType<typeof validateAssessment>, severity?: "ERROR" | "WARNING" | "ADVISORY") {
  return report.issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);
}

describe("a complete assessment", () => {
  it("raises no errors", () => {
    const report = validateAssessment(input());
    expect(codes(report, "ERROR")).toEqual([]);
    expect(report.canIssueForVerification).toBe(true);
  });
});

describe("goal and scope checks", () => {
  it("flags a missing goal", () => {
    const report = validateAssessment(input({ assessment: baseAssessment({ goal: null }) }));
    expect(codes(report, "ERROR")).toContain("MISSING_GOAL");
    expect(report.canIssueForVerification).toBe(false);
  });

  it("flags a missing functional unit", () => {
    const report = validateAssessment(
      input({ assessment: baseAssessment({ functionalUnitDescription: null, functionalUnitUnit: null }) }),
    );
    expect(codes(report, "ERROR")).toContain("MISSING_FUNCTIONAL_UNIT");
  });

  it("flags a missing reporting period", () => {
    const report = validateAssessment(input({ assessment: baseAssessment({ periodStart: null, periodEnd: null }) }));
    expect(codes(report, "ERROR")).toContain("MISSING_PERIOD");
  });

  it("flags a period that ends before it starts", () => {
    const report = validateAssessment(
      input({ assessment: baseAssessment({ periodStart: new Date("2026-12-31"), periodEnd: new Date("2026-01-01") }) }),
    );
    expect(codes(report, "ERROR")).toContain("INVALID_PERIOD");
  });

  it("flags a custom boundary that is never described", () => {
    const report = validateAssessment(
      input({ assessment: baseAssessment({ boundary: LcaBoundary.CUSTOM, boundaryNotes: null }) }),
    );
    expect(codes(report, "ERROR")).toContain("MISSING_BOUNDARY_DEFINITION");
  });

  it("flags an assessment with no methodology profile", () => {
    const report = validateAssessment(
      input({ assessment: baseAssessment({ methodologyProfileId: null, methodologyProfile: null }) }),
    );
    expect(codes(report, "ERROR")).toContain("NO_METHODOLOGY");
  });

  it("flags a comparative assertion with no independent review", () => {
    const report = validateAssessment(
      input({ assessment: baseAssessment({ comparativeAssertionDisclosed: true }), verifications: [] }),
    );
    expect(codes(report, "WARNING")).toContain("COMPARATIVE_WITHOUT_REVIEW");
  });
});

describe("factor checks", () => {
  it("flags an inventory line with no factor", () => {
    const assessment = baseAssessment();
    assessment.inventoryItems[0].factorSelectionMode = LcaFactorSelectionMode.NONE;
    assessment.inventoryItems[0].emissionFactor = null;
    assessment.inventoryItems[0].emissionFactorId = null;

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "ERROR")).toContain("ITEM_NO_FACTOR");
  });

  it("flags a manually entered factor with no source", () => {
    const assessment = baseAssessment();
    assessment.inventoryItems[0].factorSelectionMode = LcaFactorSelectionMode.MANUAL;
    assessment.inventoryItems[0].emissionFactor = null;
    assessment.inventoryItems[0].manualFactorValue = D(2);
    assessment.inventoryItems[0].manualFactorUnit = "kg";
    assessment.inventoryItems[0].manualFactorSource = null;

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "ERROR")).toContain("FACTOR_UNSOURCED");
  });

  it("blocks an assessment priced from a placeholder factor", () => {
    const assessment = baseAssessment();
    assessment.inventoryItems[0].emissionFactor!.factorSet.isPlaceholder = true;

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "ERROR")).toContain("PLACEHOLDER_FACTOR");
    expect(report.canIssueForVerification).toBe(false);
  });

  it("flags a factor whose unit cannot be applied to the activity data", () => {
    const assessment = baseAssessment();
    assessment.inventoryItems[0].emissionFactor!.unit = "kWh";

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "ERROR")).toContain("INCOMPATIBLE_UNIT");
  });

  it("flags a factor with no stated boundary", () => {
    const assessment = baseAssessment();
    assessment.inventoryItems[0].emissionFactor!.boundary = null;

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "WARNING")).toContain("FACTOR_BOUNDARY_UNKNOWN");
  });

  it("flags a factor far older than the assessment period", () => {
    const assessment = baseAssessment();
    assessment.inventoryItems[0].emissionFactor!.referenceYear = 2010;

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "WARNING")).toContain("FACTOR_OUT_OF_PERIOD");
  });

  it("flags a factor from after the assessment period", () => {
    const assessment = baseAssessment();
    assessment.inventoryItems[0].emissionFactor!.referenceYear = 2030;

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "WARNING")).toContain("FACTOR_AFTER_PERIOD");
  });

  it("flags a geography mismatch", () => {
    const assessment = baseAssessment();
    assessment.inventoryItems[0].geography = "China";
    assessment.inventoryItems[0].emissionFactor!.region = "UK";

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "WARNING")).toContain("GEOGRAPHY_MISMATCH");
  });

  it("treats UK, GB and United Kingdom as the same place", () => {
    const assessment = baseAssessment();
    assessment.inventoryItems[0].geography = "United Kingdom";
    assessment.inventoryItems[0].emissionFactor!.region = "GB";

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "WARNING")).not.toContain("GEOGRAPHY_MISMATCH");
  });
});

describe("allocation checks", () => {
  it("flags a multi-output process with no allocation", () => {
    const assessment = baseAssessment();
    assessment.processes[0].outputs = [
      { id: "o1", processId: "process-1", name: "A", isAssessedProduct: true, massValue: D(1), massUnit: "kg", physicalValue: null, physicalUnit: null, economicValue: null, economicCurrency: null, manualPercent: null, notes: null, sortOrder: 0 },
      { id: "o2", processId: "process-1", name: "B", isAssessedProduct: false, massValue: D(1), massUnit: "kg", physicalValue: null, physicalUnit: null, economicValue: null, economicCurrency: null, manualPercent: null, notes: null, sortOrder: 1 },
    ] as unknown as LoadedAssessment["processes"][number]["outputs"];

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "ERROR")).toContain("MISSING_ALLOCATION");
  });

  it("flags a manual allocation with no rationale", () => {
    const assessment = baseAssessment();
    assessment.processes[0].allocationMethod = LcaAllocationMethod.MANUAL;
    assessment.processes[0].allocationPercent = D(40);
    assessment.processes[0].allocationRationale = null;

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "WARNING")).toContain("MANUAL_ALLOCATION_NO_RATIONALE");
  });

  it("flags a derived split with no assessed product marked", () => {
    const assessment = baseAssessment();
    assessment.processes[0].allocationMethod = LcaAllocationMethod.MASS;
    assessment.processes[0].outputs = [
      { id: "o1", processId: "process-1", name: "A", isAssessedProduct: false, massValue: D(1), massUnit: "kg", physicalValue: null, physicalUnit: null, economicValue: null, economicCurrency: null, manualPercent: null, notes: null, sortOrder: 0 },
    ] as unknown as LoadedAssessment["processes"][number]["outputs"];

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "ERROR")).toContain("NO_ASSESSED_OUTPUT");
  });
});

describe("end-of-life checks", () => {
  function withRoutes(percents: number[]) {
    const assessment = baseAssessment();
    assessment.inventoryItems[0].itemType = LcaItemType.END_OF_LIFE;
    assessment.inventoryItems[0].endOfLifeRoutes = percents.map((percent, index) => ({
      id: `route-${index}`,
      inventoryItemId: "item-1",
      route: LcaEndOfLifeRouteType.LANDFILL,
      routeDescription: null,
      percent: D(percent),
      emissionFactorId: "factor-1",
      manualFactorValue: null,
      manualFactorUnit: null,
      manualFactorSource: null,
      recoveryRatePercent: null,
      avoidedFactorValue: null,
      avoidedFactorUnit: null,
      avoidedFactorSource: null,
      recoveryAssumptions: null,
      notes: null,
      emissionFactor: assessment.inventoryItems[0].emissionFactor,
    })) as unknown as LoadedAssessment["inventoryItems"][number]["endOfLifeRoutes"];
    return assessment;
  }

  it("accepts routes that total exactly 100%", () => {
    const report = validateAssessment(input({ assessment: withRoutes([60, 40]) }));
    expect(codes(report, "ERROR")).not.toContain("EOL_PERCENT_NOT_100");
  });

  it("flags routes that do not total 100%", () => {
    const report = validateAssessment(input({ assessment: withRoutes([60, 30]) }));
    expect(codes(report, "ERROR")).toContain("EOL_PERCENT_NOT_100");
  });

  it("flags routes that total more than 100%", () => {
    const report = validateAssessment(input({ assessment: withRoutes([60, 60]) }));
    expect(codes(report, "ERROR")).toContain("EOL_PERCENT_NOT_100");
  });

  it("flags an unsourced avoided-burden credit", () => {
    const assessment = withRoutes([100]);
    assessment.inventoryItems[0].endOfLifeRoutes[0].avoidedFactorValue = D(1.5);
    assessment.inventoryItems[0].endOfLifeRoutes[0].avoidedFactorSource = null;

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "ERROR")).toContain("AVOIDED_FACTOR_UNSOURCED");
  });
});

describe("transport checks", () => {
  it("flags a transport line with no legs", () => {
    const assessment = baseAssessment();
    assessment.inventoryItems[0].itemType = LcaItemType.TRANSPORT;

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "ERROR")).toContain("TRANSPORT_NO_LEGS");
  });

  it("flags a leg with no factor and no distance", () => {
    const assessment = baseAssessment();
    assessment.inventoryItems[0].itemType = LcaItemType.TRANSPORT;
    assessment.inventoryItems[0].transportLegs = [
      {
        id: "leg-1",
        inventoryItemId: "item-1",
        sequence: 0,
        mode: LcaTransportMode.ROAD,
        modeDescription: null,
        originName: null,
        destinationName: null,
        distanceValue: D(0),
        distanceUnit: "km",
        massValue: D(0),
        massUnit: "kg",
        loadFactorPercent: null,
        includesReturnTrip: false,
        emissionFactorId: null,
        manualFactorValue: null,
        manualFactorUnit: null,
        manualFactorSource: null,
        assumptions: null,
        notes: null,
        emissionFactor: null,
      },
    ] as unknown as LoadedAssessment["inventoryItems"][number]["transportLegs"];

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "ERROR")).toEqual(expect.arrayContaining(["LEG_NO_FACTOR", "LEG_NO_DISTANCE", "LEG_NO_MASS"]));
  });
});

describe("exclusion and data-quality checks", () => {
  it("flags an excluded line with no reason", () => {
    const assessment = baseAssessment();
    assessment.inventoryItems[0].isExcluded = true;
    assessment.inventoryItems[0].exclusionReason = null;

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "ERROR")).toContain("UNDOCUMENTED_EXCLUSION");
  });

  it("flags proxy data with no explanation", () => {
    const assessment = baseAssessment();
    assessment.inventoryItems[0].dataType = LcaDataType.PROXY;
    assessment.inventoryItems[0].dataSource = null;
    assessment.inventoryItems[0].notes = null;

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "WARNING")).toContain("UNEXPLAINED_PROXY");
  });

  it("accepts proxy data explained in the assumptions register", () => {
    const assessment = baseAssessment();
    assessment.inventoryItems[0].dataType = LcaDataType.PROXY;
    assessment.inventoryItems[0].dataSource = null;
    assessment.inventoryItems[0].notes = null;

    const report = validateAssessment(
      input({
        assessment,
        assumptions: [{ id: "a1", assumption: "Stands in for X", approvedAt: new Date(), inventoryItemId: "item-1" }],
      }),
    );
    expect(codes(report, "WARNING")).not.toContain("UNEXPLAINED_PROXY");
  });

  it("flags a line with no data-quality scores", () => {
    const assessment = baseAssessment();
    Object.assign(assessment.inventoryItems[0], {
      temporalScore: null,
      geographicalScore: null,
      technologicalScore: null,
      completenessScore: null,
      reliabilityScore: null,
    });

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "WARNING")).toContain("NO_DATA_QUALITY_SCORES");
  });

  it("flags an invalid manufacturing loss", () => {
    const assessment = baseAssessment();
    assessment.inventoryItems[0].wastePercent = D(100);

    const report = validateAssessment(input({ assessment }));
    expect(codes(report, "ERROR")).toContain("INVALID_WASTE");
  });

  it("requires evidence for primary data when the methodology says so", () => {
    const assessment = baseAssessment();
    assessment.methodologyProfile!.requireEvidenceForPrimary = true;

    const report = validateAssessment(input({ assessment, evidence: [] }));
    expect(codes(report, "WARNING")).toContain("MISSING_EVIDENCE");
  });
});

describe("calculation checks", () => {
  it("flags an assessment that has never been calculated", () => {
    const report = validateAssessment(input({ run: null }));
    expect(codes(report, "ERROR")).toContain("NOT_CALCULATED");
  });

  it("flags results that are out of date", () => {
    const report = validateAssessment(
      input({ staleness: { stale: true, reason: "Inventory has changed since the last run." } }),
    );
    expect(codes(report, "ERROR")).toContain("STALE_CALCULATION");
  });

  it("flags a run where the functional unit could not be resolved", () => {
    const run = baseRun();
    (run as unknown as { totals: unknown }).totals = {
      functionalUnitResolved: false,
      functionalUnitNote: "Units are not comparable.",
    };

    const report = validateAssessment(input({ run }));
    expect(codes(report, "ERROR")).toContain("FUNCTIONAL_UNIT_UNRESOLVED");
  });
});

describe("verification checks", () => {
  it("flags a verified status with no verification record", () => {
    const report = validateAssessment(
      input({ assessment: baseAssessment({ status: LcaAssessmentStatus.VERIFIED }), verifications: [] }),
    );
    expect(codes(report, "ERROR")).toContain("VERIFIED_WITHOUT_RECORD");
  });

  it("flags a verification record with no statement attached", () => {
    const report = validateAssessment(input({ verifications: [{ id: "v1" }], evidence: [] }));
    expect(codes(report, "WARNING")).toContain("VERIFICATION_NO_EVIDENCE");
  });
});

describe("severity counts", () => {
  it("only errors block readiness for verification", () => {
    const assessment = baseAssessment();
    assessment.inventoryItems[0].uncertaintyStatus = LcaUncertaintyStatus.NOT_ASSESSED;
    assessment.inventoryItems[0].emissionFactor!.boundary = null;

    const report = validateAssessment(input({ assessment }));
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBeGreaterThan(0);
    expect(report.advisoryCount).toBeGreaterThan(0);
    expect(report.canIssueForVerification).toBe(true);
  });
});

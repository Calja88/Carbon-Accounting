import { describe, expect, it } from "vitest";
import { LcaBoundary, LcaPcfVerificationStatus } from "@prisma/client";
import { fromPactFootprint, PactAdapterError, toPactFootprint, type ExportSourceAssessment } from "@/lib/lca/pact/adapter";
import { ADAPTER_SPEC_VERSION, CONFORMANCE_NOTICE } from "@/lib/lca/pact/types";
import { D } from "@/lib/lca/decimal";

function source(overrides: Partial<ExportSourceAssessment> = {}): ExportSourceAssessment {
  return {
    id: "assessment-1",
    reference: "PCF-001",
    title: "Cradle-to-gate footprint",
    companyName: "Test Entity",
    companyIds: [],
    productName: "Test product",
    productDescription: "A test product",
    productIds: ["SKU-1"],
    productCategoryCpc: "38999",
    version: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    issuedAt: new Date("2026-06-01T00:00:00.000Z"),
    boundary: LcaBoundary.CRADLE_TO_GATE,
    boundaryNotes: "Materials through to the factory gate.",
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    periodEnd: new Date("2026-12-31T00:00:00.000Z"),
    geographyCountry: "GB",
    gwpBasis: "IPCC AR6 (2021), GWP100",
    allocationRules: "Mass allocation.",
    biogenicRules: "Reported separately.",
    standardsReferenced: ["ISO 14067:2018"],
    uncertaintyDescription: "Indicative range only.",
    exemptedEmissionsPercent: 0,
    exemptedEmissionsDescription: null,
    packagingIncluded: true,
    packagingKgCo2e: 0.2,
    primaryDataSharePercent: 62,
    dataQuality: { coveragePercent: 95, technological: 2, temporal: 2, geographical: 2, completeness: 2, reliability: 2 },
    verification: null,
    functionalUnitQuantity: D(1),
    functionalUnitUnit: "kg",
    results: {
      fossilKgCo2ePerFunctionalUnit: D("2.5"),
      biogenicEmissionsKgCo2ePerFunctionalUnit: D(0),
      biogenicRemovalsKgCo2ePerFunctionalUnit: D(0),
    },
    secondaryFactorSources: ["Test library (2026)"],
    ...overrides,
  };
}

describe("export", () => {
  it("produces a document with the headline figures against the declared unit", () => {
    const { document } = toPactFootprint(source());

    expect(document.specVersion).toBe(ADAPTER_SPEC_VERSION);
    expect(document.pcf.declaredUnit).toBe("kilogram");
    expect(document.pcf.pCfExcludingBiogenic).toBe("2.5");
    expect(document.pcf.fossilGhgEmissions).toBe("2.5");
    expect(document.productNameCompany).toBe("Test product");
    expect(document.pcf.characterizationFactors).toBe("IPCC AR6 (2021), GWP100");
  });

  it("always ships the conformance notice with the document", () => {
    const { notes } = toPactFootprint(source());
    expect(notes[0]).toBe(CONFORMANCE_NOTICE);
  });

  it("carries biogenic figures separately from the fossil headline", () => {
    const { document } = toPactFootprint(
      source({
        results: {
          fossilKgCo2ePerFunctionalUnit: D(10),
          biogenicEmissionsKgCo2ePerFunctionalUnit: D(2),
          biogenicRemovalsKgCo2ePerFunctionalUnit: D(-3),
        },
      }),
    );

    expect(document.pcf.pCfExcludingBiogenic).toBe("10");
    expect(document.pcf.pCfIncludingBiogenic).toBe("9");
    expect(document.pcf.otherBiogenicGhgEmissions).toBe("2");
    expect(document.pcf.biogenicCarbonWithdrawal).toBe("-3");
  });

  it("converts a unit the format does not allow, and says it has done so", () => {
    // The format has no "tonne", so a per-tonne figure is restated per kilogram.
    const { document, notes } = toPactFootprint(
      source({
        functionalUnitUnit: "t",
        results: {
          fossilKgCo2ePerFunctionalUnit: D(2000),
          biogenicEmissionsKgCo2ePerFunctionalUnit: D(0),
          biogenicRemovalsKgCo2ePerFunctionalUnit: D(0),
        },
      }),
    );

    expect(document.pcf.declaredUnit).toBe("kilogram");
    expect(document.pcf.pCfExcludingBiogenic).toBe("2");
    expect(notes.some((note) => note.includes("converted"))).toBe(true);
  });

  it("refuses to relabel a unit it cannot convert", () => {
    expect(() => toPactFootprint(source({ functionalUnitUnit: "item" }))).toThrow(PactAdapterError);
  });

  it("refuses to export an assessment with no unit at all", () => {
    expect(() => toPactFootprint(source({ functionalUnitUnit: null }))).toThrow(PactAdapterError);
  });

  it("warns when the boundary is wider than the format assumes", () => {
    const { notes } = toPactFootprint(source({ boundary: LcaBoundary.CRADLE_TO_GRAVE }));
    expect(notes.some((note) => note.includes("cradle to grave"))).toBe(true);
  });

  it("includes assurance details when a verification exists", () => {
    const { document } = toPactFootprint(
      source({
        verification: {
          verified: true,
          providerName: "Test Assurance Ltd",
          level: "LIMITED_ASSURANCE",
          coverage: "The whole assessment",
          boundary: "CRADLE_TO_GATE",
          completedAt: new Date("2026-07-01T00:00:00.000Z"),
          standardName: "STMT-001",
          comments: "No material misstatements found.",
        },
      }),
    );

    expect(document.pcf.assurance?.assurance).toBe(true);
    expect(document.pcf.assurance?.providerName).toBe("Test Assurance Ltd");
  });
});

describe("import", () => {
  function validDocument(overrides: Record<string, unknown> = {}) {
    // `pcf` merges into the nested object; everything else overrides at the top
    // level, so the two cannot fight over the same key.
    const { pcf: pcfOverrides, ...topLevel } = overrides;
    return {
      id: "urn:uuid:0f4d0e1c-1111-2222-3333-444455556666",
      specVersion: ADAPTER_SPEC_VERSION,
      version: 1,
      created: "2026-03-01T00:00:00.000Z",
      status: "Active",
      companyName: "Example Polymers Ltd",
      companyIds: ["urn:pathfinder:company:customer-idcompany-1"],
      productDescription: "ABS polymer granulate",
      productIds: ["urn:pathfinder:product:customer-idproduct-1"],
      productCategoryCpc: "34110",
      productNameCompany: "ABS granulate",
      pcf: {
        declaredUnit: "kilogram",
        unitaryProductAmount: "1",
        pCfExcludingBiogenic: "3.42",
        fossilGhgEmissions: "3.42",
        referencePeriodStart: "2025-01-01T00:00:00.000Z",
        referencePeriodEnd: "2025-12-31T00:00:00.000Z",
        geographyCountry: "DE",
        crossSectoralStandardsUsed: ["ISO 14067"],
        characterizationFactors: "AR6",
        boundaryProcessesDescription: "Cradle to gate.",
        primaryDataShare: 55,
        dqi: { temporalDQR: 2, geographicalDQR: 3, technologicalDQR: 2, completenessDQR: 2, reliabilityDQR: 3 },
        ...(pcfOverrides as Record<string, unknown> | undefined),
      },
      ...topLevel,
    };
  }

  it("maps a valid document onto a supplier PCF record", () => {
    const result = fromPactFootprint(validDocument());

    expect(result.ok).toBe(true);
    expect(result.pcf?.productName).toBe("ABS granulate");
    expect(result.pcf?.companyName).toBe("Example Polymers Ltd");
    expect(result.pcf?.pcfValue).toBe("3.42");
    expect(result.pcf?.declaredUnitUnit).toBe("kg");
    expect(result.pcf?.boundary).toBe(LcaBoundary.CRADLE_TO_GATE);
    expect(result.pcf?.geography).toBe("DE");
    expect(result.pcf?.temporalScore).toBe(2);
    expect(result.pcf?.primaryDataSharePercent).toBe(55);
  });

  it("keeps the original document for audit", () => {
    const doc = validDocument();
    const result = fromPactFootprint(doc);
    expect(result.raw).toBe(doc);
  });

  it("reports every validation problem rather than importing part of a document", () => {
    const result = fromPactFootprint({ specVersion: "2.2.0", companyName: "Missing everything else" });

    expect(result.ok).toBe(false);
    expect(result.pcf).toBeNull();
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it("rejects a declared unit it cannot work with", () => {
    const result = fromPactFootprint(validDocument({ pcf: { declaredUnit: "furlong" } }));
    expect(result.ok).toBe(false);
  });

  it("warns about a specification version the adapter was not written against", () => {
    const result = fromPactFootprint(validDocument({ specVersion: "3.0.0" }));
    expect(result.ok).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("3.0.0"))).toBe(true);
  });

  it("warns when the supplier has deprecated the footprint", () => {
    const result = fromPactFootprint(validDocument({ status: "Deprecated" }));
    expect(result.warnings.some((warning) => warning.includes("deprecated"))).toBe(true);
  });

  it("warns about a material exemption rather than absorbing it silently", () => {
    const result = fromPactFootprint(validDocument({ pcf: { exemptedEmissionsPercent: 12 } }));
    expect(result.warnings.some((warning) => warning.includes("12%"))).toBe(true);
  });

  it("records an unverified supplier figure as self-declared, not verified", () => {
    const result = fromPactFootprint(validDocument());
    expect(result.pcf?.verificationStatus).toBe(LcaPcfVerificationStatus.SELF_DECLARED);
  });

  it("records third-party verification when the document asserts assurance", () => {
    const result = fromPactFootprint(
      validDocument({
        pcf: {
          assurance: { assurance: true, providerName: "Assurance Co", completedAt: "2026-02-01T00:00:00.000Z" },
        },
      }),
    );
    expect(result.pcf?.verificationStatus).toBe(LcaPcfVerificationStatus.THIRD_PARTY_VERIFIED);
    expect(result.pcf?.verifierName).toBe("Assurance Co");
  });

  it("does not assume cradle-to-gate when the boundary description says otherwise", () => {
    const result = fromPactFootprint(
      validDocument({ pcf: { boundaryProcessesDescription: "Cradle to grave including use and disposal." } }),
    );
    expect(result.pcf?.boundary).toBe(LcaBoundary.CUSTOM);
    expect(result.pcf?.boundaryNotes).toContain("grave");
  });
});

describe("round trip", () => {
  it("survives export then import with the headline figure intact", () => {
    const { document } = toPactFootprint(source());
    const result = fromPactFootprint(document);

    expect(result.ok).toBe(true);
    expect(result.pcf?.pcfValue).toBe("2.5");
    expect(result.pcf?.declaredUnitUnit).toBe("kg");
    expect(result.pcf?.gwpBasis).toBe("IPCC AR6 (2021), GWP100");
  });
});

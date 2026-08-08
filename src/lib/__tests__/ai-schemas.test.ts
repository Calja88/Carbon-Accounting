import { describe, expect, it } from "vitest";
import {
  documentExtractionResultSchema,
  emissionClassificationResultSchema,
  emissionFactorSuggestionSchema,
  lcaReviewResultSchema,
  toProviderJsonSchema,
} from "@/lib/ai/schemas";
import { extractJsonObject } from "@/lib/ai/run";

/**
 * Model output is untrusted until it has been through these schemas. These
 * tests are about the failure path as much as the happy one: anything that
 * doesn't validate must be rejected outright, never partially used.
 */

const validExtraction = {
  documentKind: "ELECTRICITY_INVOICE",
  metadata: {
    supplier: "Example Energy Ltd",
    accountReference: "ACC-1",
    invoiceNumber: "INV-9",
    invoiceDate: "2026-02-03",
    billingPeriodStart: "2026-01-01",
    billingPeriodEnd: "2026-01-31",
    siteNameOnDocument: "Hull Site",
    addressOnDocument: null,
  },
  energy: {
    electricityKwh: 12450,
    gasKwh: null,
    gasVolumeM3: null,
    fuelLitres: null,
    fuelType: null,
    meterNumber: "M-1",
    meterReadingPrevious: null,
    meterReadingCurrent: null,
    renewableTariffStated: null,
    renewableTariffDetail: null,
  },
  water: { waterConsumption: null, waterUnit: null, wastewaterVolume: null, wastewaterUnit: null },
  waste: {
    lines: [],
    carrierName: null,
    carrierRegistrationNumber: null,
    destinationSite: null,
    transferDate: null,
    wtnReference: null,
  },
  transport: {
    mode: null,
    vehicleType: null,
    fuelType: null,
    distance: null,
    distanceUnit: null,
    weight: null,
    weightUnit: null,
    tonneKm: null,
  },
  missingFields: ["addressOnDocument"],
  warnings: [],
  containsSuspiciousInstructions: false,
  overall: {
    state: "CONFIRMED",
    confidence: 0.97,
    reasoningSummary: "The invoice states 12,450 kWh of electricity for January 2026.",
    requiresReview: true,
    evidence: [{ field: "energy.electricityKwh", sourceText: "Total units 12,450 kWh", note: null }],
  },
};

describe("documentExtractionResultSchema", () => {
  it("accepts a well-formed extraction", () => {
    const parsed = documentExtractionResultSchema.safeParse(validExtraction);
    expect(parsed.success).toBe(true);
  });

  it("rejects output that omits a field instead of returning null", () => {
    const { energy, ...rest } = validExtraction;
    const withoutMeter = { ...rest, energy: { ...energy, meterNumber: undefined } };
    expect(documentExtractionResultSchema.safeParse(withoutMeter).success).toBe(false);
  });

  it("rejects a confidence outside 0-1", () => {
    const bad = { ...validExtraction, overall: { ...validExtraction.overall, confidence: 1.4 } };
    expect(documentExtractionResultSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invented document kind", () => {
    const bad = { ...validExtraction, documentKind: "CARBON_CREDIT_CERTIFICATE" };
    expect(documentExtractionResultSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an invented confidence state", () => {
    const bad = { ...validExtraction, overall: { ...validExtraction.overall, state: "VERY_SURE" } };
    expect(documentExtractionResultSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a numeric field returned as prose", () => {
    const bad = {
      ...validExtraction,
      energy: { ...validExtraction.energy, electricityKwh: "about twelve thousand" },
    };
    expect(documentExtractionResultSchema.safeParse(bad).success).toBe(false);
  });
});

describe("emissionClassificationResultSchema", () => {
  it("accepts a classification limited to the platform's own vocabulary", () => {
    const parsed = emissionClassificationResultSchema.safeParse({
      scope: "SCOPE_2",
      category: "SCOPE_2_PURCHASED_ELECTRICITY",
      suggestedDataPointCode: "S2-01",
      suggestedSubtypeKey: null,
      suggestedUnit: "kWh",
      alternativeCategories: [],
      missingInformation: [],
      overall: {
        state: "SUGGESTED",
        confidence: 0.8,
        reasoningSummary: "Purchased grid electricity consumed by the reporting organisation.",
        requiresReview: true,
        evidence: [],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a scope or category the platform doesn't recognise", () => {
    const base = {
      suggestedDataPointCode: null,
      suggestedSubtypeKey: null,
      suggestedUnit: null,
      alternativeCategories: [],
      missingInformation: [],
      overall: {
        state: "NEEDS_REVIEW",
        confidence: 0.4,
        reasoningSummary: "Unclear.",
        requiresReview: true,
        evidence: [],
      },
    };
    expect(emissionClassificationResultSchema.safeParse({ ...base, scope: "SCOPE_4", category: "UNKNOWN" }).success).toBe(false);
    expect(
      emissionClassificationResultSchema.safeParse({ ...base, scope: "SCOPE_3", category: "SCOPE_3_CAT_99_MADE_UP" })
        .success,
    ).toBe(false);
  });
});

describe("emissionFactorSuggestionSchema", () => {
  it("accepts an explicit no-factor-found answer", () => {
    const parsed = emissionFactorSuggestionSchema.safeParse({
      suggestedFactorId: null,
      alternativeFactorIds: [],
      noFactorFound: true,
      reason: "None of the candidates covers this activity in this region.",
      missingInformation: ["Region of the supplying site"],
      overall: {
        state: "INSUFFICIENT_DATA",
        confidence: 0.9,
        reasoningSummary: "No candidate factor applies.",
        requiresReview: true,
        evidence: [],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("has no field a factor value could be returned in", () => {
    const schemaJson = toProviderJsonSchema(emissionFactorSuggestionSchema);
    const properties = Object.keys((schemaJson as { properties: Record<string, unknown> }).properties);
    expect(properties).not.toContain("co2eFactor");
    expect(properties).not.toContain("factorValue");
    expect(properties).toContain("suggestedFactorId");
  });
});

describe("toProviderJsonSchema", () => {
  it("produces a schema with no $schema key and closed objects", () => {
    const json = toProviderJsonSchema(lcaReviewResultSchema) as Record<string, unknown>;
    expect(json.$schema).toBeUndefined();
    expect(json.additionalProperties).toBe(false);
    expect(json.type).toBe("object");
  });

  it("expresses nullable fields as a type union rather than anyOf", () => {
    const json = toProviderJsonSchema(emissionFactorSuggestionSchema) as {
      properties: { suggestedFactorId: { type: unknown; anyOf?: unknown } };
    };
    expect(json.properties.suggestedFactorId.anyOf).toBeUndefined();
    expect(json.properties.suggestedFactorId.type).toEqual(["string", "null"]);
  });

  it("lists every property as required, so an unknown comes back as an explicit null", () => {
    const json = toProviderJsonSchema(emissionClassificationResultSchema) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(json.required.sort()).toEqual(Object.keys(json.properties).sort());
  });
});

describe("extractJsonObject", () => {
  it("parses a bare JSON object", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("recovers JSON from a markdown code fence", () => {
    expect(extractJsonObject('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });

  it("recovers JSON a model wrapped in a sentence", () => {
    expect(extractJsonObject('Here you go: {"a":3} — hope that helps.')).toEqual({ a: 3 });
  });

  it("throws on a reply with no JSON object at all", () => {
    expect(() => extractJsonObject("I can't answer that.")).toThrow();
    expect(() => extractJsonObject("")).toThrow();
  });
});

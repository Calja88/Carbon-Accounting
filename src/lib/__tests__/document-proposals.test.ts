import { describe, expect, it } from "vitest";
import { buildProposals, derivePeriod } from "@/lib/document-proposals";
import type { DocumentExtractionResult } from "@/lib/ai/schemas";

/**
 * Turning an extraction into entry proposals is a rule, not a model output —
 * so it is tested like one. The cases that matter most are the ones where the
 * platform has to decline: waste, water and freight have no data point yet,
 * and must surface as explicit gaps rather than be forced into a category
 * that means something else.
 */

function extraction(overrides: Partial<DocumentExtractionResult> = {}): DocumentExtractionResult {
  return {
    documentKind: "ELECTRICITY_INVOICE",
    metadata: {
      supplier: "Example Energy",
      accountReference: null,
      invoiceNumber: null,
      invoiceDate: "2026-02-10",
      billingPeriodStart: "2026-01-01",
      billingPeriodEnd: "2026-01-31",
      siteNameOnDocument: null,
      addressOnDocument: null,
    },
    energy: {
      electricityKwh: null,
      electricityDayKwh: null,
      electricityNightKwh: null,
      gasKwh: null,
      gasVolumeM3: null,
      fuelLitres: null,
      fuelType: null,
      meterNumber: null,
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
    missingFields: [],
    warnings: [],
    containsSuspiciousInstructions: false,
    overall: {
      state: "CONFIRMED",
      confidence: 0.95,
      reasoningSummary: "test",
      requiresReview: true,
      evidence: [],
    },
    ...overrides,
  };
}

describe("derivePeriod", () => {
  it("uses the billing period start month", () => {
    const period = derivePeriod(extraction());
    expect(period.periodInput).toBe("2026-01");
    expect(period.warning).toBeNull();
  });

  it("warns when the billing period crosses a month boundary", () => {
    const period = derivePeriod(
      extraction({
        metadata: { ...extraction().metadata, billingPeriodStart: "2026-01-15", billingPeriodEnd: "2026-02-14" },
      }),
    );
    expect(period.periodInput).toBe("2026-01");
    expect(period.warning).toMatch(/crosses a month boundary/);
  });

  it("falls back to the invoice date, saying so", () => {
    const period = derivePeriod(
      extraction({
        metadata: { ...extraction().metadata, billingPeriodStart: null, billingPeriodEnd: null },
      }),
    );
    expect(period.periodInput).toBe("2026-02");
    expect(period.basis).toMatch(/Invoice date/);
    expect(period.warning).toMatch(/Check it/);
  });

  it("returns nothing rather than guessing when no date can be read", () => {
    const period = derivePeriod(
      extraction({
        metadata: {
          ...extraction().metadata,
          billingPeriodStart: null,
          billingPeriodEnd: null,
          invoiceDate: "sometime in the new year",
        },
      }),
    );
    expect(period.periodInput).toBeNull();
    expect(period.warning).toMatch(/choose the period/);
  });
});

describe("buildProposals", () => {
  it("proposes a Scope 2 electricity entry from a kWh figure", () => {
    const { proposals } = buildProposals(
      extraction({ energy: { ...extraction().energy, electricityKwh: 12450 } }),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ dataPointCode: "S2-01", quantity: 12450, unit: "kWh", periodInput: "2026-01" });
  });

  it("flags a stated renewable tariff as something to record on the contract, not the entry", () => {
    const { proposals } = buildProposals(
      extraction({
        energy: { ...extraction().energy, electricityKwh: 100, renewableTariffStated: true },
      }),
    );
    expect(proposals[0].needsAttention.join(" ")).toMatch(/market-based/);
  });

  it("prefers a gas kWh figure over a volume when the document gives both", () => {
    const { proposals } = buildProposals(
      extraction({ energy: { ...extraction().energy, gasKwh: 5000, gasVolumeM3: 470 } }),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ dataPointCode: "S1-01", quantity: 5000, unit: "kWh" });
  });

  it("passes a gas volume through in m3 and leaves the conversion to the platform", () => {
    const { proposals } = buildProposals(
      extraction({ energy: { ...extraction().energy, gasVolumeM3: 470 } }),
    );
    expect(proposals[0]).toMatchObject({ dataPointCode: "S1-01", quantity: 470, unit: "m3" });
    expect(proposals[0].basis).toMatch(/converts m³ to kWh itself/);
  });

  it("resolves a fuel sub-type only when the document says it plainly", () => {
    const diesel = buildProposals(
      extraction({ energy: { ...extraction().energy, fuelLitres: 400, fuelType: "Diesel (B7)" } }),
    );
    expect(diesel.proposals[0].subtypeKey).toBe("diesel");

    const unclear = buildProposals(
      extraction({ energy: { ...extraction().energy, fuelLitres: 400, fuelType: "Fuel" } }),
    );
    expect(unclear.proposals[0].subtypeKey).toBeNull();
    expect(unclear.proposals[0].needsAttention.join(" ")).toMatch(/couldn't be determined/);
  });

  it("reports waste as unmapped rather than forcing it into a category that isn't built", () => {
    const { proposals, unmapped } = buildProposals(
      extraction({
        documentKind: "WASTE_TRANSFER_NOTE",
        waste: {
          lines: [
            {
              description: "Mixed municipal waste",
              ewcCode: "20 03 01",
              weight: 1.2,
              weightUnit: "tonnes",
              treatmentMethod: "Energy recovery",
              disposalOrRecovery: "R1",
            },
          ],
          carrierName: "Example Waste Ltd",
          carrierRegistrationNumber: "CBDU12345",
          destinationSite: "Example EfW",
          transferDate: "2026-01-20",
          wtnReference: "WTN-001",
        },
      }),
    );

    expect(proposals).toHaveLength(0);
    expect(unmapped.length).toBeGreaterThanOrEqual(2);
    // The EWC code identifies the line; the weight and treatment describe it.
    expect(unmapped[0].label).toContain("20 03 01");
    expect(unmapped[0].detail).toContain("1.2 tonnes");
    expect(unmapped.map((u) => u.reason).join(" ")).toMatch(/Category 5/);
    // Duty-of-care details are retained against the document, not discarded.
    expect(unmapped.map((u) => u.detail).join(" ")).toContain("WTN-001");
  });

  it("reports freight as unmapped rather than guessing it into business travel", () => {
    const { proposals, unmapped } = buildProposals(
      extraction({
        transport: { ...extraction().transport, mode: "Road freight", distance: 320, distanceUnit: "km" },
      }),
    );
    expect(proposals).toHaveLength(0);
    expect(unmapped[0].reason).toMatch(/Categories 4 and 9/);
  });

  it("reports water as unmapped, keeping the figures visible", () => {
    const { unmapped } = buildProposals(
      extraction({ water: { waterConsumption: 320, waterUnit: "m3", wastewaterVolume: 290, wastewaterUnit: "m3" } }),
    );
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0].detail).toContain("320");
  });

  it("proposes nothing at all from a document with no usable figures", () => {
    const { proposals, unmapped } = buildProposals(extraction());
    expect(proposals).toHaveLength(0);
    expect(unmapped).toHaveLength(0);
  });

  it("ignores a zero quantity rather than creating an empty entry", () => {
    const { proposals } = buildProposals(extraction({ energy: { ...extraction().energy, electricityKwh: 0 } }));
    expect(proposals).toHaveLength(0);
  });
});

/**
 * A bill can print the same consumption more than one way — a total, a
 * day/night split, a pair of meter readings. Deciding what that means is a
 * methodology rule, so it lives in code and is tested here rather than being
 * left to a model to reconcile.
 */
describe("several figures for one consumption", () => {
  it("adds a day/night split into one entry, because the factor doesn't vary by time of use", () => {
    const { proposals, blocked } = buildProposals(
      extraction({
        energy: { ...extraction().energy, electricityKwh: null, electricityDayKwh: 12000, electricityNightKwh: 6420 },
      }),
    );

    expect(blocked).toHaveLength(0);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].quantity).toBe(18420);
    expect(proposals[0].basis).toContain("added together");
  });

  it("keeps the printed total when the split agrees with it", () => {
    const { proposals } = buildProposals(
      extraction({
        energy: { ...extraction().energy, electricityKwh: 18420, electricityDayKwh: 12000, electricityNightKwh: 6420 },
      }),
    );
    expect(proposals[0].quantity).toBe(18420);
    expect(proposals[0].basis).toContain("agree with it");
  });

  it("records nothing when the total and the split disagree", () => {
    const { proposals, blocked } = buildProposals(
      extraction({
        energy: { ...extraction().energy, electricityKwh: 18420, electricityDayKwh: 12000, electricityNightKwh: 2000 },
      }),
    );

    expect(proposals).toHaveLength(0);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].conflicts[0]).toContain("18420");
    expect(blocked[0].conflicts[0]).toContain("14000");
  });

  it("records nothing when the meter readings don't produce the stated consumption", () => {
    const { proposals, blocked } = buildProposals(
      extraction({
        energy: {
          ...extraction().energy,
          electricityKwh: 18420,
          meterReadingPrevious: 100000,
          meterReadingCurrent: 105000,
        },
      }),
    );

    expect(proposals).toHaveLength(0);
    expect(blocked[0].conflicts[0]).toContain("100000");
  });

  it("accepts meter readings that do produce it", () => {
    const { proposals, blocked } = buildProposals(
      extraction({
        energy: {
          ...extraction().energy,
          electricityKwh: 18420,
          meterReadingPrevious: 100000,
          meterReadingCurrent: 118420,
        },
      }),
    );
    expect(blocked).toHaveLength(0);
    expect(proposals).toHaveLength(1);
  });

  it("says so when only one half of a split could be read", () => {
    const { proposals } = buildProposals(
      extraction({ energy: { ...extraction().energy, electricityKwh: null, electricityDayKwh: 12000 } }),
    );
    expect(proposals).toHaveLength(0);
  });

  it("proposes an entry per activity when one document carries several", () => {
    const { proposals } = buildProposals(
      extraction({
        energy: { ...extraction().energy, electricityKwh: 18420, gasKwh: 4200, fuelLitres: 300, fuelType: "Diesel" },
      }),
    );

    expect(proposals.map((p) => p.dataPointCode).sort()).toEqual(["S1-01", "S1-03", "S2-01"]);
    expect(proposals.find((p) => p.dataPointCode === "S1-03")?.subtypeKey).toBe("diesel");
  });
});

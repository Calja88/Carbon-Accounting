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
      billingSections: [],
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

  it("aggregates two consecutive billing sections deterministically (Corona Energy IN0002774528 regression)", () => {
    // Real invoice: two consecutive billing periods on one meter within a
    // single document. Day/night must be summed per band, never taken from
    // a model-produced single total — see A1-A4 in the brief.
    const { proposals } = buildProposals(
      extraction({
        energy: {
          ...extraction().energy,
          electricityKwh: null,
          billingSections: [
            {
              startDate: "2025-02-01",
              endDate: "2025-02-20",
              meterSerial: "MG20K00242",
              mpan: null,
              dayKwh: 77874.6,
              nightKwh: 22848.2,
              otherKwh: null,
            },
            {
              startDate: "2025-02-21",
              endDate: "2025-02-28",
              meterSerial: "MG20K00242",
              mpan: null,
              dayKwh: 32812.9,
              nightKwh: 9453.4,
              otherKwh: null,
            },
          ],
        },
      }),
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0].dataPointCode).toBe("S2-01");
    expect(proposals[0].quantity).toBeCloseTo(142989.1, 3);
    expect(proposals[0].provenance).toBe("DERIVED");
    expect(proposals[0].basis).toMatch(/Calculated from invoice figures/);
    // Never the unsupported model-only total from this scenario.
    expect(proposals[0].quantity).not.toBeCloseTo(130414.1, 1);
  });

  it("keeps separate meters/MPANs as separate proposals rather than aggregating them together", () => {
    const { proposals } = buildProposals(
      extraction({
        energy: {
          ...extraction().energy,
          billingSections: [
            { startDate: "2025-02-01", endDate: "2025-02-28", meterSerial: "METER-A", mpan: null, dayKwh: 100, nightKwh: 50, otherKwh: null },
            { startDate: "2025-02-01", endDate: "2025-02-28", meterSerial: "METER-B", mpan: null, dayKwh: 200, nightKwh: 20, otherKwh: null },
          ],
        },
      }),
    );

    expect(proposals).toHaveLength(2);
    expect(proposals.map((p) => p.quantity).sort()).toEqual([150, 220]);
  });

  it("uses the single stated total when the document has no billing sections to derive from", () => {
    const { proposals } = buildProposals(
      extraction({ energy: { ...extraction().energy, electricityKwh: 12450 } }),
    );
    expect(proposals[0].provenance).toBe("SOURCE_STATED");
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

  it("proposes a Category 5 waste entry when weight and treatment route are both clear", () => {
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

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      dataPointCode: "S3-05",
      quantity: 1200, // 1.2 tonnes normalised to kg
      unit: "kg",
      subtypeKey: "incinerated_energy_recovery",
      provenance: "SOURCE_STATED",
    });
    expect(proposals[0].label).toContain("20 03 01");
    // Duty-of-care details are retained against the document, not discarded.
    expect(unmapped.map((u) => u.detail).join(" ")).toContain("WTN-001");
  });

  it("does not auto-log waste when the treatment route isn't clear from the document — the EWC code alone doesn't decide it", () => {
    const { proposals, unmapped } = buildProposals(
      extraction({
        documentKind: "WASTE_TRANSFER_NOTE",
        waste: {
          lines: [
            {
              description: "Mixed waste",
              ewcCode: "20 03 01",
              weight: 740,
              weightUnit: "kg",
              treatmentMethod: null,
              disposalOrRecovery: null,
            },
          ],
          carrierName: null,
          carrierRegistrationNumber: null,
          destinationSite: null,
          transferDate: null,
          wtnReference: null,
        },
      }),
    );

    expect(proposals).toHaveLength(0);
    expect(unmapped[0].reason).toMatch(/treatment route/);
  });

  it("converts waste weight in tonnes to kg deterministically for the proposal", () => {
    const { proposals } = buildProposals(
      extraction({
        waste: {
          lines: [
            { description: "Cardboard", ewcCode: "15 01 01", weight: 0.74, weightUnit: "tonnes", treatmentMethod: "Recycled", disposalOrRecovery: null },
          ],
          carrierName: null,
          carrierRegistrationNumber: null,
          destinationSite: null,
          transferDate: null,
          wtnReference: null,
        },
      }),
    );
    expect(proposals[0]).toMatchObject({ quantity: 740, unit: "kg", subtypeKey: "recycled" });
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

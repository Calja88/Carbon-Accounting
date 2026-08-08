/**
 * Turns a validated document extraction into concrete, reviewable entry
 * proposals against the activity data points this platform actually collects.
 *
 * Deterministic on purpose. The model transcribed the document; deciding
 * "12,450 kWh of electricity means an S2-01 entry in kWh for January 2026" is
 * a rule, and rules belong in code where they can be read and tested. The
 * model is never asked to name a data point here.
 *
 * Where the platform has no home for something the document contains — waste
 * tonnages, for instance, because Scope 3 Category 5 isn't built — that is
 * reported as an explicit gap. The extracted values stay visible and the
 * document stays as evidence; they simply don't become an entry, rather than
 * being quietly dropped or forced into a data point that doesn't mean the
 * same thing.
 */

import type { DocumentExtractionResult } from "@/lib/ai/schemas";

export interface EntryProposal {
  /** Stable key for form field names on the review screen. */
  key: string;
  dataPointCode: string;
  label: string;
  quantity: number;
  unit: string;
  /** FactorOption.subtypeKey where the document pins the sub-type down. */
  subtypeKey: string | null;
  /** "YYYY-MM" or "YYYY-MM-DD" for the period picker. */
  periodInput: string | null;
  /** Why this proposal exists — shown next to it on the review screen. */
  basis: string;
  /** Anything the reviewer must supply or check before accepting. */
  needsAttention: string[];
}

export interface UnmappedFinding {
  label: string;
  detail: string;
  /** Why the platform can't turn this into an entry yet. */
  reason: string;
}

export interface ProposalSet {
  proposals: EntryProposal[];
  unmapped: UnmappedFinding[];
  /** Period the platform derived, if the document gave one. */
  derivedPeriodInput: string | null;
  derivedPeriodBasis: string | null;
}

const ISO_DATE = /^(\d{4})-(\d{2})(?:-(\d{2}))?/;

/** Parses a date string only when it is unambiguous. A guess would be worse than a null. */
function parseIsoish(value: string | null): { year: number; month: number } | null {
  if (!value) return null;
  const match = value.trim().match(ISO_DATE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function toMonthInput(parts: { year: number; month: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

/**
 * The billing period start decides the accounting period, matching how the
 * rest of the platform treats a monthly entry. A period spanning more than
 * one month is flagged rather than silently attributed to one of them.
 */
export function derivePeriod(result: DocumentExtractionResult): { periodInput: string | null; basis: string | null; warning: string | null } {
  const start = parseIsoish(result.metadata.billingPeriodStart);
  const end = parseIsoish(result.metadata.billingPeriodEnd);

  if (start) {
    const spansMonths = end && (end.year !== start.year || end.month !== start.month);
    return {
      periodInput: toMonthInput(start),
      basis: `Billing period starting ${result.metadata.billingPeriodStart}`,
      warning: spansMonths
        ? `The billing period runs from ${result.metadata.billingPeriodStart} to ${result.metadata.billingPeriodEnd}, which crosses a month boundary. The whole amount would be recorded against ${toMonthInput(start)} — split it by hand if that isn't right.`
        : null,
    };
  }

  const invoiceDate = parseIsoish(result.metadata.invoiceDate);
  if (invoiceDate) {
    return {
      periodInput: toMonthInput(invoiceDate),
      basis: `Invoice date ${result.metadata.invoiceDate} (no billing period was printed)`,
      warning: "No billing period was found on the document, so the invoice date's month is offered as a starting point. Check it.",
    };
  }

  return { periodInput: null, basis: null, warning: "No date on the document could be read, so you'll need to choose the period." };
}

/** Maps a printed fuel description onto an S1-03 sub-type, or null if it isn't clear-cut. */
function fuelSubtype(fuelType: string | null): string | null {
  if (!fuelType) return null;
  const text = fuelType.toLowerCase();
  if (text.includes("diesel")) return "diesel";
  if (text.includes("petrol") || text.includes("unleaded") || text.includes("gasoline")) return "petrol";
  return null;
}

export function buildProposals(result: DocumentExtractionResult): ProposalSet {
  const proposals: EntryProposal[] = [];
  const unmapped: UnmappedFinding[] = [];

  const period = derivePeriod(result);
  const periodWarnings = period.warning ? [period.warning] : [];

  const { energy, water, waste, transport } = result;

  if (energy.electricityKwh !== null && energy.electricityKwh > 0) {
    proposals.push({
      key: "electricity",
      dataPointCode: "S2-01",
      label: "Grid electricity consumption",
      quantity: energy.electricityKwh,
      unit: "kWh",
      subtypeKey: null,
      periodInput: period.periodInput,
      basis: "Electricity consumption in kWh read from the document.",
      needsAttention: [
        ...periodWarnings,
        ...(energy.renewableTariffStated
          ? ["The document mentions a renewable tariff. Record the supplier, tariff and any REGO volume on the site's electricity contract — that, not this entry, drives the market-based figure."]
          : []),
      ],
    });
  }

  if (energy.gasKwh !== null && energy.gasKwh > 0) {
    proposals.push({
      key: "gas-kwh",
      dataPointCode: "S1-01",
      label: "Natural gas — facilities",
      quantity: energy.gasKwh,
      unit: "kWh",
      subtypeKey: null,
      periodInput: period.periodInput,
      basis: "Gas consumption in kWh read from the document.",
      needsAttention: periodWarnings,
    });
  } else if (energy.gasVolumeM3 !== null && energy.gasVolumeM3 > 0) {
    proposals.push({
      key: "gas-m3",
      dataPointCode: "S1-01",
      label: "Natural gas — facilities",
      quantity: energy.gasVolumeM3,
      unit: "m3",
      subtypeKey: null,
      periodInput: period.periodInput,
      basis: "Gas volume in cubic metres read from the document. The platform converts m³ to kWh itself using its published constants.",
      needsAttention: periodWarnings,
    });
  }

  if (energy.fuelLitres !== null && energy.fuelLitres > 0) {
    const subtype = fuelSubtype(energy.fuelType);
    proposals.push({
      key: "fuel",
      dataPointCode: "S1-03",
      label: "Company-owned/leased vehicle fuel",
      quantity: energy.fuelLitres,
      unit: "litres",
      subtypeKey: subtype,
      periodInput: period.periodInput,
      basis: `Fuel volume in litres read from the document${energy.fuelType ? ` (described as "${energy.fuelType}")` : ""}.`,
      needsAttention: [
        ...periodWarnings,
        ...(subtype
          ? []
          : ["The fuel type couldn't be determined from the document — choose petrol or diesel before accepting."]),
        "Check this fuel was for company-owned or leased vehicles. Fuel for a generator belongs under S1-02, and mileage claimed by an employee for their own car belongs under S1-04.",
      ],
    });
  }

  // --- Things the document contains that this platform has no home for ----

  if (water.waterConsumption !== null && water.waterConsumption > 0) {
    unmapped.push({
      label: "Water consumption",
      detail: `${water.waterConsumption}${water.waterUnit ? ` ${water.waterUnit}` : ""}${water.wastewaterVolume !== null ? `, wastewater ${water.wastewaterVolume}${water.wastewaterUnit ? ` ${water.wastewaterUnit}` : ""}` : ""}`,
      reason:
        "This platform has no water data point yet — water supply and treatment sit under Scope 3 Category 5, which isn't part of the current build. The figures stay on this document as evidence.",
    });
  }

  if (waste.lines.length > 0) {
    for (const [index, line] of waste.lines.entries()) {
      unmapped.push({
        label: `Waste line ${index + 1}${line.ewcCode ? ` (EWC ${line.ewcCode})` : ""}`,
        detail: [
          line.description,
          line.weight !== null ? `${line.weight}${line.weightUnit ? ` ${line.weightUnit}` : ""}` : null,
          line.treatmentMethod,
          line.disposalOrRecovery,
        ]
          .filter(Boolean)
          .join(" · ") || "No details read",
        reason:
          "Scope 3 Category 5 (waste generated in operations) isn't built in this platform yet, so there's no data point to record this against. The Waste Transfer Note is kept as evidence and the extracted detail stays here for when Category 5 is added.",
      });
    }
    if (waste.carrierName || waste.wtnReference || waste.destinationSite) {
      unmapped.push({
        label: "Waste Transfer Note details",
        detail: [
          waste.wtnReference ? `Reference ${waste.wtnReference}` : null,
          waste.carrierName ? `Carrier ${waste.carrierName}` : null,
          waste.carrierRegistrationNumber ? `Carrier registration ${waste.carrierRegistrationNumber}` : null,
          waste.destinationSite ? `Destination ${waste.destinationSite}` : null,
          waste.transferDate ? `Transferred ${waste.transferDate}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        reason: "Retained as duty-of-care evidence against this document.",
      });
    }
  }

  if (transport.distance !== null || transport.tonneKm !== null) {
    unmapped.push({
      label: "Freight movement",
      detail: [
        transport.mode,
        transport.vehicleType,
        transport.distance !== null ? `${transport.distance}${transport.distanceUnit ? ` ${transport.distanceUnit}` : ""}` : null,
        transport.weight !== null ? `${transport.weight}${transport.weightUnit ? ` ${transport.weightUnit}` : ""}` : null,
        transport.tonneKm !== null ? `${transport.tonneKm} tonne-km` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      reason:
        "Upstream and downstream freight are Scope 3 Categories 4 and 9, which aren't built in this platform yet. Recorded here as evidence rather than guessed into business travel, which is a different category with different factors.",
    });
  }

  return {
    proposals,
    unmapped,
    derivedPeriodInput: period.periodInput,
    derivedPeriodBasis: period.basis,
  };
}

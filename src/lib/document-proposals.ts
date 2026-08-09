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

/**
 * A2/A6: how a proposed quantity was arrived at, shown on the review screen
 * instead of a blanket confidence percentage. SOURCE_STATED means the
 * figure is legible as a single value on the document; DERIVED means the
 * platform calculated it deterministically from other source figures (e.g.
 * summing two billing sections' day readings); AI_INFERRED is never used
 * for a quantity here — extraction transcribes, it never infers a number.
 */
export type ProposalProvenance = "SOURCE_STATED" | "DERIVED";

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
  provenance: ProposalProvenance;
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

/** Rounds away floating-point noise from summing decimal invoice figures (e.g. 77874.6 + 32812.9) without losing precision that matters. */
function roundKwh(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function fmtKwh(value: number): string {
  return value.toLocaleString("en-GB", { maximumFractionDigits: 3 });
}

type BillingSection = DocumentExtractionResult["energy"]["billingSections"][number];

interface ElectricityAggregate {
  meterKey: string | null;
  sectionCount: number;
  dayKwh: number | null;
  nightKwh: number | null;
  otherKwh: number | null;
  totalKwh: number;
  summary: string;
}

/**
 * A1/A4: groups billing sections by meter identity and sums each band
 * deterministically. Sections with no meter identity printed are treated as
 * one meter (the common case: a single-meter invoice with two consecutive
 * date ranges). Sections that do name distinct meters/MPANs are kept in
 * separate groups — never summed together, per A1's "never blindly
 * aggregate multiple independent meters/MPANs".
 */
function aggregateElectricityBillingSections(sections: BillingSection[]): ElectricityAggregate[] {
  const meaningful = sections.filter((s) => s.dayKwh !== null || s.nightKwh !== null || s.otherKwh !== null);
  const groups = new Map<string, BillingSection[]>();
  for (const section of meaningful) {
    const key = section.meterSerial?.trim() || section.mpan?.trim() || "__unspecified__";
    groups.set(key, [...(groups.get(key) ?? []), section]);
  }

  return Array.from(groups.entries()).map(([key, group]) => {
    let day = 0,
      night = 0,
      other = 0;
    let hasDay = false,
      hasNight = false,
      hasOther = false;
    const parts: string[] = [];
    for (const section of group) {
      const bandParts: string[] = [];
      if (section.dayKwh !== null) {
        day += section.dayKwh;
        hasDay = true;
        bandParts.push(`day ${fmtKwh(section.dayKwh)}`);
      }
      if (section.nightKwh !== null) {
        night += section.nightKwh;
        hasNight = true;
        bandParts.push(`night ${fmtKwh(section.nightKwh)}`);
      }
      if (section.otherKwh !== null) {
        other += section.otherKwh;
        hasOther = true;
        bandParts.push(`${fmtKwh(section.otherKwh)}`);
      }
      const range = section.startDate && section.endDate ? `${section.startDate}–${section.endDate}` : section.startDate ?? section.endDate;
      parts.push(`${range ? `${range}: ` : ""}${bandParts.join(", ")}`);
    }

    return {
      meterKey: key === "__unspecified__" ? null : key,
      sectionCount: group.length,
      dayKwh: hasDay ? roundKwh(day) : null,
      nightKwh: hasNight ? roundKwh(night) : null,
      otherKwh: hasOther ? roundKwh(other) : null,
      totalKwh: roundKwh(day + night + other),
      summary: parts.join("; "),
    };
  });
}

type WasteLine = DocumentExtractionResult["waste"]["lines"][number];

/** D1/B2: kg and tonnes only, matched case-insensitively against the units this platform expects on a WTN. Anything else is left unresolved rather than guessed. */
function normalizeWasteWeightKg(weight: number | null, unit: string | null): number | null {
  if (weight === null) return null;
  const u = (unit ?? "kg").trim().toLowerCase();
  if (["kg", "kgs", "kilogram", "kilograms"].includes(u)) return weight;
  if (["t", "te", "tonne", "tonnes", "ton", "tons", "metric tonne", "metric tonnes"].includes(u)) return weight * 1000;
  return null;
}

/**
 * D2: the treatment route comes only from what the document says the waste
 * was treated as (treatmentMethod / disposalOrRecovery text) — never from
 * the EWC code, which classifies the waste, not its fate. Returns null when
 * the text doesn't clearly resolve to one of the routes this platform has a
 * factor for, so the caller can ask rather than guess.
 */
function wasteTreatmentSubtype(line: WasteLine): string | null {
  const text = `${line.treatmentMethod ?? ""} ${line.disposalOrRecovery ?? ""}`.toLowerCase().trim();
  if (!text) return null;
  if (text.includes("landfill")) return "landfill";
  if (text.includes("anaerobic digest") || /\bad\b/.test(text)) return "anaerobic_digestion";
  if (text.includes("compost")) return "composted";
  if (text.includes("recycl")) return "recycled";
  if (text.includes("incinerat") || text.includes("energy recovery") || /\br1\b/.test(text)) {
    if (text.includes("without energy recovery") || text.includes("no energy recovery") || /\bd10\b/.test(text)) {
      return "incinerated_no_energy_recovery";
    }
    return "incinerated_energy_recovery";
  }
  return null;
}

export function buildProposals(result: DocumentExtractionResult): ProposalSet {
  const proposals: EntryProposal[] = [];
  const unmapped: UnmappedFinding[] = [];

  const period = derivePeriod(result);
  const periodWarnings = period.warning ? [period.warning] : [];

  const { energy, water, waste, transport } = result;

  // --- Electricity: multi-period billing sections take precedence -------
  //
  // A3/A4: billing sections are what the document actually printed, so a
  // deterministic sum of them is authoritative. `energy.electricityKwh` is
  // only ever used as a fallback for simple single-figure invoices with no
  // sections — it is never compared against the aggregate to manufacture a
  // "conflict", because a model-produced figure with no source line items
  // behind it isn't evidence of anything (A3: false total protection).
  const aggregates = aggregateElectricityBillingSections(energy.billingSections);

  if (aggregates.length > 0) {
    for (const agg of aggregates) {
      if (agg.totalKwh <= 0) continue;
      const multiSection = agg.sectionCount > 1;
      const meterNote = agg.meterKey ? ` (meter ${agg.meterKey})` : "";
      proposals.push({
        key: `electricity${agg.meterKey ? `-${agg.meterKey}` : ""}`,
        dataPointCode: "S2-01",
        label: `Grid electricity consumption${aggregates.length > 1 ? meterNote : ""}`,
        quantity: agg.totalKwh,
        unit: "kWh",
        subtypeKey: null,
        periodInput: period.periodInput,
        basis: multiSection
          ? `Calculated from invoice figures: ${agg.summary}. This document prints ${agg.sectionCount} separate billing sections${meterNote}; the platform adds each band across the sections deterministically rather than asking AI to do the arithmetic.`
          : `Electricity consumption in kWh read from the document (${agg.summary}).`,
        needsAttention: [
          ...periodWarnings,
          ...(energy.renewableTariffStated
            ? ["The document mentions a renewable tariff. Record the supplier, tariff and any REGO volume on the site's electricity contract — that, not this entry, drives the market-based figure."]
            : []),
          ...(aggregates.length > 1
            ? ["This document names more than one meter/MPAN. A separate entry has been proposed for each — check the totals are attributed to the right meter before accepting."]
            : []),
        ],
        provenance: multiSection ? "DERIVED" : "SOURCE_STATED",
      });
    }
  } else if (energy.electricityKwh !== null && energy.electricityKwh > 0) {
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
      provenance: "SOURCE_STATED",
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
      provenance: "SOURCE_STATED",
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
      provenance: "SOURCE_STATED",
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
      provenance: "SOURCE_STATED",
    });
  }

  // --- Things the document contains that this platform has no home for ----

  if (water.waterConsumption !== null && water.waterConsumption > 0) {
    unmapped.push({
      label: "Water consumption",
      detail: `${water.waterConsumption}${water.waterUnit ? ` ${water.waterUnit}` : ""}${water.wastewaterVolume !== null ? `, wastewater ${water.wastewaterVolume}${water.wastewaterUnit ? ` ${water.wastewaterUnit}` : ""}` : ""}`,
      reason: "This platform has no water data point yet. The figures stay on this document as evidence.",
    });
  }

  // --- Waste: Category 5 (Waste Generated in Operations) -----------------
  //
  // D2: EWC code alone never decides the treatment route — only
  // treatmentMethod/disposalOrRecovery text does. When that text doesn't
  // resolve to a known route the line is surfaced for the reviewer to
  // confirm by hand rather than logged automatically (D2/D5).
  if (waste.lines.length > 0) {
    for (const [index, line] of waste.lines.entries()) {
      const weightKg = normalizeWasteWeightKg(line.weight, line.weightUnit);
      const subtype = wasteTreatmentSubtype(line);
      const label = `Waste — ${line.description ?? "unspecified"}${line.ewcCode ? ` (EWC ${line.ewcCode})` : ""}`;

      if (weightKg !== null && weightKg > 0 && subtype) {
        proposals.push({
          key: `waste-${index}`,
          dataPointCode: "S3-05",
          label,
          quantity: weightKg,
          unit: "kg",
          subtypeKey: subtype,
          periodInput: parseIsoish(waste.transferDate) ? toMonthInput(parseIsoish(waste.transferDate)!) : period.periodInput,
          basis: `Waste weight and treatment route read from the document (${line.treatmentMethod ?? line.disposalOrRecovery ?? "treatment stated"}).`,
          needsAttention: [
            ...(waste.wtnReference ? [] : ["No Waste Transfer Note reference was found — check duty-of-care paperwork is complete."]),
          ],
          provenance: "SOURCE_STATED",
        });
      } else {
        unmapped.push({
          label,
          detail:
            [
              line.weight !== null ? `${line.weight}${line.weightUnit ? ` ${line.weightUnit}` : ""}` : null,
              line.treatmentMethod,
              line.disposalOrRecovery,
            ]
              .filter(Boolean)
              .join(" · ") || "No details read",
          reason:
            weightKg === null
              ? "The weight isn't stated, or its unit isn't kg or tonnes, so a Category 5 entry can't be created automatically."
              : "The treatment route for this waste isn't clearly stated (recycling, landfill, incineration, composting, anaerobic digestion, etc.) — the EWC code alone doesn't tell us. Confirm how it was treated before this can be logged against Scope 3 Category 5.",
        });
      }
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

/**
 * "How was this calculated?"
 *
 * Everything in here is read straight off the stored Calculation row and the
 * records around it — activity data, the snapshotted factor value, its source
 * and vintage, the equation as it was applied, and the evidence document if
 * one is linked. No AI is involved in producing any of it.
 *
 * The AI layer may take a `CalculationExplanation` and put it into plainer
 * English (see src/lib/ai/services/explain.ts). It is handed the finished
 * figures and told to restate them exactly; it cannot recompute, adjust or
 * round them, because it never sees the inputs in a form it could multiply.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface CalculationExplanation {
  calculationId: string;
  scope: string;
  basis: string;
  scope3Category: string | null;

  activity: {
    dataPointCode: string;
    dataPointName: string;
    siteName: string;
    entityName: string;
    periodLabel: string;
    rawValue: string;
    rawUnit: string;
    canonicalValue: string;
    canonicalUnit: string;
    unitConversionApplied: boolean;
    optionLabel: string | null;
    supplierName: string | null;
    dataOrigin: string;
    enteredBy: string;
    enteredAt: Date;
    notes: string | null;
  };

  factor: {
    id: string;
    value: string;
    unit: string;
    source: string;
    vintage: string;
    category: string;
    subtypeKey: string | null;
    region: string;
    publisher: string | null;
    sourceType: string | null;
    sourceUrl: string | null;
    importedAt: Date | null;
    isPlaceholder: boolean;
    factorNotes: string | null;
  };

  result: {
    equation: string;
    kgCo2e: string;
    tonnesCo2e: string;
    dataQualityTier: string;
    engineVersion: string;
    calculatedAt: Date;
    calculatedBy: string | null;
  };

  /** Set on Cat 3 rows derived from a Scope 1/2 calculation. */
  derivedFrom: { calculationId: string; description: string } | null;

  evidence: { documentId: string; filename: string; uploadedAt: Date }[];

  /** Caveats that come from the data itself, not from anyone's opinion. */
  caveats: string[];
}

function dec(value: Prisma.Decimal | number): string {
  const n = typeof value === "number" ? value : Number(value);
  // Trim trailing zeros without losing precision on small factors.
  return String(Number(n.toPrecision(12)));
}

function periodLabel(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" };
  const from = start.toLocaleDateString("en-GB", opts);
  const to = end.toLocaleDateString("en-GB", opts);
  return from === to ? from : `${from} – ${to}`;
}

/**
 * Builds the full deterministic explanation for one calculation, or null if
 * it doesn't exist. Callers are responsible for authorization before calling.
 */
export async function explainCalculation(calculationId: string): Promise<CalculationExplanation | null> {
  const calc = await prisma.calculation.findUnique({
    where: { id: calculationId },
    include: {
      calculatedBy: { select: { name: true } },
      emissionFactor: { include: { factorSet: true } },
      derivedFromCalculation: {
        include: { activityEntry: { include: { activityDataPoint: true } } },
      },
      activityEntry: {
        include: {
          activityDataPoint: true,
          factorOption: true,
          enteredBy: { select: { name: true } },
          site: { include: { entity: true } },
          sourceDocument: { select: { id: true, filename: true, uploadedAt: true } },
        },
      },
    },
  });

  if (!calc) return null;

  const entry = calc.activityEntry;
  const factorSet = calc.emissionFactor.factorSet;

  const caveats: string[] = [];
  if (factorSet.isPlaceholder) {
    caveats.push("This factor comes from a placeholder set that has not been verified against a published source.");
  }
  if (entry.plausibilityFlagged) {
    caveats.push(
      `This entry is flagged for review and is excluded from report totals until resolved: ${entry.plausibilityReason ?? "no reason recorded"}`,
    );
  }
  if (calc.basis === "RESIDUAL_MIX") {
    caveats.push(
      "The residual-mix basis is used because the site holds no REGO certificate or green tariff for this period.",
    );
  }
  if (entry.rawUnit !== entry.canonicalUnit) {
    caveats.push(
      `The entered value was converted from ${entry.rawUnit} to ${entry.canonicalUnit} before the factor was applied.`,
    );
  }
  if (calc.derivedFromCalculationId) {
    caveats.push(
      "This is an automatically derived upstream figure (Category 3), calculated from an existing Scope 1 or Scope 2 calculation rather than from a separate data entry.",
    );
  }
  if (entry.dataOrigin === "AI_EXTRACTED") {
    caveats.push(
      "The activity data behind this figure was read from an uploaded document by AI and then accepted by a person before it was saved.",
    );
  }

  return {
    calculationId: calc.id,
    scope: calc.scope,
    basis: calc.basis,
    scope3Category: calc.scope3Category,

    activity: {
      dataPointCode: entry.activityDataPoint.code,
      dataPointName: entry.activityDataPoint.dataPointName,
      siteName: entry.site.name,
      entityName: entry.site.entity.name,
      periodLabel: periodLabel(entry.periodStart, entry.periodEnd),
      rawValue: dec(entry.rawValue),
      rawUnit: entry.rawUnit,
      canonicalValue: dec(entry.canonicalValue),
      canonicalUnit: entry.canonicalUnit,
      unitConversionApplied: entry.rawUnit !== entry.canonicalUnit,
      optionLabel: entry.factorOption?.label ?? null,
      supplierName: entry.supplierName,
      dataOrigin: entry.dataOrigin,
      enteredBy: entry.enteredBy.name,
      enteredAt: entry.enteredAt,
      notes: entry.notes,
    },

    factor: {
      id: calc.emissionFactorId,
      value: dec(calc.factorValueSnapshot),
      unit: calc.factorUnitSnapshot,
      source: calc.factorSourceSnapshot,
      vintage: calc.factorVintageSnapshot,
      category: calc.emissionFactor.category,
      subtypeKey: calc.emissionFactor.subtypeKey,
      region: calc.emissionFactor.region,
      publisher: factorSet.publisher,
      sourceType: factorSet.sourceType,
      sourceUrl: factorSet.sourceUrl,
      importedAt: factorSet.createdAt,
      isPlaceholder: factorSet.isPlaceholder,
      factorNotes: calc.emissionFactor.notes,
    },

    result: {
      equation: calc.formulaApplied,
      kgCo2e: dec(calc.resultKgCo2e),
      tonnesCo2e: (Number(calc.resultKgCo2e) / 1000).toFixed(4),
      dataQualityTier: calc.dataQualityTier,
      engineVersion: calc.engineVersion,
      calculatedAt: calc.calculatedAt,
      calculatedBy: calc.calculatedBy?.name ?? null,
    },

    derivedFrom: calc.derivedFromCalculation
      ? {
          calculationId: calc.derivedFromCalculation.id,
          description: `${calc.derivedFromCalculation.activityEntry.activityDataPoint.dataPointName} (${calc.derivedFromCalculation.scope})`,
        }
      : null,

    evidence: entry.sourceDocument
      ? [
          {
            documentId: entry.sourceDocument.id,
            filename: entry.sourceDocument.filename,
            uploadedAt: entry.sourceDocument.uploadedAt,
          },
        ]
      : [],

    caveats,
  };
}

/**
 * The explanation as compact labelled text, for use as AI context. The model
 * is given the finished figures and asked to restate them — it never receives
 * the inputs in a form that invites it to recompute anything.
 */
export function formatExplanationForPrompt(explanation: CalculationExplanation): string {
  const e = explanation;
  return [
    `Scope: ${e.scope}${e.scope3Category ? ` (${e.scope3Category})` : ""}, basis ${e.basis}`,
    `Activity: ${e.activity.dataPointName} at ${e.activity.siteName} (${e.activity.entityName}), ${e.activity.periodLabel}`,
    e.activity.optionLabel ? `Type selected: ${e.activity.optionLabel}` : null,
    `Entered value: ${e.activity.rawValue} ${e.activity.rawUnit}`,
    e.activity.unitConversionApplied
      ? `Converted for calculation to: ${e.activity.canonicalValue} ${e.activity.canonicalUnit}`
      : null,
    `Emission factor used: ${e.factor.value} kgCO2e per ${e.factor.unit}`,
    `Factor source: ${e.factor.source} (publisher ${e.factor.publisher ?? "unknown"}, vintage ${e.factor.vintage}, region ${e.factor.region}, factor id ${e.factor.id})`,
    e.factor.sourceUrl ? `Factor source URL: ${e.factor.sourceUrl}` : null,
    `Equation applied: ${e.result.equation}`,
    `Result: ${e.result.kgCo2e} kgCO2e (${e.result.tonnesCo2e} tonnes CO2e)`,
    `Data quality tier: ${e.result.dataQualityTier}. Calculation engine: ${e.result.engineVersion}.`,
    e.derivedFrom ? `Derived from: ${e.derivedFrom.description}` : null,
    e.caveats.length > 0 ? `Caveats recorded by the platform: ${e.caveats.join(" ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

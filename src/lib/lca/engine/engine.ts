/**
 * The product carbon footprint calculation engine.
 *
 * Pure: no database, no clock, no randomness. The same snapshot in always
 * produces the same rows out, which is what makes a result reproducible from
 * an issued version months later.
 *
 * Every row it emits carries its own arithmetic — activity, conversion,
 * factor, methodology, adjustment, allocation, result — because a product
 * footprint that can't be taken apart and checked is not verifiable, however
 * neat the total looks.
 */

import {
  LcaAllocationMethod,
  LcaBiogenicTreatment,
  LcaEmissionClassification,
  LcaFactorBoundary,
  LcaFactorSelectionMode,
  LcaItemType,
  LcaOffsetTreatment,
} from "@prisma/client";
import { D, Decimal, HUNDRED, ONE, ZERO, percentToFactor, toDisplayString } from "../decimal";
import { allowsAvoidedBurden, biogenicInHeadline, biogenicTracked } from "../methodology";
import {
  convertWithTrail,
  IncompatibleUnitError,
  requireUnit,
  toTonneKilometres,
  UnknownUnitError,
  unitDimension,
} from "../units";
import { resolveAllocations, type ResolvedAllocation } from "./allocation";
import type {
  ClassifiedTotals,
  EngineAssessment,
  EngineDiagnostic,
  EngineFactor,
  EngineInventoryItem,
  EngineOutput,
  EngineProcess,
  EngineResultRow,
  EngineTotals,
  EngineTransportLeg,
  ProvenanceStep,
} from "./types";

export const LCA_ENGINE_VERSION = "lca-engine-v1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyClassifiedTotals(): ClassifiedTotals {
  return {
    fossil: ZERO,
    biogenicEmissions: ZERO,
    biogenicRemovals: ZERO,
    technologicalRemovals: ZERO,
    storedCarbon: ZERO,
    avoidedBurden: ZERO,
    offsets: ZERO,
  };
}

function addToClassified(totals: ClassifiedTotals, classification: LcaEmissionClassification, value: Decimal): void {
  switch (classification) {
    case LcaEmissionClassification.FOSSIL:
      totals.fossil = totals.fossil.plus(value);
      break;
    case LcaEmissionClassification.BIOGENIC:
      totals.biogenicEmissions = totals.biogenicEmissions.plus(value);
      break;
    case LcaEmissionClassification.BIOGENIC_REMOVAL:
      totals.biogenicRemovals = totals.biogenicRemovals.plus(value);
      break;
    case LcaEmissionClassification.TECHNOLOGICAL_REMOVAL:
      totals.technologicalRemovals = totals.technologicalRemovals.plus(value);
      break;
    case LcaEmissionClassification.STORED_CARBON:
      totals.storedCarbon = totals.storedCarbon.plus(value);
      break;
    case LcaEmissionClassification.AVOIDED_BURDEN:
      totals.avoidedBurden = totals.avoidedBurden.plus(value);
      break;
    case LcaEmissionClassification.OFFSET:
      totals.offsets = totals.offsets.plus(value);
      break;
  }
}

function divideClassified(totals: ClassifiedTotals, divisor: Decimal): ClassifiedTotals {
  if (divisor.isZero()) return { ...totals };
  return {
    fossil: totals.fossil.div(divisor),
    biogenicEmissions: totals.biogenicEmissions.div(divisor),
    biogenicRemovals: totals.biogenicRemovals.div(divisor),
    technologicalRemovals: totals.technologicalRemovals.div(divisor),
    storedCarbon: totals.storedCarbon.div(divisor),
    avoidedBurden: totals.avoidedBurden.div(divisor),
    offsets: totals.offsets.div(divisor),
  };
}

function meanDataQuality(item: EngineInventoryItem): Decimal | null {
  const scores = [
    item.dataQuality.temporal,
    item.dataQuality.geographical,
    item.dataQuality.technological,
    item.dataQuality.completeness,
    item.dataQuality.reliability,
  ].filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  if (scores.length === 0) return null;
  return scores.reduce<Decimal>((sum, s) => sum.plus(D(s)), ZERO).div(D(scores.length));
}

/**
 * Net input required once manufacturing loss is accounted for. A 10% loss
 * means 10 kg leaving the process needed 11.11 kg going in, not 11 kg — the
 * loss is a share of the input, not of the output.
 */
function applyWasteGrossUp(
  quantity: Decimal,
  wastePercent: Decimal | null,
): { value: Decimal; applied: boolean; note: string; problem: string | null } {
  if (!wastePercent || wastePercent.isZero()) {
    return { value: quantity, applied: false, note: "No manufacturing loss recorded.", problem: null };
  }
  if (wastePercent.lt(ZERO) || wastePercent.gte(HUNDRED)) {
    return {
      value: quantity,
      applied: false,
      note: `Recorded loss of ${wastePercent.toString()}% is outside 0–100% and has not been applied.`,
      problem: `Manufacturing loss of ${wastePercent.toString()}% is not a usable figure (it must be at least 0% and less than 100%).`,
    };
  }
  const grossed = quantity.div(ONE.minus(percentToFactor(wastePercent)));
  return {
    value: grossed,
    applied: true,
    note: `Grossed up for ${wastePercent.toString()}% manufacturing loss: ${toDisplayString(quantity)} / (1 - ${wastePercent.toString()}/100) = ${toDisplayString(grossed)}`,
    problem: null,
  };
}

interface RowBuildInput {
  keySuffix: string;
  item: EngineInventoryItem;
  process: EngineProcess;
  allocation: ResolvedAllocation;
  classification: LcaEmissionClassification;
  /** Label shown for this row — may differ from the item name for sub-rows. */
  displayName: string;
  activityValue: Decimal;
  activityUnit: string;
  factor: EngineFactor;
  adjustmentFactor: Decimal;
  /** Extra provenance inserted between "activity" and "unit conversion". */
  preConversionSteps: { label: string; detail: string; value?: string }[];
  methodologyNotes: string[];
  transportLegId?: string | null;
  endOfLifeRouteId?: string | null;
  functionalUnitsInModel: Decimal;
  /** Force a negative result (credits and removals). */
  negate?: boolean;
}

type RowBuildOutcome = { row: EngineResultRow } | { diagnostic: EngineDiagnostic };

function buildRow(input: RowBuildInput): RowBuildOutcome {
  const {
    item,
    process,
    allocation,
    factor,
    activityValue,
    activityUnit,
    adjustmentFactor,
    functionalUnitsInModel,
  } = input;

  let conversion;
  try {
    conversion = convertWithTrail(activityValue, activityUnit, factor.unit);
  } catch (err) {
    if (err instanceof IncompatibleUnitError || err instanceof UnknownUnitError) {
      return {
        diagnostic: {
          code: err instanceof UnknownUnitError ? "UNKNOWN_UNIT" : "INCOMPATIBLE_UNIT",
          severity: "error",
          message: `${input.displayName}: ${err.message}`,
          inventoryItemId: item.id,
          processId: process.id,
          itemName: input.displayName,
        },
      };
    }
    throw err;
  }

  const adjusted = conversion.value.times(adjustmentFactor);
  const signedFactorValue = input.negate ? factor.value.negated() : factor.value;
  const gross = adjusted.times(signedFactorValue);
  const allocated = gross.times(allocation.effectiveFactor);
  const perFunctionalUnit = functionalUnitsInModel.isZero() ? ZERO : allocated.div(functionalUnitsInModel);

  const steps: ProvenanceStep[] = [];
  let n = 1;
  const push = (label: string, detail: string, value?: string) => {
    steps.push({ step: n++, label, detail, value });
  };

  push(
    "Activity data",
    `${input.displayName} — entered as ${toDisplayString(item.quantity)} ${item.unit} (${item.dataType.toLowerCase().replace(/_/g, " ")} data${item.supplierName ? `, ${item.supplierName}` : ""}).`,
    `${toDisplayString(item.quantity)} ${item.unit}`,
  );

  for (const extra of input.preConversionSteps) {
    push(extra.label, extra.detail, extra.value);
  }

  push(
    "Unit conversion",
    conversion.note,
    `${toDisplayString(activityValue)} ${activityUnit} = ${toDisplayString(conversion.value)} ${factor.unit}`,
  );

  if (!adjustmentFactor.equals(ONE)) {
    push(
      "Adjustment",
      item.adjustmentRationale ?? "Adjustment factor applied to the converted quantity.",
      `x ${toDisplayString(adjustmentFactor)} = ${toDisplayString(adjusted)} ${factor.unit}`,
    );
  }

  push(
    "Emission factor",
    `${factor.source} (version ${factor.version})${factor.geography ? `, ${factor.geography}` : ""}${factor.year ? `, ${factor.year} data` : ""}. Boundary: ${factor.boundary.replace(/_/g, " ").toLowerCase()}. GWP basis: ${factor.gwpBasis ?? "not stated"}.${factor.isPlaceholder ? " NOT VERIFIED — placeholder value." : ""}`,
    `${toDisplayString(factor.value, 10)} kgCO2e per ${factor.unit}`,
  );

  push(
    "Methodology",
    input.methodologyNotes.length > 0
      ? input.methodologyNotes.join(" ")
      : "No methodology adjustment bears on this line beyond the assessment's general configuration.",
    input.classification === LcaEmissionClassification.FOSSIL ? undefined : `Classified as ${input.classification.replace(/_/g, " ").toLowerCase()}`,
  );

  push(
    "Allocation",
    allocation.own.method === LcaAllocationMethod.NONE && allocation.effectiveFactor.equals(ONE)
      ? "No multi-output allocation applies to this process."
      : `${allocation.own.basis}${allocation.chain ? ` (chain: ${allocation.chain})` : ""}`,
    `x ${toDisplayString(allocation.effectiveFactor, 8)}`,
  );

  const formula = `${toDisplayString(conversion.value)} ${factor.unit}${adjustmentFactor.equals(ONE) ? "" : ` x ${toDisplayString(adjustmentFactor)}`} x ${toDisplayString(signedFactorValue, 10)} kgCO2e/${factor.unit}${allocation.effectiveFactor.equals(ONE) ? "" : ` x ${toDisplayString(allocation.effectiveFactor, 8)} allocation`} = ${toDisplayString(allocated)} kgCO2e`;

  push("Calculation", formula, `${toDisplayString(allocated)} kgCO2e`);

  push(
    "Result",
    functionalUnitsInModel.isZero()
      ? "Per-functional-unit figure unavailable — the functional unit could not be resolved."
      : `${toDisplayString(allocated)} kgCO2e / ${toDisplayString(functionalUnitsInModel)} functional units in the model.`,
    `${toDisplayString(perFunctionalUnit, 8)} kgCO2e per functional unit`,
  );

  return {
    row: {
      key: `${item.id}${input.keySuffix}`,
      inventoryItemId: item.id,
      processId: process.id,
      transportLegId: input.transportLegId ?? null,
      endOfLifeRouteId: input.endOfLifeRouteId ?? null,
      stage: process.stage,
      processName: process.name,
      itemName: input.displayName,
      itemType: item.itemType,
      classification: input.classification,
      activityValue,
      activityUnit,
      conversionFactor: conversion.factor,
      normalizedValue: adjusted,
      normalizedUnit: factor.unit,
      factorValue: signedFactorValue,
      factorUnit: factor.unit,
      factorSource: factor.source,
      factorVersion: factor.version,
      factorBoundary: factor.boundary,
      factorGeography: factor.geography,
      factorYear: factor.year,
      factorGwpBasis: factor.gwpBasis,
      factorSelectionMode: factor.selectionMode,
      emissionFactorId: factor.emissionFactorId,
      isPlaceholderFactor: factor.isPlaceholder,
      allocationMethod: allocation.own.method,
      allocationFactor: allocation.effectiveFactor,
      adjustmentFactor,
      grossKgCo2e: gross,
      allocatedKgCo2e: allocated,
      perFunctionalUnitKgCo2e: perFunctionalUnit,
      dataType: item.dataType,
      dataQualityScore: meanDataQuality(item),
      uncertaintyPercent: item.uncertaintyPercent ?? factor.uncertaintyPercent,
      supplierName: item.supplierName,
      materialName: item.materialName,
      formula,
      provenance: steps,
    },
  };
}

/** Synthetic factor for a per-unit carbon figure carried on the item itself. */
function inlineFactor(value: Decimal, unit: string, source: string): EngineFactor {
  return {
    emissionFactorId: null,
    selectionMode: LcaFactorSelectionMode.MANUAL,
    value,
    unit,
    source,
    version: "entered on the inventory item",
    boundary: LcaFactorBoundary.UNKNOWN,
    geography: null,
    year: null,
    gwpBasis: null,
    isPlaceholder: false,
    uncertaintyPercent: null,
  };
}

// ---------------------------------------------------------------------------
// Functional unit
// ---------------------------------------------------------------------------

export interface FunctionalUnitResolution {
  functionalUnitsInModel: Decimal;
  resolved: boolean;
  note: string;
}

/**
 * How many functional units the entered inventory represents.
 *
 * A model built on one batch of 500 units, against a functional unit of one
 * unit, contains 500 functional units — so a 1,000 kgCO2e model total is
 * 2 kgCO2e per functional unit.
 */
export function resolveFunctionalUnits(assessment: EngineAssessment): FunctionalUnitResolution {
  const fu = assessment.functionalUnit;
  const referenceQuantity = fu.referenceFlowQuantity;

  if (referenceQuantity.lte(ZERO)) {
    return {
      functionalUnitsInModel: ZERO,
      resolved: false,
      note: "The reference flow quantity must be greater than zero before a per-functional-unit figure can be produced.",
    };
  }
  if (fu.modelledOutputQuantity.lte(ZERO)) {
    return {
      functionalUnitsInModel: ZERO,
      resolved: false,
      note: "Record how much product the entered inventory represents before a per-functional-unit figure can be produced.",
    };
  }

  const referenceUnit = fu.referenceFlowUnit ?? fu.unit ?? fu.modelledOutputUnit;
  const modelUnit = fu.modelledOutputUnit ?? referenceUnit;

  if (!referenceUnit || !modelUnit) {
    const count = fu.modelledOutputQuantity.div(referenceQuantity);
    return {
      functionalUnitsInModel: count,
      resolved: false,
      note: `No units recorded for the reference flow or the modelled output, so the two quantities have been compared directly: ${toDisplayString(fu.modelledOutputQuantity)} / ${toDisplayString(referenceQuantity)} = ${toDisplayString(count)} functional units.`,
    };
  }

  try {
    const converted = convertWithTrail(fu.modelledOutputQuantity, modelUnit, referenceUnit);
    const count = converted.value.div(referenceQuantity);
    return {
      functionalUnitsInModel: count,
      resolved: true,
      note: `${toDisplayString(fu.modelledOutputQuantity)} ${modelUnit} of modelled output / ${toDisplayString(referenceQuantity)} ${referenceUnit} per functional unit = ${toDisplayString(count)} functional units in the model.`,
    };
  } catch (err) {
    if (err instanceof IncompatibleUnitError || err instanceof UnknownUnitError) {
      return {
        functionalUnitsInModel: ZERO,
        resolved: false,
        note: `The modelled output (${modelUnit}) and the reference flow (${referenceUnit}) are not comparable: ${err.message}`,
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Per-item calculation
// ---------------------------------------------------------------------------

interface ItemContext {
  process: EngineProcess;
  allocation: ResolvedAllocation;
  assessment: EngineAssessment;
  functionalUnitsInModel: Decimal;
  rows: EngineResultRow[];
  diagnostics: EngineDiagnostic[];
}

function collect(outcome: RowBuildOutcome, ctx: ItemContext): void {
  if ("row" in outcome) ctx.rows.push(outcome.row);
  else ctx.diagnostics.push(outcome.diagnostic);
}

function classificationFor(item: EngineInventoryItem): LcaEmissionClassification {
  // Offsets are never allowed to reduce gross emissions, so an item recorded
  // as an offset is carried as its own class and excluded from the headline.
  return item.classification;
}

function calculateTransportItem(item: EngineInventoryItem, ctx: ItemContext, grossQuantityNote: string[]): void {
  if (item.transportLegs.length === 0) {
    ctx.diagnostics.push({
      code: "NO_FACTOR",
      severity: "warning",
      message: `Transport item "${item.name}" has no legs recorded, so it produces no figure.`,
      inventoryItemId: item.id,
      processId: ctx.process.id,
      itemName: item.name,
    });
    return;
  }

  const legs = [...item.transportLegs].sort((a, b) => a.sequence - b.sequence);
  for (const leg of legs) {
    if (!leg.factor) {
      ctx.diagnostics.push({
        code: "NO_FACTOR",
        severity: "error",
        message: `Transport leg ${leg.sequence + 1} (${leg.mode.toLowerCase()}) of "${item.name}" has no emission factor assigned.`,
        inventoryItemId: item.id,
        processId: ctx.process.id,
        itemName: item.name,
      });
      continue;
    }

    const legRows = buildTransportLegRow(item, leg, ctx, grossQuantityNote);
    collect(legRows, ctx);
  }
}

function buildTransportLegRow(
  item: EngineInventoryItem,
  leg: EngineTransportLeg,
  ctx: ItemContext,
  methodologyNotes: string[],
): RowBuildOutcome {
  const factor = leg.factor as EngineFactor;
  const distance = leg.includesReturnTrip ? leg.distanceValue.times(2) : leg.distanceValue;
  const preSteps: { label: string; detail: string; value?: string }[] = [];

  let activityValue: Decimal;
  let activityUnit: string;
  const notes = [...methodologyNotes];

  let factorDimension: string | null;
  try {
    factorDimension = unitDimension(factor.unit);
  } catch {
    factorDimension = null;
  }

  if (factorDimension === "FREIGHT") {
    try {
      activityValue = toTonneKilometres(leg.massValue, leg.massUnit, distance, leg.distanceUnit);
    } catch (err) {
      if (err instanceof IncompatibleUnitError || err instanceof UnknownUnitError) {
        return {
          diagnostic: {
            code: err instanceof UnknownUnitError ? "UNKNOWN_UNIT" : "INCOMPATIBLE_UNIT",
            severity: "error",
            message: `Transport leg ${leg.sequence + 1} of "${item.name}": ${err.message}`,
            inventoryItemId: item.id,
            processId: ctx.process.id,
            itemName: item.name,
          },
        };
      }
      throw err;
    }
    activityUnit = "t.km";
    preSteps.push({
      label: "Freight work",
      detail: `${toDisplayString(leg.massValue)} ${leg.massUnit} carried ${toDisplayString(distance)} ${leg.distanceUnit}${leg.includesReturnTrip ? " (outbound and return)" : ""}${leg.originName || leg.destinationName ? `, ${leg.originName ?? "origin"} to ${leg.destinationName ?? "destination"}` : ""}.`,
      value: `${toDisplayString(activityValue)} t.km`,
    });
    if (leg.loadFactorPercent) {
      notes.push(
        `A load factor of ${leg.loadFactorPercent.toString()}% is recorded on this leg but has not been applied, because a tonne-kilometre factor already accounts for vehicle utilisation.`,
      );
    }
  } else {
    // Vehicle-distance factor: the consignment's share of the vehicle is the
    // modeller's to state, and is applied here rather than assumed to be 100%.
    const share = leg.loadFactorPercent ? percentToFactor(leg.loadFactorPercent) : ONE;
    activityValue = distance.times(share);
    activityUnit = leg.distanceUnit;
    preSteps.push({
      label: "Vehicle distance",
      detail: `${toDisplayString(distance)} ${leg.distanceUnit}${leg.includesReturnTrip ? " (outbound and return)" : ""}${leg.loadFactorPercent ? `, ${leg.loadFactorPercent.toString()}% of the vehicle attributed to this consignment` : ", whole vehicle attributed to this consignment"}.`,
      value: `${toDisplayString(activityValue)} ${leg.distanceUnit}`,
    });
    notes.push(
      "This leg uses a per-vehicle-distance factor, so the consignment's share of the vehicle has been applied to the distance rather than converting to tonne-kilometres.",
    );
  }

  if (leg.assumptions) notes.push(`Leg assumptions: ${leg.assumptions}`);

  return buildRow({
    keySuffix: `:leg:${leg.id}`,
    item,
    process: ctx.process,
    allocation: ctx.allocation,
    classification: classificationFor(item),
    displayName: `${item.name} — leg ${leg.sequence + 1} (${leg.modeDescription ?? leg.mode.replace(/_/g, " ").toLowerCase()})`,
    activityValue,
    activityUnit,
    factor,
    adjustmentFactor: item.adjustmentFactor,
    preConversionSteps: preSteps,
    methodologyNotes: notes,
    transportLegId: leg.id,
    functionalUnitsInModel: ctx.functionalUnitsInModel,
  });
}

function calculateEndOfLifeItem(
  item: EngineInventoryItem,
  ctx: ItemContext,
  grossQuantity: Decimal,
  methodologyNotes: string[],
): void {
  const routes = item.endOfLifeRoutes;
  if (routes.length === 0) {
    ctx.diagnostics.push({
      code: "NO_FACTOR",
      severity: "warning",
      message: `"${item.name}" has no end-of-life routes recorded, so it produces no figure.`,
      inventoryItemId: item.id,
      processId: ctx.process.id,
      itemName: item.name,
    });
    return;
  }

  const methodology = ctx.assessment.methodology;
  const creditsAllowed = allowsAvoidedBurden(methodology);

  for (const route of routes) {
    const share = percentToFactor(route.percent);
    const routeQuantity = grossQuantity.times(share);
    const routeLabel = route.routeDescription ?? route.route.replace(/_/g, " ").toLowerCase();

    if (route.factor) {
      collect(
        buildRow({
          keySuffix: `:eol:${route.id}`,
          item,
          process: ctx.process,
          allocation: ctx.allocation,
          classification: classificationFor(item),
          displayName: `${item.name} — ${routeLabel}`,
          activityValue: routeQuantity,
          activityUnit: item.unit,
          factor: route.factor,
          adjustmentFactor: item.adjustmentFactor,
          preConversionSteps: [
            {
              label: "End-of-life route share",
              detail: `${route.percent.toString()}% of ${toDisplayString(grossQuantity)} ${item.unit} follows the ${routeLabel} route.`,
              value: `${toDisplayString(routeQuantity)} ${item.unit}`,
            },
          ],
          methodologyNotes: [
            ...methodologyNotes,
            `End-of-life treatment follows the assessment's ${methodology.recyclingMethod.replace(/_/g, " ").toLowerCase()} methodology.`,
            ...(route.recoveryAssumptions ? [`Recovery assumptions: ${route.recoveryAssumptions}`] : []),
          ],
          endOfLifeRouteId: route.id,
          functionalUnitsInModel: ctx.functionalUnitsInModel,
        }),
        ctx,
      );
    } else {
      ctx.diagnostics.push({
        code: "NO_FACTOR",
        severity: "error",
        message: `The ${routeLabel} route on "${item.name}" has no emission factor assigned.`,
        inventoryItemId: item.id,
        processId: ctx.process.id,
        itemName: item.name,
      });
    }

    // Recovery credit, only where the methodology allows one to exist at all.
    if (route.avoidedFactorValue && route.avoidedFactorValue.gt(ZERO)) {
      if (!creditsAllowed) {
        ctx.diagnostics.push({
          code: "NO_FACTOR",
          severity: "info",
          message: `An avoided-burden credit is recorded on the ${routeLabel} route of "${item.name}" but has not been applied: this assessment's methodology uses ${methodology.recyclingMethod.replace(/_/g, " ").toLowerCase()}, which gives no end-of-life credit.`,
          inventoryItemId: item.id,
          processId: ctx.process.id,
          itemName: item.name,
        });
      } else {
        const recovery = route.recoveryRatePercent ? percentToFactor(route.recoveryRatePercent) : ONE;
        const recoveredQuantity = routeQuantity.times(recovery);
        collect(
          buildRow({
            keySuffix: `:eol:${route.id}:credit`,
            item,
            process: ctx.process,
            allocation: ctx.allocation,
            classification: LcaEmissionClassification.AVOIDED_BURDEN,
            displayName: `${item.name} — ${routeLabel} recovery credit`,
            activityValue: recoveredQuantity,
            activityUnit: item.unit,
            factor: inlineFactor(
              route.avoidedFactorValue,
              route.avoidedFactorUnit ?? item.unit,
              route.avoidedFactorSource ?? "Avoided-burden factor recorded on the end-of-life route",
            ),
            adjustmentFactor: item.adjustmentFactor,
            preConversionSteps: [
              {
                label: "Recovered material",
                detail: `${route.percent.toString()}% of ${toDisplayString(grossQuantity)} ${item.unit} follows the ${routeLabel} route, of which ${route.recoveryRatePercent ? `${route.recoveryRatePercent.toString()}%` : "100%"} is recovered as usable material.`,
                value: `${toDisplayString(recoveredQuantity)} ${item.unit}`,
              },
            ],
            methodologyNotes: [
              `This credit exists only because the assessment's methodology is ${methodology.recyclingMethod.replace(/_/g, " ").toLowerCase()}. It is reported as its own class and never merged into gross emissions.`,
              ...(route.recoveryAssumptions ? [`Recovery assumptions: ${route.recoveryAssumptions}`] : []),
            ],
            endOfLifeRouteId: route.id,
            functionalUnitsInModel: ctx.functionalUnitsInModel,
            negate: true,
          }),
          ctx,
        );
      }
    }
  }
}

function calculateStandardItem(
  item: EngineInventoryItem,
  ctx: ItemContext,
  grossQuantity: Decimal,
  methodologyNotes: string[],
): void {
  if (!item.factor) {
    ctx.diagnostics.push({
      code: "NO_FACTOR",
      severity: "error",
      message: `"${item.name}" has no emission factor assigned, so it contributes nothing to the footprint yet.`,
      inventoryItemId: item.id,
      processId: ctx.process.id,
      itemName: item.name,
    });
    return;
  }

  const recycled = item.recycledContentPercent;
  const hasRecycledSplit = Boolean(recycled && recycled.gt(ZERO) && item.recycledFactor);

  if (hasRecycledSplit) {
    const recycledShare = percentToFactor(recycled as Decimal);
    const virginQuantity = grossQuantity.times(ONE.minus(recycledShare));
    const recycledQuantity = grossQuantity.times(recycledShare);

    collect(
      buildRow({
        keySuffix: ":virgin",
        item,
        process: ctx.process,
        allocation: ctx.allocation,
        classification: classificationFor(item),
        displayName: `${item.name} — virgin content`,
        activityValue: virginQuantity,
        activityUnit: item.unit,
        factor: item.factor,
        adjustmentFactor: item.adjustmentFactor,
        preConversionSteps: [
          {
            label: "Recycled content split",
            detail: `${(recycled as Decimal).toString()}% recycled content recorded, so ${ONE.minus(recycledShare).times(HUNDRED).toDecimalPlaces(4)}% of ${toDisplayString(grossQuantity)} ${item.unit} is priced at the virgin-route factor.`,
            value: `${toDisplayString(virginQuantity)} ${item.unit}`,
          },
        ],
        methodologyNotes: [
          ...methodologyNotes,
          `Recycled content is priced from its own sourced factor under the assessment's ${ctx.assessment.methodology.recyclingMethod.replace(/_/g, " ").toLowerCase()} methodology.`,
        ],
        functionalUnitsInModel: ctx.functionalUnitsInModel,
      }),
      ctx,
    );

    collect(
      buildRow({
        keySuffix: ":recycled",
        item,
        process: ctx.process,
        allocation: ctx.allocation,
        classification: classificationFor(item),
        displayName: `${item.name} — recycled content`,
        activityValue: recycledQuantity,
        activityUnit: item.unit,
        factor: item.recycledFactor as EngineFactor,
        adjustmentFactor: item.adjustmentFactor,
        preConversionSteps: [
          {
            label: "Recycled content split",
            detail: `${(recycled as Decimal).toString()}% of ${toDisplayString(grossQuantity)} ${item.unit} is recycled material, priced at the recycled-route factor.`,
            value: `${toDisplayString(recycledQuantity)} ${item.unit}`,
          },
        ],
        methodologyNotes: [
          ...methodologyNotes,
          `Recycled content is priced from its own sourced factor under the assessment's ${ctx.assessment.methodology.recyclingMethod.replace(/_/g, " ").toLowerCase()} methodology.`,
        ],
        functionalUnitsInModel: ctx.functionalUnitsInModel,
      }),
      ctx,
    );
    return;
  }

  const notes = [...methodologyNotes];
  if (recycled && recycled.gt(ZERO)) {
    notes.push(
      `${recycled.toString()}% recycled content is recorded but no recycled-route factor has been assigned, so the whole quantity is priced at the assigned factor. Recycled content is disclosed, not discounted.`,
    );
  }

  collect(
    buildRow({
      keySuffix: "",
      item,
      process: ctx.process,
      allocation: ctx.allocation,
      classification: classificationFor(item),
      displayName: item.name,
      activityValue: grossQuantity,
      activityUnit: item.unit,
      factor: item.factor,
      adjustmentFactor: item.adjustmentFactor,
      preConversionSteps: [],
      methodologyNotes: notes,
      functionalUnitsInModel: ctx.functionalUnitsInModel,
    }),
    ctx,
  );
}

/** Biogenic uptake and stored carbon, carried as their own classes. */
function calculateCarbonStorageRows(
  item: EngineInventoryItem,
  ctx: ItemContext,
  grossQuantity: Decimal,
): void {
  const methodology = ctx.assessment.methodology;
  if (!biogenicTracked(methodology)) return;

  if (item.biogenicUptakePerUnit && !item.biogenicUptakePerUnit.isZero()) {
    collect(
      buildRow({
        keySuffix: ":biogenic-uptake",
        item,
        process: ctx.process,
        allocation: ctx.allocation,
        classification: LcaEmissionClassification.BIOGENIC_REMOVAL,
        displayName: `${item.name} — biogenic carbon uptake`,
        activityValue: grossQuantity,
        activityUnit: item.unit,
        factor: inlineFactor(
          item.biogenicUptakePerUnit,
          item.unit,
          "Biogenic uptake recorded on the inventory item",
        ),
        adjustmentFactor: item.adjustmentFactor,
        preConversionSteps: [],
        methodologyNotes: [
          `Biogenic carbon is ${methodology.biogenicTreatment === LcaBiogenicTreatment.INCLUDED_IN_TOTAL ? "included in the headline total" : "reported separately from fossil emissions"} under this assessment's methodology.`,
        ],
        functionalUnitsInModel: ctx.functionalUnitsInModel,
        negate: true,
      }),
      ctx,
    );
  }

  if (item.storedCarbonPerUnit && !item.storedCarbonPerUnit.isZero()) {
    collect(
      buildRow({
        keySuffix: ":stored-carbon",
        item,
        process: ctx.process,
        allocation: ctx.allocation,
        classification: LcaEmissionClassification.STORED_CARBON,
        displayName: `${item.name} — carbon stored in product`,
        activityValue: grossQuantity,
        activityUnit: item.unit,
        factor: inlineFactor(item.storedCarbonPerUnit, item.unit, "Stored carbon recorded on the inventory item"),
        adjustmentFactor: item.adjustmentFactor,
        preConversionSteps: [],
        methodologyNotes: [
          "Carbon held in the product is a memo disclosure. It is never subtracted from the reported footprint.",
        ],
        functionalUnitsInModel: ctx.functionalUnitsInModel,
      }),
      ctx,
    );
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function calculateAssessment(assessment: EngineAssessment): EngineOutput {
  const rows: EngineResultRow[] = [];
  const diagnostics: EngineDiagnostic[] = [];

  const allocations = resolveAllocations(assessment.processes);
  for (const [processId, allocation] of allocations) {
    if (allocation.own.problem) {
      diagnostics.push({
        code: "ALLOCATION_UNRESOLVED",
        severity: "warning",
        message: allocation.own.problem,
        processId,
      });
    }
  }

  const fuResolution = resolveFunctionalUnits(assessment);
  if (!fuResolution.resolved) {
    diagnostics.push({
      code: "NO_FUNCTIONAL_UNIT",
      severity: "error",
      message: fuResolution.note,
    });
  }

  const processById = new Map(assessment.processes.map((p) => [p.id, p]));

  for (const item of assessment.items) {
    const process = processById.get(item.processId);
    if (!process) continue;

    if (!process.isIncluded) {
      diagnostics.push({
        code: "EXCLUDED_PROCESS",
        severity: "info",
        message: `"${item.name}" sits in process "${process.name}", which is marked as excluded from the model.`,
        inventoryItemId: item.id,
        processId: process.id,
        itemName: item.name,
      });
      continue;
    }

    if (item.isExcluded) {
      diagnostics.push({
        code: "EXCLUDED_ITEM",
        severity: "info",
        message: `"${item.name}" is excluded from the model${item.exclusionReason ? `: ${item.exclusionReason}` : " with no reason recorded"}.`,
        inventoryItemId: item.id,
        processId: process.id,
        itemName: item.name,
      });
      continue;
    }

    const allocation = allocations.get(process.id);
    if (!allocation) continue;

    const ctx: ItemContext = {
      process,
      allocation,
      assessment,
      functionalUnitsInModel: fuResolution.functionalUnitsInModel,
      rows,
      diagnostics,
    };

    const waste = applyWasteGrossUp(item.quantity, item.wastePercent);
    if (waste.problem) {
      diagnostics.push({
        code: "INVALID_WASTE_PERCENT",
        severity: "error",
        message: `"${item.name}": ${waste.problem}`,
        inventoryItemId: item.id,
        processId: process.id,
        itemName: item.name,
      });
    }
    const grossQuantity = waste.value;
    const methodologyNotes = waste.applied ? [waste.note] : [];

    if (
      item.classification === LcaEmissionClassification.OFFSET &&
      assessment.methodology.offsetTreatment === LcaOffsetTreatment.EXCLUDED
    ) {
      diagnostics.push({
        code: "EXCLUDED_ITEM",
        severity: "info",
        message: `"${item.name}" is an offset or credit, and this assessment's methodology excludes offsets entirely, so it produces no figure.`,
        inventoryItemId: item.id,
        processId: process.id,
        itemName: item.name,
      });
      continue;
    }

    if (item.itemType === LcaItemType.TRANSPORT) {
      calculateTransportItem(item, ctx, methodologyNotes);
    } else if (item.endOfLifeRoutes.length > 0) {
      calculateEndOfLifeItem(item, ctx, grossQuantity, methodologyNotes);
    } else {
      calculateStandardItem(item, ctx, grossQuantity, methodologyNotes);
    }

    calculateCarbonStorageRows(item, ctx, grossQuantity);
  }

  // --- totals -----------------------------------------------------------
  const model = emptyClassifiedTotals();
  for (const row of rows) addToClassified(model, row.classification, row.allocatedKgCo2e);

  const perFunctionalUnit = divideClassified(model, fuResolution.functionalUnitsInModel);
  const includeBiogenic = biogenicInHeadline(assessment.methodology);

  const headlineModel = model.fossil
    .plus(includeBiogenic ? model.biogenicEmissions.plus(model.biogenicRemovals) : ZERO)
    .plus(model.avoidedBurden);
  const headlinePerFu = fuResolution.functionalUnitsInModel.isZero()
    ? ZERO
    : headlineModel.div(fuResolution.functionalUnitsInModel);
  const includingBiogenicPerFu = fuResolution.functionalUnitsInModel.isZero()
    ? ZERO
    : model.fossil
        .plus(model.biogenicEmissions)
        .plus(model.biogenicRemovals)
        .plus(model.avoidedBurden)
        .div(fuResolution.functionalUnitsInModel);

  const totals: EngineTotals = {
    model,
    perFunctionalUnit,
    headlineModelKgCo2e: headlineModel,
    headlinePerFunctionalUnitKgCo2e: headlinePerFu,
    includingBiogenicPerFunctionalUnitKgCo2e: includingBiogenicPerFu,
    functionalUnitsInModel: fuResolution.functionalUnitsInModel,
    functionalUnitResolved: fuResolution.resolved,
    functionalUnitNote: fuResolution.note,
  };

  // --- factor snapshot ---------------------------------------------------
  const factorMap = new Map<string, EngineOutput["factorsUsed"][number]>();
  for (const row of rows) {
    const key = `${row.emissionFactorId ?? "manual"}|${row.factorSource}|${row.factorVersion}|${row.factorUnit}|${row.factorValue.toString()}`;
    if (!factorMap.has(key)) {
      factorMap.set(key, {
        emissionFactorId: row.emissionFactorId,
        source: row.factorSource,
        version: row.factorVersion,
        unit: row.factorUnit,
        value: row.factorValue.toString(),
        boundary: row.factorBoundary,
        geography: row.factorGeography,
        year: row.factorYear,
        gwpBasis: row.factorGwpBasis,
        selectionMode: row.factorSelectionMode,
        isPlaceholder: row.isPlaceholderFactor,
      });
    }
  }

  return {
    engineVersion: LCA_ENGINE_VERSION,
    rows,
    totals,
    diagnostics,
    factorsUsed: Array.from(factorMap.values()),
  };
}

/** Convenience for tests and the UI: the unit a factor must be expressed in. */
export function factorUnitFor(unit: string): string {
  return requireUnit(unit).symbol;
}

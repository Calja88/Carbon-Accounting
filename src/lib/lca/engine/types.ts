/**
 * The calculation engine's own vocabulary.
 *
 * These types are deliberately plain data — no Prisma models, no database
 * handles. The engine is a pure function from a fully-loaded snapshot of an
 * assessment to a set of result rows and totals, which means every rule in it
 * can be tested directly against a known answer, and a result can be
 * reproduced later from the snapshot alone.
 */

import {
  LcaAllocationMethod,
  LcaDataType,
  LcaEmissionClassification,
  LcaEndOfLifeRouteType,
  LcaFactorBoundary,
  LcaFactorSelectionMode,
  LcaItemType,
  LcaLifecycleStage,
  LcaTransportMode,
} from "@prisma/client";
import type { Decimal } from "../decimal";
import type { MethodologyConfig } from "../methodology";

/** A factor as the engine sees it, whatever its origin. */
export interface EngineFactor {
  /** EmissionFactor id when it came from the library; null for manual/PCF. */
  emissionFactorId: string | null;
  selectionMode: LcaFactorSelectionMode;
  /** kgCO2e per one `unit`. */
  value: Decimal;
  unit: string;
  source: string;
  version: string;
  boundary: LcaFactorBoundary;
  geography: string | null;
  year: number | null;
  gwpBasis: string | null;
  isPlaceholder: boolean;
  uncertaintyPercent: Decimal | null;
}

export interface EngineProcessOutput {
  id: string;
  name: string;
  isAssessedProduct: boolean;
  massValue: Decimal | null;
  massUnit: string | null;
  physicalValue: Decimal | null;
  physicalUnit: string | null;
  economicValue: Decimal | null;
  economicCurrency: string | null;
  manualPercent: Decimal | null;
}

export interface EngineProcess {
  id: string;
  parentProcessId: string | null;
  stage: LcaLifecycleStage;
  name: string;
  isIncluded: boolean;
  allocationMethod: LcaAllocationMethod;
  /** Only read for MANUAL and NONE; otherwise derived from the outputs. */
  allocationPercent: Decimal;
  allocationRationale: string | null;
  outputs: EngineProcessOutput[];
}

export interface EngineTransportLeg {
  id: string;
  sequence: number;
  mode: LcaTransportMode;
  modeDescription: string | null;
  originName: string | null;
  destinationName: string | null;
  distanceValue: Decimal;
  distanceUnit: string;
  massValue: Decimal;
  massUnit: string;
  loadFactorPercent: Decimal | null;
  includesReturnTrip: boolean;
  factor: EngineFactor | null;
  assumptions: string | null;
}

export interface EngineEndOfLifeRoute {
  id: string;
  route: LcaEndOfLifeRouteType;
  routeDescription: string | null;
  percent: Decimal;
  factor: EngineFactor | null;
  recoveryRatePercent: Decimal | null;
  avoidedFactorValue: Decimal | null;
  avoidedFactorUnit: string | null;
  avoidedFactorSource: string | null;
  recoveryAssumptions: string | null;
}

export interface EngineDataQuality {
  temporal: number | null;
  geographical: number | null;
  technological: number | null;
  completeness: number | null;
  reliability: number | null;
}

export interface EngineInventoryItem {
  id: string;
  processId: string;
  itemType: LcaItemType;
  name: string;
  classification: LcaEmissionClassification;

  quantity: Decimal;
  unit: string;
  adjustmentFactor: Decimal;
  adjustmentRationale: string | null;
  wastePercent: Decimal | null;
  recycledContentPercent: Decimal | null;

  dataType: LcaDataType;
  supplierName: string | null;
  materialName: string | null;
  componentName: string | null;
  geography: string | null;

  factor: EngineFactor | null;
  recycledFactor: EngineFactor | null;

  biogenicUptakePerUnit: Decimal | null;
  storedCarbonPerUnit: Decimal | null;

  dataQuality: EngineDataQuality;
  uncertaintyPercent: Decimal | null;

  isExcluded: boolean;
  exclusionReason: string | null;

  transportLegs: EngineTransportLeg[];
  endOfLifeRoutes: EngineEndOfLifeRoute[];
}

export interface EngineFunctionalUnit {
  description: string | null;
  quantity: Decimal;
  unit: string | null;
  isDeclaredUnit: boolean;
  declaredUnitDescription: string | null;
  referenceFlowDescription: string | null;
  referenceFlowQuantity: Decimal;
  referenceFlowUnit: string | null;
  /** How much product the entered inventory represents. */
  modelledOutputQuantity: Decimal;
  modelledOutputUnit: string | null;
}

export interface EngineAssessment {
  id: string;
  reference: string;
  title: string;
  functionalUnit: EngineFunctionalUnit;
  methodology: MethodologyConfig;
  processes: EngineProcess[];
  items: EngineInventoryItem[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * One line of the "How was this calculated?" trail. Every result row carries
 * the whole sequence: what was entered, what it was converted to, which factor
 * was applied and where it came from, which methodology rules bore on it, what
 * was adjusted or allocated, the arithmetic, and the answer.
 */
export interface ProvenanceStep {
  step: number;
  label: string;
  detail: string;
  value?: string;
}

export interface EngineResultRow {
  /** Stable within a run; lets a scenario row be matched to its baseline row. */
  key: string;
  inventoryItemId: string | null;
  processId: string | null;
  transportLegId: string | null;
  endOfLifeRouteId: string | null;

  stage: LcaLifecycleStage;
  processName: string;
  itemName: string;
  itemType: LcaItemType;
  classification: LcaEmissionClassification;

  activityValue: Decimal;
  activityUnit: string;
  conversionFactor: Decimal;
  normalizedValue: Decimal;
  normalizedUnit: string;

  factorValue: Decimal;
  factorUnit: string;
  factorSource: string;
  factorVersion: string;
  factorBoundary: LcaFactorBoundary;
  factorGeography: string | null;
  factorYear: number | null;
  factorGwpBasis: string | null;
  factorSelectionMode: LcaFactorSelectionMode;
  emissionFactorId: string | null;
  isPlaceholderFactor: boolean;

  allocationMethod: LcaAllocationMethod;
  allocationFactor: Decimal;
  adjustmentFactor: Decimal;

  grossKgCo2e: Decimal;
  allocatedKgCo2e: Decimal;
  perFunctionalUnitKgCo2e: Decimal;

  dataType: LcaDataType;
  dataQualityScore: Decimal | null;
  uncertaintyPercent: Decimal | null;

  /** Supplier and material carried through for the contribution breakdowns. */
  supplierName: string | null;
  materialName: string | null;

  formula: string;
  provenance: ProvenanceStep[];
}

/** Something the engine could not calculate, and why. Never silently dropped. */
export interface EngineDiagnostic {
  code:
    | "NO_FACTOR"
    | "INCOMPATIBLE_UNIT"
    | "UNKNOWN_UNIT"
    | "EXCLUDED_ITEM"
    | "EXCLUDED_PROCESS"
    | "INVALID_WASTE_PERCENT"
    | "NO_FUNCTIONAL_UNIT"
    | "ALLOCATION_UNRESOLVED";
  severity: "error" | "warning" | "info";
  message: string;
  inventoryItemId?: string;
  processId?: string;
  itemName?: string;
}

export interface ClassifiedTotals {
  fossil: Decimal;
  biogenicEmissions: Decimal;
  biogenicRemovals: Decimal;
  technologicalRemovals: Decimal;
  storedCarbon: Decimal;
  avoidedBurden: Decimal;
  offsets: Decimal;
}

export interface EngineTotals {
  /** Sums of allocated emissions by carbon class, over the whole model. */
  model: ClassifiedTotals;
  /** The same, divided by the number of functional units in the model. */
  perFunctionalUnit: ClassifiedTotals;

  /**
   * The headline product carbon footprint per functional unit. Fossil always
   * counts; biogenic terms only when the methodology puts them in the total;
   * removals, stored carbon and offsets never do.
   */
  headlinePerFunctionalUnitKgCo2e: Decimal;
  headlineModelKgCo2e: Decimal;
  /** Fossil plus biogenic emissions and removals, always available alongside. */
  includingBiogenicPerFunctionalUnitKgCo2e: Decimal;

  functionalUnitsInModel: Decimal;
  /** Set when the functional unit could not be resolved; totals then stay per model. */
  functionalUnitResolved: boolean;
  functionalUnitNote: string;
}

export interface EngineOutput {
  engineVersion: string;
  rows: EngineResultRow[];
  totals: EngineTotals;
  diagnostics: EngineDiagnostic[];
  /** Every distinct factor the run drew on — the run's factor snapshot. */
  factorsUsed: {
    emissionFactorId: string | null;
    source: string;
    version: string;
    unit: string;
    value: string;
    boundary: LcaFactorBoundary;
    geography: string | null;
    year: number | null;
    gwpBasis: string | null;
    selectionMode: LcaFactorSelectionMode;
    isPlaceholder: boolean;
  }[];
}

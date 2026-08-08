/**
 * The deterministic LCA calculation engine.
 *
 * Pure functions, no database, no network, no AI — the same discipline as
 * `calc-engine.ts` for the corporate inventory, and for the same reason: the
 * arithmetic that produces a published number has to be reproducible and
 * unit-testable in isolation.
 *
 * Every flow keeps its full derivation — activity quantity, the factor that
 * was applied with its source and vintage, the allocation share, and the
 * equation as text — so a reader can drill from a product total down to
 * stage, process, flow, activity data, factor and evidence without leaving
 * the audit trail.
 *
 * A flow with no mapped factor is never treated as zero. It is reported with
 * status NO_FACTOR and counted, so an incomplete inventory reads as
 * incomplete rather than as a low footprint.
 */

export const LCA_ENGINE_VERSION = "lca-engine-v1";

export interface LcaFactorSnapshot {
  id: string;
  /** kgCO2e per `unit`. Always read from the approved factor catalogue. */
  value: number;
  unit: string;
  source: string;
  vintage: string;
  category: string;
  subtypeKey: string | null;
  region: string;
  isPlaceholder: boolean;
  sourceUrl: string | null;
}

export interface LcaDataQualityScores {
  reliability: number | null;
  completeness: number | null;
  temporal: number | null;
  geographical: number | null;
  technological: number | null;
}

export interface LcaFlowInput {
  id: string;
  name: string;
  direction: "INPUT" | "OUTPUT";
  flowType:
    | "MATERIAL"
    | "ENERGY"
    | "FUEL"
    | "ELECTRICITY"
    | "WATER"
    | "TRANSPORT"
    | "WASTE"
    | "EMISSION"
    | "PRODUCT"
    | "CO_PRODUCT";
  quantity: number;
  unit: string;
  /** False when the quantity covers the whole reference flow rather than one functional unit. */
  perFunctionalUnit: boolean;
  transportMassTonnes: number | null;
  transportDistanceKm: number | null;
  allocationPercent: number;
  factor: LcaFactorSnapshot | null;
  dataSource: string | null;
  dataType: "PRIMARY" | "SECONDARY" | null;
  geography: string | null;
  referenceYear: number | null;
  supplierName: string | null;
  dq: LcaDataQualityScores;
}

export interface LcaProcessInput {
  id: string;
  name: string;
  flows: LcaFlowInput[];
}

export interface LcaStageInput {
  id: string;
  key: string;
  name: string;
  included: boolean;
  exclusionReason: string | null;
  processes: LcaProcessInput[];
}

export interface LcaCalculationInput {
  functionalUnitLabel: string | null;
  /**
   * How many functional units the recorded quantities cover, for flows
   * marked `perFunctionalUnit: false`. Null means only per-functional-unit
   * flows can be calculated.
   */
  referenceFlowQuantity: number | null;
  stages: LcaStageInput[];
}

export type LcaFlowStatus =
  | "CALCULATED"
  | "NO_FACTOR"
  | "UNIT_MISMATCH"
  | "MISSING_REFERENCE_FLOW"
  | "INCOMPLETE_TRANSPORT"
  | "NOT_AN_IMPACT"
  | "STAGE_EXCLUDED";

export interface LcaFlowResult {
  flowId: string;
  name: string;
  direction: LcaFlowInput["direction"];
  flowType: LcaFlowInput["flowType"];
  /** As recorded by the user. */
  activityQuantity: number;
  activityUnit: string;
  /** After transport derivation and functional-unit normalisation. */
  effectiveQuantity: number;
  effectiveUnit: string;
  allocationPercent: number;
  factor: LcaFactorSnapshot | null;
  equation: string | null;
  kgCo2e: number | null;
  status: LcaFlowStatus;
  statusReason: string | null;
}

export interface LcaProcessResult {
  processId: string;
  name: string;
  kgCo2e: number;
  flows: LcaFlowResult[];
  unmappedFlowCount: number;
}

export interface LcaStageResult {
  stageId: string;
  key: string;
  name: string;
  included: boolean;
  exclusionReason: string | null;
  kgCo2e: number;
  processes: LcaProcessResult[];
  unmappedFlowCount: number;
}

export interface LcaCalculationResult {
  engineVersion: string;
  functionalUnitLabel: string | null;
  totalKgCo2e: number;
  stages: LcaStageResult[];
  unmappedFlowCount: number;
  /** Every flow that produced no figure, with the reason — surfaced, never hidden. */
  gaps: { flowId: string; name: string; status: LcaFlowStatus; reason: string }[];
  calculatedFlowCount: number;
}

/**
 * Product and co-product outputs describe what leaves the system, not an
 * impact of it — counting them would double-count the very thing the study
 * measures. Waste and emission outputs *do* carry a treatment or release
 * factor and are counted.
 */
const NON_IMPACT_FLOW_TYPES = new Set(["PRODUCT", "CO_PRODUCT"]);

function round(value: number): number {
  // Guards against binary-floating-point dust accumulating across hundreds of
  // flows without pretending to a precision the inputs don't have.
  return Number(value.toFixed(8));
}

function formatNumber(value: number): string {
  return String(Number(value.toPrecision(12)));
}

/** Derives the quantity a factor is actually applied to, and how it got there. */
function deriveQuantity(
  flow: LcaFlowInput,
  referenceFlowQuantity: number | null,
): { quantity: number; unit: string; note: string | null } | { error: LcaFlowStatus; reason: string } {
  let quantity = flow.quantity;
  let note: string | null = null;

  // Transport: tonne-km is computed here from mass and distance rather than
  // trusted as a pre-multiplied figure, so the two inputs stay visible and
  // checkable in the audit trail.
  if (flow.flowType === "TRANSPORT" && flow.transportMassTonnes !== null && flow.transportDistanceKm !== null) {
    quantity = flow.transportMassTonnes * flow.transportDistanceKm;
    note = `${formatNumber(flow.transportMassTonnes)} t × ${formatNumber(flow.transportDistanceKm)} km`;
  } else if (
    flow.flowType === "TRANSPORT" &&
    (flow.transportMassTonnes !== null) !== (flow.transportDistanceKm !== null)
  ) {
    return {
      error: "INCOMPLETE_TRANSPORT",
      reason: "A transport flow needs both a mass and a distance before tonne-kilometres can be calculated. Only one was recorded.",
    };
  }

  if (!flow.perFunctionalUnit) {
    if (referenceFlowQuantity === null || referenceFlowQuantity <= 0) {
      return {
        error: "MISSING_REFERENCE_FLOW",
        reason:
          "This quantity covers the whole reference flow, but the study has no reference flow quantity recorded, so it cannot be expressed per functional unit.",
      };
    }
    quantity = quantity / referenceFlowQuantity;
    note = note
      ? `${note}, ÷ ${formatNumber(referenceFlowQuantity)} functional units`
      : `÷ ${formatNumber(referenceFlowQuantity)} functional units`;
  }

  return { quantity, unit: flow.unit, note };
}

export function calculateFlow(
  flow: LcaFlowInput,
  referenceFlowQuantity: number | null,
  stageIncluded = true,
): LcaFlowResult {
  const base: Omit<LcaFlowResult, "status" | "statusReason" | "kgCo2e" | "equation" | "effectiveQuantity" | "effectiveUnit"> = {
    flowId: flow.id,
    name: flow.name,
    direction: flow.direction,
    flowType: flow.flowType,
    activityQuantity: flow.quantity,
    activityUnit: flow.unit,
    allocationPercent: flow.allocationPercent,
    factor: flow.factor,
  };

  if (!stageIncluded) {
    return {
      ...base,
      effectiveQuantity: flow.quantity,
      effectiveUnit: flow.unit,
      equation: null,
      kgCo2e: null,
      status: "STAGE_EXCLUDED",
      statusReason: "The life cycle stage this flow belongs to is excluded from the system boundary.",
    };
  }

  if (NON_IMPACT_FLOW_TYPES.has(flow.flowType)) {
    return {
      ...base,
      effectiveQuantity: flow.quantity,
      effectiveUnit: flow.unit,
      equation: null,
      kgCo2e: null,
      status: "NOT_AN_IMPACT",
      statusReason:
        "Product and co-product outputs describe what the system produces; they carry no impact of their own and are used for allocation, not added to the total.",
    };
  }

  const derived = deriveQuantity(flow, referenceFlowQuantity);
  if ("error" in derived) {
    return {
      ...base,
      effectiveQuantity: flow.quantity,
      effectiveUnit: flow.unit,
      equation: null,
      kgCo2e: null,
      status: derived.error,
      statusReason: derived.reason,
    };
  }

  if (!flow.factor) {
    return {
      ...base,
      effectiveQuantity: round(derived.quantity),
      effectiveUnit: derived.unit,
      equation: null,
      kgCo2e: null,
      status: "NO_FACTOR",
      statusReason:
        "No emission factor from this platform's approved catalogue is mapped to this flow, so it contributes nothing to the total yet. It is not zero — it is unknown.",
    };
  }

  if (flow.factor.unit !== derived.unit) {
    return {
      ...base,
      effectiveQuantity: round(derived.quantity),
      effectiveUnit: derived.unit,
      equation: null,
      kgCo2e: null,
      status: "UNIT_MISMATCH",
      statusReason: `The mapped factor is expressed per "${flow.factor.unit}" but this flow is recorded in "${derived.unit}". The engine will not convert between them silently — correct the unit or map a different factor.`,
    };
  }

  const allocationShare = flow.allocationPercent / 100;
  const kgCo2e = round(derived.quantity * flow.factor.value * allocationShare);

  const equationParts = [
    derived.note ? `${derived.note} = ${formatNumber(derived.quantity)} ${derived.unit}` : `${formatNumber(derived.quantity)} ${derived.unit}`,
    `× ${formatNumber(flow.factor.value)} kgCO2e/${flow.factor.unit}`,
  ];
  if (flow.allocationPercent !== 100) {
    equationParts.push(`× ${formatNumber(flow.allocationPercent)}% allocation`);
  }
  equationParts.push(`= ${formatNumber(kgCo2e)} kgCO2e`);

  return {
    ...base,
    effectiveQuantity: round(derived.quantity),
    effectiveUnit: derived.unit,
    equation: equationParts.join(" "),
    kgCo2e,
    status: "CALCULATED",
    statusReason: null,
  };
}

/** Runs the whole study. Deterministic: same input, same output, every time. */
export function calculateLca(input: LcaCalculationInput): LcaCalculationResult {
  const stages: LcaStageResult[] = [];
  const gaps: LcaCalculationResult["gaps"] = [];
  let total = 0;
  let unmappedFlowCount = 0;
  let calculatedFlowCount = 0;

  for (const stage of input.stages) {
    const processes: LcaProcessResult[] = [];
    let stageTotal = 0;
    let stageUnmapped = 0;

    for (const process of stage.processes) {
      const flows = process.flows.map((flow) => calculateFlow(flow, input.referenceFlowQuantity, stage.included));
      let processTotal = 0;
      let processUnmapped = 0;

      for (const result of flows) {
        if (result.status === "CALCULATED" && result.kgCo2e !== null) {
          processTotal += result.kgCo2e;
          calculatedFlowCount++;
        } else if (result.status !== "NOT_AN_IMPACT" && result.status !== "STAGE_EXCLUDED") {
          processUnmapped++;
          gaps.push({
            flowId: result.flowId,
            name: result.name,
            status: result.status,
            reason: result.statusReason ?? "No figure produced.",
          });
        }
      }

      processes.push({
        processId: process.id,
        name: process.name,
        kgCo2e: round(processTotal),
        flows,
        unmappedFlowCount: processUnmapped,
      });
      stageTotal += processTotal;
      stageUnmapped += processUnmapped;
    }

    stages.push({
      stageId: stage.id,
      key: stage.key,
      name: stage.name,
      included: stage.included,
      exclusionReason: stage.exclusionReason,
      kgCo2e: round(stageTotal),
      processes,
      unmappedFlowCount: stageUnmapped,
    });

    total += stageTotal;
    unmappedFlowCount += stageUnmapped;
  }

  return {
    engineVersion: LCA_ENGINE_VERSION,
    functionalUnitLabel: input.functionalUnitLabel,
    totalKgCo2e: round(total),
    stages,
    unmappedFlowCount,
    gaps,
    calculatedFlowCount,
  };
}

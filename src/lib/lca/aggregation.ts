/**
 * Hotspot analysis and contribution rollups.
 *
 * Pure aggregation over a `LcaCalculationResult` the engine already produced.
 * Rankings are computed here, from figures the engine calculated — the AI is
 * never asked which stage is biggest, only to explain a ranking it was given.
 *
 * Every rollup carries the share of the total it represents *and* how much of
 * the inventory couldn't be calculated, so "manufacturing is 62% of the
 * footprint" is never quoted without "…of what has been calculated so far".
 */

import { LcaCalculationResult, LcaFlowResult } from "./calc";

export interface Contribution {
  key: string;
  label: string;
  kgCo2e: number;
  percentOfTotal: number;
  /** Flows in this bucket that produced no figure. */
  unmappedFlowCount: number;
}

export interface HotspotAnalysis {
  totalKgCo2e: number;
  byStage: Contribution[];
  byProcess: Contribution[];
  byFlow: Contribution[];
  byFlowType: Contribution[];
  byMaterial: Contribution[];
  byFactorSource: Contribution[];
  /** Flows with no figure, so a hotspot claim can be read with the gaps in view. */
  unmappedFlowCount: number;
  /** True when enough of the inventory is calculated for rankings to mean much. */
  coverageIsMeaningful: boolean;
}

function pct(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}

function sortAndRank(map: Map<string, { label: string; kg: number; unmapped: number }>, total: number): Contribution[] {
  return Array.from(map.entries())
    .map(([key, v]) => ({
      key,
      label: v.label,
      kgCo2e: Number(v.kg.toFixed(8)),
      percentOfTotal: pct(v.kg, total),
      unmappedFlowCount: v.unmapped,
    }))
    .sort((a, b) => b.kgCo2e - a.kgCo2e);
}

function add(
  map: Map<string, { label: string; kg: number; unmapped: number }>,
  key: string,
  label: string,
  kg: number,
  unmapped: number,
) {
  const existing = map.get(key);
  if (existing) {
    existing.kg += kg;
    existing.unmapped += unmapped;
  } else {
    map.set(key, { label, kg, unmapped });
  }
}

export function analyseHotspots(result: LcaCalculationResult): HotspotAnalysis {
  const total = result.totalKgCo2e;

  const stageMap = new Map<string, { label: string; kg: number; unmapped: number }>();
  const processMap = new Map<string, { label: string; kg: number; unmapped: number }>();
  const flowMap = new Map<string, { label: string; kg: number; unmapped: number }>();
  const typeMap = new Map<string, { label: string; kg: number; unmapped: number }>();
  const materialMap = new Map<string, { label: string; kg: number; unmapped: number }>();
  const sourceMap = new Map<string, { label: string; kg: number; unmapped: number }>();

  for (const stage of result.stages) {
    if (!stage.included) continue;
    add(stageMap, stage.stageId, stage.name, stage.kgCo2e, stage.unmappedFlowCount);

    for (const process of stage.processes) {
      add(processMap, process.processId, `${stage.name} → ${process.name}`, process.kgCo2e, process.unmappedFlowCount);

      for (const flow of process.flows) {
        const isGap = flow.status !== "CALCULATED" && flow.status !== "NOT_AN_IMPACT" && flow.status !== "STAGE_EXCLUDED";
        const kg = flow.kgCo2e ?? 0;
        const unmapped = isGap ? 1 : 0;

        add(flowMap, flow.flowId, `${flow.name} (${stage.name})`, kg, unmapped);
        add(typeMap, flow.flowType, flowTypeLabel(flow.flowType), kg, unmapped);
        if (flow.flowType === "MATERIAL") {
          add(materialMap, flow.name.toLowerCase(), flow.name, kg, unmapped);
        }
        if (flow.factor) {
          add(sourceMap, flow.factor.source, flow.factor.source, kg, 0);
        }
      }
    }
  }

  const consideredFlows = result.calculatedFlowCount + result.unmappedFlowCount;

  return {
    totalKgCo2e: total,
    byStage: sortAndRank(stageMap, total),
    byProcess: sortAndRank(processMap, total),
    byFlow: sortAndRank(flowMap, total).slice(0, 20),
    byFlowType: sortAndRank(typeMap, total),
    byMaterial: sortAndRank(materialMap, total),
    byFactorSource: sortAndRank(sourceMap, total),
    unmappedFlowCount: result.unmappedFlowCount,
    // Rankings over an inventory that is mostly uncalculated are misleading;
    // the UI uses this to caveat rather than to hide.
    coverageIsMeaningful: consideredFlows > 0 && result.calculatedFlowCount / consideredFlows >= 0.6,
  };
}

export function flowTypeLabel(flowType: LcaFlowResult["flowType"]): string {
  const labels: Record<LcaFlowResult["flowType"], string> = {
    MATERIAL: "Materials",
    ENERGY: "Energy",
    FUEL: "Fuel",
    ELECTRICITY: "Electricity",
    WATER: "Water",
    TRANSPORT: "Transport",
    WASTE: "Waste",
    EMISSION: "Direct emissions",
    PRODUCT: "Product output",
    CO_PRODUCT: "Co-product output",
  };
  return labels[flowType];
}

/** Compact rendering of a result plus its hotspots, for use as AI context. */
export function formatHotspotsForPrompt(result: LcaCalculationResult, hotspots: HotspotAnalysis): string {
  const lines: string[] = [];
  lines.push(
    `Total: ${result.totalKgCo2e.toFixed(4)} kgCO2e per ${result.functionalUnitLabel ?? "functional unit (not yet defined)"}.`,
  );
  lines.push(
    `Flows calculated: ${result.calculatedFlowCount}. Flows with no figure: ${result.unmappedFlowCount}. Engine: ${result.engineVersion}.`,
  );
  if (!hotspots.coverageIsMeaningful) {
    lines.push(
      "WARNING: a large share of the inventory has no figure yet, so these rankings are provisional and must be presented as such.",
    );
  }

  lines.push("", "BY LIFE CYCLE STAGE:");
  for (const c of hotspots.byStage) {
    lines.push(`- ${c.label}: ${c.kgCo2e.toFixed(4)} kgCO2e (${c.percentOfTotal.toFixed(1)}%)${c.unmappedFlowCount ? `, ${c.unmappedFlowCount} flow(s) with no figure` : ""}`);
  }

  lines.push("", "BY PROCESS (largest first):");
  for (const c of hotspots.byProcess.slice(0, 10)) {
    lines.push(`- ${c.label}: ${c.kgCo2e.toFixed(4)} kgCO2e (${c.percentOfTotal.toFixed(1)}%)`);
  }

  lines.push("", "BY FLOW TYPE:");
  for (const c of hotspots.byFlowType) {
    lines.push(`- ${c.label}: ${c.kgCo2e.toFixed(4)} kgCO2e (${c.percentOfTotal.toFixed(1)}%)`);
  }

  if (hotspots.byMaterial.length > 0) {
    lines.push("", "BY MATERIAL:");
    for (const c of hotspots.byMaterial.slice(0, 10)) {
      lines.push(`- ${c.label}: ${c.kgCo2e.toFixed(4)} kgCO2e (${c.percentOfTotal.toFixed(1)}%)`);
    }
  }

  if (result.gaps.length > 0) {
    lines.push("", "FLOWS WITH NO FIGURE (not zero — unknown):");
    for (const gap of result.gaps.slice(0, 25)) {
      lines.push(`- ${gap.name} [${gap.status}]: ${gap.reason}`);
    }
  }

  return lines.join("\n");
}

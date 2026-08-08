/**
 * Multi-output allocation.
 *
 * When a process makes more than one saleable thing, only part of its burden
 * belongs to the product being assessed. Which part depends on the method the
 * modeller chose, and the split has to be reproducible from the recorded
 * outputs rather than typed in as a bare percentage — otherwise nobody can
 * check it later.
 *
 * Allocation also cascades: a sub-process inside an already-allocated parent
 * is allocated twice over, once at each level, which is the correct treatment
 * and easy to get wrong by hand.
 */

import { LcaAllocationMethod } from "@prisma/client";
import { D, Decimal, HUNDRED, ONE, ZERO, percentOf } from "../decimal";
import { convertQuantity, IncompatibleUnitError, UnknownUnitError } from "../units";
import type { EngineProcess, EngineProcessOutput } from "./types";

export interface AllocationOutcome {
  method: LcaAllocationMethod;
  /** 0..1 multiplier applied to this process's emissions. */
  factor: Decimal;
  percent: Decimal;
  basis: string;
  /** Set when the method could not be applied from the recorded outputs. */
  problem: string | null;
}

function outputMass(output: EngineProcessOutput, targetUnit: string): Decimal | null {
  if (output.massValue === null || !output.massUnit) return null;
  try {
    return convertQuantity(output.massValue, output.massUnit, targetUnit);
  } catch (err) {
    if (err instanceof IncompatibleUnitError || err instanceof UnknownUnitError) return null;
    throw err;
  }
}

function physicalValue(output: EngineProcessOutput, targetUnit: string): Decimal | null {
  if (output.physicalValue === null || !output.physicalUnit) return null;
  try {
    return convertQuantity(output.physicalValue, output.physicalUnit, targetUnit);
  } catch (err) {
    if (err instanceof IncompatibleUnitError || err instanceof UnknownUnitError) return null;
    throw err;
  }
}

/**
 * The share of one process's own emissions that belongs to the assessed
 * product, before any parent allocation is applied.
 */
export function resolveProcessAllocation(process: EngineProcess): AllocationOutcome {
  const outputs = process.outputs;

  if (process.allocationMethod === LcaAllocationMethod.NONE) {
    return {
      method: LcaAllocationMethod.NONE,
      factor: ONE,
      percent: HUNDRED,
      basis: "Single-output process — all emissions belong to the assessed product.",
      problem: null,
    };
  }

  if (process.allocationMethod === LcaAllocationMethod.MANUAL) {
    const percent = process.allocationPercent;
    const problem =
      percent.lt(ZERO) || percent.gt(HUNDRED)
        ? `Manual allocation of ${percent.toString()}% is outside 0–100%.`
        : process.allocationRationale
          ? null
          : "Manual allocation has no recorded rationale.";
    const safePercent = percent.lt(ZERO) ? ZERO : percent.gt(HUNDRED) ? HUNDRED : percent;
    return {
      method: LcaAllocationMethod.MANUAL,
      factor: safePercent.div(HUNDRED),
      percent: safePercent,
      basis: `Manual split of ${safePercent.toString()}%${process.allocationRationale ? `: ${process.allocationRationale}` : ""}`,
      problem,
    };
  }

  const assessed = outputs.filter((o) => o.isAssessedProduct);
  if (outputs.length === 0 || assessed.length === 0) {
    return {
      method: process.allocationMethod,
      factor: ONE,
      percent: HUNDRED,
      basis: "No co-products recorded, so no split could be derived — all emissions attributed to the assessed product.",
      problem: `Process "${process.name}" is set to ${process.allocationMethod.toLowerCase()} allocation but has no recorded outputs marking the assessed product, so 100% has been attributed to it.`,
    };
  }

  if (process.allocationMethod === LcaAllocationMethod.MASS) {
    const target = "kg";
    const values = outputs.map((o) => ({ output: o, value: outputMass(o, target) }));
    const missing = values.filter((v) => v.value === null);
    if (missing.length > 0) {
      return unresolved(process, `${missing.length} output(s) have no usable mass, so a mass split could not be derived.`);
    }
    const total = values.reduce<Decimal>((sum, v) => sum.plus(v.value as Decimal), ZERO);
    if (total.lte(ZERO)) return unresolved(process, "Total output mass is zero, so a mass split could not be derived.");
    const assessedTotal = values
      .filter((v) => v.output.isAssessedProduct)
      .reduce<Decimal>((sum, v) => sum.plus(v.value as Decimal), ZERO);
    const percent = percentOf(assessedTotal, total);
    return {
      method: LcaAllocationMethod.MASS,
      factor: assessedTotal.div(total),
      percent,
      basis: `Mass allocation: ${assessedTotal.toSignificantDigits(10)} kg of ${total.toSignificantDigits(10)} kg total output = ${percent.toDecimalPlaces(4)}%`,
      problem: null,
    };
  }

  if (process.allocationMethod === LcaAllocationMethod.PHYSICAL) {
    const reference = outputs.find((o) => o.physicalUnit)?.physicalUnit;
    if (!reference) return unresolved(process, "No physical quantities recorded on the outputs.");
    const values = outputs.map((o) => ({ output: o, value: physicalValue(o, reference) }));
    const missing = values.filter((v) => v.value === null);
    if (missing.length > 0) {
      return unresolved(
        process,
        `${missing.length} output(s) have no physical quantity in a unit comparable with ${reference}, so a physical split could not be derived.`,
      );
    }
    const total = values.reduce<Decimal>((sum, v) => sum.plus(v.value as Decimal), ZERO);
    if (total.lte(ZERO)) return unresolved(process, "Total physical output is zero, so a physical split could not be derived.");
    const assessedTotal = values
      .filter((v) => v.output.isAssessedProduct)
      .reduce<Decimal>((sum, v) => sum.plus(v.value as Decimal), ZERO);
    const percent = percentOf(assessedTotal, total);
    return {
      method: LcaAllocationMethod.PHYSICAL,
      factor: assessedTotal.div(total),
      percent,
      basis: `Physical allocation on ${reference}: ${assessedTotal.toSignificantDigits(10)} of ${total.toSignificantDigits(10)} = ${percent.toDecimalPlaces(4)}%`,
      problem: null,
    };
  }

  // Economic
  const currencies = new Set(outputs.filter((o) => o.economicValue !== null).map((o) => o.economicCurrency ?? ""));
  if (currencies.size > 1) {
    return unresolved(
      process,
      `Outputs are valued in more than one currency (${Array.from(currencies).join(", ")}); this platform holds no exchange rates, so convert to one currency before allocating.`,
    );
  }
  const missingValue = outputs.filter((o) => o.economicValue === null);
  if (missingValue.length > 0) {
    return unresolved(process, `${missingValue.length} output(s) have no economic value, so an economic split could not be derived.`);
  }
  const total = outputs.reduce<Decimal>((sum, o) => sum.plus(o.economicValue as Decimal), ZERO);
  if (total.lte(ZERO)) return unresolved(process, "Total output value is zero, so an economic split could not be derived.");
  const assessedTotal = outputs
    .filter((o) => o.isAssessedProduct)
    .reduce<Decimal>((sum, o) => sum.plus(o.economicValue as Decimal), ZERO);
  const percent = percentOf(assessedTotal, total);
  const currency = outputs.find((o) => o.economicCurrency)?.economicCurrency ?? "";
  return {
    method: LcaAllocationMethod.ECONOMIC,
    factor: assessedTotal.div(total),
    percent,
    basis: `Economic allocation: ${assessedTotal.toSignificantDigits(10)} ${currency} of ${total.toSignificantDigits(10)} ${currency} total output value = ${percent.toDecimalPlaces(4)}%`,
    problem: null,
  };
}

/**
 * When a chosen method can't be applied, nothing is invented: the full burden
 * stays with the product (the conservative direction) and the reason is
 * reported so it shows up in validation rather than being absorbed silently.
 */
function unresolved(process: EngineProcess, reason: string): AllocationOutcome {
  return {
    method: process.allocationMethod,
    factor: ONE,
    percent: HUNDRED,
    basis: "Allocation could not be derived — 100% attributed to the assessed product pending correction.",
    problem: `Process "${process.name}": ${reason}`,
  };
}

export interface ResolvedAllocation {
  /** Allocation for the process alone. */
  own: AllocationOutcome;
  /** Own allocation multiplied through every ancestor process. */
  effectiveFactor: Decimal;
  effectivePercent: Decimal;
  /** Human-readable chain, e.g. "Moulding 40% x Manufacturing 100%". */
  chain: string;
}

/**
 * Allocation for every process in the model, with parent allocations cascaded
 * down. A cycle in the parent chain (which the UI prevents but the data model
 * could technically hold) stops the walk rather than looping.
 */
export function resolveAllocations(processes: EngineProcess[]): Map<string, ResolvedAllocation> {
  const byId = new Map(processes.map((p) => [p.id, p]));
  const own = new Map<string, AllocationOutcome>();
  for (const p of processes) own.set(p.id, resolveProcessAllocation(p));

  const resolved = new Map<string, ResolvedAllocation>();

  for (const process of processes) {
    let factor = ONE;
    const chainParts: string[] = [];
    const seen = new Set<string>();
    let current: EngineProcess | undefined = process;

    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      const outcome = own.get(current.id);
      if (outcome) {
        factor = factor.times(outcome.factor);
        chainParts.push(`${current.name} ${outcome.percent.toDecimalPlaces(4)}%`);
      }
      current = current.parentProcessId ? byId.get(current.parentProcessId) : undefined;
    }

    resolved.set(process.id, {
      own: own.get(process.id) ?? {
        method: LcaAllocationMethod.NONE,
        factor: ONE,
        percent: HUNDRED,
        basis: "No allocation applied.",
        problem: null,
      },
      effectiveFactor: factor,
      effectivePercent: factor.times(HUNDRED),
      chain: chainParts.join(" x "),
    });
  }

  return resolved;
}

/** Percentages of a set of routes/splits, for the 100% checks. */
export function sumPercent(values: (Decimal | number | string)[]): Decimal {
  return values.reduce<Decimal>((sum, v) => sum.plus(D(v)), ZERO);
}

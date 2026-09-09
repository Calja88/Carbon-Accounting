/**
 * Pure, deterministic significance engine (T32).
 *
 * There is deliberately no database, clock, actor, organisation or React
 * dependency here. Decimal strings enter and exact Decimal strings leave, so
 * an approved snapshot can always be recalculated without float drift.
 */

import { D, Decimal, ZERO } from "@/lib/lca/decimal";
import type {
  SignificanceFormulaConfig,
  SignificanceResult,
  SignificanceScaleConfig,
  SignificanceSnapshot,
} from "./types";

export type SignificanceValidationCode =
  | "INVALID_THRESHOLD"
  | "DUPLICATE_CRITERION"
  | "MISSING_CRITERION"
  | "INVALID_VALUE"
  | "INVALID_WEIGHT"
  | "INVALID_SCALE"
  | "INVALID_FORMULA_CONFIG";

export class SignificanceValidationError extends Error {
  constructor(
    readonly code: SignificanceValidationCode,
    message: string,
    readonly criterionKey?: string,
  ) {
    super(message);
    this.name = "SignificanceValidationError";
  }
}

function decimal(value: string, code: SignificanceValidationCode, message: string, criterionKey?: string): Decimal {
  try {
    return D(value);
  } catch {
    throw new SignificanceValidationError(code, message, criterionKey);
  }
}

function scoreValue(key: string, value: string, scale?: SignificanceScaleConfig): Decimal {
  if (!value.trim()) {
    throw new SignificanceValidationError("MISSING_CRITERION", `Criterion "${key}" is required.`, key);
  }
  if (!scale || scale.kind === "NUMERIC") {
    const score = decimal(value, "INVALID_VALUE", `Criterion "${key}" must be numeric.`, key);
    if (scale) {
      const min = decimal(scale.min, "INVALID_SCALE", `Criterion "${key}" has an invalid scale minimum.`, key);
      const max = decimal(scale.max, "INVALID_SCALE", `Criterion "${key}" has an invalid scale maximum.`, key);
      if (min.gt(max)) throw new SignificanceValidationError("INVALID_SCALE", `Criterion "${key}" scale minimum exceeds its maximum.`, key);
      if (score.lt(min) || score.gt(max)) {
        throw new SignificanceValidationError("INVALID_VALUE", `Criterion "${key}" must be between ${min} and ${max}.`, key);
      }
    }
    return score;
  }
  const option = scale.options.find((candidate) => candidate.value === value);
  if (!option) throw new SignificanceValidationError("INVALID_VALUE", `Criterion "${key}" is not a configured option.`, key);
  return decimal(option.score, "INVALID_SCALE", `Criterion "${key}" has an invalid option score.`, key);
}

function ruleMatches(value: Decimal, operator: "GT" | "GTE" | "LT" | "LTE" | "EQ", compareTo: Decimal): boolean {
  if (operator === "GT") return value.gt(compareTo);
  if (operator === "GTE") return value.gte(compareTo);
  if (operator === "LT") return value.lt(compareTo);
  if (operator === "LTE") return value.lte(compareTo);
  return value.eq(compareTo);
}

function requireFormulaConfig(snapshot: SignificanceSnapshot): SignificanceFormulaConfig {
  const config = snapshot.formulaConfig ?? ({ formula: snapshot.formula } as SignificanceFormulaConfig);
  if (
    !config ||
    typeof config !== "object" ||
    config.formula !== snapshot.formula ||
    (config.formula === "RULE_SET" && (!Array.isArray(config.rules) || config.rules.length === 0))
  ) {
    throw new SignificanceValidationError("INVALID_FORMULA_CONFIG", "Formula configuration does not match the snapshot formula.");
  }
  return config;
}

export function calculateSignificance(snapshot: SignificanceSnapshot): SignificanceResult {
  const threshold = decimal(snapshot.threshold, "INVALID_THRESHOLD", "Threshold must be a non-negative number.");
  if (threshold.lt(ZERO)) throw new SignificanceValidationError("INVALID_THRESHOLD", "Threshold must be a non-negative number.");
  if (snapshot.criteria.length === 0) throw new SignificanceValidationError("MISSING_CRITERION", "At least one criterion is required.");

  const seen = new Set<string>();
  const scores = new Map<string, Decimal>();
  const weights = new Map<string, Decimal>();
  for (const criterion of snapshot.criteria) {
    if (seen.has(criterion.key)) throw new SignificanceValidationError("DUPLICATE_CRITERION", `Criterion "${criterion.key}" appears more than once.`, criterion.key);
    seen.add(criterion.key);
    if (criterion.weight !== undefined) {
      const weight = decimal(criterion.weight, "INVALID_WEIGHT", `Criterion "${criterion.key}" has an invalid weight.`, criterion.key);
      if (weight.lt(ZERO)) throw new SignificanceValidationError("INVALID_WEIGHT", `Criterion "${criterion.key}" weight cannot be negative.`, criterion.key);
      weights.set(criterion.key, weight);
    }
    if (criterion.required !== false || criterion.value.trim()) scores.set(criterion.key, scoreValue(criterion.key, criterion.value, criterion.scale));
  }

  const config = requireFormulaConfig(snapshot);
  const trace: SignificanceResult["trace"] = [];
  let score = ZERO;

  if (config.formula === "WEIGHTED_SUM") {
    for (const criterion of snapshot.criteria) {
      const value = scores.get(criterion.key);
      if (!value) continue;
      const weight = weights.get(criterion.key) ?? new Decimal(1);
      const contribution = value.times(weight);
      score = score.plus(contribution);
      trace.push({ criterionKey: criterion.key, contribution: contribution.toString() });
    }
  } else if (config.formula === "MAX_CRITERION") {
    let first = true;
    for (const criterion of snapshot.criteria) {
      const value = scores.get(criterion.key);
      if (!value) continue;
      if (first || value.gt(score)) score = value;
      first = false;
      trace.push({ criterionKey: criterion.key, contribution: value.toString() });
    }
  } else {
    for (const rule of config.rules) {
      const value = scores.get(rule.criterionKey);
      if (!value) throw new SignificanceValidationError("MISSING_CRITERION", `Rule criterion "${rule.criterionKey}" is missing.`, rule.criterionKey);
      const compareTo = decimal(rule.compareTo, "INVALID_FORMULA_CONFIG", `Rule for "${rule.criterionKey}" has an invalid comparison value.`, rule.criterionKey);
      const contribution = ruleMatches(value, rule.operator, compareTo) ? new Decimal(1) : ZERO;
      score = score.plus(contribution);
      trace.push({ criterionKey: rule.criterionKey, contribution: contribution.toString() });
    }
  }

  return { score: score.toString(), calculatedSignificant: score.gte(threshold), trace };
}

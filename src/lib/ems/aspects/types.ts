/**
 * Process/activity profile shared types (task T30,
 * Docs/PHASE3_ASPECTS_OPERATIONS_SPEC.md §2). Re-exports the
 * Prisma-generated enums under this module's own path so callers never
 * import `@prisma/client` directly for these.
 */

export type {
  ProcessActivityType,
  EmsLifecycleStage,
  EmsOperatingCondition,
  ActivityProcessStatus,
  AspectControlRelationship,
  EnvironmentalEffect,
  EnvironmentalImpactExtent,
  SignificanceFormula,
  SignificanceMethodStatus,
  AspectAssessmentStatus,
} from "@prisma/client";

export type NumericScaleConfig = {
  kind: "NUMERIC";
  min: string;
  max: string;
};

export type ScoredOptionsScaleConfig = {
  kind: "SCORED_OPTIONS";
  options: Array<{ value: string; label: string; score: string }>;
};

export type SignificanceScaleConfig = NumericScaleConfig | ScoredOptionsScaleConfig;

export type SignificanceFormulaConfig =
  | { formula: "WEIGHTED_SUM" }
  | { formula: "MAX_CRITERION" }
  | {
      formula: "RULE_SET";
      rules: Array<{
        criterionKey: string;
        operator: "GT" | "GTE" | "LT" | "LTE" | "EQ";
        compareTo: string;
      }>;
    };

export type SignificanceSnapshot = {
  methodKey: string;
  version: number;
  formula: "WEIGHTED_SUM" | "MAX_CRITERION" | "RULE_SET";
  formulaConfig?: SignificanceFormulaConfig;
  threshold: string;
  criteria: Array<{
    key: string;
    value: string;
    weight?: string;
    required?: boolean;
    scale?: SignificanceScaleConfig;
  }>;
};

export type SignificanceResult = {
  score: string;
  calculatedSignificant: boolean;
  trace: Array<{ criterionKey: string; contribution: string }>;
};

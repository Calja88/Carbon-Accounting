/**
 * Input adapter registry (task T72, spec §5). Maps each
 * `ManagementReviewInputSourceType` to the read-only adapter that resolves
 * its exact current source record(s) — see `types.ts` for the contract and
 * why this stops short of T73's frozen pack generation.
 */

import type { ManagementReviewInputSourceType } from "@prisma/client";
import type { ReviewInputAdapter } from "./types";
import { complianceEvaluationAdapter } from "./compliance-evaluation";
import { actionProgrammeAdapter } from "./action-programme";
import { auditReportAdapter } from "./audit-report";
import { correctiveActionAdapter } from "./corrective-action";
import { competenceGapAdapter } from "./competence-gap";

export type { ReviewInputAdapter, ReviewInputResolution } from "./types";

const REGISTRY: Partial<Record<ManagementReviewInputSourceType, ReviewInputAdapter>> = {
  COMPLIANCE_EVALUATION: complianceEvaluationAdapter,
  ACTION_PROGRAMME: actionProgrammeAdapter,
  AUDIT_REPORT: auditReportAdapter,
  CORRECTIVE_ACTION: correctiveActionAdapter,
  COMPETENCE_GAP: competenceGapAdapter,
};

/** Returns the adapter for a source type, or `null` for OTHER / organisation-defined inputs with no dedicated adapter. */
export function getReviewInputAdapter(sourceType: ManagementReviewInputSourceType): ReviewInputAdapter | null {
  return REGISTRY[sourceType] ?? null;
}

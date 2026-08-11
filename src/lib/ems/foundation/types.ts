/**
 * EMS programme foundation shared types (task T23,
 * Docs/PHASE2_EMS_FOUNDATION_SPEC.md §3). Re-exports the Prisma-generated
 * enums under this module's own path so callers never import `@prisma/client`
 * directly for these, plus the small non-schema types the services share.
 */

export type {
  EmsProgrammeStatus,
  EmsCertificationIntent,
  EmsScopeVersionStatus,
  EmsRequirementImplementationStatus,
  ContextIssueType,
  ContextIssueDirection,
  InterestedPartyInfluence,
  EmsRiskOpportunityKind,
  EmsRiskOpportunityStatus,
  ChangeAssessmentStatus,
} from "@prisma/client";

/**
 * A generic `{ resourceType, resourceId }` reference, used by
 * `ChangeAssessment.affectedRefs` to point at scope/context/policy (and,
 * later, aspect/obligation/control/competence) records without a hard FK to
 * models a later phase has not built yet.
 */
export interface EmsResourceRef {
  resourceType: string;
  resourceId: string;
}

/** A versioned rating snapshot for an `EmsRiskOpportunity` — organisation-configured, never a seeded universal formula. */
export interface EmsRatingSnapshot {
  scaleVersion: string;
  values: Record<string, unknown>;
  computedAt: string;
}

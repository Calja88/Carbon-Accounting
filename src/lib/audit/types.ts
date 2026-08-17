/**
 * Phase 2 (T20) — generic append-only audit event vocabulary and input
 * shape. Supplements, not replaces, existing domain-specific provenance
 * (LcaAuditEvent, immutable Calculation/ReportSnapshot/LcaAssessmentVersion
 * history).
 *
 * `AuditEventType` is the fixed Phase 1 vocabulary required by
 * PHASE1_TENANCY_RBAC_SPEC.md §10, plus `organisation.created` /
 * `organisation.settings_changed` from the same list. It stays a union of
 * literal strings — not a Postgres enum — so later phases can extend it
 * without a schema migration; the schema column itself is a plain string.
 */

export const AUDIT_EVENT_TYPES = [
  "organisation.created",
  "organisation.settings_changed",
  "membership.invited",
  "membership.activated",
  "membership.suspended",
  "membership.removed",
  "membership.scope_changed",
  "role.created",
  "role.updated",
  "role.deactivated",
  "role.permission_granted",
  "role.permission_revoked",
  "membership.role_assigned",
  "membership.role_removed",
  "access_review.completed",
  // Controlled documents / shared evidence (task T22).
  "controlled_document.created",
  "controlled_document_revision.created",
  "controlled_document_revision.submitted_for_review",
  "controlled_document_revision.reviewed",
  "controlled_document_revision.approved",
  "controlled_document_revision.published_effective",
  "controlled_document_revision.made_obsolete",
  "evidence_object.uploaded",
  "evidence_object.linked",
  // EMS programme, scope, context and interested parties (task T23).
  "ems_programme.created",
  "ems_programme.activated",
  "ems_programme.suspended",
  "ems_programme.closed",
  "ems_scope_version.created",
  "ems_scope_version.submitted_for_review",
  "ems_scope_version.approved",
  "ems_scope_version.superseded",
  "standard_requirement_map.upserted",
  "context_issue.created",
  "context_issue.updated",
  "interested_party.created",
  "interested_party.updated",
  "interested_party_requirement.created",
  "interested_party_requirement.updated",
  "ems_risk_opportunity.created",
  "ems_risk_opportunity.updated",
  "change_assessment.created",
  "change_assessment.reviewed",
  "change_assessment.approved",
  "change_assessment.implemented",
  "change_assessment.effectiveness_reviewed",
  "environmental_policy_record.linked",
  "environmental_policy_record.approved",
  // Process/activity profiles (task T30).
  "activity_process.created",
  "activity_process.revised",
  "activity_process.activated",
  "activity_process.archived",
  "activity_process.template_applied",
  // Aspect/impact register (task T31).
  "environmental_aspect.created",
  "environmental_aspect.updated",
  "environmental_aspect.deleted",
  "environmental_impact.created",
  "environmental_impact.deleted",
  "aspect_impact.linked",
  "aspect_impact.unlinked",
  // Versioned aspect significance (task T32).
  "significance_method.created",
  "significance_method.approved",
  "significance_method.superseded",
  "aspect_assessment.created",
  "aspect_assessment.approved",
  "aspect_assessment.superseded",
  // Operational controls and review cycle (task T33).
  "operational_control.created",
  "operational_control.revised",
  "operational_control.retired",
  "control_check.recorded",
  // External providers, communications and emergency preparedness (task T35).
  "external_provider_control.created",
  "external_provider_control.status_changed",
  "external_provider_evaluation.recorded",
  "communication_plan.created",
  "communication_plan.status_changed",
  "communication_record.created",
  "emergency_scenario.created",
  "emergency_scenario.status_changed",
  "emergency_plan.created",
  "emergency_plan.revised",
  "emergency_exercise.recorded",
  "emergency_exercise_action.recorded",
  // Applicability workflow (task T43).
  "applicability_assessment.created",
  "applicability_assessment.submitted_for_review",
  "applicability_assessment.decided",
  "applicability_assessment.superseded",
  // Compliance obligation versioning and approval (task T44).
  "compliance_obligation_version.created",
  "compliance_obligation_version.submitted_for_review",
  "compliance_obligation_version.approved",
  "compliance_obligation_version.rejected",
  "compliance_obligation_version.returned",
  "compliance_obligation_version.superseded",
  "compliance_obligation_version.retired",
  "obligation_change_review.recorded",
  // Compliance evaluation (task T45).
  "compliance_evaluation_programme.created",
  "compliance_evaluation_programme.closed",
  "compliance_evaluation.created",
  "compliance_evaluation.started",
  "compliance_evaluation.completed",
  "compliance_evaluation.issued",
  "compliance_evaluation_item.recorded",
  "compliance_evaluation_finding_link.requested",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export type AuditActorType = "USER" | "SYSTEM";

export type AuditResourceType =
  | "organisation"
  | "membership"
  | "role"
  | "role_permission"
  | "access_review"
  | "controlled_document"
  | "controlled_document_revision"
  | "evidence_object"
  | "ems_programme"
  | "ems_scope_version"
  | "standard_requirement_map"
  | "context_issue"
  | "interested_party"
  | "interested_party_requirement"
  | "ems_risk_opportunity"
  | "change_assessment"
  | "environmental_policy_record"
  | "activity_process"
  | "process_profile_template"
  | "environmental_aspect"
  | "environmental_impact"
  | "aspect_impact_link"
  | "significance_method"
  | "aspect_assessment"
  | "operational_control"
  | "control_check"
  | "external_provider_control"
  | "external_provider_evaluation"
  | "communication_plan"
  | "communication_record"
  | "emergency_scenario"
  | "emergency_plan"
  | "emergency_exercise"
  | "applicability_assessment"
  | "compliance_obligation_version"
  | "obligation_change_review"
  | "compliance_evaluation_programme"
  | "compliance_evaluation"
  | "compliance_evaluation_item"
  | "compliance_evaluation_finding_link";

/**
 * Input to `recordAuditEvent`. Deliberately narrow: `before`/`after` accept
 * only plain JSON-safe values, and callers are responsible for keeping them
 * to safe summaries or field-level diffs — never secrets, invitation
 * tokens, cookies, file bytes, environmental values, API keys, or full AI
 * prompts (PHASE1_TENANCY_RBAC_SPEC.md §10).
 */
export interface RecordAuditEventInput {
  eventType: AuditEventType;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  summary: string;
  /** The acting User's id, or null for a genuine `actorType: "SYSTEM"` event. Never defaulted from context — callers state it explicitly so a system context marker id is never mistaken for a real User row. */
  actorUserId: string | null;
  actorType?: AuditActorType;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Ties every event raised by one logical operation together (e.g. an invite that both creates a membership and assigns roles). */
  correlationId: string;
  /** Where the event originated, e.g. "web-app", "backfill", "system". Never a full request URL/user agent. */
  source: string;
}

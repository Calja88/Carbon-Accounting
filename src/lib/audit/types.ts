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
  "standard_requirement_map.competent_review_recorded",
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
  // Environmental monitoring and calibration (task T34).
  "monitoring_plan.created",
  "monitoring_result.recorded",
  "monitoring_result.reviewed",
  "monitoring_exception.reviewed",
  "monitoring_equipment.created",
  "equipment_calibration.recorded",
  "calibration_exception.reviewed",
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
  // Other requirements and manual legal sources (task T46).
  "other_requirement_source.created",
  "other_requirement_source.updated",
  "other_requirement_source.status_changed",
  // Objectives and metric definitions (task T50).
  "environmental_objective_version.created",
  "environmental_objective_version.submitted_for_review",
  "environmental_objective_version.approved",
  "environmental_objective_version.rejected",
  "environmental_objective_version.returned",
  "environmental_objective_version.superseded",
  "environmental_objective_version.achievement_decided",
  "environmental_objective_version.cancelled",
  "objective_metric_version.created",
  "objective_metric_version.approved",
  "objective_metric_version.superseded",
  // Action programmes and reminders (task T52).
  "action_programme.created",
  "action_programme.status_changed",
  "action_item.created",
  "action_item.reassigned",
  "action_item.status_changed",
  "action_item.progress_recorded",
  "action_item.completed",
  "action_item.verified",
  "action_item.reopened",
  // Audit programme and audit execution (task T60).
  "audit_programme.created",
  "audit_programme.approved",
  "audit_programme.activated",
  "audit_programme.completed",
  "audit_programme_item.created",
  "ems_audit.created",
  "ems_audit.rescheduled",
  "ems_audit.preparation_started",
  "ems_audit.started",
  "audit_team_member.assigned",
  "audit_team_member.removed",
  // Checklists, evidence, findings and frozen report (task T61).
  "audit_checklist_version.frozen",
  "audit_question_response.recorded",
  "audit_question_response.updated",
  "audit_finding.created",
  "audit_finding.confirmed",
  "audit_finding.action_required",
  "audit_finding.accepted_observation",
  "audit_finding.closed",
  "ems_audit.report_draft_started",
  "ems_audit.report_issued",
  // Environmental incident intake (task T62).
  "incident_severity_level.created",
  "incident_escalation_rule.upserted",
  "environmental_incident.reported",
  "environmental_incident.triaged",
  "environmental_incident.investigation_started",
  "environmental_incident.response_completed",
  "environmental_incident.closed",
  "environmental_incident.reopened",
  "incident_correction.recorded",
  "incident_notification_assessment.recorded",
  // Nonconformity workflow (task T63).
  "nonconformity_classification.created",
  "nonconformity_closure_policy.upserted",
  "nonconformity.created",
  "nonconformity.classified",
  "nonconformity_source_link.created",
  "containment_record.created",
  "containment_record.adequacy_reviewed",
  "nonconformity.contained",
  "nonconformity.closed",
  "nonconformity.reopened",
  // Root cause, corrective action and effectiveness (task T64).
  "root_cause_analysis.recorded",
  "root_cause_analysis.approved",
  "nonconformity.root_cause_approved",
  "corrective_action.created",
  "nonconformity.actions_in_progress",
  "corrective_action.reassigned",
  "corrective_action.status_changed",
  "corrective_action.completed",
  "corrective_action.verified",
  "corrective_action.reopened",
  "nonconformity.effectiveness_review_requested",
  "effectiveness_review.recorded",
  "nonconformity.follow_up_created",
  // Competence requirements and person assignments (task T70).
  "person_profile.created",
  "person_profile.updated",
  "person_profile.deactivated",
  "person_profile.reactivated",
  "person_sensitive_profile.updated",
  "competence_requirement_version.created",
  "competence_requirement_version.approved",
  "competence_requirement_version.activated",
  "competence_requirement_version.superseded",
  "competence_assignment.created",
  "competence_assignment.status_changed",
  // Training, evidence, assessment and expiry (task T71).
  "competence_evidence.submitted",
  "competence_evidence.verified",
  "competence_evidence.rejected",
  "competence_assessment.created",
  "competence_assessment.completed",
  "competence_assignment.expired",
  // Management review model and agenda (task T72).
  "management_review_agenda_template_version.created",
  "management_review_agenda_template_version.approved",
  "management_review_agenda_template_version.activated",
  "management_review_agenda_template_version.superseded",
  "management_review.scheduled",
  "management_review.rescheduled",
  "management_review.input_collection_started",
  "management_review_attendee.added",
  "management_review_attendee.removed",
  "management_review_input_link.linked",
  "management_review_input_link.removed",
  // Deterministic review pack, decisions and approved minutes (task T73).
  "management_review_pack.generated",
  "management_review_pack.issued",
  "management_review_ai_narrative.added",
  "management_review_ai_narrative.reviewed",
  "management_review_decision.recorded",
  "management_review.held",
  "management_review_minutes.drafted",
  "management_review_minutes.approved",
  "management_review_minutes.addendum_drafted",
  "management_review.closed",
  "management_review_action_link.linked",
  "management_review_action_link.unlinked",
  // Audit integrity, retention and export (task T81).
  "legal_hold.created",
  "legal_hold.released",
  "evidence_object.retention_previewed",
  "evidence_object.retention_executed",
  "organisation_export.generated",
  // Organisation storage configuration and external-file references (task SP01).
  "storage_connection.created",
  "storage_connection.status_changed",
  "storage_site_binding.created",
  "storage_site_binding.status_changed",
  "external_file_reference.created",
  "external_file_reference.pinned",
  "external_file_reference.marked_stale",
  // Controlled-document SharePoint revision integration (task SP04).
  "external_file_reference.relinked",
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
  | "monitoring_plan"
  | "monitoring_result"
  | "monitoring_equipment"
  | "equipment_calibration"
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
  | "compliance_evaluation_finding_link"
  | "other_requirement_source"
  | "environmental_objective_version"
  | "objective_metric_version"
  | "action_programme"
  | "action_item"
  | "audit_programme"
  | "audit_programme_item"
  | "ems_audit"
  | "audit_team_member"
  | "audit_checklist_version"
  | "audit_question_response"
  | "audit_finding"
  | "environmental_incident"
  | "nonconformity_classification"
  | "nonconformity_closure_policy"
  | "nonconformity"
  | "nonconformity_source_link"
  | "containment_record"
  | "root_cause_analysis"
  | "corrective_action"
  | "effectiveness_review"
  | "person_profile"
  | "competence_requirement_version"
  | "competence_assignment"
  | "competence_evidence"
  | "competence_assessment"
  | "management_review_agenda_template_version"
  | "management_review"
  | "management_review_attendee"
  | "management_review_input_link"
  | "management_review_pack"
  | "management_review_ai_narrative"
  | "management_review_decision"
  | "management_review_minute_revision"
  | "management_review_action_link"
  | "legal_hold"
  | "organisation_export"
  | "organisation_storage_connection"
  | "storage_site_binding"
  | "external_file_reference";

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

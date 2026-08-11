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
  | "evidence_object";

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

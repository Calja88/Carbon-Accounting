/**
 * Record classification matrix (task T81,
 * Docs/PHASE8_HARDENING_READINESS_SPEC.md §4). Pure, DB-agnostic vocabulary
 * — used by the legal-hold and retention services to decide what a resource
 * type IS before deciding what may happen to it.
 *
 * Per the spec table:
 *  - IMMUTABLE_ISSUED  — reports, obligation approvals, audit reports,
 *    review packs/minutes. Never deleted by retention; the existing
 *    version/supersession pattern (already landed per task) is the only
 *    "revision" mechanism. Retention execution refuses this class outright.
 *  - OPERATIONAL_CONTROLLED — aspects, controls, objectives, NC/CAPA.
 *    Retention triggers/archival for this class are an explicit owner
 *    decision (CLAUDE_IMPLEMENTATION_TASKS.md global context: "Do not ask
 *    Claude to decide ... records-retention policy") not yet configured —
 *    retention execution refuses this class until an organisation-specific
 *    policy exists.
 *  - EVIDENCE — invoices, certificates, photos, source payloads. The one
 *    class with a concrete, already-schema'd per-record retention control
 *    (`EvidenceObject.retentionUntil`/`legalHold`), so it is the one class
 *    `retention-service.ts` actually executes against.
 *  - PERSONAL_RESTRICTED — competence, restricted incidents. Subject-access
 *    boundaries are enforced by existing classification/permission checks
 *    (`ems.competence.sensitive.view`, `ems.incident.restricted.view`);
 *    retention execution refuses this class until an owner-approved policy
 *    exists, same as OPERATIONAL_CONTROLLED.
 *  - TELEMETRY_AUDIT — app audit, AI interaction metadata, job logs. Never
 *    deleted: `AuditEvent` is append-only by database trigger
 *    (`src/lib/audit/integrity.ts`), so this class is permanently excluded
 *    from retention execution, not merely defaulted off.
 *
 * Only EVIDENCE is wired to preview/execute in this task. The other classes
 * are recorded here as the deliverable classification matrix and as the
 * refusal reason retention-service.ts returns for them, so callers get an
 * explicit "not configured for deletion" rather than a silent no-op.
 */

export const RECORD_CLASSES = [
  "IMMUTABLE_ISSUED",
  "OPERATIONAL_CONTROLLED",
  "EVIDENCE",
  "PERSONAL_RESTRICTED",
  "TELEMETRY_AUDIT",
] as const;

export type RecordClass = (typeof RECORD_CLASSES)[number];

export interface RecordClassDefinition {
  recordClass: RecordClass;
  description: string;
  /** Representative resource types in this class — informational, not exhaustive. */
  examples: string[];
  /** Whether `retention-service.ts` can preview/execute deletion for this class today. */
  retentionExecutable: boolean;
  /** Why, when `retentionExecutable` is false. */
  refusalReason?: string;
}

export const RECORD_CLASSIFICATION: Record<RecordClass, RecordClassDefinition> = {
  IMMUTABLE_ISSUED: {
    recordClass: "IMMUTABLE_ISSUED",
    description: "Reports, obligation approvals, audit reports, review packs/minutes.",
    examples: ["compliance_obligation_version", "ems_audit", "management_review_pack"],
    retentionExecutable: false,
    refusalReason: "Issued/approved records use archival/successor-version rules, never deletion.",
  },
  OPERATIONAL_CONTROLLED: {
    recordClass: "OPERATIONAL_CONTROLLED",
    description: "Aspects, controls, objectives, nonconformities and corrective actions.",
    examples: ["environmental_aspect", "operational_control", "nonconformity"],
    retentionExecutable: false,
    refusalReason: "Retention trigger/archive policy for this class is an owner decision, not yet configured.",
  },
  EVIDENCE: {
    recordClass: "EVIDENCE",
    description: "Invoices, certificates, photos and other uploaded source payloads.",
    examples: ["evidence_object"],
    retentionExecutable: true,
  },
  PERSONAL_RESTRICTED: {
    recordClass: "PERSONAL_RESTRICTED",
    description: "Competence records and restricted/confidential incidents.",
    examples: ["person_profile", "environmental_incident"],
    retentionExecutable: false,
    refusalReason: "Subject-access retention policy for this class is an owner decision, not yet configured.",
  },
  TELEMETRY_AUDIT: {
    recordClass: "TELEMETRY_AUDIT",
    description: "Platform audit events, AI interaction metadata, job logs.",
    examples: ["audit_event"],
    retentionExecutable: false,
    refusalReason: "Audit events are append-only (database trigger); never deleted by retention.",
  },
};

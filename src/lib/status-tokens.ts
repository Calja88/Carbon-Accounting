/**
 * Canonical status -> {label, tone} mappings, one domain per export, so the
 * same status always reads the same way wherever it appears. Consolidates
 * what used to be several near-identical, independently-maintained maps
 * (STATUS_TONES in documents/page.tsx, STATUS_BADGE in entry/[siteId]/
 * page.tsx, ACTION_TONES in the LCA audit page, DOCUMENT_STATUS_LABELS in
 * documents-service.ts, STATUS_LABELS/STATUS_TONES in lib/lca/labels.ts).
 *
 * This module only adds the *shared* shape; it does not remove the existing
 * per-domain label maps (several of those, e.g. lib/lca/labels.ts and
 * documents-service.ts, are backend-adjacent and stay as the source of
 * truth for label text). Consumers are migrated onto <StatusBadge> as each
 * page is touched by its own redesign phase, not all at once.
 */

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export interface StatusToken {
  label: string;
  tone: Tone;
}

/** Quantity/survey entry status shown on the site checklist and the historical data explorer. */
export const ENTRY_STATUS_TOKENS: Record<string, StatusToken> = {
  submitted: { label: "Submitted", tone: "success" },
  flagged: { label: "Flagged for review", tone: "warning" },
  missing: { label: "Not yet submitted", tone: "neutral" },
  log: { label: "Log as needed", tone: "neutral" },
  awaiting_factor: { label: "Awaiting emission factor", tone: "warning" },
};

/** ActivityEntry.status (backend enum), distinct from the derived checklist status above. */
export const ACTIVITY_ENTRY_STATUS_TOKENS: Record<string, StatusToken> = {
  SUBMITTED: { label: "Submitted", tone: "success" },
  FLAGGED: { label: "Flagged for review", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  AWAITING_FACTOR: { label: "Awaiting emission factor", tone: "warning" },
};

/** SourceDocument.status. */
export const DOCUMENT_STATUS_TOKENS: Record<string, StatusToken> = {
  UPLOADED: { label: "Uploaded", tone: "neutral" },
  EXTRACTED: { label: "Extracted — awaiting review", tone: "info" },
  EXTRACTION_FAILED: { label: "Extraction failed", tone: "danger" },
  PARTIALLY_ACCEPTED: { label: "Partly accepted", tone: "warning" },
  ACCEPTED: { label: "Accepted", tone: "success" },
  REJECTED: { label: "Rejected", tone: "neutral" },
};

/** LcaAssessmentStatus. */
export const ASSESSMENT_STATUS_TOKENS: Record<string, StatusToken> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  DATA_COLLECTION: { label: "Data collection", tone: "info" },
  CALCULATION: { label: "Calculation", tone: "info" },
  INTERNAL_REVIEW: { label: "Internal review", tone: "warning" },
  READY_FOR_VERIFICATION: { label: "Ready for verification", tone: "warning" },
  VERIFIED: { label: "Verified", tone: "success" },
  SUPERSEDED: { label: "Superseded", tone: "neutral" },
};

/** LCA audit-event action verbs. */
export const AUDIT_ACTION_TOKENS: Record<string, StatusToken> = {
  created: { label: "Created", tone: "success" },
  updated: { label: "Updated", tone: "info" },
  deleted: { label: "Deleted", tone: "danger" },
  status_changed: { label: "Status changed", tone: "warning" },
  calculated: { label: "Calculated", tone: "info" },
  approved: { label: "Approved", tone: "success" },
  issued: { label: "Issued", tone: "success" },
  superseded: { label: "Superseded", tone: "warning" },
};

export type StatusDomain = "entry" | "activityEntry" | "document" | "assessment" | "auditAction";

const DOMAIN_TOKENS: Record<StatusDomain, Record<string, StatusToken>> = {
  entry: ENTRY_STATUS_TOKENS,
  activityEntry: ACTIVITY_ENTRY_STATUS_TOKENS,
  document: DOCUMENT_STATUS_TOKENS,
  assessment: ASSESSMENT_STATUS_TOKENS,
  auditAction: AUDIT_ACTION_TOKENS,
};

/** Falls back to a neutral badge showing the raw status rather than throwing on an unmapped value. */
export function resolveStatusToken(domain: StatusDomain, status: string): StatusToken {
  return DOMAIN_TOKENS[domain][status] ?? { label: status, tone: "neutral" };
}

/**
 * SP07 — dry-run migration planning (Docs/SHAREPOINT_AND_EMS_UI_CLAUDE_DELIVERY_PACK.md
 * §"SP07 - Dry-run-first evidence migration").
 *
 * Pure, DB-agnostic planning logic: given a snapshot of one organisation's
 * database-backed evidence (EvidenceObject + LCA evidence) and
 * controlled-document revisions, classifies each item into candidates,
 * skipped, or blocked, and produces the JSON report SP07 requires. This
 * module never touches Prisma or the network — `scripts/migrate-evidence-to-sharepoint.ts`
 * loads the current database state and calls `planEvidenceMigration`, so the
 * classification rules are unit-testable against synthetic in-memory
 * fixtures (same pattern as `src/lib/backfill/organisation-backfill.ts`).
 *
 * Per the SP07 spec, the dry-run report is deliberately non-disclosing: it
 * carries record ids, counts, byte sizes, checksums (already-computed
 * hashes, not secrets) and status — never filenames, paths, or SharePoint
 * URLs/tokens.
 */

export type MigrationRecordKind = "evidence_object" | "lca_evidence" | "controlled_document_revision";

export type MigrationBlockerReason =
  | "already_migrated"
  | "legal_hold"
  | "tombstoned"
  | "missing_checksum"
  | "missing_bytes"
  | "malware_not_clean"
  | "no_storage_connection"
  | "no_active_site_binding"
  | "apply_not_supported_for_kind";

export interface EvidenceObjectSnapshot {
  kind: "evidence_object";
  id: string;
  storageProvider: string | null;
  hasBlob: boolean;
  byteSize: number;
  mimeType: string;
  checksumSha256: string | null;
  malwareScanStatus: "PENDING" | "CLEAN" | "INFECTED" | "SKIPPED" | "FAILED";
  legalHold: boolean;
  underLegalHold: boolean;
  retentionTombstonedAt: string | null;
  retentionUntil: string | null;
  linkedResourceCount: number;
  controlledDocumentRevisionId: string | null;
  alreadyHasExternalReference: boolean;
}

export interface LcaEvidenceSnapshot {
  kind: "lca_evidence";
  id: string;
  assessmentId: string;
  storageProvider: string | null;
  byteSize: number | null;
  mimeType: string | null;
  checksumSha256: string | null;
}

export interface ControlledDocumentRevisionSnapshot {
  kind: "controlled_document_revision";
  id: string;
  documentId: string;
  status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "EFFECTIVE" | "OBSOLETE";
  evidenceObjectId: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
  checksumSha256: string | null;
  underLegalHold: boolean;
  retentionUntil: string | null;
  alreadyHasExternalReference: boolean;
  isCurrentRevision: boolean;
}

export type MigrationItemSnapshot = EvidenceObjectSnapshot | LcaEvidenceSnapshot | ControlledDocumentRevisionSnapshot;

export interface StorageConnectionSnapshot {
  status: "NOT_CONNECTED" | "CONNECTED" | "SUSPENDED" | "OFFBOARDED";
  activeSiteBindingId: string | null;
}

export interface EvidenceMigrationPlanInput {
  organisationId: string;
  storageConnection: StorageConnectionSnapshot | null;
  items: MigrationItemSnapshot[];
}

export interface MigrationCandidate {
  kind: MigrationRecordKind;
  id: string;
  byteSize: number | null;
  mimeType: string | null;
  checksumSha256: string | null;
  hasChecksum: boolean;
  relationships: {
    controlledDocumentRevisionId?: string;
    linkedResourceCount?: number;
    assessmentId?: string;
  };
  applySupported: boolean;
}

export interface MigrationSkippedItem {
  kind: MigrationRecordKind;
  id: string;
  reason: "already_migrated";
}

export interface MigrationBlockedItem {
  kind: MigrationRecordKind;
  id: string;
  reasons: MigrationBlockerReason[];
}

export interface EvidenceMigrationReport {
  organisationId: string;
  generatedAt: string;
  mode: "dry-run";
  target: {
    provider: "sharepoint";
    connectionStatus: StorageConnectionSnapshot["status"] | "not_configured";
    siteBindingConfigured: boolean;
  };
  summary: {
    totalItems: number;
    candidateCount: number;
    candidateApplySupportedCount: number;
    skippedCount: number;
    blockedCount: number;
    candidateBytesTotal: number;
    checksumAvailableCount: number;
    checksumMissingCount: number;
  };
  candidates: MigrationCandidate[];
  skipped: MigrationSkippedItem[];
  blocked: MigrationBlockedItem[];
  warnings: string[];
}

/** Kinds whose apply path is implemented by `evidence-migration-apply.ts` in this task. */
const APPLY_SUPPORTED_KINDS: ReadonlySet<MigrationRecordKind> = new Set(["evidence_object"]);

function classifyEvidenceObject(item: EvidenceObjectSnapshot): MigrationBlockerReason[] | "skip" | null {
  if (item.storageProvider === "sharepoint" || item.alreadyHasExternalReference) return "skip";

  const reasons: MigrationBlockerReason[] = [];
  if (item.legalHold || item.underLegalHold) reasons.push("legal_hold");
  if (item.retentionTombstonedAt) reasons.push("tombstoned");
  if (!item.checksumSha256) reasons.push("missing_checksum");
  if (!item.hasBlob) reasons.push("missing_bytes");
  if (item.malwareScanStatus !== "CLEAN") reasons.push("malware_not_clean");
  return reasons.length > 0 ? reasons : null;
}

function classifyLcaEvidence(item: LcaEvidenceSnapshot): MigrationBlockerReason[] | "skip" | null {
  if (item.storageProvider === "sharepoint") return "skip";
  const reasons: MigrationBlockerReason[] = [];
  if (!item.checksumSha256) reasons.push("missing_checksum");
  if (item.byteSize === null) reasons.push("missing_bytes");
  return reasons.length > 0 ? reasons : null;
}

function classifyControlledDocumentRevision(item: ControlledDocumentRevisionSnapshot): MigrationBlockerReason[] | "skip" | null {
  if (item.alreadyHasExternalReference) return "skip";
  if (!item.evidenceObjectId) return "skip";

  const reasons: MigrationBlockerReason[] = [];
  if (item.underLegalHold) reasons.push("legal_hold");
  if (!item.checksumSha256) reasons.push("missing_checksum");
  return reasons.length > 0 ? reasons : null;
}

/**
 * Classifies one organisation's database-backed evidence for a SharePoint
 * dry-run migration. Never mutates its input and never assumes network or
 * database access — everything needed is passed in via `input`.
 */
export function planEvidenceMigration(input: EvidenceMigrationPlanInput): EvidenceMigrationReport {
  const warnings: string[] = [];
  const candidates: MigrationCandidate[] = [];
  const skipped: MigrationSkippedItem[] = [];
  const blocked: MigrationBlockedItem[] = [];

  const connectionStatus = input.storageConnection?.status ?? "not_configured";
  const siteBindingConfigured = Boolean(input.storageConnection?.activeSiteBindingId);
  const connectionReady = input.storageConnection?.status === "CONNECTED" && siteBindingConfigured;

  if (!connectionReady) {
    warnings.push(
      connectionStatus === "not_configured"
        ? "No SharePoint storage connection is configured for this organisation; every item is blocked."
        : `SharePoint storage connection status is "${connectionStatus}" (requires CONNECTED with an active site binding); every item is blocked.`,
    );
  }

  for (const item of input.items) {
    let classification: MigrationBlockerReason[] | "skip" | null;
    switch (item.kind) {
      case "evidence_object":
        classification = classifyEvidenceObject(item);
        break;
      case "lca_evidence":
        classification = classifyLcaEvidence(item);
        break;
      case "controlled_document_revision":
        classification = classifyControlledDocumentRevision(item);
        break;
    }

    if (classification === "skip") {
      skipped.push({ kind: item.kind, id: item.id, reason: "already_migrated" });
      continue;
    }

    const reasons = classification ? [...classification] : [];
    if (!connectionReady) {
      reasons.push(connectionStatus === "not_configured" ? "no_storage_connection" : "no_active_site_binding");
    }
    if (!APPLY_SUPPORTED_KINDS.has(item.kind) && reasons.length === 0) {
      // Reported as a candidate (informational — dry-run must still show
      // what *would* be mapped), but apply is refused for this kind until a
      // dedicated task implements it (SP04's issue-time pin flow for
      // controlled documents, or the LCA evidence registry).
    }

    if (reasons.length > 0) {
      blocked.push({ kind: item.kind, id: item.id, reasons });
      continue;
    }

    const applySupported = APPLY_SUPPORTED_KINDS.has(item.kind);
    if (!applySupported) {
      warnings.push(`${item.kind} ${item.id} is a migration candidate but apply is not implemented for this kind in SP07; dry-run only.`);
    }

    const byteSize = item.kind === "evidence_object" ? item.byteSize : item.kind === "lca_evidence" ? item.byteSize : item.sizeBytes;
    const mimeType = item.kind === "controlled_document_revision" ? item.mimeType : item.mimeType;
    const relationships: MigrationCandidate["relationships"] =
      item.kind === "evidence_object"
        ? { controlledDocumentRevisionId: item.controlledDocumentRevisionId ?? undefined, linkedResourceCount: item.linkedResourceCount }
        : item.kind === "lca_evidence"
          ? { assessmentId: item.assessmentId }
          : {};

    candidates.push({
      kind: item.kind,
      id: item.id,
      byteSize: byteSize ?? null,
      mimeType: mimeType ?? null,
      checksumSha256: item.checksumSha256 ?? null,
      hasChecksum: Boolean(item.checksumSha256),
      relationships,
      applySupported,
    });
  }

  const candidateBytesTotal = candidates.reduce((sum, c) => sum + (c.byteSize ?? 0), 0);
  const checksumAvailableCount = candidates.filter((c) => c.hasChecksum).length;

  return {
    organisationId: input.organisationId,
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    target: {
      provider: "sharepoint",
      connectionStatus,
      siteBindingConfigured,
    },
    summary: {
      totalItems: input.items.length,
      candidateCount: candidates.length,
      candidateApplySupportedCount: candidates.filter((c) => c.applySupported).length,
      skippedCount: skipped.length,
      blockedCount: blocked.length,
      candidateBytesTotal,
      checksumAvailableCount,
      checksumMissingCount: candidates.length - checksumAvailableCount,
    },
    candidates,
    skipped,
    blocked,
    warnings,
  };
}

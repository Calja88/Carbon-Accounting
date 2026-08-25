/** SP07 dry-run migration planning tests. All records are synthetic. */

import { describe, expect, it } from "vitest";
import { planEvidenceMigration, type EvidenceObjectSnapshot, type MigrationItemSnapshot } from "@/lib/documents/storage/migration/evidence-migration-plan";

const CONNECTED = { status: "CONNECTED" as const, activeSiteBindingId: "binding-1" };

function evidence(overrides: Partial<EvidenceObjectSnapshot> = {}): EvidenceObjectSnapshot {
  return {
    kind: "evidence_object",
    id: "evidence-1",
    storageProvider: null,
    hasBlob: true,
    byteSize: 1024,
    mimeType: "application/pdf",
    checksumSha256: "a".repeat(64),
    malwareScanStatus: "CLEAN",
    legalHold: false,
    underLegalHold: false,
    retentionTombstonedAt: null,
    retentionUntil: null,
    linkedResourceCount: 0,
    controlledDocumentRevisionId: null,
    alreadyHasExternalReference: false,
    ...overrides,
  };
}

describe("planEvidenceMigration", () => {
  it("reports a clean database-backed evidence object as a candidate with apply supported", () => {
    const report = planEvidenceMigration({ organisationId: "org-a", storageConnection: CONNECTED, items: [evidence()] });

    expect(report.mode).toBe("dry-run");
    expect(report.summary.candidateCount).toBe(1);
    expect(report.summary.candidateApplySupportedCount).toBe(1);
    expect(report.candidates[0]).toMatchObject({ kind: "evidence_object", id: "evidence-1", applySupported: true, hasChecksum: true });
    expect(report.blocked).toHaveLength(0);
    expect(report.skipped).toHaveLength(0);
  });

  it("never includes a filename, path, or URL anywhere in the report", () => {
    const report = planEvidenceMigration({ organisationId: "org-a", storageConnection: CONNECTED, items: [evidence()] });
    const serialised = JSON.stringify(report);
    expect(serialised).not.toMatch(/\.pdf|https?:\/\/|sharepoint\.com/i);
  });

  it("skips an item already migrated to sharepoint", () => {
    const report = planEvidenceMigration({
      organisationId: "org-a",
      storageConnection: CONNECTED,
      items: [evidence({ storageProvider: "sharepoint" })],
    });

    expect(report.skipped).toEqual([{ kind: "evidence_object", id: "evidence-1", reason: "already_migrated" }]);
    expect(report.candidates).toHaveLength(0);
  });

  it("skips an item that already has a pinned external file reference even if storageProvider lags", () => {
    const report = planEvidenceMigration({
      organisationId: "org-a",
      storageConnection: CONNECTED,
      items: [evidence({ alreadyHasExternalReference: true })],
    });

    expect(report.skipped[0].reason).toBe("already_migrated");
  });

  it("blocks an item under legal hold", () => {
    const report = planEvidenceMigration({
      organisationId: "org-a",
      storageConnection: CONNECTED,
      items: [evidence({ underLegalHold: true })],
    });

    expect(report.blocked).toEqual([{ kind: "evidence_object", id: "evidence-1", reasons: ["legal_hold"] }]);
  });

  it("blocks a tombstoned item", () => {
    const report = planEvidenceMigration({
      organisationId: "org-a",
      storageConnection: CONNECTED,
      items: [evidence({ retentionTombstonedAt: "2024-01-01T00:00:00.000Z" })],
    });

    expect(report.blocked[0].reasons).toContain("tombstoned");
  });

  it("blocks an item with no checksum and reports checksum-missing counts", () => {
    const report = planEvidenceMigration({
      organisationId: "org-a",
      storageConnection: CONNECTED,
      items: [evidence({ checksumSha256: null })],
    });

    expect(report.blocked[0].reasons).toContain("missing_checksum");
    expect(report.summary.candidateCount).toBe(0);
  });

  it("blocks an item whose malware scan is not clean", () => {
    const report = planEvidenceMigration({
      organisationId: "org-a",
      storageConnection: CONNECTED,
      items: [evidence({ malwareScanStatus: "PENDING" })],
    });

    expect(report.blocked[0].reasons).toContain("malware_not_clean");
  });

  it("blocks every item and warns when no storage connection is configured", () => {
    const report = planEvidenceMigration({ organisationId: "org-a", storageConnection: null, items: [evidence()] });

    expect(report.target.connectionStatus).toBe("not_configured");
    expect(report.blocked[0].reasons).toContain("no_storage_connection");
    expect(report.warnings.some((w) => w.includes("No SharePoint storage connection"))).toBe(true);
  });

  it("blocks every item when the connection has no active site binding", () => {
    const report = planEvidenceMigration({
      organisationId: "org-a",
      storageConnection: { status: "CONNECTED", activeSiteBindingId: null },
      items: [evidence()],
    });

    expect(report.blocked[0].reasons).toContain("no_active_site_binding");
  });

  it("reports a controlled-document revision candidate as apply-not-supported (dry-run only, per SP04 pin flow split)", () => {
    const items: MigrationItemSnapshot[] = [
      {
        kind: "controlled_document_revision",
        id: "rev-1",
        documentId: "doc-1",
        status: "EFFECTIVE",
        evidenceObjectId: "evidence-9",
        sizeBytes: 2048,
        mimeType: "application/pdf",
        checksumSha256: "b".repeat(64),
        underLegalHold: false,
        retentionUntil: null,
        alreadyHasExternalReference: false,
        isCurrentRevision: true,
      },
    ];
    const report = planEvidenceMigration({ organisationId: "org-a", storageConnection: CONNECTED, items });

    expect(report.candidates[0]).toMatchObject({ kind: "controlled_document_revision", id: "rev-1", applySupported: false });
    expect(report.summary.candidateApplySupportedCount).toBe(0);
    expect(report.warnings.some((w) => w.includes("apply is not implemented"))).toBe(true);
  });

  it("does not repoint an issued controlled-document revision's identity — reports it, never mutates it", () => {
    const items: MigrationItemSnapshot[] = [
      {
        kind: "controlled_document_revision",
        id: "rev-issued",
        documentId: "doc-1",
        status: "EFFECTIVE",
        evidenceObjectId: null,
        sizeBytes: 2048,
        mimeType: "application/pdf",
        checksumSha256: "c".repeat(64),
        underLegalHold: false,
        retentionUntil: null,
        alreadyHasExternalReference: true,
        isCurrentRevision: true,
      },
    ];
    const report = planEvidenceMigration({ organisationId: "org-a", storageConnection: CONNECTED, items });

    // Already pinned to SharePoint (SP04) -> skip, never a migration candidate.
    expect(report.skipped).toEqual([{ kind: "controlled_document_revision", id: "rev-issued", reason: "already_migrated" }]);
  });

  it("computes candidateBytesTotal only from actual candidates, not blocked or skipped items", () => {
    const report = planEvidenceMigration({
      organisationId: "org-a",
      storageConnection: CONNECTED,
      items: [evidence({ id: "e1", byteSize: 100 }), evidence({ id: "e2", byteSize: 200, underLegalHold: true })],
    });

    expect(report.summary.candidateBytesTotal).toBe(100);
  });
});

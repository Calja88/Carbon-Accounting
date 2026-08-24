/**
 * Unified evidence/download boundary tests (task SP05). No live database and
 * no live Microsoft Graph call — Prisma is an in-memory fake (matching the
 * SP01/SP03/SP04 test pattern) and `GraphClient` is a hand-written synthetic
 * fake injected directly into every call under test. Covers: the database
 * fallback path (unchanged behaviour), SharePoint-backed evidence-object
 * success/failure classification (missing reference, stale/unreachable
 * reference, Graph NOT_FOUND/PERMISSION_DENIED/CONFIGURATION mapping,
 * checksum mismatch), tombstoned/malware/legal-hold reporting, and the
 * controlled-document revision delegation (database-backed and
 * SharePoint-pinned, including the unpinned-draft case).
 */

import { createHash } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";
import { GraphClientError } from "@/lib/documents/storage/graph/types";
import type { GraphClient } from "@/lib/documents/storage/graph/types";

interface EvidenceRow {
  id: string;
  organisationId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  storageProvider: string | null;
  storageKey: string | null;
  classification: string;
  legalHold: boolean;
  retentionUntil: Date | null;
  retentionTombstonedAt: Date | null;
  malwareScanStatus: string;
}

interface RevisionRow {
  id: string;
  documentId: string;
  organisationId: string;
  evidenceObjectId: string | null;
  classification: string;
  retentionUntil: Date | null;
}

interface ReferenceRow {
  id: string;
  organisationId: string;
  siteBindingId: string;
  evidenceObjectId: string | null;
  controlledDocumentRevisionId: string | null;
  itemId: string;
  versionId: string;
  checksumSha256: string;
  byteSize: number | null;
  mimeType: string | null;
  pinnedAt: Date | null;
  referenceStatus: string;
  staleReason: string | null;
}

const { evidenceRows, revisionRows, referenceRows, blobs, legalHolds, resetTables, nextIdRef } = vi.hoisted(() => {
  const evidenceRows: EvidenceRow[] = [];
  const revisionRows: RevisionRow[] = [];
  const referenceRows: ReferenceRow[] = [];
  const blobs = new Map<string, Buffer>();
  const legalHolds: { organisationId: string; resourceType: string | null; resourceId: string | null; status: string }[] = [];
  const nextIdRef = { n: 1 };
  function resetTables() {
    evidenceRows.length = 0;
    revisionRows.length = 0;
    referenceRows.length = 0;
    blobs.clear();
    legalHolds.length = 0;
    nextIdRef.n = 1;
  }
  return { evidenceRows, revisionRows, referenceRows, blobs, legalHolds, resetTables, nextIdRef };
});

function nextId(prefix: string): string {
  return `${prefix}-${nextIdRef.n++}`;
}

function matches(row: object, where: Record<string, unknown>): boolean {
  const record = row as Record<string, unknown>;
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR" || key === "AND") return true; // legal-hold OR clause handled separately below
    return record[key] === value;
  });
}

vi.mock("@/lib/prisma", () => {
  const evidenceObject = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => evidenceRows.find((r) => matches(r, where)) ?? null),
  };
  const controlledDocumentRevision = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => revisionRows.find((r) => matches(r, where)) ?? null),
  };
  const externalFileReference = {
    findUnique: vi.fn(async ({ where }: { where: { evidenceObjectId?: string } }) =>
      referenceRows.find((r) => r.evidenceObjectId === where.evidenceObjectId) ?? null,
    ),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => referenceRows.find((r) => matches(r, where)) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ReferenceRow> }) => {
      const row = referenceRows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };
  const evidenceObjectBlob = {
    findUnique: vi.fn(async ({ where }: { where: { evidenceObjectId: string } }) => {
      const data = blobs.get(where.evidenceObjectId);
      return data ? { data } : null;
    }),
  };
  const legalHold = {
    findFirst: vi.fn(async ({ where }: { where: { organisationId: string; status: string; OR: { resourceType: string | null; resourceId: string | null }[] } }) => {
      const hit = legalHolds.find(
        (h) =>
          h.organisationId === where.organisationId &&
          h.status === where.status &&
          where.OR.some((clause) => h.resourceType === clause.resourceType && h.resourceId === clause.resourceId),
      );
      return hit ? { id: "hold-1" } : null;
    }),
  };

  const prisma = {
    evidenceObject,
    controlledDocumentRevision,
    externalFileReference,
    evidenceObjectBlob,
    legalHold,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma };
});

vi.mock("@/lib/repositories/audit-repository", () => ({
  recordAuditEvent: vi.fn(async () => ({ id: "audit-1" })),
}));

vi.mock("@/lib/documents/storage/graph/config", () => ({
  resolveGraphSiteTargetForEvidenceProvider: vi.fn(async (organisationId: string, siteBindingId: string) => ({
    target: { organisationId, entraTenantId: "tenant-1", siteId: "site-1", driveId: "drive-1" },
    siteBindingId,
    rootFolderPath: null,
  })),
}));

const { resolveEvidenceObjectDownload, resolveControlledDocumentRevisionDownload } = await import("@/lib/documents/download-boundary");

const orgContextA = makeOrganisationContext(ORG_A, {
  permissions: new Set(["ems.controlled_document.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});
const orgContextB = makeOrganisationContext(ORG_B, { permissions: new Set() as unknown as ReturnType<typeof makeOrganisationContext>["permissions"] });

function seedDatabaseEvidence(overrides: Partial<EvidenceRow> = {}): EvidenceRow {
  const id = nextId("evidence");
  const row: EvidenceRow = {
    id,
    organisationId: ORG_A,
    filename: "policy.pdf",
    mimeType: "application/pdf",
    byteSize: 9,
    checksumSha256: "checksum-1",
    storageProvider: "database",
    storageKey: id,
    classification: "INTERNAL",
    legalHold: false,
    retentionUntil: null,
    retentionTombstonedAt: null,
    malwareScanStatus: "CLEAN",
    ...overrides,
  };
  evidenceRows.push(row);
  blobs.set(id, Buffer.from("synthetic"));
  return row;
}

const PINNED_SHAREPOINT_BYTES = Buffer.from("pinned sharepoint bytes");
const PINNED_SHAREPOINT_CHECKSUM = createHash("sha256").update(PINNED_SHAREPOINT_BYTES).digest("hex");

function seedSharePointEvidence(overrides: Partial<EvidenceRow> = {}, referenceOverrides: Partial<ReferenceRow> = {}): { evidence: EvidenceRow; reference: ReferenceRow } {
  const id = nextId("evidence");
  const evidence: EvidenceRow = {
    id,
    organisationId: ORG_A,
    filename: "sp-policy.pdf",
    mimeType: "application/pdf",
    byteSize: 12,
    checksumSha256: PINNED_SHAREPOINT_CHECKSUM,
    storageProvider: "sharepoint",
    storageKey: id,
    classification: "INTERNAL",
    legalHold: false,
    retentionUntil: null,
    retentionTombstonedAt: null,
    malwareScanStatus: "CLEAN",
    ...overrides,
  };
  evidenceRows.push(evidence);

  const reference: ReferenceRow = {
    id: nextId("reference"),
    organisationId: ORG_A,
    siteBindingId: "binding-1",
    evidenceObjectId: id,
    controlledDocumentRevisionId: null,
    itemId: "item-1",
    versionId: "2.0",
    checksumSha256: PINNED_SHAREPOINT_CHECKSUM,
    byteSize: 12,
    mimeType: "application/pdf",
    pinnedAt: new Date(),
    referenceStatus: "ACTIVE",
    staleReason: null,
    ...referenceOverrides,
  };
  referenceRows.push(reference);

  return { evidence, reference };
}

function fakeGraphClient(overrides: Partial<GraphClient> = {}): GraphClient {
  return {
    getDrive: vi.fn(),
    getItem: vi.fn(),
    listVersions: vi.fn(),
    getDownloadMetadata: vi.fn(),
    createUploadSession: vi.fn(),
    uploadContent: vi.fn(),
    downloadContent: vi.fn(async () => Buffer.from("pinned sharepoint bytes")),
    deleteItem: vi.fn(),
    checkHealth: vi.fn(),
    ...overrides,
  } as unknown as GraphClient;
}

beforeEach(() => {
  resetTables();
  vi.clearAllMocks();
});

describe("resolveEvidenceObjectDownload — database provider (fallback/local mode)", () => {
  it("returns bytes and consistent metadata", async () => {
    const evidence = seedDatabaseEvidence();
    const result = await resolveEvidenceObjectDownload(orgContextA, evidence.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bytes.toString()).toBe("synthetic");
    expect(result.metadata).toMatchObject({
      provider: "database",
      filename: "policy.pdf",
      mimeType: "application/pdf",
      checksumSha256: "checksum-1",
      referenceStatus: "ACTIVE",
      legalHold: false,
    });
  });

  it("denies a foreign-tenant caller identically to a missing id", async () => {
    const evidence = seedDatabaseEvidence();
    const foreign = await resolveEvidenceObjectDownload(orgContextB, evidence.id);
    const missing = await resolveEvidenceObjectDownload(orgContextB, "does-not-exist");
    expect(foreign).toEqual({ ok: false, reason: "not_found", metadata: null, detail: null });
    expect(missing).toEqual({ ok: false, reason: "not_found", metadata: null, detail: null });
  });

  it("reports a tombstoned (retention-executed) evidence object distinctly", async () => {
    const evidence = seedDatabaseEvidence({ retentionTombstonedAt: new Date(), storageKey: null });
    const result = await resolveEvidenceObjectDownload(orgContextA, evidence.id);
    expect(result).toMatchObject({ ok: false, reason: "tombstoned" });
  });

  it("reports a malware-infected file distinctly", async () => {
    const evidence = seedDatabaseEvidence({ malwareScanStatus: "INFECTED" });
    const result = await resolveEvidenceObjectDownload(orgContextA, evidence.id);
    expect(result).toMatchObject({ ok: false, reason: "malware_infected" });
  });

  it("surfaces legal-hold and retention state in metadata without blocking a read", async () => {
    const retentionUntil = new Date("2030-01-01T00:00:00Z");
    const evidence = seedDatabaseEvidence({ legalHold: true, retentionUntil });
    const result = await resolveEvidenceObjectDownload(orgContextA, evidence.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.metadata.legalHold).toBe(true);
    expect(result.metadata.retentionUntil).toBe(retentionUntil.toISOString());
  });
});

describe("resolveEvidenceObjectDownload — SharePoint provider (Graph-mocked)", () => {
  it("returns bytes after verifying the checksum of the pinned version", async () => {
    const { evidence } = seedSharePointEvidence();
    const client = fakeGraphClient();
    const result = await resolveEvidenceObjectDownload(orgContextA, evidence.id, client);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bytes.toString()).toBe("pinned sharepoint bytes");
    expect(result.metadata.provider).toBe("sharepoint");
    expect(result.metadata.referenceStatus).toBe("ACTIVE");
  });

  it("reports missing_upstream when no ExternalFileReference exists for the evidence object", async () => {
    const evidence = seedDatabaseEvidence({ storageProvider: "sharepoint", storageKey: "orphan-key" });
    const result = await resolveEvidenceObjectDownload(orgContextA, evidence.id, fakeGraphClient());
    expect(result).toMatchObject({ ok: false, reason: "missing_upstream" });
  });

  it("reports unreachable for a STALE/UNREACHABLE reference without calling Graph", async () => {
    const { evidence } = seedSharePointEvidence({}, { referenceStatus: "UNREACHABLE", staleReason: "Evidence bytes deleted by Paragon-side retention execution." });
    const client = fakeGraphClient();
    const result = await resolveEvidenceObjectDownload(orgContextA, evidence.id, client);
    expect(result).toMatchObject({ ok: false, reason: "unreachable", detail: "Evidence bytes deleted by Paragon-side retention execution." });
    expect(client.downloadContent).not.toHaveBeenCalled();
  });

  it("maps a Graph NOT_FOUND failure to missing_upstream", async () => {
    const { evidence } = seedSharePointEvidence();
    const client = fakeGraphClient({
      downloadContent: vi.fn(async () => {
        throw new GraphClientError("item gone", "NOT_FOUND", 404, false, "cid-1");
      }),
    });
    const result = await resolveEvidenceObjectDownload(orgContextA, evidence.id, client);
    expect(result).toMatchObject({ ok: false, reason: "missing_upstream" });
  });

  it("maps a Graph PERMISSION_DENIED failure to revoked_access", async () => {
    const { evidence } = seedSharePointEvidence();
    const client = fakeGraphClient({
      downloadContent: vi.fn(async () => {
        throw new GraphClientError("access denied", "PERMISSION_DENIED", 403, false, "cid-2");
      }),
    });
    const result = await resolveEvidenceObjectDownload(orgContextA, evidence.id, client);
    expect(result).toMatchObject({ ok: false, reason: "revoked_access" });
  });

  it("maps a Graph CONFIGURATION failure to tenant_mismatch", async () => {
    const { evidence } = seedSharePointEvidence();
    const client = fakeGraphClient({
      downloadContent: vi.fn(async () => {
        throw new GraphClientError("connection not connected", "CONFIGURATION", null, false, "cid-3");
      }),
    });
    const result = await resolveEvidenceObjectDownload(orgContextA, evidence.id, client);
    expect(result).toMatchObject({ ok: false, reason: "tenant_mismatch" });
  });

  it("blocks and flags a checksum mismatch rather than silently serving changed bytes", async () => {
    const { evidence, reference } = seedSharePointEvidence();
    const client = fakeGraphClient({ downloadContent: vi.fn(async () => Buffer.from("tampered bytes")) });
    const result = await resolveEvidenceObjectDownload(orgContextA, evidence.id, client);
    expect(result).toMatchObject({ ok: false, reason: "checksum_mismatch" });
    const updated = referenceRows.find((r) => r.id === reference.id);
    expect(updated?.referenceStatus).toBe("UNREACHABLE");
  });
});

describe("resolveControlledDocumentRevisionDownload", () => {
  function seedRevision(overrides: Partial<RevisionRow> = {}): RevisionRow {
    const row: RevisionRow = {
      id: nextId("revision"),
      documentId: "document-1",
      organisationId: ORG_A,
      evidenceObjectId: null,
      classification: "INTERNAL",
      retentionUntil: null,
      ...overrides,
    };
    revisionRows.push(row);
    return row;
  }

  it("denies a foreign-tenant caller identically to a missing revision", async () => {
    const revision = seedRevision();
    const result = await resolveControlledDocumentRevisionDownload(orgContextB, revision.id);
    expect(result).toEqual({ ok: false, reason: "not_found", metadata: null, detail: null });
  });

  it("delegates to the database-backed evidence object exactly as T22 always has", async () => {
    const evidence = seedDatabaseEvidence();
    const revision = seedRevision({ evidenceObjectId: evidence.id });
    const result = await resolveControlledDocumentRevisionDownload(orgContextA, revision.id, revision.documentId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bytes.toString()).toBe("synthetic");
    expect(result.metadata.provider).toBe("database");
  });

  it("reports unpinned for a draft SharePoint reference that has not been issued yet", async () => {
    const revision = seedRevision();
    referenceRows.push({
      id: nextId("reference"),
      organisationId: ORG_A,
      siteBindingId: "binding-1",
      evidenceObjectId: null,
      controlledDocumentRevisionId: revision.id,
      itemId: "item-2",
      versionId: "1.0",
      checksumSha256: "b".repeat(64),
      byteSize: 10,
      mimeType: "application/pdf",
      pinnedAt: null,
      referenceStatus: "ACTIVE",
      staleReason: null,
    });
    const result = await resolveControlledDocumentRevisionDownload(orgContextA, revision.id, revision.documentId, fakeGraphClient());
    expect(result).toMatchObject({ ok: false, reason: "unpinned" });
  });

  it("returns bytes for an issued (pinned) SharePoint reference and reports legal-hold state", async () => {
    const revision = seedRevision();
    const issuedContent = Buffer.from("issued content");
    const checksum = createHash("sha256").update(issuedContent).digest("hex");
    referenceRows.push({
      id: nextId("reference"),
      organisationId: ORG_A,
      siteBindingId: "binding-1",
      evidenceObjectId: null,
      controlledDocumentRevisionId: revision.id,
      itemId: "item-3",
      versionId: "2.0",
      checksumSha256: checksum,
      byteSize: issuedContent.byteLength,
      mimeType: "application/pdf",
      pinnedAt: new Date(),
      referenceStatus: "ACTIVE",
      staleReason: null,
    });
    legalHolds.push({ organisationId: ORG_A, resourceType: "controlled_document_revision", resourceId: revision.id, status: "ACTIVE" });
    const client = fakeGraphClient({ downloadContent: vi.fn(async () => issuedContent) });
    const result = await resolveControlledDocumentRevisionDownload(orgContextA, revision.id, revision.documentId, client);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bytes.toString()).toBe("issued content");
    expect(result.metadata.legalHold).toBe(true);
  });

  it("reports unreachable for a stale pinned reference without calling Graph", async () => {
    const revision = seedRevision();
    referenceRows.push({
      id: nextId("reference"),
      organisationId: ORG_A,
      siteBindingId: "binding-1",
      evidenceObjectId: null,
      controlledDocumentRevisionId: revision.id,
      itemId: "item-4",
      versionId: "3.0",
      checksumSha256: "d".repeat(64),
      byteSize: 5,
      mimeType: "application/pdf",
      pinnedAt: new Date(),
      referenceStatus: "STALE",
      staleReason: "Move outside the granted site/library scope.",
    });
    const client = fakeGraphClient();
    const result = await resolveControlledDocumentRevisionDownload(orgContextA, revision.id, revision.documentId, client);
    expect(result).toMatchObject({ ok: false, reason: "unreachable", detail: "Move outside the granted site/library scope." });
    expect(client.downloadContent).not.toHaveBeenCalled();
  });
});

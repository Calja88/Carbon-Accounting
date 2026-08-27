/**
 * Safe removal controls for controlled documents and shared evidence
 * (safe-deletion pass) — built against the real SP00-SP08 SharePoint
 * lineage now merged into this branch. `discardDraftRevision` never
 * deletes an issued/effective revision (the immutability trigger and the
 * status check both refuse). `unlinkEvidence` only removes the app-side
 * `EvidenceLink`. `discardUnlinkedEvidenceObject` only tombstones bytes
 * (via the same provider `remove()` the retention flow uses, which never
 * deletes real SharePoint content) for an upload nothing references yet —
 * the metadata/checksum row is always kept. Synthetic fixtures only; no
 * live database, no real environmental data, no live SharePoint access.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const tables = vi.hoisted(() => ({
  documents: [] as Row[],
  revisions: [] as Row[],
  evidenceObjects: [] as Row[],
  evidenceLinks: [] as Row[],
  evidenceBlobs: [] as Row[],
  legalHolds: [] as Row[],
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "OR" in value === false && "not" in value) return row[key] !== value.not;
    if (key === "OR" && Array.isArray(value)) return value.some((clause: Row) => matches(row, clause));
    return row[key] === value;
  });
}

function table(rows: Row[]) {
  return {
    findFirst: vi.fn(async ({ where }: { where: Row }) => rows.find((row) => matches(row, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Row }) => rows.filter((row) => matches(row, where))),
    count: vi.fn(async ({ where }: { where: Row }) => rows.filter((row) => matches(row, where)).length),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const id = where.organisationId_id ? where.organisationId_id.id : where.id;
      const row = rows.find((item) => item.id === id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
    delete: vi.fn(async ({ where }: { where: Row }) => {
      const index = rows.findIndex((item) => item.id === where.id);
      if (index < 0) throw new Error("not found");
      return rows.splice(index, 1)[0];
    }),
    deleteMany: vi.fn(async ({ where }: { where: Row }) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (matches(rows[i], where)) { rows.splice(i, 1); count += 1; }
      }
      return { count };
    }),
  };
}

vi.mock("@/lib/prisma", () => {
  const client: Row = {
    controlledDocument: table(tables.documents),
    controlledDocumentRevision: table(tables.revisions),
    evidenceObject: table(tables.evidenceObjects),
    evidenceLink: table(tables.evidenceLinks),
    evidenceObjectBlob: table(tables.evidenceBlobs),
    legalHold: table(tables.legalHolds),
  };
  client.$transaction = vi.fn(async (callback: (tx: Row) => Promise<unknown>) => callback(client));
  return { prisma: client };
});

vi.mock("@/lib/repositories/audit-repository", () => ({
  recordAuditEvent: vi.fn(async () => ({ id: "synthetic-audit" })),
}));
vi.mock("@/lib/jobs/outbox-service", () => ({ enqueueTenantJob: vi.fn(async () => undefined) }));

const removeMock = vi.fn(async () => undefined);
vi.mock("@/lib/documents/storage/provider", () => ({
  documentEvidenceStorage: {
    active: () => ({ name: "database", put: vi.fn(), get: vi.fn(), remove: removeMock }),
    forKey: () => ({ name: "database", put: vi.fn(), get: vi.fn(), remove: removeMock }),
  },
}));
vi.mock("@/lib/documents/malware-scan", () => ({ scanEvidence: vi.fn() }));

const documentService = await import("@/lib/documents/document-control-service");
const evidenceService = await import("@/lib/documents/evidence-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const ALL = new Set(["ems.view", "ems.controlled_document.manage", "ems.controlled_document.approve", "ems.evidence.manage"]) as never;
const contextA = makeOrganisationContext(ORG_A, { userId: "user-a", membershipId: "membership-a", permissions: ALL });
const contextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: ALL });
const viewerA = makeOrganisationContext(ORG_A, {
  userId: "user-a", membershipId: "membership-a", permissions: new Set(["ems.view"]) as never,
});

beforeEach(() => {
  Object.values(tables).forEach((rows) => { rows.length = 0; });
  vi.clearAllMocks();
  tables.documents.push({ id: "doc-a", organisationId: ORG_A, reference: "POL-ENV-001", currentRevisionId: null });
  tables.revisions.push({
    id: "rev-a-1", organisationId: ORG_A, documentId: "doc-a", revisionNumber: 1, status: "DRAFT", evidenceObjectId: null,
  });
});

describe("discardDraftRevision", () => {
  it("discards a lone DRAFT revision and its empty parent document", async () => {
    const result = await documentService.discardDraftRevision(contextA, "rev-a-1", "user-a");
    expect(result.documentAlsoDeleted).toBe(true);
    expect(tables.revisions).toHaveLength(0);
    expect(tables.documents).toHaveLength(0);
  });

  it("discards only the draft successor, keeping the document and its other revisions", async () => {
    tables.revisions.length = 0;
    tables.documents[0].currentRevisionId = "rev-a-effective";
    tables.revisions.push({ id: "rev-a-effective", organisationId: ORG_A, documentId: "doc-a", revisionNumber: 1, status: "EFFECTIVE" });
    tables.revisions.push({ id: "rev-a-2", organisationId: ORG_A, documentId: "doc-a", revisionNumber: 2, status: "DRAFT" });

    const result = await documentService.discardDraftRevision(contextA, "rev-a-2", "user-a");
    expect(result.documentAlsoDeleted).toBe(false);
    expect(tables.documents).toHaveLength(1);
    expect(tables.revisions.map((r) => r.id)).toEqual(["rev-a-effective"]);
  });

  it("refuses to discard a revision that has left DRAFT", async () => {
    tables.revisions[0].status = "IN_REVIEW";
    await expect(documentService.discardDraftRevision(contextA, "rev-a-1", "user-a")).rejects.toThrow(
      documentService.DocumentControlError,
    );
    expect(tables.revisions).toHaveLength(1);
  });

  it("refuses to discard an EFFECTIVE/issued revision", async () => {
    tables.revisions[0].status = "EFFECTIVE";
    tables.documents[0].currentRevisionId = "rev-a-1";
    await expect(documentService.discardDraftRevision(contextA, "rev-a-1", "user-a")).rejects.toThrow(
      documentService.DocumentControlError,
    );
    expect(tables.revisions).toHaveLength(1);
  });

  it("refuses a foreign-tenant revision id", async () => {
    await expect(documentService.discardDraftRevision(contextB, "rev-a-1", "user-b")).rejects.toThrow(TenantOwnershipError);
  });

  it("refuses a viewer without ems.controlled_document.manage", async () => {
    await expect(documentService.discardDraftRevision(viewerA, "rev-a-1", "user-a")).rejects.toThrow(PermissionDeniedError);
  });
});

describe("unlinkEvidence", () => {
  beforeEach(() => {
    tables.evidenceObjects.push({ id: "evidence-a", organisationId: ORG_A, filename: "site-photo.pdf" });
    tables.evidenceLinks.push({ id: "link-a", organisationId: ORG_A, evidenceId: "evidence-a", resourceType: "context_issue", resourceId: "issue-a" });
  });

  it("removes the link without touching the evidence object", async () => {
    const result = await evidenceService.unlinkEvidence(contextA, "link-a", "user-a");
    expect(result.id).toBe("link-a");
    expect(tables.evidenceLinks).toHaveLength(0);
    expect(tables.evidenceObjects).toHaveLength(1);
  });

  it("refuses a foreign-tenant link id", async () => {
    await expect(evidenceService.unlinkEvidence(contextB, "link-a", "user-b")).rejects.toThrow(TenantOwnershipError);
  });

  it("refuses a viewer without ems.evidence.manage", async () => {
    await expect(evidenceService.unlinkEvidence(viewerA, "link-a", "user-a")).rejects.toThrow(PermissionDeniedError);
  });
});

describe("discardUnlinkedEvidenceObject", () => {
  beforeEach(() => {
    tables.evidenceObjects.push({
      id: "evidence-a", organisationId: ORG_A, filename: "draft-upload.pdf", storageKey: "key-1", storageProvider: "database",
      legalHold: false, retentionTombstonedAt: null,
    });
  });

  it("tombstones an unlinked upload's bytes, keeping the metadata row", async () => {
    const result = await evidenceService.discardUnlinkedEvidenceObject(contextA, "evidence-a", "user-a");
    expect(result.retentionTombstonedAt).not.toBeNull();
    expect(removeMock).toHaveBeenCalledWith("key-1");
    expect(tables.evidenceObjects).toHaveLength(1);
    expect(tables.evidenceObjects[0].storageKey).toBeNull();
  });

  it("blocks discard once the evidence has a link", async () => {
    tables.evidenceLinks.push({ id: "link-a", organisationId: ORG_A, evidenceId: "evidence-a", resourceType: "context_issue", resourceId: "issue-a" });
    await expect(evidenceService.discardUnlinkedEvidenceObject(contextA, "evidence-a", "user-a")).rejects.toThrow(
      evidenceService.EvidenceLifecycleError,
    );
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("blocks discard once the evidence is a controlled-document revision's content", async () => {
    tables.revisions.push({ id: "rev-x", organisationId: ORG_A, documentId: "doc-a", revisionNumber: 1, status: "DRAFT", evidenceObjectId: "evidence-a" });
    await expect(evidenceService.discardUnlinkedEvidenceObject(contextA, "evidence-a", "user-a")).rejects.toThrow(
      evidenceService.EvidenceLifecycleError,
    );
  });

  it("blocks discard under legal hold", async () => {
    tables.evidenceObjects[0].legalHold = true;
    await expect(evidenceService.discardUnlinkedEvidenceObject(contextA, "evidence-a", "user-a")).rejects.toThrow(
      evidenceService.EvidenceLifecycleError,
    );
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("blocks discard under an organisation-wide legal hold row", async () => {
    tables.legalHolds.push({ id: "hold-1", organisationId: ORG_A, status: "ACTIVE", resourceType: null, resourceId: null });
    await expect(evidenceService.discardUnlinkedEvidenceObject(contextA, "evidence-a", "user-a")).rejects.toThrow(
      evidenceService.EvidenceLifecycleError,
    );
  });

  it("blocks discard of an already-tombstoned object", async () => {
    tables.evidenceObjects[0].retentionTombstonedAt = new Date();
    await expect(evidenceService.discardUnlinkedEvidenceObject(contextA, "evidence-a", "user-a")).rejects.toThrow(
      evidenceService.EvidenceLifecycleError,
    );
  });

  it("refuses a foreign-tenant evidence id", async () => {
    await expect(evidenceService.discardUnlinkedEvidenceObject(contextB, "evidence-a", "user-b")).rejects.toThrow(TenantOwnershipError);
  });

  it("refuses a viewer without ems.evidence.manage", async () => {
    await expect(evidenceService.discardUnlinkedEvidenceObject(viewerA, "evidence-a", "user-a")).rejects.toThrow(PermissionDeniedError);
  });
});

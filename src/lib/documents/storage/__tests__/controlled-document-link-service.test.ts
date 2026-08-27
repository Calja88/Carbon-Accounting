/**
 * Controlled-document SharePoint revision integration tests (task SP04). No
 * live database and no live Microsoft Graph call — Prisma is an in-memory
 * fake (matching the SP01/SP03 test pattern) and `GraphClient` is a
 * hand-written synthetic fake injected directly into every call under test.
 * Covers: exact-version pinning at approval (never "latest"), a checksum
 * mismatch on read is a blocking evidence-integrity failure rather than a
 * silently served stale file, cross-tenant denial of a site binding/
 * reference, non-SharePoint revisions approve/download exactly as T22 always
 * has, a missing/pruned pinned version blocks rather than silently
 * succeeding, and drift visibility never mutates a pinned reference.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";
import type { GraphClient, GraphItemMetadata, GraphVersionMetadata, GraphDownloadMetadata } from "@/lib/documents/storage/graph/types";

interface DocumentRow {
  id: string;
  organisationId: string;
  reference: string;
  title: string;
  category: string;
  classification: string;
  currentRevisionId: string | null;
}

interface RevisionRow {
  id: string;
  documentId: string;
  organisationId: string;
  revisionNumber: number;
  status: string;
  evidenceObjectId: string | null;
  checksumSha256: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  classification: string;
  preparedByUserId: string | null;
  reviewedByUserId: string | null;
  approvedByUserId: string | null;
  reviewedAt: Date | null;
  approvedAt: Date | null;
  supersedesRevisionId: string | null;
}

interface ConnectionRow {
  id: string;
  organisationId: string;
  status: string;
  entraTenantId: string | null;
}

interface SiteBindingRow {
  id: string;
  connectionId: string;
  organisationId: string;
  siteId: string;
  driveId: string;
  status: string;
  rootFolderPath: string | null;
}

interface ReferenceRow {
  id: string;
  organisationId: string;
  siteBindingId: string;
  evidenceObjectId: string | null;
  controlledDocumentRevisionId: string | null;
  itemId: string;
  versionId: string;
  eTag: string | null;
  webUrl: string | null;
  checksumSha256: string;
  byteSize: number | null;
  mimeType: string | null;
  pinnedAt: Date | null;
  referenceStatus: string;
  staleReason: string | null;
  lastObservedAt: Date | null;
}

const { documents, revisions, connections, siteBindings, references, resetTables, nextIdRef } = vi.hoisted(() => {
  const documents: DocumentRow[] = [];
  const revisions: RevisionRow[] = [];
  const connections: ConnectionRow[] = [];
  const siteBindings: SiteBindingRow[] = [];
  const references: ReferenceRow[] = [];
  const nextIdRef = { n: 1 };
  function resetTables() {
    documents.length = 0;
    revisions.length = 0;
    connections.length = 0;
    siteBindings.length = 0;
    references.length = 0;
    nextIdRef.n = 1;
  }
  return { documents, revisions, connections, siteBindings, references, resetTables, nextIdRef };
});

function nextId(prefix: string): string {
  return `${prefix}-${nextIdRef.n++}`;
}

function matches(row: object, where: Record<string, unknown>): boolean {
  const record = row as Record<string, unknown>;
  return Object.entries(where).every(([key, value]) => record[key] === value);
}

vi.mock("@/lib/prisma", () => {
  const controlledDocument = {
    create: vi.fn(async ({ data }: { data: Partial<DocumentRow> }) => {
      const row = { id: nextId("document"), currentRevisionId: null, ...data } as DocumentRow;
      documents.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<DocumentRow> }) => {
      const row = documents.find((d) => d.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const controlledDocumentRevision = {
    create: vi.fn(async ({ data }: { data: Partial<RevisionRow> }) => {
      const row = {
        id: nextId("revision"),
        evidenceObjectId: null,
        checksumSha256: null,
        mimeType: null,
        sizeBytes: null,
        preparedByUserId: null,
        reviewedByUserId: null,
        approvedByUserId: null,
        reviewedAt: null,
        approvedAt: null,
        supersedesRevisionId: null,
        ...data,
      } as RevisionRow;
      revisions.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<RevisionRow> }) => {
      const row = revisions.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      // Mirrors the real `controlled_document_revision_immutable` trigger:
      // once OLD.status has left DRAFT/IN_REVIEW, content fields are frozen.
      if (row.status !== "DRAFT" && row.status !== "IN_REVIEW") {
        const contentFields: (keyof RevisionRow)[] = ["evidenceObjectId", "checksumSha256", "mimeType", "sizeBytes"];
        for (const field of contentFields) {
          if (field in data && data[field] !== row[field]) {
            throw new Error(`ControlledDocumentRevision content is immutable once ${row.status}`);
          }
        }
      }
      Object.assign(row, data);
      return row;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return revisions.find((r) => matches(r, where)) ?? null;
    }),
  };

  const organisationStorageConnection = {
    findUnique: vi.fn(async ({ where }: { where: { organisationId?: string } }) => connections.find((c) => c.organisationId === where.organisationId) ?? null),
  };

  const storageSiteBinding = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => siteBindings.find((b) => matches(b, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => siteBindings.filter((b) => matches(b, where))),
  };

  const externalFileReference = {
    create: vi.fn(async ({ data }: { data: Partial<ReferenceRow> }) => {
      const row = {
        id: nextId("reference"),
        evidenceObjectId: null,
        controlledDocumentRevisionId: null,
        eTag: null,
        webUrl: null,
        byteSize: null,
        mimeType: null,
        pinnedAt: null,
        referenceStatus: "ACTIVE",
        staleReason: null,
        lastObservedAt: null,
        ...data,
      } as ReferenceRow;
      references.push(row);
      return row;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => references.find((r) => matches(r, where)) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ReferenceRow> }) => {
      const row = references.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const evidenceObject = {
    findFirst: vi.fn(async () => null),
  };

  const prisma = {
    controlledDocument,
    controlledDocumentRevision,
    organisationStorageConnection,
    storageSiteBinding,
    externalFileReference,
    evidenceObject,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };

  return { prisma };
});

vi.mock("@/lib/repositories/audit-repository", () => ({
  recordAuditEvent: vi.fn(async () => ({ id: "audit-1" })),
}));

vi.mock("@/lib/jobs/outbox-service", () => ({
  enqueueTenantJob: vi.fn(async () => ({ id: "job-1" })),
}));

const {
  createControlledDocument,
  submitRevisionForReview,
  recordRevisionReview,
  approveRevision,
} = await import("@/lib/documents/document-control-service");

const { linkSharePointFileToRevision, readControlledDocumentRevisionBytes, checkForSharePointDrift, SharePointLinkError } = await import(
  "@/lib/documents/storage/controlled-document-link-service"
);
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");

const docContext = (organisationId: string) =>
  makeOrganisationContext(organisationId, {
    permissions: new Set([
      "ems.controlled_document.manage",
      "ems.controlled_document.approve",
    ]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
  });

function seedConnectedSiteBinding(organisationId: string): SiteBindingRow {
  const connection: ConnectionRow = { id: nextId("connection"), organisationId, status: "CONNECTED", entraTenantId: "tenant-1" };
  connections.push(connection);
  const binding: SiteBindingRow = {
    id: nextId("binding"),
    connectionId: connection.id,
    organisationId,
    siteId: "site-1",
    driveId: "drive-1",
    status: "CONNECTED",
    rootFolderPath: "Controlled Documents",
  };
  siteBindings.push(binding);
  return binding;
}

function fakeGraphClient(overrides: Partial<GraphClient> = {}): GraphClient {
  const item: GraphItemMetadata = {
    itemId: "item-1",
    name: "policy.docx",
    eTag: "etag-1",
    cTag: "ctag-1",
    webUrl: "https://contoso.sharepoint.com/policy.docx",
    lastModifiedDateTime: new Date().toISOString(),
    sha256: "a".repeat(64),
    size: 1024,
  };
  const versions: GraphVersionMetadata[] = [{ versionId: "2.0", lastModifiedDateTime: new Date().toISOString() }];
  const downloadMetadata: GraphDownloadMetadata = { itemId: "item-1", versionId: "2.0", sizeBytes: 1024, mimeType: null, sha256: "a".repeat(64) };

  return {
    getDrive: vi.fn(),
    getItem: vi.fn(async () => item),
    listVersions: vi.fn(async () => versions),
    getDownloadMetadata: vi.fn(async () => downloadMetadata),
    createUploadSession: vi.fn(),
    uploadContent: vi.fn(),
    downloadContent: vi.fn(async () => Buffer.from("pinned bytes")),
    deleteItem: vi.fn(),
    checkHealth: vi.fn(),
    ...overrides,
  } as unknown as GraphClient;
}

async function createDraftRevision(organisationId: string, reference = "POL-SP-001") {
  const { document, revision } = await createControlledDocument(docContext(organisationId), {
    reference,
    title: "SharePoint policy",
    category: "policy",
    actorUserId: "user-author",
  });
  return { document, revision };
}

beforeEach(() => {
  resetTables();
  vi.clearAllMocks();
});

describe("linkSharePointFileToRevision (draft authoring)", () => {
  it("creates an unpinned reference pointing at the current SharePoint version", async () => {
    const binding = seedConnectedSiteBinding(ORG_A);
    const { revision } = await createDraftRevision(ORG_A);
    const graphClient = fakeGraphClient();

    const reference = await linkSharePointFileToRevision(docContext(ORG_A), {
      revisionId: revision.id,
      siteBindingId: binding.id,
      itemId: "item-1",
      actorUserId: "user-author",
      graphClient,
    });

    expect(reference.pinnedAt).toBeNull();
    expect(reference.versionId).toBe("2.0");
    expect(reference.checksumSha256).toBe("a".repeat(64));
  });

  it("denies linking a site binding belonging to another organisation", async () => {
    const bindingB = seedConnectedSiteBinding(ORG_B);
    const { revision } = await createDraftRevision(ORG_A);

    await expect(
      linkSharePointFileToRevision(docContext(ORG_A), {
        revisionId: revision.id,
        siteBindingId: bindingB.id,
        itemId: "item-1",
        actorUserId: "user-author",
        graphClient: fakeGraphClient(),
      }),
    ).rejects.toThrow(TenantOwnershipError);
  });

  it("denies linking a revision belonging to another organisation", async () => {
    const bindingA = seedConnectedSiteBinding(ORG_A);
    const { revision: revisionB } = await createDraftRevision(ORG_B);

    await expect(
      linkSharePointFileToRevision(docContext(ORG_A), {
        revisionId: revisionB.id,
        siteBindingId: bindingA.id,
        itemId: "item-1",
        actorUserId: "user-author",
        graphClient: fakeGraphClient(),
      }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

describe("version pinning at approval", () => {
  it("pins the exact version/checksum current at approval, never a later 'latest'", async () => {
    const binding = seedConnectedSiteBinding(ORG_A);
    const { revision } = await createDraftRevision(ORG_A);
    await linkSharePointFileToRevision(docContext(ORG_A), {
      revisionId: revision.id,
      siteBindingId: binding.id,
      itemId: "item-1",
      actorUserId: "user-author",
      graphClient: fakeGraphClient(),
    });

    await submitRevisionForReview(docContext(ORG_A), revision.id, "user-author");
    await recordRevisionReview(docContext(ORG_A), revision.id, "user-reviewer");

    // Between linking and approval, SharePoint moved on to a newer version —
    // approval must pin whatever is current *now*, and never rewrite it later.
    const approvalGraphClient = fakeGraphClient({
      listVersions: vi.fn(async () => [{ versionId: "3.0", lastModifiedDateTime: new Date().toISOString() }]),
      getDownloadMetadata: vi.fn(async () => ({ itemId: "item-1", versionId: "3.0", sizeBytes: 2048, mimeType: null, sha256: "b".repeat(64) })),
    });

    const approved = await approveRevision(docContext(ORG_A), revision.id, { actorUserId: "user-approver", graphClient: approvalGraphClient });

    expect(approved.status).toBe("APPROVED");
    expect(approved.checksumSha256).toBe("b".repeat(64));

    const pinned = references.find((r) => r.controlledDocumentRevisionId === revision.id)!;
    expect(pinned.versionId).toBe("3.0");
    expect(pinned.checksumSha256).toBe("b".repeat(64));
    expect(pinned.pinnedAt).not.toBeNull();

    // A still-later SharePoint edit must never mutate the now-pinned row.
    const drift = await checkForSharePointDrift(
      docContext(ORG_A),
      revision.id,
      fakeGraphClient({ listVersions: vi.fn(async () => [{ versionId: "4.0", lastModifiedDateTime: new Date().toISOString() }]) }),
    );
    expect(drift).toEqual({ pinned: true, pinnedVersionId: "3.0", currentVersionId: "4.0", drift: true });
    const stillPinned = references.find((r) => r.controlledDocumentRevisionId === revision.id)!;
    expect(stillPinned.versionId).toBe("3.0");
  });

  it("blocks approval when the linked SharePoint version cannot be resolved (missing/pruned/inaccessible)", async () => {
    const binding = seedConnectedSiteBinding(ORG_A);
    const { revision } = await createDraftRevision(ORG_A);
    await linkSharePointFileToRevision(docContext(ORG_A), {
      revisionId: revision.id,
      siteBindingId: binding.id,
      itemId: "item-1",
      actorUserId: "user-author",
      graphClient: fakeGraphClient(),
    });
    await submitRevisionForReview(docContext(ORG_A), revision.id, "user-author");
    await recordRevisionReview(docContext(ORG_A), revision.id, "user-reviewer");

    const unreachableGraphClient = fakeGraphClient({
      getDownloadMetadata: vi.fn(async () => {
        throw new Error("404 not found");
      }),
    });

    await expect(
      approveRevision(docContext(ORG_A), revision.id, { actorUserId: "user-approver", graphClient: unreachableGraphClient }),
    ).rejects.toThrow(SharePointLinkError);

    // The revision must not have been silently moved to APPROVED anyway.
    const stillInReview = revisions.find((r) => r.id === revision.id)!;
    expect(stillInReview.status).toBe("IN_REVIEW");
  });
});

describe("fallback / non-SharePoint behaviour", () => {
  it("approves a revision with no SharePoint reference exactly as T22 always has", async () => {
    const { revision } = await createDraftRevision(ORG_A);
    await submitRevisionForReview(docContext(ORG_A), revision.id, "user-author");
    await recordRevisionReview(docContext(ORG_A), revision.id, "user-reviewer");

    const approved = await approveRevision(docContext(ORG_A), revision.id, { actorUserId: "user-approver" });

    expect(approved.status).toBe("APPROVED");
    expect(references.find((r) => r.controlledDocumentRevisionId === revision.id)).toBeUndefined();
  });

  it("readControlledDocumentRevisionBytes returns null for a revision with neither evidence nor a SharePoint link", async () => {
    const { revision } = await createDraftRevision(ORG_A);
    const result = await readControlledDocumentRevisionBytes(docContext(ORG_A), revision.id);
    expect(result).toBeNull();
  });
});

describe("reading pinned SharePoint content", () => {
  async function approvedSharePointRevision(orgId: string) {
    const binding = seedConnectedSiteBinding(orgId);
    const { revision } = await createDraftRevision(orgId, `POL-SP-${orgId}`);
    await linkSharePointFileToRevision(docContext(orgId), {
      revisionId: revision.id,
      siteBindingId: binding.id,
      itemId: "item-1",
      actorUserId: "user-author",
      graphClient: fakeGraphClient(),
    });
    await submitRevisionForReview(docContext(orgId), revision.id, "user-author");
    await recordRevisionReview(docContext(orgId), revision.id, "user-reviewer");
    await approveRevision(docContext(orgId), revision.id, { actorUserId: "user-approver", graphClient: fakeGraphClient() });
    return revision;
  }

  it("downloads the pinned bytes and verifies them against the pinned checksum", async () => {
    const revision = await approvedSharePointRevision(ORG_A);
    const pinned = references.find((r) => r.controlledDocumentRevisionId === revision.id)!;

    const { createHash } = await import("node:crypto");
    const bytes = Buffer.from("pinned bytes");
    const readGraphClient = fakeGraphClient({ downloadContent: vi.fn(async () => bytes) });
    // Make the pinned checksum match what downloadContent will actually return.
    pinned.checksumSha256 = createHash("sha256").update(bytes).digest("hex");

    const result = await readControlledDocumentRevisionBytes(docContext(ORG_A), revision.id, readGraphClient);
    expect(result?.bytes.toString()).toBe("pinned bytes");
    expect(result?.checksumSha256).toBe(pinned.checksumSha256);
  });

  it("blocks (never silently serves) when downloaded bytes no longer match the pinned checksum", async () => {
    const revision = await approvedSharePointRevision(ORG_A);
    const pinned = references.find((r) => r.controlledDocumentRevisionId === revision.id)!;
    pinned.checksumSha256 = "c".repeat(64); // deliberately wrong vs. the bytes below

    const tamperedGraphClient = fakeGraphClient({ downloadContent: vi.fn(async () => Buffer.from("tampered bytes")) });

    await expect(readControlledDocumentRevisionBytes(docContext(ORG_A), revision.id, tamperedGraphClient)).rejects.toThrow(
      SharePointLinkError,
    );

    const flagged = references.find((r) => r.id === pinned.id)!;
    expect(flagged.referenceStatus).toBe("UNREACHABLE");
  });

  it("denies reading a revision's SharePoint content across organisations", async () => {
    const revisionA = await approvedSharePointRevision(ORG_A);
    await approvedSharePointRevision(ORG_B);

    const result = await readControlledDocumentRevisionBytes(docContext(ORG_B), revisionA.id, fakeGraphClient());
    expect(result).toBeNull();
  });
});

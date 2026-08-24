/**
 * SharePoint-backed `EvidenceStorageProvider` tests (task SP03). No live
 * database and no live Microsoft Graph call — Prisma is an in-memory fake
 * (matching the SP01 `connection-service.test.ts` pattern) and the
 * `GraphClient` is a hand-written synthetic fake injected via
 * `createSharePointEvidenceStorageProvider({ graphClient })`. Covers: byte
 * upload pins an `ExternalFileReference` to the exact returned item/version
 * (never "latest"), download resolves the pinned reference and never a
 * client-supplied organisation id, a foreign-tenant/unknown storageKey
 * yields `null` rather than throwing, and remove() deletes the Graph item
 * and marks the reference UNREACHABLE without deleting Neon's own record.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { GraphClient, GraphDownloadMetadata, GraphDriveMetadata, GraphHealthCheckResult, GraphItemMetadata, GraphUploadResult, GraphUploadSession, GraphVersionMetadata } from "@/lib/documents/storage/graph/types";

const ORG_A = "org-aster-demo";
const ORG_B = "org-birch-demo";

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

interface EvidenceObjectRow {
  id: string;
  organisationId: string;
  uploadedByUserId: string | null;
}

const { connections, siteBindings, references, evidenceObjects, resetTables, nextIdRef } = vi.hoisted(() => {
  const connections: ConnectionRow[] = [];
  const siteBindings: SiteBindingRow[] = [];
  const references: ReferenceRow[] = [];
  const evidenceObjects: EvidenceObjectRow[] = [];
  const nextIdRef = { n: 1 };
  function resetTables() {
    connections.length = 0;
    siteBindings.length = 0;
    references.length = 0;
    evidenceObjects.length = 0;
    nextIdRef.n = 1;
  }
  return { connections, siteBindings, references, evidenceObjects, resetTables, nextIdRef };
});

function nextId(prefix: string): string {
  return `${prefix}-${nextIdRef.n++}`;
}

function matches(row: object, where: Record<string, unknown>): boolean {
  const record = row as Record<string, unknown>;
  return Object.entries(where).every(([key, value]) => record[key] === value);
}

vi.mock("@/lib/prisma", () => {
  const organisationStorageConnection = {
    findUnique: vi.fn(async ({ where }: { where: { organisationId?: string } }) => connections.find((c) => c.organisationId === where.organisationId) ?? null),
  };
  const storageSiteBinding = {
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
    findUnique: vi.fn(async ({ where }: { where: { evidenceObjectId: string } }) => references.find((r) => r.evidenceObjectId === where.evidenceObjectId) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ReferenceRow> }) => {
      const row = references.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };
  const evidenceObject = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => evidenceObjects.find((e) => e.id === where.id) ?? null),
  };
  const prisma = {
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

const { recordAuditEvent } = await import("@/lib/repositories/audit-repository");
const { createSharePointEvidenceStorageProvider } = await import("@/lib/documents/storage/sharepoint-provider");

/** A minimal synthetic `GraphClient` fake — no HTTP, no real tenant, per the programme's synthetic-fixtures rule. */
function fakeGraphClient(overrides: Partial<GraphClient> = {}): GraphClient {
  return {
    getDrive: vi.fn(async (): Promise<GraphDriveMetadata> => ({ siteId: "site-1", driveId: "drive-1", webUrl: null })),
    getItem: vi.fn(async (): Promise<GraphItemMetadata> => {
      throw new Error("not used in these tests");
    }),
    listVersions: vi.fn(async (): Promise<GraphVersionMetadata[]> => []),
    getDownloadMetadata: vi.fn(async (): Promise<GraphDownloadMetadata> => {
      throw new Error("not used in these tests");
    }),
    createUploadSession: vi.fn(async (): Promise<GraphUploadSession> => ({ uploadUrl: "https://contoso.example/upload", expirationDateTime: null })),
    uploadContent: vi.fn(
      async (): Promise<GraphUploadResult> => ({
        itemId: "item-synthetic-1",
        versionId: "1.0",
        eTag: '"etag-1"',
        webUrl: "https://contoso.example/item-synthetic-1",
        sha256: "synthetic-sha256",
        size: 11,
      }),
    ),
    downloadContent: vi.fn(async (): Promise<Buffer> => Buffer.from("synthetic bytes")),
    deleteItem: vi.fn(async () => {}),
    checkHealth: vi.fn(async (): Promise<GraphHealthCheckResult> => ({ ok: true, checkedAt: new Date().toISOString(), detail: "ok" })),
    ...overrides,
  };
}

function connectOrganisation(organisationId: string, siteBindingId: string, rootFolderPath: string | null = "EMS/Evidence") {
  connections.push({ id: `conn-${organisationId}`, organisationId, status: "CONNECTED", entraTenantId: `tenant-${organisationId}` });
  siteBindings.push({
    id: siteBindingId,
    connectionId: `conn-${organisationId}`,
    organisationId,
    siteId: "site-1",
    driveId: "drive-1",
    status: "CONNECTED",
    rootFolderPath,
  });
}

beforeEach(() => {
  resetTables();
  vi.clearAllMocks();
});

describe("SharePointEvidenceStorageProvider", () => {
  it("is named 'sharepoint'", () => {
    expect(createSharePointEvidenceStorageProvider({ graphClient: fakeGraphClient() }).name).toBe("sharepoint");
  });

  describe("put", () => {
    it("uploads bytes through the Graph client and pins an ExternalFileReference to the returned item/version", async () => {
      connectOrganisation(ORG_A, "binding-1");
      evidenceObjects.push({ id: "evidence-1", organisationId: ORG_A, uploadedByUserId: "user-1" });
      const graphClient = fakeGraphClient();
      const provider = createSharePointEvidenceStorageProvider({ graphClient });

      const stored = await provider.put({
        evidenceId: "evidence-1",
        fileName: "evidence.pdf",
        mimeType: "application/pdf",
        bytes: Buffer.from("hello world"),
      });

      expect(stored).toEqual({ storageProvider: "sharepoint", storageKey: "evidence-1" });
      expect(graphClient.uploadContent).toHaveBeenCalledWith(
        expect.objectContaining({ organisationId: ORG_A, siteId: "site-1", driveId: "drive-1" }),
        "EMS/Evidence",
        "evidence.pdf",
        Buffer.from("hello world"),
        expect.any(String),
      );

      expect(references).toHaveLength(1);
      expect(references[0]).toMatchObject({
        organisationId: ORG_A,
        siteBindingId: "binding-1",
        evidenceObjectId: "evidence-1",
        itemId: "item-synthetic-1",
        versionId: "1.0",
        checksumSha256: "synthetic-sha256",
        referenceStatus: "ACTIVE",
      });
      expect(references[0].pinnedAt).not.toBeNull();

      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ organisationId: ORG_A }),
        expect.objectContaining({ eventType: "external_file_reference.created", actorUserId: "user-1" }),
      );
    });

    it("falls back to a locally computed checksum when Graph reports no hash facet", async () => {
      connectOrganisation(ORG_A, "binding-1");
      evidenceObjects.push({ id: "evidence-2", organisationId: ORG_A, uploadedByUserId: "user-1" });
      const graphClient = fakeGraphClient({
        uploadContent: vi.fn(
          async (): Promise<GraphUploadResult> => ({ itemId: "item-2", versionId: "1.0", eTag: null, webUrl: null, sha256: null, size: 11 }),
        ),
      });
      const provider = createSharePointEvidenceStorageProvider({ graphClient });

      await provider.put({ evidenceId: "evidence-2", fileName: "f.pdf", mimeType: "application/pdf", bytes: Buffer.from("hello world") });

      expect(references[0].checksumSha256).toHaveLength(64); // sha256 hex digest, computed locally
    });

    it("rejects an unknown evidence id without calling Graph", async () => {
      const graphClient = fakeGraphClient();
      const provider = createSharePointEvidenceStorageProvider({ graphClient });

      await expect(
        provider.put({ evidenceId: "no-such-evidence", fileName: "f.pdf", mimeType: "application/pdf", bytes: Buffer.from("x") }),
      ).rejects.toThrow();
      expect(graphClient.uploadContent).not.toHaveBeenCalled();
    });

    it("propagates a Graph/configuration failure rather than silently falling back", async () => {
      // No storage connection configured for ORG_A.
      evidenceObjects.push({ id: "evidence-3", organisationId: ORG_A, uploadedByUserId: "user-1" });
      const graphClient = fakeGraphClient();
      const provider = createSharePointEvidenceStorageProvider({ graphClient });

      await expect(
        provider.put({ evidenceId: "evidence-3", fileName: "f.pdf", mimeType: "application/pdf", bytes: Buffer.from("x") }),
      ).rejects.toMatchObject({ kind: "CONFIGURATION" });
      expect(references).toHaveLength(0);
    });
  });

  describe("get", () => {
    it("downloads the exact pinned item/version for the reference's own organisation", async () => {
      connectOrganisation(ORG_A, "binding-1");
      references.push({
        id: "ref-1",
        organisationId: ORG_A,
        siteBindingId: "binding-1",
        evidenceObjectId: "evidence-1",
        controlledDocumentRevisionId: null,
        itemId: "item-1",
        versionId: "3.0",
        eTag: null,
        webUrl: null,
        checksumSha256: "abc",
        byteSize: 11,
        mimeType: "application/pdf",
        pinnedAt: new Date(),
        referenceStatus: "ACTIVE",
        staleReason: null,
        lastObservedAt: new Date(),
      });
      const graphClient = fakeGraphClient();
      const provider = createSharePointEvidenceStorageProvider({ graphClient });

      const bytes = await provider.get("evidence-1");

      expect(bytes?.toString("utf8")).toBe("synthetic bytes");
      expect(graphClient.downloadContent).toHaveBeenCalledWith(
        expect.objectContaining({ organisationId: ORG_A }),
        "item-1",
        "3.0",
        expect.any(String),
      );
    });

    it("returns null for a storageKey with no SharePoint reference", async () => {
      const provider = createSharePointEvidenceStorageProvider({ graphClient: fakeGraphClient() });
      expect(await provider.get("no-such-evidence")).toBeNull();
    });

    it("returns null (never throws) when Graph is unreachable", async () => {
      connectOrganisation(ORG_A, "binding-1");
      references.push({
        id: "ref-1",
        organisationId: ORG_A,
        siteBindingId: "binding-1",
        evidenceObjectId: "evidence-1",
        controlledDocumentRevisionId: null,
        itemId: "item-1",
        versionId: "3.0",
        eTag: null,
        webUrl: null,
        checksumSha256: "abc",
        byteSize: 11,
        mimeType: "application/pdf",
        pinnedAt: new Date(),
        referenceStatus: "ACTIVE",
        staleReason: null,
        lastObservedAt: new Date(),
      });
      const graphClient = fakeGraphClient({ downloadContent: vi.fn().mockRejectedValue(new Error("Graph unreachable")) });
      const provider = createSharePointEvidenceStorageProvider({ graphClient });

      expect(await provider.get("evidence-1")).toBeNull();
    });

    it("returns null for a reference marked UNREACHABLE rather than resolving a stale item", async () => {
      connectOrganisation(ORG_A, "binding-1");
      references.push({
        id: "ref-1",
        organisationId: ORG_A,
        siteBindingId: "binding-1",
        evidenceObjectId: "evidence-1",
        controlledDocumentRevisionId: null,
        itemId: "item-1",
        versionId: "3.0",
        eTag: null,
        webUrl: null,
        checksumSha256: "abc",
        byteSize: 11,
        mimeType: "application/pdf",
        pinnedAt: new Date(),
        referenceStatus: "UNREACHABLE",
        staleReason: "deleted upstream",
        lastObservedAt: new Date(),
      });
      const graphClient = fakeGraphClient();
      const provider = createSharePointEvidenceStorageProvider({ graphClient });

      expect(await provider.get("evidence-1")).toBeNull();
      expect(graphClient.downloadContent).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("deletes the Graph item and marks the reference UNREACHABLE without deleting the Neon row", async () => {
      connectOrganisation(ORG_A, "binding-1");
      references.push({
        id: "ref-1",
        organisationId: ORG_A,
        siteBindingId: "binding-1",
        evidenceObjectId: "evidence-1",
        controlledDocumentRevisionId: null,
        itemId: "item-1",
        versionId: "3.0",
        eTag: null,
        webUrl: null,
        checksumSha256: "abc",
        byteSize: 11,
        mimeType: "application/pdf",
        pinnedAt: new Date(),
        referenceStatus: "ACTIVE",
        staleReason: null,
        lastObservedAt: new Date(),
      });
      const graphClient = fakeGraphClient();
      const provider = createSharePointEvidenceStorageProvider({ graphClient });

      await provider.remove("evidence-1");

      expect(graphClient.deleteItem).toHaveBeenCalledWith(expect.objectContaining({ organisationId: ORG_A }), "item-1", expect.any(String));
      expect(references).toHaveLength(1);
      expect(references[0].referenceStatus).toBe("UNREACHABLE");
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ eventType: "external_file_reference.marked_stale" }),
      );
    });

    it("is a no-op for a storageKey with no SharePoint reference", async () => {
      const graphClient = fakeGraphClient();
      const provider = createSharePointEvidenceStorageProvider({ graphClient });

      await expect(provider.remove("no-such-evidence")).resolves.toBeUndefined();
      expect(graphClient.deleteItem).not.toHaveBeenCalled();
    });
  });

  it("never crosses organisations: ORG_B's connection never resolves ORG_A's reference", async () => {
    connectOrganisation(ORG_B, "binding-b");
    references.push({
      id: "ref-1",
      organisationId: ORG_A,
      siteBindingId: "binding-a-never-connected",
      evidenceObjectId: "evidence-1",
      controlledDocumentRevisionId: null,
      itemId: "item-1",
      versionId: "3.0",
      eTag: null,
      webUrl: null,
      checksumSha256: "abc",
      byteSize: 11,
      mimeType: "application/pdf",
      pinnedAt: new Date(),
      referenceStatus: "ACTIVE",
      staleReason: null,
      lastObservedAt: new Date(),
    });
    const graphClient = fakeGraphClient();
    const provider = createSharePointEvidenceStorageProvider({ graphClient });

    // ORG_A has no connection of its own configured, so resolution must fail closed (null), never borrow ORG_B's connection.
    expect(await provider.get("evidence-1")).toBeNull();
    expect(graphClient.downloadContent).not.toHaveBeenCalled();
  });
});

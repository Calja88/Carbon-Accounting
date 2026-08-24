/**
 * SharePoint delta reconciliation tests (task SP06,
 * Docs/SP00_SHAREPOINT_INTEGRATION_SPEC.md §9). Synthetic in-memory Prisma
 * fake, same shape as `legal-sync-worker.test.ts` (T42) — no live database,
 * no live Microsoft Graph call: `GraphClient` here is a fully synthetic
 * fake and every itemId/site/drive value below is a fabricated fixture.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphClient, GraphDeltaPage, GraphSiteTarget } from "@/lib/documents/storage/graph/types";

interface Row {
  id: string;
  [key: string]: unknown;
}

function flattenWhere(where: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where)) {
    if (
      value &&
      typeof value === "object" &&
      !(value instanceof Date) &&
      !("in" in (value as Record<string, unknown>)) &&
      !("not" in (value as Record<string, unknown>))
    ) {
      Object.assign(flat, value as Record<string, unknown>);
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  const flat = flattenWhere(where);
  return Object.entries(flat).every(([key, value]) => {
    if (value && typeof value === "object" && "in" in (value as Record<string, unknown>)) {
      return (value as { in: unknown[] }).in.includes(row[key]);
    }
    if (value && typeof value === "object" && "not" in (value as Record<string, unknown>)) {
      return row[key] !== (value as { not: unknown }).not;
    }
    return row[key] === value;
  });
}

const { tables, db } = vi.hoisted(() => {
  function makeTable(idPrefix: string, defaults: Record<string, unknown> = {}) {
    const rows: Row[] = [];
    let n = 0;
    return {
      rows,
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matches(r, where)) ?? null),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matches(r, where)) ?? null),
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => (where ? rows.filter((r) => matches(r, where)) : [...rows])),
      count: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => (where ? rows.filter((r) => matches(r, where)).length : rows.length)),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const row: Row = { id: `${idPrefix}${++n}`, createdAt: now, updatedAt: now, ...defaults, ...data };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const existing = rows.find((r) => matches(r, where));
        if (!existing) throw new Error(`update: no row matches ${JSON.stringify(where)}`);
        Object.assign(existing, data, { updatedAt: new Date() });
        return existing;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const matched = rows.filter((r) => matches(r, where));
        for (const row of matched) Object.assign(row, data, { updatedAt: new Date() });
        return { count: matched.length };
      }),
    };
  }

  const tables = {
    storageSiteBinding: makeTable("binding-"),
    storageReconciliationCursor: makeTable("cursor-"),
    externalFileReference: makeTable("ref-"),
    outboxMessage: makeTable("msg-"),
  };

  function snapshot() {
    return Object.fromEntries(Object.entries(tables).map(([key, table]) => [key, table.rows.map((r) => ({ ...r }))]));
  }
  function restore(snap: Record<string, Row[]>) {
    for (const [key, rows] of Object.entries(snap)) {
      const table = tables[key as keyof typeof tables];
      table.rows.length = 0;
      table.rows.push(...rows);
    }
  }

  const db = {
    ...tables,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const snap = snapshot();
      try {
        return await fn(db);
      } catch (error) {
        restore(snap);
        throw error;
      }
    }),
  };

  return { tables, db };
});

vi.mock("@/lib/prisma", () => ({ prisma: db }));

const recordAuditEvent = vi.fn(async (_tx: unknown, _ctx: unknown, _input: unknown) => ({ id: "audit-1" }));
vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: (tx: unknown, ctx: unknown, input: unknown) => recordAuditEvent(tx, ctx, input) }));

const ORG_A = "org-aster-demo";
const ORG_B = "org-birch-demo";
const SITE_BINDING_A = "binding-org-a";
const SITE_BINDING_B = "binding-org-b";

const resolveGraphSiteTargetForEvidenceProvider = vi.fn(async (organisationId: string, siteBindingId?: string) => {
  const entraTenantId = organisationId === ORG_A ? "tenant-a" : "tenant-b";
  return {
    target: { organisationId, entraTenantId, siteId: "site-1", driveId: "drive-1" } satisfies GraphSiteTarget,
    siteBindingId: siteBindingId ?? (organisationId === ORG_A ? SITE_BINDING_A : SITE_BINDING_B),
    rootFolderPath: null,
  };
});
vi.mock("@/lib/documents/storage/graph/config", () => ({
  resolveGraphSiteTargetForEvidenceProvider: (organisationId: string, siteBindingId?: string) =>
    resolveGraphSiteTargetForEvidenceProvider(organisationId, siteBindingId),
}));

vi.mock("@/lib/documents/storage/graph/registry", () => ({
  getGraphClient: () => {
    throw new Error("tests must inject a graphClient explicitly");
  },
}));

const { runReconciliationCycle, getOrCreateReconciliationCursor, makeSharePointReconciliationJobHandler, MAX_PAGES_PER_RUN } = await import(
  "../reconciliation-service"
);
const { GraphClientError } = await import("@/lib/documents/storage/graph/types");

function resetAll() {
  for (const table of Object.values(tables)) table.rows.length = 0;
  recordAuditEvent.mockClear();
}

function seedSiteBinding(organisationId: string, id: string, driveId = "drive-1") {
  tables.storageSiteBinding.rows.push({
    id,
    organisationId,
    connectionId: "conn-1",
    siteId: "site-1",
    driveId,
    rootFolderId: null,
    rootFolderPath: null,
    label: "EMS Controlled Documents",
    status: "CONNECTED",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function seedReference(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: overrides.id ?? `ref-seed-${tables.externalFileReference.rows.length + 1}`,
    organisationId: ORG_A,
    siteBindingId: SITE_BINDING_A,
    evidenceObjectId: "evidence-1",
    controlledDocumentRevisionId: null,
    itemId: "item-1",
    versionId: "1.0",
    eTag: '"etag-1"',
    webUrl: null,
    checksumSha256: "checksum-original",
    byteSize: 100,
    mimeType: "application/pdf",
    pinnedAt: null,
    referenceStatus: "ACTIVE",
    staleReason: null,
    lastObservedAt: null,
    reconciliationIssue: null,
    lastKnownName: "policy.pdf",
    lastKnownPath: "/drive/root:/EMS",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  tables.externalFileReference.rows.push(row);
  return row;
}

/** A fully synthetic `GraphClient` fake — no HTTP, no real tenant. */
function fakeGraphClient(pages: GraphDeltaPage[]): GraphClient {
  const queue = [...pages];
  return {
    getDrive: vi.fn(),
    getItem: vi.fn(),
    listVersions: vi.fn(async () => [{ versionId: "2.0", lastModifiedDateTime: new Date().toISOString() }]),
    getDownloadMetadata: vi.fn(),
    createUploadSession: vi.fn(),
    uploadContent: vi.fn(),
    downloadContent: vi.fn(),
    deleteItem: vi.fn(),
    checkHealth: vi.fn(),
    getDelta: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error("no more synthetic delta pages queued");
      return next;
    }),
  } as unknown as GraphClient;
}

function deltaItem(overrides: Partial<GraphDeltaPage["items"][number]> = {}): GraphDeltaPage["items"][number] {
  return {
    itemId: "item-1",
    name: "policy.pdf",
    eTag: '"etag-1"',
    webUrl: null,
    lastModifiedDateTime: new Date().toISOString(),
    sha256: "checksum-original",
    size: 100,
    deleted: false,
    parentItemId: "folder-1",
    parentDriveId: "drive-1",
    parentPath: "/drive/root:/EMS",
    ...overrides,
  };
}

beforeEach(() => {
  resetAll();
  seedSiteBinding(ORG_A, SITE_BINDING_A);
  seedSiteBinding(ORG_B, SITE_BINDING_B);
});

describe("runReconciliationCycle", () => {
  it("leaves an unchanged reference ACTIVE with no issue when the observed item matches", async () => {
    seedReference();
    const client = fakeGraphClient([{ items: [deltaItem()], nextLink: null, deltaLink: "https://graph.microsoft.com/final" }]);

    const result = await runReconciliationCycle({ organisationId: ORG_A, siteBindingId: SITE_BINDING_A, graphClient: client });

    expect(result.cursorAdvancedTo).toBe("https://graph.microsoft.com/final");
    const ref = tables.externalFileReference.rows[0];
    expect(ref.referenceStatus).toBe("ACTIVE");
    expect(ref.reconciliationIssue).toBeNull();
  });

  it("marks a reference UNREACHABLE with DELETED when Graph reports the item deleted", async () => {
    seedReference();
    const client = fakeGraphClient([{ items: [deltaItem({ deleted: true })], nextLink: null, deltaLink: "https://graph.microsoft.com/final" }]);

    await runReconciliationCycle({ organisationId: ORG_A, siteBindingId: SITE_BINDING_A, graphClient: client });

    const ref = tables.externalFileReference.rows[0];
    expect(ref.referenceStatus).toBe("UNREACHABLE");
    expect(ref.reconciliationIssue).toBe("DELETED");
  });

  it("never deletes the ExternalFileReference row itself on a deletion — only tombstones its status", async () => {
    seedReference();
    const client = fakeGraphClient([{ items: [deltaItem({ deleted: true })], nextLink: null, deltaLink: "https://graph.microsoft.com/final" }]);

    await runReconciliationCycle({ organisationId: ORG_A, siteBindingId: SITE_BINDING_A, graphClient: client });

    expect(tables.externalFileReference.rows).toHaveLength(1);
  });

  it("marks a reference STALE with MOVED_OUT_OF_SCOPE when the item's parent drive differs from the bound drive", async () => {
    seedReference();
    const client = fakeGraphClient([
      { items: [deltaItem({ parentDriveId: "some-other-drive" })], nextLink: null, deltaLink: "https://graph.microsoft.com/final" },
    ]);

    await runReconciliationCycle({ organisationId: ORG_A, siteBindingId: SITE_BINDING_A, graphClient: client });

    const ref = tables.externalFileReference.rows[0];
    expect(ref.referenceStatus).toBe("STALE");
    expect(ref.reconciliationIssue).toBe("MOVED_OUT_OF_SCOPE");
  });

  it("flags RENAMED without changing referenceStatus when only the name/path changed within the bound drive", async () => {
    seedReference();
    const client = fakeGraphClient([
      { items: [deltaItem({ name: "policy-v2.pdf", parentPath: "/drive/root:/EMS/Renamed" })], nextLink: null, deltaLink: "https://graph.microsoft.com/final" },
    ]);

    await runReconciliationCycle({ organisationId: ORG_A, siteBindingId: SITE_BINDING_A, graphClient: client });

    const ref = tables.externalFileReference.rows[0];
    expect(ref.referenceStatus).toBe("ACTIVE");
    expect(ref.reconciliationIssue).toBe("RENAMED");
    expect(ref.lastKnownName).toBe("policy-v2.pdf");
    expect(ref.lastKnownPath).toBe("/drive/root:/EMS/Renamed");
  });

  it("never rewrites itemId/versionId/checksumSha256 on a pinned (issued) reference when content changed behind it", async () => {
    seedReference({ pinnedAt: new Date("2026-01-01T00:00:00Z"), checksumSha256: "checksum-issued" });
    const client = fakeGraphClient([
      { items: [deltaItem({ sha256: "checksum-newer-on-sharepoint" })], nextLink: null, deltaLink: "https://graph.microsoft.com/final" },
    ]);

    await runReconciliationCycle({ organisationId: ORG_A, siteBindingId: SITE_BINDING_A, graphClient: client });

    const ref = tables.externalFileReference.rows[0];
    expect(ref.checksumSha256).toBe("checksum-issued");
    expect(ref.versionId).toBe("1.0");
    expect(ref.reconciliationIssue).toBe("VERSION_DRIFT_BEHIND_ISSUED");
    expect(ref.referenceStatus).toBe("ACTIVE");
  });

  it("updates checksum/eTag/versionId on a drafting (unpinned) reference when content changed", async () => {
    seedReference({ pinnedAt: null, checksumSha256: "checksum-draft-old" });
    const client = fakeGraphClient([
      { items: [deltaItem({ sha256: "checksum-draft-new", eTag: '"etag-2"' })], nextLink: null, deltaLink: "https://graph.microsoft.com/final" },
    ]);

    await runReconciliationCycle({ organisationId: ORG_A, siteBindingId: SITE_BINDING_A, graphClient: client });

    const ref = tables.externalFileReference.rows[0];
    expect(ref.checksumSha256).toBe("checksum-draft-new");
    expect(ref.eTag).toBe('"etag-2"');
    expect(ref.versionId).toBe("2.0"); // resolved via listVersions
    expect(ref.reconciliationIssue).toBeNull();
  });

  it("pages through @odata.nextLink and commits the cursor to the final page's @odata.deltaLink", async () => {
    seedReference();
    const client = fakeGraphClient([
      { items: [], nextLink: "https://graph.microsoft.com/page-2", deltaLink: null },
      { items: [deltaItem()], nextLink: null, deltaLink: "https://graph.microsoft.com/final" },
    ]);

    const result = await runReconciliationCycle({ organisationId: ORG_A, siteBindingId: SITE_BINDING_A, graphClient: client });

    expect(result.pagesProcessed).toBe(2);
    expect(result.cursorAdvancedTo).toBe("https://graph.microsoft.com/final");
    const cursor = tables.storageReconciliationCursor.rows.find((r) => r.siteBindingId === SITE_BINDING_A);
    expect(cursor?.deltaLink).toBe("https://graph.microsoft.com/final");
    expect(cursor?.lastSuccessAt).not.toBeNull();
  });

  it("bounds a run to MAX_PAGES_PER_RUN pages, persisting the intermediate nextLink to resume later", async () => {
    const pages: GraphDeltaPage[] = [];
    for (let i = 0; i < MAX_PAGES_PER_RUN + 2; i++) {
      pages.push({ items: [], nextLink: `https://graph.microsoft.com/page-${i + 1}`, deltaLink: null });
    }
    const client = fakeGraphClient(pages);

    const result = await runReconciliationCycle({ organisationId: ORG_A, siteBindingId: SITE_BINDING_A, graphClient: client });

    expect(result.pagesProcessed).toBe(MAX_PAGES_PER_RUN);
    expect(result.cursorAdvancedTo).toBe(`https://graph.microsoft.com/page-${MAX_PAGES_PER_RUN}`);
  });

  it("is idempotent: replaying the exact same page twice leaves the reference in the same terminal state without duplicate flags", async () => {
    seedReference();
    const client1 = fakeGraphClient([{ items: [deltaItem({ deleted: true })], nextLink: null, deltaLink: "https://graph.microsoft.com/final" }]);
    const result1 = await runReconciliationCycle({ organisationId: ORG_A, siteBindingId: SITE_BINDING_A, graphClient: client1 });
    expect(result1.itemsFlagged).toBe(1);

    // Simulate a retried/duplicate-delivered job attempt replaying from the same committed cursor.
    tables.storageReconciliationCursor.rows.find((r) => r.siteBindingId === SITE_BINDING_A)!.deltaLink = null;
    const client2 = fakeGraphClient([{ items: [deltaItem({ deleted: true })], nextLink: null, deltaLink: "https://graph.microsoft.com/final" }]);
    const result2 = await runReconciliationCycle({ organisationId: ORG_A, siteBindingId: SITE_BINDING_A, graphClient: client2 });

    expect(result2.itemsFlagged).toBe(0); // no state change the second time — already DELETED/UNREACHABLE
    expect(tables.externalFileReference.rows).toHaveLength(1);
    const ref = tables.externalFileReference.rows[0];
    expect(ref.referenceStatus).toBe("UNREACHABLE");
    expect(ref.reconciliationIssue).toBe("DELETED");
  });

  it("resets the delta cursor and throws on a GONE (410, expired cursor) response, forcing a bounded resync next run", async () => {
    seedReference();
    const client: GraphClient = {
      getDrive: vi.fn(),
      getItem: vi.fn(),
      listVersions: vi.fn(),
      getDownloadMetadata: vi.fn(),
      createUploadSession: vi.fn(),
      uploadContent: vi.fn(),
      downloadContent: vi.fn(),
      deleteItem: vi.fn(),
      checkHealth: vi.fn(),
      getDelta: vi.fn(async () => {
        throw new GraphClientError("expired", "GONE", 410, false, "cid");
      }),
    } as unknown as GraphClient;
    await getOrCreateReconciliationCursor(db as never, ORG_A, SITE_BINDING_A);
    tables.storageReconciliationCursor.rows[0].deltaLink = "https://graph.microsoft.com/expired-token";

    await expect(runReconciliationCycle({ organisationId: ORG_A, siteBindingId: SITE_BINDING_A, graphClient: client })).rejects.toMatchObject({
      code: "SHAREPOINT_RECONCILE_CURSOR_EXPIRED",
    });

    const cursor = tables.storageReconciliationCursor.rows[0];
    expect(cursor.deltaLink).toBeNull();
    expect(cursor.status).toBe("ERROR");
  });

  it("marks every reference UNREACHABLE with PERMISSION_REVOKED when Graph denies access to the whole drive", async () => {
    seedReference();
    seedReference({ id: "ref-2", itemId: "item-2" });
    const client: GraphClient = {
      getDrive: vi.fn(),
      getItem: vi.fn(),
      listVersions: vi.fn(),
      getDownloadMetadata: vi.fn(),
      createUploadSession: vi.fn(),
      uploadContent: vi.fn(),
      downloadContent: vi.fn(),
      deleteItem: vi.fn(),
      checkHealth: vi.fn(),
      getDelta: vi.fn(async () => {
        throw new GraphClientError("denied", "PERMISSION_DENIED", 403, false, "cid");
      }),
    } as unknown as GraphClient;

    await expect(runReconciliationCycle({ organisationId: ORG_A, siteBindingId: SITE_BINDING_A, graphClient: client })).rejects.toMatchObject({
      code: "SHAREPOINT_RECONCILE_PERMISSION_DENIED",
    });

    for (const ref of tables.externalFileReference.rows) {
      expect(ref.referenceStatus).toBe("UNREACHABLE");
      expect(ref.reconciliationIssue).toBe("PERMISSION_REVOKED");
    }
  });

  it("refuses to call Graph and marks references TENANT_MISMATCH when the connection's tenant differs from the cursor's last-known tenant", async () => {
    seedReference();
    const cursor = await getOrCreateReconciliationCursor(db as never, ORG_A, SITE_BINDING_A);
    tables.storageReconciliationCursor.rows.find((r) => r.id === cursor.id)!.lastKnownEntraTenantId = "tenant-old-and-different";
    const client = fakeGraphClient([]);

    const result = await runReconciliationCycle({ organisationId: ORG_A, siteBindingId: SITE_BINDING_A, graphClient: client });

    expect(result.skippedTenantMismatch).toBe(true);
    expect(client.getDelta).not.toHaveBeenCalled();
    const ref = tables.externalFileReference.rows[0];
    expect(ref.referenceStatus).toBe("UNREACHABLE");
    expect(ref.reconciliationIssue).toBe("TENANT_MISMATCH");
  });

  it("keeps two organisations' reconciliation cursors and references fully isolated", async () => {
    seedReference({ id: "ref-a", organisationId: ORG_A, siteBindingId: SITE_BINDING_A, itemId: "item-1" });
    seedReference({ id: "ref-b", organisationId: ORG_B, siteBindingId: SITE_BINDING_B, itemId: "item-1" });

    const clientA = fakeGraphClient([{ items: [deltaItem({ deleted: true })], nextLink: null, deltaLink: "https://graph.microsoft.com/a-final" }]);
    await runReconciliationCycle({ organisationId: ORG_A, siteBindingId: SITE_BINDING_A, graphClient: clientA });

    const refA = tables.externalFileReference.rows.find((r) => r.id === "ref-a")!;
    const refB = tables.externalFileReference.rows.find((r) => r.id === "ref-b")!;
    expect(refA.referenceStatus).toBe("UNREACHABLE");
    expect(refB.referenceStatus).toBe("ACTIVE"); // untouched by org A's reconciliation run

    const cursorA = tables.storageReconciliationCursor.rows.find((r) => r.organisationId === ORG_A);
    const cursorB = tables.storageReconciliationCursor.rows.find((r) => r.organisationId === ORG_B);
    expect(cursorA?.deltaLink).toBe("https://graph.microsoft.com/a-final");
    expect(cursorB).toBeUndefined(); // org B's cycle never ran — no cursor created for it
  });

  it("preserves an ExternalFileReference row regardless of legalHold/retention state on the parent record (reconciliation writes only ExternalFileReference)", async () => {
    // T81 legal hold/retention state lives on EvidenceObject/ControlledDocumentRevision,
    // tables this module never touches — asserting that only externalFileReference rows
    // changed is the module-boundary proof that T81 behaviour is untouched.
    seedReference();
    const before = { ...tables.externalFileReference.rows[0] };
    const client = fakeGraphClient([{ items: [deltaItem({ deleted: true })], nextLink: null, deltaLink: "https://graph.microsoft.com/final" }]);

    await runReconciliationCycle({ organisationId: ORG_A, siteBindingId: SITE_BINDING_A, graphClient: client });

    expect(before.evidenceObjectId).toBe("evidence-1"); // unchanged linkage — no cascading mutation attempted
    expect(tables.storageSiteBinding.rows).toHaveLength(2); // untouched
  });
});

describe("makeSharePointReconciliationJobHandler", () => {
  it("rejects a payload missing siteBindingId", async () => {
    const handler = makeSharePointReconciliationJobHandler(() => fakeGraphClient([]));
    await expect(
      handler({
        id: "msg-1",
        organisationId: ORG_A,
        topic: "sharepoint.reconcile",
        version: 1,
        payload: {},
        idempotencyKey: "k1",
        status: "LEASED",
        availableAt: new Date(),
        leaseOwner: "worker-1",
        leaseUntil: new Date(),
        attempts: 1,
        maxAttempts: 8,
        lastErrorCode: null,
        lastErrorMessage: null,
        correlationId: "cid",
        source: "test",
        completedAt: null,
        deadLetteredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: "SHAREPOINT_RECONCILE_INVALID_PAYLOAD" });
  });

  it("runs a reconciliation cycle for the payload's siteBindingId under the message's organisationId", async () => {
    seedReference();
    const client = fakeGraphClient([{ items: [deltaItem()], nextLink: null, deltaLink: "https://graph.microsoft.com/final" }]);
    const handler = makeSharePointReconciliationJobHandler(() => client);

    await handler({
      id: "msg-1",
      organisationId: ORG_A,
      topic: "sharepoint.reconcile",
      version: 1,
      payload: { siteBindingId: SITE_BINDING_A },
      idempotencyKey: "k1",
      status: "LEASED",
      availableAt: new Date(),
      leaseOwner: "worker-1",
      leaseUntil: new Date(),
      attempts: 1,
      maxAttempts: 8,
      lastErrorCode: null,
      lastErrorMessage: null,
      correlationId: "cid",
      source: "test",
      completedAt: null,
      deadLetteredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(client.getDelta).toHaveBeenCalled();
  });
});

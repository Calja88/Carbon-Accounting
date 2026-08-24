/**
 * Organisation storage connection / external-file-reference service tests
 * (task SP01). No live database — Prisma is replaced with an in-memory
 * fake, matching the T22 `document-control-service.test.ts` pattern. Covers
 * the schema invariants SP01 requires: connection-admin permission gating
 * separate from document-content permissions, safe offboarding without
 * deletion, exactly-one-target on a reference, pin-once immutability, and
 * cross-tenant denial (Docs/PHASE1_ADVERSARIAL_TEST_MATRIX.md pattern).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

interface ConnectionRow {
  id: string;
  organisationId: string;
  provider: string;
  status: string;
  entraTenantId: string | null;
  applicationIdentityMode: string | null;
  connectedByUserId: string | null;
  connectedAt: Date | null;
  lastVerifiedAt: Date | null;
  disabledByUserId: string | null;
  disabledAt: Date | null;
  disabledReason: string | null;
}

interface SiteBindingRow {
  id: string;
  connectionId: string;
  organisationId: string;
  siteId: string;
  driveId: string;
  rootFolderId: string | null;
  rootFolderPath: string | null;
  label: string | null;
  status: string;
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

const { connections, siteBindings, references, evidenceObjects, revisions, resetTables, nextIdRef } = vi.hoisted(() => {
  const connections: ConnectionRow[] = [];
  const siteBindings: SiteBindingRow[] = [];
  const references: ReferenceRow[] = [];
  const evidenceObjects: { id: string; organisationId: string }[] = [];
  const revisions: { id: string; organisationId: string }[] = [];
  const nextIdRef = { n: 1 };
  function resetTables() {
    connections.length = 0;
    siteBindings.length = 0;
    references.length = 0;
    evidenceObjects.length = 0;
    revisions.length = 0;
    nextIdRef.n = 1;
  }
  return { connections, siteBindings, references, evidenceObjects, revisions, resetTables, nextIdRef };
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
    findUnique: vi.fn(async ({ where }: { where: { organisationId?: string; id?: string } }) => {
      if (where.organisationId) return connections.find((c) => c.organisationId === where.organisationId) ?? null;
      return connections.find((c) => c.id === where.id) ?? null;
    }),
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { organisationId: string };
        create: Partial<ConnectionRow>;
        update: Partial<ConnectionRow>;
      }) => {
        const existing = connections.find((c) => c.organisationId === where.organisationId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = {
          id: nextId("connection"),
          provider: "SHAREPOINT",
          disabledByUserId: null,
          disabledAt: null,
          disabledReason: null,
          lastVerifiedAt: null,
          ...create,
        } as ConnectionRow;
        connections.push(row);
        return row;
      },
    ),
    update: vi.fn(async ({ where, data }: { where: { organisationId: string }; data: Partial<ConnectionRow> }) => {
      const row = connections.find((c) => c.organisationId === where.organisationId);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const storageSiteBinding = {
    create: vi.fn(async ({ data }: { data: Partial<SiteBindingRow> }) => {
      const row = { id: nextId("binding"), status: "CONNECTED", rootFolderId: null, rootFolderPath: null, label: null, ...data } as SiteBindingRow;
      siteBindings.push(row);
      return row;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return siteBindings.find((b) => matches(b, where)) ?? null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<SiteBindingRow> }) => {
      const row = siteBindings.find((b) => b.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
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
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return references.find((r) => matches(r, where)) ?? null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ReferenceRow> }) => {
      const row = references.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const evidenceObject = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return evidenceObjects.find((e) => matches(e, where)) ?? null;
    }),
  };

  const controlledDocumentRevision = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return revisions.find((r) => matches(r, where)) ?? null;
    }),
  };

  const prisma = {
    organisationStorageConnection,
    storageSiteBinding,
    externalFileReference,
    evidenceObject,
    controlledDocumentRevision,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };

  return { prisma };
});

vi.mock("@/lib/repositories/audit-repository", () => ({
  recordAuditEvent: vi.fn(async () => ({ id: "audit-1" })),
}));

await import("@/lib/prisma");

const {
  connectStorage,
  disableStorage,
  addSiteBinding,
  disableSiteBinding,
  createExternalFileReference,
  pinExternalFileReference,
  markExternalFileReferenceStale,
  getStorageConnection,
  StorageConnectionError,
} = await import("@/lib/documents/storage/connection-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");

const manageContext = (organisationId: string) =>
  makeOrganisationContext(organisationId, {
    permissions: new Set(["ems.storage_connection.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
  });
const noPermissionContext = (organisationId: string) =>
  makeOrganisationContext(organisationId, { permissions: new Set() as unknown as ReturnType<typeof makeOrganisationContext>["permissions"] });
// Content-only permissions (ems.view / ems.controlled_document.manage) but NOT storage_connection.manage —
// proves connection administration is not implied by document-content access, and vice versa.
const documentContentOnlyContext = (organisationId: string) =>
  makeOrganisationContext(organisationId, {
    permissions: new Set(["ems.view", "ems.controlled_document.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
  });

beforeEach(() => {
  resetTables();
  vi.clearAllMocks();
});

describe("permission gating", () => {
  it("denies connectStorage without ems.storage_connection.manage", async () => {
    await expect(
      connectStorage(noPermissionContext(ORG_A), {
        entraTenantId: "tenant-a",
        applicationIdentityMode: "PARAGON_MULTI_TENANT",
        actorUserId: "user-1",
      }),
    ).rejects.toThrow();
  });

  it("denies connectStorage to a caller who only holds document-content permissions", async () => {
    await expect(
      connectStorage(documentContentOnlyContext(ORG_A), {
        entraTenantId: "tenant-a",
        applicationIdentityMode: "PARAGON_MULTI_TENANT",
        actorUserId: "user-1",
      }),
    ).rejects.toThrow();
  });
});

describe("connectStorage", () => {
  it("creates a connection with no credential fields, then reconnects the same row on a second call", async () => {
    const first = await connectStorage(manageContext(ORG_A), {
      entraTenantId: "tenant-a",
      applicationIdentityMode: "PARAGON_MULTI_TENANT",
      actorUserId: "user-1",
    });
    expect(first.status).toBe("CONNECTED");
    expect(Object.keys(first)).not.toContain("clientSecret");
    expect(Object.keys(first)).not.toContain("accessToken");

    const second = await connectStorage(manageContext(ORG_A), {
      entraTenantId: "tenant-a-2",
      applicationIdentityMode: "CUSTOMER_OWNED",
      actorUserId: "user-2",
    });
    expect(second.id).toBe(first.id);
    expect(connections.length).toBe(1);
    expect(second.entraTenantId).toBe("tenant-a-2");
  });
});

describe("disableStorage", () => {
  it("suspends/offboards without deleting the connection row", async () => {
    await connectStorage(manageContext(ORG_A), {
      entraTenantId: "tenant-a",
      applicationIdentityMode: "PARAGON_MULTI_TENANT",
      actorUserId: "user-1",
    });

    const offboarded = await disableStorage(manageContext(ORG_A), {
      status: "OFFBOARDED",
      reason: "Contract ended.",
      actorUserId: "user-1",
    });
    expect(offboarded.status).toBe("OFFBOARDED");
    expect(connections.length).toBe(1);
  });

  it("rejects disabling a connection that does not exist for this organisation", async () => {
    await expect(
      disableStorage(manageContext(ORG_A), { status: "SUSPENDED", reason: "test", actorUserId: "user-1" }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

async function connectAndBind(organisationId: string) {
  await connectStorage(manageContext(organisationId), {
    entraTenantId: `tenant-${organisationId}`,
    applicationIdentityMode: "PARAGON_MULTI_TENANT",
    actorUserId: "user-1",
  });
  return addSiteBinding(manageContext(organisationId), {
    siteId: `site-${organisationId}`,
    driveId: `drive-${organisationId}`,
    label: "EMS Controlled Documents",
    actorUserId: "user-1",
  });
}

describe("addSiteBinding / disableSiteBinding", () => {
  it("adds a binding and can suspend it without touching its file references", async () => {
    const binding = await connectAndBind(ORG_A);
    expect(binding.organisationId).toBe(ORG_A);

    const suspended = await disableSiteBinding(manageContext(ORG_A), {
      siteBindingId: binding.id,
      status: "SUSPENDED",
      actorUserId: "user-1",
    });
    expect(suspended.status).toBe("SUSPENDED");
    expect(siteBindings.length).toBe(1);
  });

  it("denies binding a site to an organisation with no connection yet", async () => {
    await expect(
      addSiteBinding(manageContext(ORG_A), { siteId: "site-x", driveId: "drive-x", actorUserId: "user-1" }),
    ).rejects.toThrow(StorageConnectionError);
  });

  it("denies a cross-tenant caller from disabling another organisation's site binding", async () => {
    const bindingA = await connectAndBind(ORG_A);
    await expect(
      disableSiteBinding(manageContext(ORG_B), { siteBindingId: bindingA.id, status: "SUSPENDED", actorUserId: "user-b" }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

describe("createExternalFileReference", () => {
  it("requires exactly one of evidenceObjectId/controlledDocumentRevisionId", async () => {
    const binding = await connectAndBind(ORG_A);
    evidenceObjects.push({ id: "evidence-1", organisationId: ORG_A });
    revisions.push({ id: "revision-1", organisationId: ORG_A });

    await expect(
      createExternalFileReference(manageContext(ORG_A), {
        siteBindingId: binding.id,
        itemId: "item-1",
        versionId: "v1",
        checksumSha256: "a".repeat(64),
        actorUserId: "user-1",
      }),
    ).rejects.toThrow(/exactly one/);

    await expect(
      createExternalFileReference(manageContext(ORG_A), {
        siteBindingId: binding.id,
        evidenceObjectId: "evidence-1",
        controlledDocumentRevisionId: "revision-1",
        itemId: "item-1",
        versionId: "v1",
        checksumSha256: "a".repeat(64),
        actorUserId: "user-1",
      }),
    ).rejects.toThrow(/exactly one/);
  });

  it("creates a draft reference targeting a single EvidenceObject", async () => {
    const binding = await connectAndBind(ORG_A);
    evidenceObjects.push({ id: "evidence-1", organisationId: ORG_A });

    const reference = await createExternalFileReference(manageContext(ORG_A), {
      siteBindingId: binding.id,
      evidenceObjectId: "evidence-1",
      itemId: "item-1",
      versionId: "v1",
      checksumSha256: "a".repeat(64),
      actorUserId: "user-1",
    });
    expect(reference.pinnedAt).toBeNull();
    expect(reference.referenceStatus).toBe("ACTIVE");
  });

  it("denies referencing another organisation's EvidenceObject", async () => {
    const binding = await connectAndBind(ORG_A);
    evidenceObjects.push({ id: "evidence-b", organisationId: ORG_B });

    await expect(
      createExternalFileReference(manageContext(ORG_A), {
        siteBindingId: binding.id,
        evidenceObjectId: "evidence-b",
        itemId: "item-1",
        versionId: "v1",
        checksumSha256: "a".repeat(64),
        actorUserId: "user-1",
      }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

describe("pinExternalFileReference", () => {
  async function makeDraftReference() {
    const binding = await connectAndBind(ORG_A);
    evidenceObjects.push({ id: "evidence-1", organisationId: ORG_A });
    return createExternalFileReference(manageContext(ORG_A), {
      siteBindingId: binding.id,
      evidenceObjectId: "evidence-1",
      itemId: "item-1",
      versionId: "v1",
      checksumSha256: "a".repeat(64),
      actorUserId: "user-1",
    });
  }

  it("pins a draft reference to its current exact version", async () => {
    const reference = await makeDraftReference();
    const pinned = await pinExternalFileReference(manageContext(ORG_A), {
      referenceId: reference.id,
      versionId: "v2-at-approval",
      checksumSha256: "b".repeat(64),
      actorUserId: "user-1",
    });
    expect(pinned.pinnedAt).not.toBeNull();
    expect(pinned.versionId).toBe("v2-at-approval");
  });

  it("never lets a second pin call overwrite an already-issued version (SP00 §7 hard invariant)", async () => {
    const reference = await makeDraftReference();
    await pinExternalFileReference(manageContext(ORG_A), {
      referenceId: reference.id,
      versionId: "v2-at-approval",
      checksumSha256: "b".repeat(64),
      actorUserId: "user-1",
    });

    await expect(
      pinExternalFileReference(manageContext(ORG_A), {
        referenceId: reference.id,
        versionId: "v3-newer-edit",
        checksumSha256: "c".repeat(64),
        actorUserId: "user-1",
      }),
    ).rejects.toThrow(StorageConnectionError);

    const stored = references.find((r) => r.id === reference.id);
    expect(stored?.versionId).toBe("v2-at-approval");
  });
});

describe("markExternalFileReferenceStale", () => {
  it("marks a pinned reference stale without touching its pinned identity fields", async () => {
    const binding = await connectAndBind(ORG_A);
    evidenceObjects.push({ id: "evidence-1", organisationId: ORG_A });
    const reference = await createExternalFileReference(manageContext(ORG_A), {
      siteBindingId: binding.id,
      evidenceObjectId: "evidence-1",
      itemId: "item-1",
      versionId: "v1",
      checksumSha256: "a".repeat(64),
      actorUserId: "user-1",
    });
    await pinExternalFileReference(manageContext(ORG_A), {
      referenceId: reference.id,
      versionId: "v2-at-approval",
      checksumSha256: "b".repeat(64),
      actorUserId: "user-1",
    });

    const marked = await markExternalFileReferenceStale(manageContext(ORG_A), {
      referenceId: reference.id,
      status: "UNREACHABLE",
      reason: "Site moved outside granted scope.",
      actorUserId: "user-1",
    });
    expect(marked.referenceStatus).toBe("UNREACHABLE");
    expect(marked.versionId).toBe("v2-at-approval");
    expect(marked.itemId).toBe("item-1");
  });
});

describe("cross-tenant isolation", () => {
  it("denies a foreign-tenant caller reading the connection at all", async () => {
    await connectStorage(manageContext(ORG_A), {
      entraTenantId: "tenant-a",
      applicationIdentityMode: "PARAGON_MULTI_TENANT",
      actorUserId: "user-1",
    });
    const foreignRead = await getStorageConnection(manageContext(ORG_B));
    expect(foreignRead).toBeNull();
  });

  it("denies a foreign-tenant caller pinning another organisation's reference", async () => {
    const binding = await connectAndBind(ORG_A);
    evidenceObjects.push({ id: "evidence-1", organisationId: ORG_A });
    const reference = await createExternalFileReference(manageContext(ORG_A), {
      siteBindingId: binding.id,
      evidenceObjectId: "evidence-1",
      itemId: "item-1",
      versionId: "v1",
      checksumSha256: "a".repeat(64),
      actorUserId: "user-1",
    });

    await expect(
      pinExternalFileReference(manageContext(ORG_B), {
        referenceId: reference.id,
        versionId: "v2",
        checksumSha256: "b".repeat(64),
        actorUserId: "user-b",
      }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

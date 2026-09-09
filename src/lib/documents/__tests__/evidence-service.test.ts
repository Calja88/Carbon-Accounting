/**
 * Shared evidence-object service tests (task T22). No live database —
 * Prisma and the storage/malware-scan modules are faked in-memory. Covers
 * the T22 acceptance criteria most likely to regress silently: tenant
 * isolation, classification-gated download, and a non-CLEAN scan blocking
 * download of an infected file.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

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
  retentionCategory: string;
  retentionUntil: Date | null;
  legalHold: boolean;
  malwareScanStatus: string;
  malwareScannedAt: Date | null;
  malwareScanner: string | null;
  uploadedByUserId: string | null;
}

const { rows, blobs, resetTables, nextIdRef } = vi.hoisted(() => {
  const rows: EvidenceRow[] = [];
  const blobs = new Map<string, Buffer>();
  const nextIdRef = { n: 1 };
  function resetTables() {
    rows.length = 0;
    blobs.clear();
    nextIdRef.n = 1;
  }
  return { rows, blobs, resetTables, nextIdRef };
});

function nextId(): string {
  return `evidence-${nextIdRef.n++}`;
}

const evidenceLinks: { id: string; evidenceId: string; organisationId: string; resourceType: string; resourceId: string }[] = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    controlledDocumentRevision: { findMany: vi.fn(async () => []) },
    evidenceObject: {
      create: vi.fn(async ({ data }: { data: Partial<EvidenceRow> }) => {
        const row = {
          id: nextId(),
          storageProvider: null,
          storageKey: null,
          retentionUntil: null,
          legalHold: false,
          malwareScannedAt: null,
          malwareScanner: null,
          uploadedByUserId: null,
          ...data,
        } as EvidenceRow;
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<EvidenceRow> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return rows.find((r) => Object.entries(where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)) ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return rows.filter((r) =>
          Object.entries(where).every(([k, v]) => {
            if (v && typeof v === "object" && "in" in v) return (v as { in: unknown[] }).in.includes((r as unknown as Record<string, unknown>)[k]);
            if (v && typeof v === "object" && "contains" in (v as Record<string, unknown>)) {
              const needle = String((v as { contains: unknown }).contains).toLowerCase();
              return String((r as unknown as Record<string, unknown>)[k]).toLowerCase().includes(needle);
            }
            return (r as unknown as Record<string, unknown>)[k] === v;
          }),
        ).map(r => ({ ...r, controlledDocumentRevision: null, links: evidenceLinks.filter(l => l.evidenceId === r.id) }));
      }),
    },
    evidenceLink: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return evidenceLinks.filter((l) => Object.entries(where).every(([k, v]) => (l as unknown as Record<string, unknown>)[k] === v));
      }),
    },
    evidenceObjectBlob: {
      upsert: vi.fn(async ({ where, create }: { where: { evidenceObjectId: string }; create: { data: Uint8Array } }) => {
        blobs.set(where.evidenceObjectId, Buffer.from(create.data));
      }),
      findUnique: vi.fn(async ({ where }: { where: { evidenceObjectId: string } }) => {
        const data = blobs.get(where.evidenceObjectId);
        return data ? { data } : null;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { evidenceObjectId: string } }) => {
        blobs.delete(where.evidenceObjectId);
      }),
    },
  },
}));

const {
  uploadEvidenceObject,
  readEvidenceObjectBytes,
  EvidenceError,
  isKnownEvidenceLinkResourceType,
  listEvidenceObjects,
  listLinksForEvidenceObject,
  activeEvidenceStorageProviderName,
} = await import("@/lib/documents/evidence-service");
const { resetMalwareScanner, registerMalwareScanner } = await import("@/lib/documents/malware-scan");

const orgContextA = makeOrganisationContext(ORG_A, {
  permissions: new Set(["ems.view", "ems.controlled_document.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});
const orgContextB = makeOrganisationContext(ORG_B, { permissions: new Set(["ems.view"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"] });
const orgContextANoManage = makeOrganisationContext(ORG_A, { permissions: new Set(["ems.view"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"] });

beforeEach(() => {
  resetTables();
  evidenceLinks.length = 0;
  resetMalwareScanner();
  vi.clearAllMocks();
});

describe("uploadEvidenceObject", () => {
  it("allows T31 environmental aspects as evidence-link targets", () => {
    expect(isKnownEvidenceLinkResourceType("environmental_aspect")).toBe(true);
  });

  it("rejects an empty file", async () => {
    await expect(
      uploadEvidenceObject(orgContextA, {
        fileName: "empty.txt",
        mimeType: "text/plain",
        bytes: Buffer.from(""),
        uploadedByUserId: "user-1",
      }),
    ).rejects.toThrow(EvidenceError);
  });

  it("rejects a disallowed MIME type", async () => {
    await expect(
      uploadEvidenceObject(orgContextA, {
        fileName: "app.exe",
        mimeType: "application/x-msdownload",
        bytes: Buffer.from("synthetic"),
        uploadedByUserId: "user-1",
      }),
    ).rejects.toThrow(EvidenceError);
  });

  it("stores bytes, checksum, and always runs the malware-scanning interface (SKIPPED by default in dev)", async () => {
    const evidence = await uploadEvidenceObject(orgContextA, {
      fileName: "policy.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("synthetic policy content"),
      uploadedByUserId: "user-1",
    });
    expect(evidence.organisationId).toBe(ORG_A);
    expect(evidence.checksumSha256).toHaveLength(64);
    expect(evidence.malwareScanStatus).toBe("SKIPPED");
    expect(evidence.storageProvider).toBe("database");
  });
});

describe("readEvidenceObjectBytes — tenant and classification scoping", () => {
  it("returns bytes for the uploading organisation", async () => {
    const evidence = await uploadEvidenceObject(orgContextA, {
      fileName: "policy.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("synthetic policy content"),
      uploadedByUserId: "user-1",
    });
    const result = await readEvidenceObjectBytes(orgContextA, evidence.id);
    expect(result?.bytes.toString()).toBe("synthetic policy content");
  });

  it("denies a foreign-tenant caller identically to a missing id", async () => {
    const evidence = await uploadEvidenceObject(orgContextA, {
      fileName: "policy.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("synthetic policy content"),
      uploadedByUserId: "user-1",
    });
    await expect(readEvidenceObjectBytes(orgContextB, evidence.id)).resolves.toBeNull();
    await expect(readEvidenceObjectBytes(orgContextB, "does-not-exist")).resolves.toBeNull();
  });

  it("denies a RESTRICTED classification download without the controlled-document manage permission", async () => {
    const evidence = await uploadEvidenceObject(orgContextA, {
      fileName: "restricted.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("synthetic restricted content"),
      classification: "RESTRICTED",
      uploadedByUserId: "user-1",
    });
    await expect(readEvidenceObjectBytes(orgContextANoManage, evidence.id)).resolves.toBeNull();
    await expect(readEvidenceObjectBytes(orgContextA, evidence.id)).resolves.not.toBeNull();
  });

  it("blocks download once a scanner marks the file INFECTED", async () => {
    registerMalwareScanner({ name: "fake", scan: async () => ({ status: "INFECTED", scannerName: "fake" }) });
    const evidence = await uploadEvidenceObject(orgContextA, {
      fileName: "bad.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("synthetic infected content"),
      uploadedByUserId: "user-1",
    });
    expect(evidence.malwareScanStatus).toBe("INFECTED");
    await expect(readEvidenceObjectBytes(orgContextA, evidence.id)).resolves.toBeNull();
  });
});

describe("listEvidenceObjects — evidence hub (task UI03)", () => {
  it("only lists the calling organisation's evidence, optionally filtered by filename", async () => {
    await uploadEvidenceObject(orgContextA, {
      fileName: "policy.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("synthetic policy content"),
      uploadedByUserId: "user-1",
    });
    await uploadEvidenceObject(orgContextA, {
      fileName: "procedure.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("synthetic procedure content"),
      uploadedByUserId: "user-1",
    });
    await uploadEvidenceObject(orgContextB, {
      fileName: "other-org.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("synthetic other-org content"),
      uploadedByUserId: "user-2",
    });

    const all = await listEvidenceObjects(orgContextA);
    expect(all.map((e) => e.filename).sort()).toEqual(["policy.pdf", "procedure.pdf"]);

    const filtered = await listEvidenceObjects(orgContextA, { search: "policy" });
    expect(filtered.map((e) => e.filename)).toEqual(["policy.pdf"]);
  });
});

describe("listLinksForEvidenceObject — tenant scoping", () => {
  it("denies a foreign-tenant evidence id identically to a missing one", async () => {
    const evidence = await uploadEvidenceObject(orgContextA, {
      fileName: "policy.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("synthetic policy content"),
      uploadedByUserId: "user-1",
    });
    await expect(listLinksForEvidenceObject(orgContextB, evidence.id)).rejects.toThrow();
  });
});

describe("activeEvidenceStorageProviderName", () => {
  it("reports the built-in database provider until a SharePoint provider is registered (SP01+)", () => {
    expect(activeEvidenceStorageProviderName()).toBe("database");
  });
});

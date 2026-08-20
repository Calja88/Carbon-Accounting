/** T81 retention service tests. All records are synthetic. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

const tables = vi.hoisted(() => ({
  evidence: [] as Record<string, unknown>[],
  blobs: [] as Record<string, unknown>[],
  holds: [] as Record<string, unknown>[],
  nextId: 1,
}));
const storageMocks = vi.hoisted(() => ({ remove: vi.fn(async () => undefined) }));

function id(prefix: string) {
  return `${prefix}-${tables.nextId++}`;
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => {
    if (value === null) return row[key] === null || row[key] === undefined;
    if (value && typeof value === "object" && "lt" in (value as Record<string, unknown>)) {
      const rowValue = row[key];
      return rowValue instanceof Date && rowValue < (value as { lt: Date }).lt;
    }
    if (value && typeof value === "object" && "OR" in (value as Record<string, unknown>)) return true;
    return row[key] === value;
  });
}

vi.mock("@/lib/prisma", () => {
  const evidenceObject = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => tables.evidence.find((row) => matches(row, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => tables.evidence.filter((row) => matches(row, where))),
    update: vi.fn(async ({ where, data }: { where: { organisationId_id: { organisationId: string; id: string } }; data: Record<string, unknown> }) => {
      const row = tables.evidence.find((item) => item.id === where.organisationId_id.id && item.organisationId === where.organisationId_id.organisationId);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };
  const evidenceObjectBlob = {
    deleteMany: vi.fn(async ({ where }: { where: { evidenceObjectId: string } }) => {
      const before = tables.blobs.length;
      tables.blobs = tables.blobs.filter((row) => row.evidenceObjectId !== where.evidenceObjectId);
      return { count: before - tables.blobs.length };
    }),
  };
  const legalHold = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.OR) {
        const clauses = where.OR as Record<string, unknown>[];
        return (
          tables.holds.find(
            (row) => row.organisationId === where.organisationId && row.status === where.status && clauses.some((clause) => matches(row, clause)),
          ) ?? null
        );
      }
      return tables.holds.find((row) => matches(row, where)) ?? null;
    }),
  };
  const prismaClient = {
    evidenceObject,
    evidenceObjectBlob,
    legalHold,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-1" })) }));
vi.mock("@/lib/documents/storage/provider", () => ({
  documentEvidenceStorage: { active: () => storageMocks, forKey: () => storageMocks },
}));

const { previewRetention, executeRetention, RetentionError } = await import("@/lib/retention/retention-service");

const managerContextA = makeOrganisationContext(ORG_A, {
  userId: "synthetic-manager-a",
  permissions: new Set(["organisation.retention.manage"]) as never,
});
const noPermContextA = makeOrganisationContext(ORG_A, {
  userId: "synthetic-nobody-a",
  permissions: new Set([]) as never,
});

const PAST = new Date("2020-01-01T00:00:00Z");
const FUTURE = new Date("2999-01-01T00:00:00Z");

function evidenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: id("evidence"),
    organisationId: ORG_A,
    filename: "synthetic-invoice.pdf",
    retentionUntil: PAST,
    legalHold: false,
    retentionTombstonedAt: null,
    storageKey: "storage-key-1",
    storageProvider: null,
    ...overrides,
  };
}

beforeEach(() => {
  tables.evidence.length = 0;
  tables.blobs.length = 0;
  tables.holds.length = 0;
  tables.nextId = 1;
  vi.clearAllMocks();
});

describe("previewRetention", () => {
  it("denies a caller without organisation.retention.manage", async () => {
    await expect(previewRetention(noPermContextA, "EVIDENCE")).rejects.toThrow();
  });

  it("refuses a non-executable record class", async () => {
    await expect(previewRetention(managerContextA, "IMMUTABLE_ISSUED")).rejects.toThrow(RetentionError);
    await expect(previewRetention(managerContextA, "TELEMETRY_AUDIT")).rejects.toThrow(RetentionError);
  });

  it("lists only past-retentionUntil, non-held, non-tombstoned evidence for this organisation", async () => {
    const eligible = tables.evidence[tables.evidence.push(evidenceRow()) - 1];
    tables.evidence.push(evidenceRow({ retentionUntil: FUTURE })); // not due yet
    tables.evidence.push(evidenceRow({ legalHold: true })); // per-row hold flag
    tables.evidence.push(evidenceRow({ retentionTombstonedAt: new Date() })); // already tombstoned
    tables.evidence.push(evidenceRow({ organisationId: ORG_B })); // foreign tenant

    const preview = await previewRetention(managerContextA, "EVIDENCE");
    expect(preview.count).toBe(1);
    expect(preview.items.map((i) => i.id)).toEqual([eligible.id]);
  });

  it("excludes a row covered by an active generic LegalHold, resource-specific or organisation-wide", async () => {
    const held = evidenceRow();
    const orgWideHeld = evidenceRow();
    tables.evidence.push(held, orgWideHeld);
    tables.holds.push({ id: "hold-1", organisationId: ORG_A, status: "ACTIVE", resourceType: "evidence_object", resourceId: held.id, reason: "x" });
    tables.holds.push({ id: "hold-2", organisationId: ORG_A, status: "ACTIVE", resourceType: null, resourceId: null, reason: "org-wide" });

    const preview = await previewRetention(managerContextA, "EVIDENCE");
    expect(preview.count).toBe(0);
  });
});

describe("executeRetention", () => {
  it("denies a caller without organisation.retention.manage", async () => {
    await expect(executeRetention(noPermContextA, "EVIDENCE", ["e-1"], "u")).rejects.toThrow();
  });

  it("tombstones eligible evidence: removes bytes/blob, stamps retentionTombstonedAt, keeps the metadata row", async () => {
    const row = evidenceRow();
    tables.evidence.push(row);
    tables.blobs.push({ id: "blob-1", evidenceObjectId: row.id });

    const result = await executeRetention(managerContextA, "EVIDENCE", [row.id], "synthetic-manager-a");

    expect(result.tombstonedIds).toEqual([row.id]);
    expect(result.skippedHeldIds).toEqual([]);
    expect(storageMocks.remove).toHaveBeenCalledWith("storage-key-1");
    expect(tables.blobs).toHaveLength(0);
    const updated = tables.evidence.find((r) => r.id === row.id) as Record<string, unknown>;
    expect(updated.retentionTombstonedAt).toBeInstanceOf(Date);
    expect(updated.storageKey).toBeNull();
    expect(updated.filename).toBe("synthetic-invoice.pdf"); // metadata survives the tombstone
  });

  it("re-checks eligibility at execution time — a hold placed after preview still blocks deletion", async () => {
    const row = evidenceRow();
    tables.evidence.push(row);
    tables.holds.push({ id: "hold-late", organisationId: ORG_A, status: "ACTIVE", resourceType: "evidence_object", resourceId: row.id, reason: "late hold" });

    const result = await executeRetention(managerContextA, "EVIDENCE", [row.id], "synthetic-manager-a");

    expect(result.tombstonedIds).toEqual([]);
    expect(result.skippedHeldIds).toEqual([row.id]);
    expect(storageMocks.remove).not.toHaveBeenCalled();
    const untouched = tables.evidence.find((r) => r.id === row.id) as Record<string, unknown>;
    expect(untouched.retentionTombstonedAt).toBeNull();
  });

  it("never re-checks a per-row legalHold=true flag as eligible, even if passed explicitly", async () => {
    const row = evidenceRow({ legalHold: true });
    tables.evidence.push(row);
    const result = await executeRetention(managerContextA, "EVIDENCE", [row.id], "synthetic-manager-a");
    expect(result.skippedHeldIds).toEqual([row.id]);
  });

  it("is idempotent — executing an already-tombstoned id again is a no-op, not an error", async () => {
    const row = evidenceRow({ retentionTombstonedAt: new Date("2021-01-01") });
    tables.evidence.push(row);
    const result = await executeRetention(managerContextA, "EVIDENCE", [row.id], "synthetic-manager-a");
    expect(result.tombstonedIds).toEqual([]);
    expect(result.skippedHeldIds).toEqual([row.id]);
  });

  it("never touches a foreign-organisation evidence id, even if the caller passes it directly", async () => {
    const foreign = evidenceRow({ organisationId: ORG_B });
    tables.evidence.push(foreign);
    const result = await executeRetention(managerContextA, "EVIDENCE", [foreign.id], "synthetic-manager-a");
    expect(result.tombstonedIds).toEqual([]);
    expect(result.skippedHeldIds).toEqual([foreign.id]);
    const untouched = tables.evidence.find((r) => r.id === foreign.id) as Record<string, unknown>;
    expect(untouched.retentionTombstonedAt).toBeNull();
  });
});

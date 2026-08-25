/**
 * SP07 apply-path tests. All records are synthetic; the "provider" here is
 * an in-memory fake, never a real Microsoft Graph/SharePoint call.
 */

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantRepositoryContext } from "@/lib/repositories/context";
import { assertApplySafetyPreconditions } from "@/lib/documents/storage/migration/evidence-migration-apply";
import type { EvidenceStorageProvider } from "@/lib/documents/storage/provider";

const tables = vi.hoisted(() => ({
  evidence: [] as Record<string, unknown>[],
  externalFileReferences: [] as Record<string, unknown>[],
  auditCalls: [] as unknown[],
}));

vi.mock("@/lib/prisma", () => {
  const evidenceObject = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      tables.evidence.find((row) => row.id === where.id && row.organisationId === where.organisationId) ?? null,
    ),
    update: vi.fn(async ({ where, data }: { where: { organisationId_id: { organisationId: string; id: string } }; data: Record<string, unknown> }) => {
      const row = tables.evidence.find(
        (item) => item.id === where.organisationId_id.id && item.organisationId === where.organisationId_id.organisationId,
      );
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };
  const externalFileReference = {
    findUnique: vi.fn(async ({ where }: { where: { evidenceObjectId: string } }) =>
      tables.externalFileReferences.find((row) => row.evidenceObjectId === where.evidenceObjectId) ?? null,
    ),
  };
  const prismaClient = {
    evidenceObject,
    externalFileReference,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({
  recordAuditEvent: vi.fn(async (_tx: unknown, _ctx: unknown, input: unknown) => {
    tables.auditCalls.push(input);
    return { id: "audit-1" };
  }),
}));

const { applyEvidenceObjectMigration } = await import("@/lib/documents/storage/migration/evidence-migration-apply");

function makeProvider(overrides: Partial<EvidenceStorageProvider> = {}): EvidenceStorageProvider {
  return {
    name: "sharepoint",
    put: vi.fn(async ({ evidenceId }) => {
      tables.externalFileReferences.push({
        evidenceObjectId: evidenceId,
        checksumSha256: (tables.evidence.find((e) => e.id === evidenceId) as { checksumSha256: string }).checksumSha256,
        itemId: "item-1",
        versionId: "1.0",
        pinnedAt: new Date(),
      });
      return { storageProvider: "sharepoint", storageKey: evidenceId };
    }),
    get: vi.fn(async () => null),
    remove: vi.fn(async () => undefined),
    ...overrides,
  };
}

const SYNTHETIC_BYTES = Buffer.from("synthetic!!!");
const SYNTHETIC_CHECKSUM = createHash("sha256").update(SYNTHETIC_BYTES).digest("hex");

function evidenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evidence-1",
    organisationId: "org-a",
    filename: "synthetic-source.txt",
    mimeType: "text/plain",
    byteSize: 12,
    checksumSha256: SYNTHETIC_CHECKSUM,
    storageProvider: null,
    legalHold: false,
    retentionTombstonedAt: null,
    malwareScanStatus: "CLEAN",
    blob: { data: Buffer.from("synthetic!!!") },
    ...overrides,
  };
}

const ctx = createTenantRepositoryContext({ organisationId: "org-a", userId: "system", correlationId: "test-correlation" });

beforeEach(() => {
  tables.evidence = [];
  tables.externalFileReferences = [];
  tables.auditCalls = [];
});

describe("assertApplySafetyPreconditions", () => {
  it("refuses without an organisation id", () => {
    const result = assertApplySafetyPreconditions({
      organisationId: null,
      storageConnectionStatus: "CONNECTED",
      activeSiteBindingId: "b1",
      batchSize: 10,
      confirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes("organisation"))).toBe(true);
  });

  it("refuses when the storage connection is not CONNECTED", () => {
    const result = assertApplySafetyPreconditions({
      organisationId: "org-a",
      storageConnectionStatus: "SUSPENDED",
      activeSiteBindingId: "b1",
      batchSize: 10,
      confirmed: true,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses without --confirm even if --apply was passed", () => {
    const result = assertApplySafetyPreconditions({
      organisationId: "org-a",
      storageConnectionStatus: "CONNECTED",
      activeSiteBindingId: "b1",
      batchSize: 10,
      confirmed: false,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes("--confirm"))).toBe(true);
  });

  it("refuses a batch size above the bounded maximum", () => {
    const result = assertApplySafetyPreconditions({
      organisationId: "org-a",
      storageConnectionStatus: "CONNECTED",
      activeSiteBindingId: "b1",
      batchSize: 10_000,
      confirmed: true,
      maxBatchSize: 500,
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a fully-satisfied set of preconditions", () => {
    const result = assertApplySafetyPreconditions({
      organisationId: "org-a",
      storageConnectionStatus: "CONNECTED",
      activeSiteBindingId: "b1",
      batchSize: 10,
      confirmed: true,
    });
    expect(result).toEqual({ ok: true, reasons: [] });
  });
});

describe("applyEvidenceObjectMigration", () => {
  it("migrates a clean database-backed evidence object and records an audit event, keeping the source blob", async () => {
    tables.evidence.push(evidenceRow());
    const provider = makeProvider();

    const outcome = await applyEvidenceObjectMigration(ctx, "evidence-1", provider);

    expect(outcome.status).toBe("migrated");
    expect(provider.put).toHaveBeenCalledTimes(1);
    const row = tables.evidence[0];
    expect(row.storageProvider).toBe("sharepoint");
    expect(row.blob).toBeDefined(); // source bytes retained, not deleted by apply
    expect(tables.auditCalls).toHaveLength(1);
    expect(tables.auditCalls[0]).toMatchObject({ eventType: "evidence_object.migrated_to_sharepoint" });
  });

  it("is idempotent: re-running on an already-migrated item is a no-op that never calls the provider again", async () => {
    tables.evidence.push(evidenceRow({ storageProvider: "sharepoint" }));
    const provider = makeProvider();

    const outcome = await applyEvidenceObjectMigration(ctx, "evidence-1", provider);

    expect(outcome).toEqual({ status: "already_migrated", evidenceObjectId: "evidence-1" });
    expect(provider.put).not.toHaveBeenCalled();
  });

  it("resumes an interrupted batch: reuses an existing pinned reference instead of re-uploading", async () => {
    const row = evidenceRow();
    tables.evidence.push(row);
    tables.externalFileReferences.push({ evidenceObjectId: "evidence-1", checksumSha256: row.checksumSha256 });
    const provider = makeProvider();

    const outcome = await applyEvidenceObjectMigration(ctx, "evidence-1", provider);

    expect(outcome.status).toBe("migrated");
    expect(provider.put).not.toHaveBeenCalled();
    expect(tables.evidence[0].storageProvider).toBe("sharepoint");
  });

  it("refuses an item under legal hold and performs no write", async () => {
    tables.evidence.push(evidenceRow({ legalHold: true }));
    const provider = makeProvider();

    const outcome = await applyEvidenceObjectMigration(ctx, "evidence-1", provider);

    expect(outcome).toEqual({ status: "refused", evidenceObjectId: "evidence-1", reason: "legal_hold" });
    expect(provider.put).not.toHaveBeenCalled();
    expect(tables.evidence[0].storageProvider).toBeNull();
  });

  it("refuses a tombstoned item", async () => {
    tables.evidence.push(evidenceRow({ retentionTombstonedAt: new Date("2024-01-01T00:00:00Z") }));
    const provider = makeProvider();

    const outcome = await applyEvidenceObjectMigration(ctx, "evidence-1", provider);
    expect(outcome).toEqual({ status: "refused", evidenceObjectId: "evidence-1", reason: "tombstoned" });
  });

  it("refuses on checksum mismatch between the stored bytes and the recorded checksum", async () => {
    tables.evidence.push(evidenceRow({ checksumSha256: "f".repeat(64) })); // does not match hash of "synthetic!!!"
    const provider = makeProvider();

    const outcome = await applyEvidenceObjectMigration(ctx, "evidence-1", provider);
    expect(outcome).toEqual({ status: "refused", evidenceObjectId: "evidence-1", reason: "checksum_mismatch_before_upload" });
    expect(provider.put).not.toHaveBeenCalled();
  });

  it("refuses when the provider errors, and never marks the item migrated on failure", async () => {
    tables.evidence.push(evidenceRow());
    const provider = makeProvider({ put: vi.fn(async () => { throw new Error("synthetic Graph outage"); }) });

    await expect(applyEvidenceObjectMigration(ctx, "evidence-1", provider)).rejects.toThrow("synthetic Graph outage");
    expect(tables.evidence[0].storageProvider).toBeNull();
  });

  it("refuses cross-tenant access: an evidence id from another organisation is not found", async () => {
    tables.evidence.push(evidenceRow({ organisationId: "org-b" }));
    const provider = makeProvider();

    const outcome = await applyEvidenceObjectMigration(ctx, "evidence-1", provider);
    expect(outcome).toEqual({ status: "refused", evidenceObjectId: "evidence-1", reason: "not_found_in_organisation" });
    expect(provider.put).not.toHaveBeenCalled();
  });
});

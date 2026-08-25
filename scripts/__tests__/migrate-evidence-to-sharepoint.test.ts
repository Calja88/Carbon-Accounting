/**
 * SP07 CLI-level proof that the default (dry-run) mode never writes.
 * The injected fake Prisma client's write methods throw if called, so any
 * accidental write during dry-run planning fails the test immediately.
 * `--apply` is exercised separately by `evidence-migration-apply.test.ts`
 * (unit-level) — this file only proves the *default* path is read-only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { legalHold: { findFirst: vi.fn(async () => null) } },
}));

const { parseArgs, run } = await import("../migrate-evidence-to-sharepoint");

function refuseWrite(name: string) {
  return vi.fn(async () => {
    throw new Error(`unexpected write call: ${name}`);
  });
}

function makeReadOnlyPrismaFake() {
  return {
    evidenceObject: {
      findMany: vi.fn(async () => [
        {
          id: "evidence-1",
          storageProvider: null,
          byteSize: 10,
          mimeType: "text/plain",
          checksumSha256: "a".repeat(64),
          malwareScanStatus: "CLEAN",
          legalHold: false,
          retentionTombstonedAt: null,
          retentionUntil: null,
          controlledDocumentRevision: null,
          externalFileReference: null,
          blob: { id: "blob-1" },
          links: [],
        },
      ]),
      update: refuseWrite("evidenceObject.update"),
      create: refuseWrite("evidenceObject.create"),
      delete: refuseWrite("evidenceObject.delete"),
    },
    lcaEvidence: { findMany: vi.fn(async () => []) },
    controlledDocumentRevision: { findMany: vi.fn(async () => []) },
    organisationStorageConnection: {
      findUnique: vi.fn(async () => ({ status: "CONNECTED", siteBindings: [{ id: "binding-1" }] })),
    },
    externalFileReference: { create: refuseWrite("externalFileReference.create"), update: refuseWrite("externalFileReference.update") },
    $transaction: vi.fn(async () => {
      throw new Error("unexpected write call: $transaction");
    }),
  };
}

describe("migrate-evidence-to-sharepoint CLI", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("parses --organisation as required and defaults to dry-run", () => {
    const args = parseArgs(["--organisation", "org-a"]);
    expect(args).toMatchObject({ organisationId: "org-a", apply: false, confirm: false });
  });

  it("throws when --organisation is missing", () => {
    expect(() => parseArgs([])).toThrow(/--organisation/);
  });

  it("default (dry-run) mode never calls a write method and prints a report", async () => {
    const prisma = makeReadOnlyPrismaFake();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await run(prisma as any, { organisationId: "org-a", apply: false, confirm: false, batchSize: 25, limit: 100 });

    expect(prisma.evidenceObject.update).not.toHaveBeenCalled();
    expect(prisma.evidenceObject.create).not.toHaveBeenCalled();
    expect(prisma.evidenceObject.delete).not.toHaveBeenCalled();
    expect(prisma.externalFileReference.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();

    expect(logSpy).toHaveBeenCalledTimes(1);
    const printed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(printed.mode).toBe("dry-run");
    expect(printed.candidates).toHaveLength(1);
  });

  it("--apply without --confirm still performs no write (refused by the safety gate)", async () => {
    const prisma = makeReadOnlyPrismaFake();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await run(prisma as any, { organisationId: "org-a", apply: true, confirm: false, batchSize: 25, limit: 100 });

    expect(prisma.evidenceObject.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    const printed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(printed.apply.ok).toBe(false);
  });
});

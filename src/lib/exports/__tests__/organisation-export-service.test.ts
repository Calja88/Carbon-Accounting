/** T81 organisation export tests. All records are synthetic. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

const tables = vi.hoisted(() => ({
  evidenceObject: [] as Record<string, unknown>[],
  organisationMembership: [] as Record<string, unknown>[],
  sourceDocument: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/prisma", () => {
  function delegateFor(key: string) {
    return {
      findMany: vi.fn(async ({ where }: { where: { organisationId: string } }) => {
        const rows = (tables as Record<string, Record<string, unknown>[]>)[key] ?? [];
        return rows.filter((row) => row.organisationId === where.organisationId);
      }),
    };
  }

  const known = { evidenceObject: delegateFor("evidenceObject"), organisationMembership: delegateFor("organisationMembership"), sourceDocument: delegateFor("sourceDocument") };
  const client = new Proxy(known as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === "$transaction") return undefined;
      // Every other organisationId-scoped model: no synthetic fixtures, always empty.
      return { findMany: vi.fn(async () => []) };
    },
  }) as Record<string, unknown> & { $transaction: unknown };
  client.$transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(client));
  return { prisma: client };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-1" })) }));

const { listExportableModels, generateOrganisationExport } = await import("@/lib/exports/organisation-export-service");
const { recordAuditEvent } = await import("@/lib/repositories/audit-repository");

const exporterContextA = makeOrganisationContext(ORG_A, {
  userId: "synthetic-exporter-a",
  permissions: new Set(["organisation.export.generate"]) as never,
});
const noPermContextA = makeOrganisationContext(ORG_A, {
  userId: "synthetic-nobody-a",
  permissions: new Set([]) as never,
});

beforeEach(() => {
  tables.evidenceObject.length = 0;
  tables.organisationMembership.length = 0;
  tables.sourceDocument.length = 0;
  vi.clearAllMocks();
});

describe("listExportableModels", () => {
  it("includes every organisation-scoped model discovered from the Prisma schema, by structure not a hand list", () => {
    const models = listExportableModels();
    const names = models.map((m) => m.modelName);
    expect(names).toContain("EvidenceObject");
    expect(names).toContain("AuditEvent");
    expect(names).toContain("LegalHold");
    expect(names).toContain("OrganisationMembership");
  });

  it("excludes platform/cross-tenant models that carry no organisationId field", () => {
    const names = listExportableModels().map((m) => m.modelName);
    expect(names).not.toContain("User");
    expect(names).not.toContain("AiModelCatalog");
    expect(names).not.toContain("EvidenceObjectBlob");
  });
});

describe("generateOrganisationExport", () => {
  it("denies a caller without organisation.export.generate", async () => {
    await expect(generateOrganisationExport(noPermContextA)).rejects.toThrow();
  });

  it("is tenant-scoped: only organisation A's rows appear, never organisation B's", async () => {
    tables.evidenceObject.push({ id: "evidence-a", organisationId: ORG_A, filename: "a.pdf" });
    tables.evidenceObject.push({ id: "evidence-b", organisationId: ORG_B, filename: "b.pdf" });

    const result = await generateOrganisationExport(exporterContextA);
    const section = result.sections.find((s) => s.modelName === "EvidenceObject");
    expect(section?.records.map((r) => r.id)).toEqual(["evidence-a"]);
  });

  it("redacts the invitation-token hash field", async () => {
    tables.organisationMembership.push({ id: "m-1", organisationId: ORG_A, inviteTokenHash: "super-secret-hash", status: "ACTIVE" });
    const result = await generateOrganisationExport(exporterContextA);
    const section = result.sections.find((s) => s.modelName === "OrganisationMembership");
    expect(section?.records[0]).toMatchObject({ inviteTokenHash: { redacted: "field" } });
    expect(JSON.stringify(section?.records)).not.toContain("super-secret-hash");
  });

  it("replaces raw byte content with a redaction marker rather than embedding it", async () => {
    tables.sourceDocument.push({ id: "doc-1", organisationId: ORG_A, filename: "x", content: Buffer.from("synthetic bytes") });
    const result = await generateOrganisationExport(exporterContextA);
    const section = result.sections.find((s) => s.modelName === "SourceDocument");
    expect(section?.records[0]).toMatchObject({ content: { redacted: "bytes", byteLength: 15 } });
  });

  it("produces a manifest whose section/export checksums are deterministic for identical content", async () => {
    tables.evidenceObject.push({ id: "evidence-a", organisationId: ORG_A, filename: "a.pdf" });
    const first = await generateOrganisationExport(exporterContextA);
    const second = await generateOrganisationExport(exporterContextA);
    expect(first.manifest.exportChecksumSha256).toBe(second.manifest.exportChecksumSha256);
    const section = first.sections.find((s) => s.modelName === "EvidenceObject");
    expect(section?.checksumSha256).toBe(second.sections.find((s) => s.modelName === "EvidenceObject")?.checksumSha256);
  });

  it("counts and sums records per manifest, and logs an access audit event naming only counts", async () => {
    tables.evidenceObject.push({ id: "evidence-a", organisationId: ORG_A, filename: "a.pdf" });
    const result = await generateOrganisationExport(exporterContextA);
    expect(result.manifest.organisationId).toBe(ORG_A);
    expect(result.manifest.totalRecordCount).toBeGreaterThanOrEqual(1);
    expect(result.manifest.sectionCount).toBe(result.sections.length);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ eventType: "organisation_export.generated", resourceType: "organisation_export" }),
    );
  });
});

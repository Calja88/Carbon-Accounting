/**
 * Two-tenant adversarial tests for the T16 carbon repository, per
 * Docs/PHASE1_ADVERSARIAL_TEST_MATRIX.md §1 (mandatory access matrix) and
 * §2 (export/download — exercised here at the repository lookup a Batch D
 * route builds on). Synthetic Aster/Birch fixtures only, no real
 * environmental data, and no live database — Prisma is replaced with an
 * in-memory fake that applies the same flat-equality `where` filtering a
 * real tenant-scoped query would.
 */

import { describe, expect, it, vi } from "vitest";
import {
  ENTITY_A,
  ENTITY_B,
  ORG_A,
  ORG_B,
  SITE_A,
  SITE_B,
  activityEntryA,
  activityEntryB,
  entityA,
  entityB,
  orgContextA,
  orgContextB,
  restrictedOrgContextA,
  siteA,
  siteB,
} from "@/lib/__tests__/tenant-fixtures";

const calculationA = { id: "calc-a-1", organisationId: ORG_A, activityEntryId: activityEntryA.id, resultKgCo2e: 10 };
const calculationB = { id: "calc-b-1", organisationId: ORG_B, activityEntryId: activityEntryB.id, resultKgCo2e: 20 };

const reportSnapshotA = { id: "report-a-1", organisationId: ORG_A, version: 1 };
const reportSnapshotB = { id: "report-b-1", organisationId: ORG_B, version: 1 };

const sourceDocumentA = { id: "doc-a-1", organisationId: ORG_A, siteId: SITE_A, filename: "a.pdf" };
const sourceDocumentB = { id: "doc-b-1", organisationId: ORG_B, siteId: SITE_B, filename: "b.pdf" };

const extractionA = { id: "extraction-a-1", documentId: sourceDocumentA.id };
const extractionB = { id: "extraction-b-1", documentId: sourceDocumentB.id };

/** Minimal fake `findFirst`: flat-equality match against every key in `where`, mimicking a real tenant-scoped query. */
function fakeFindFirst<T extends Record<string, unknown>>(rows: T[]) {
  return vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    return rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null;
  });
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    entity: { findFirst: fakeFindFirst([entityA, entityB]) },
    site: { findFirst: fakeFindFirst([siteA, siteB]) },
    activityEntry: { findFirst: fakeFindFirst([activityEntryA, activityEntryB]) },
    calculation: { findFirst: fakeFindFirst([calculationA, calculationB]) },
    reportSnapshot: { findFirst: fakeFindFirst([reportSnapshotA, reportSnapshotB]) },
    sourceDocument: { findFirst: fakeFindFirst([sourceDocumentA, sourceDocumentB]) },
    documentExtraction: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        const extraction = [extractionA, extractionB].find((e) => e.id === where.id);
        if (!extraction) return null;
        const document = [sourceDocumentA, sourceDocumentB].find((d) => d.id === extraction.documentId) ?? null;
        return { ...extraction, document };
      }),
    },
  },
}));

const {
  accessibleActivityEntryFilter,
  accessibleEntityFilter,
  accessibleSiteFilter,
  findTenantActivityEntry,
  findTenantCalculation,
  findTenantDocumentExtraction,
  findTenantReportSnapshot,
  findTenantSourceDocument,
  requireEntityInScope,
  requireSiteInScope,
  toTenantRepositoryContext,
  TenantOwnershipError,
} = await import("@/lib/repositories/carbon-repository");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

describe("requireEntityInScope", () => {
  it("allows an Organisation A member reading Entity A", async () => {
    await expect(requireEntityInScope(orgContextA, ENTITY_A)).resolves.toEqual(entityA);
  });

  it("denies an Organisation A member reading Entity B (foreign tenant)", async () => {
    await expect(requireEntityInScope(orgContextA, ENTITY_B)).rejects.toThrow(TenantOwnershipError);
  });

  it("denies a restricted A member with no Entity A scope, even for their own tenant's record", async () => {
    await expect(requireEntityInScope(restrictedOrgContextA, ENTITY_A)).rejects.toThrow(PermissionDeniedError);
  });
});

describe("requireSiteInScope", () => {
  it("allows an Organisation A member reading Site A", async () => {
    await expect(requireSiteInScope(orgContextA, SITE_A)).resolves.toEqual(siteA);
  });

  it("denies an Organisation A member reading Site B (foreign tenant) even though B's ID is a real Site row", async () => {
    await expect(requireSiteInScope(orgContextA, SITE_B)).rejects.toThrow(TenantOwnershipError);
  });

  it("denies a restricted A member scoped only to a different Site", async () => {
    const restrictedToOtherSite = { ...restrictedOrgContextA, access: { mode: "RESTRICTED" as const, entityIds: new Set<string>(), siteIds: new Set(["site-not-a"]) } };
    await expect(requireSiteInScope(restrictedToOtherSite, SITE_A)).rejects.toThrow(PermissionDeniedError);
  });

  it("an ORGANISATION_WIDE B member cannot read A's Site by guessing its ID", async () => {
    await expect(requireSiteInScope(orgContextB, SITE_A)).rejects.toThrow(TenantOwnershipError);
  });
});

describe("findTenantActivityEntry", () => {
  const ctxA = toTenantRepositoryContext(orgContextA);

  it("returns A's own entry under its real Site", async () => {
    await expect(findTenantActivityEntry(ctxA, activityEntryA.id, SITE_A)).resolves.toEqual(activityEntryA);
  });

  it("returns null for a foreign-tenant entry ID (not-found, not a authorization-error signal)", async () => {
    await expect(findTenantActivityEntry(ctxA, activityEntryB.id)).resolves.toBeNull();
  });

  it("denies a same-tenant entry read through the wrong Site (nested-parent substitution)", async () => {
    await expect(findTenantActivityEntry(ctxA, activityEntryA.id, SITE_B)).rejects.toThrow(TenantOwnershipError);
  });
});

describe("findTenantCalculation / findTenantReportSnapshot / findTenantSourceDocument", () => {
  const ctxA = toTenantRepositoryContext(orgContextA);

  it("finds A's own calculation, report snapshot, and document", async () => {
    await expect(findTenantCalculation(ctxA, calculationA.id)).resolves.toEqual(calculationA);
    await expect(findTenantReportSnapshot(ctxA, reportSnapshotA.id)).resolves.toEqual(reportSnapshotA);
    await expect(findTenantSourceDocument(ctxA, sourceDocumentA.id)).resolves.toEqual(sourceDocumentA);
  });

  it("returns null (not the foreign record) for B's calculation, report snapshot, and document — the export/download IDOR case", async () => {
    await expect(findTenantCalculation(ctxA, calculationB.id)).resolves.toBeNull();
    await expect(findTenantReportSnapshot(ctxA, reportSnapshotB.id)).resolves.toBeNull();
    await expect(findTenantSourceDocument(ctxA, sourceDocumentB.id)).resolves.toBeNull();
  });
});

describe("findTenantDocumentExtraction", () => {
  const ctxA = toTenantRepositoryContext(orgContextA);

  it("finds A's own extraction via its parent document", async () => {
    const found = await findTenantDocumentExtraction(ctxA, extractionA.id);
    expect(found?.id).toBe(extractionA.id);
  });

  it("denies B's extraction even though the extraction row itself exists (ownership is inherited from the document)", async () => {
    await expect(findTenantDocumentExtraction(ctxA, extractionB.id)).rejects.toThrow(TenantOwnershipError);
  });

  it("returns null for a genuinely unknown extraction id, indistinguishable in shape from the cross-tenant denial above", async () => {
    await expect(findTenantDocumentExtraction(ctxA, "no-such-extraction")).resolves.toBeNull();
  });
});

describe("accessibleSiteFilter / accessibleActivityEntryFilter / accessibleEntityFilter", () => {
  it("ORGANISATION_WIDE membership imposes no extra scope filter", () => {
    expect(accessibleSiteFilter(orgContextA)).toEqual({});
    expect(accessibleActivityEntryFilter(orgContextA)).toEqual({});
    expect(accessibleEntityFilter(orgContextA)).toEqual({});
  });

  it("RESTRICTED membership scoped to Site A only excludes Entity-wide access — 'Site A1 scope, Entity-wide aggregate contains A1 only'", () => {
    expect(accessibleSiteFilter(restrictedOrgContextA)).toEqual({
      OR: [{ id: { in: [SITE_A] } }, { entityId: { in: [] } }],
    });
    expect(accessibleActivityEntryFilter(restrictedOrgContextA)).toEqual({
      site: { OR: [{ id: { in: [SITE_A] } }, { entityId: { in: [] } }] },
    });
  });

  it("a RESTRICTED membership with no scopes at all denies by default rather than matching everything", () => {
    const noScopes = { ...restrictedOrgContextA, access: { mode: "RESTRICTED" as const, entityIds: new Set<string>(), siteIds: new Set<string>() } };
    expect(accessibleSiteFilter(noScopes)).toEqual({ OR: [{ id: { in: [] } }, { entityId: { in: [] } }] });
  });
});

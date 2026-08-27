/**
 * Cross-tenant adversarial tests for the SP01 storage-connection repository
 * (task SP08, Docs/PHASE8_HARDENING_READINESS_SPEC.md §3 / T80's "no
 * customer-owned route without an isolation test" gate). These accessors
 * (`findTenantStorageConnection`, `findTenantSiteBinding`,
 * `findTenantExternalFileReference`, `findTenantExternalFileReferenceForRevision`)
 * were built with tenant-scoped queries in SP01 but had never been added to
 * `resource-endpoint-registry.ts`, so they escaped the mandatory CI
 * completeness/coverage check — this file closes that gap and exercises the
 * SP08-required "cross-organisation site/drive/item/version substitution"
 * checks against SharePoint's own resources specifically. Synthetic
 * Aster/Birch fixtures only, no live database.
 */

import { describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeTenantContext } from "@/lib/__tests__/tenant-fixtures";

const CONNECTION_A = "conn-aster-1";
const CONNECTION_B = "conn-birch-1";
const BINDING_A1 = "binding-aster-1";
const BINDING_A2 = "binding-aster-2";
const BINDING_B1 = "binding-birch-1";
const REFERENCE_A1 = "ref-aster-1";
const REFERENCE_A2 = "ref-aster-2";
const REFERENCE_B1 = "ref-birch-1";

const connectionA = { id: CONNECTION_A, organisationId: ORG_A, status: "CONNECTED" };
const connectionB = { id: CONNECTION_B, organisationId: ORG_B, status: "CONNECTED" };

const bindingA1 = { id: BINDING_A1, organisationId: ORG_A, connectionId: CONNECTION_A, siteId: "site-aster", driveId: "drive-aster-1" };
/** A second, genuine Organisation A site binding — used to prove the nested-parent-substitution guard, not just cross-tenant denial. */
const bindingA2 = { id: BINDING_A2, organisationId: ORG_A, connectionId: CONNECTION_A, siteId: "site-aster", driveId: "drive-aster-2" };
const bindingB1 = { id: BINDING_B1, organisationId: ORG_B, connectionId: CONNECTION_B, siteId: "site-birch", driveId: "drive-birch-1" };

const referenceA1 = {
  id: REFERENCE_A1,
  organisationId: ORG_A,
  siteBindingId: BINDING_A1,
  evidenceObjectId: "evidence-aster-1",
  controlledDocumentRevisionId: null,
  itemId: "item-aster-1",
  versionId: "1.0",
  checksumSha256: "aaa",
};
/** Same-tenant reference attached to bindingA2, not bindingA1 — the case a route that resolves "the reference for this site binding" must reject if a caller substitutes a different (but same-organisation) site binding id. */
const referenceA2 = {
  id: REFERENCE_A2,
  organisationId: ORG_A,
  siteBindingId: BINDING_A2,
  evidenceObjectId: null,
  controlledDocumentRevisionId: "revision-aster-1",
  itemId: "item-aster-2",
  versionId: "1.0",
  checksumSha256: "bbb",
};
const referenceB1 = {
  id: REFERENCE_B1,
  organisationId: ORG_B,
  siteBindingId: BINDING_B1,
  evidenceObjectId: null,
  controlledDocumentRevisionId: "revision-birch-1",
  itemId: "item-birch-1",
  versionId: "1.0",
  checksumSha256: "ccc",
};

function fakeFindFirst<T extends Record<string, unknown>>(rows: T[]) {
  return vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    return rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null;
  });
}

function fakeFindUnique<T extends Record<string, unknown>>(rows: T[]) {
  return vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    return rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null;
  });
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organisationStorageConnection: { findUnique: fakeFindUnique([connectionA, connectionB]) },
    storageSiteBinding: { findFirst: fakeFindFirst([bindingA1, bindingA2, bindingB1]) },
    externalFileReference: { findFirst: fakeFindFirst([referenceA1, referenceA2, referenceB1]) },
  },
}));

const {
  findTenantStorageConnection,
  findTenantSiteBinding,
  findTenantExternalFileReference,
  findTenantExternalFileReferenceForRevision,
  TenantOwnershipError,
} = await import("@/lib/repositories/storage-connection-repository");

const ctxA = makeTenantContext(ORG_A);
const ctxB = makeTenantContext(ORG_B);

describe("findTenantStorageConnection", () => {
  it("allows an Organisation A caller reading its own connection", async () => {
    await expect(findTenantStorageConnection(ctxA)).resolves.toEqual(connectionA);
  });

  it("never resolves Organisation B's connection for an Organisation A caller (query itself is tenant-scoped)", async () => {
    await expect(findTenantStorageConnection(ctxB)).resolves.toEqual(connectionB);
    await expect(findTenantStorageConnection(ctxA)).resolves.not.toEqual(connectionB);
  });
});

describe("findTenantSiteBinding", () => {
  it("allows an Organisation A caller reading Binding A1", async () => {
    await expect(findTenantSiteBinding(ctxA, BINDING_A1)).resolves.toEqual(bindingA1);
  });

  it("denies an Organisation A caller reading Binding B1 (foreign tenant)", async () => {
    await expect(findTenantSiteBinding(ctxA, BINDING_B1)).rejects.toThrow(TenantOwnershipError);
  });

  it("denies a missing site binding id identically to a foreign one", async () => {
    await expect(findTenantSiteBinding(ctxA, "does-not-exist")).rejects.toThrow(TenantOwnershipError);
  });
});

describe("findTenantExternalFileReference", () => {
  it("allows an Organisation A caller reading Reference A1", async () => {
    await expect(findTenantExternalFileReference(ctxA, REFERENCE_A1)).resolves.toEqual(referenceA1);
  });

  it("denies an Organisation A caller reading Reference B1 (cross-organisation item/version substitution) — the query itself is tenant-scoped, so a foreign reference resolves null rather than someone else's row", async () => {
    await expect(findTenantExternalFileReference(ctxA, REFERENCE_B1)).resolves.toBeNull();
  });

  it("denies an Organisation B caller reading Reference A1 (reverse direction)", async () => {
    await expect(findTenantExternalFileReference(ctxB, REFERENCE_A1)).resolves.toBeNull();
  });

  it("guards against a same-tenant reference attached to a different site binding than expected (nested-parent substitution)", async () => {
    // referenceA2 is a genuine Organisation A row, so the tenant check alone
    // would pass it — only the expectedSiteBindingId comparison catches
    // "Reference A2 (bound to Binding A2) fetched through Binding A1's route".
    await expect(findTenantExternalFileReference(ctxA, REFERENCE_A2, BINDING_A1)).rejects.toThrow(TenantOwnershipError);
    await expect(findTenantExternalFileReference(ctxA, REFERENCE_A2, BINDING_A2)).resolves.toEqual(referenceA2);
  });
});

describe("findTenantExternalFileReferenceForRevision", () => {
  it("allows an Organisation A caller resolving its own controlled-document revision's reference", async () => {
    await expect(findTenantExternalFileReferenceForRevision(ctxA, "revision-aster-1")).resolves.toEqual(referenceA2);
  });

  it("never resolves a foreign-tenant revision's reference (query itself is tenant-scoped, returns null rather than Birch's row)", async () => {
    await expect(findTenantExternalFileReferenceForRevision(ctxA, "revision-birch-1")).resolves.toBeNull();
    await expect(findTenantExternalFileReferenceForRevision(ctxB, "revision-birch-1")).resolves.toEqual(referenceB1);
  });
});

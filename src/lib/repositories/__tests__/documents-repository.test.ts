/**
 * Two-tenant adversarial tests for the T22 documents repository, per
 * Docs/PHASE1_ADVERSARIAL_TEST_MATRIX.md's mandatory-access-matrix pattern
 * applied to the new controlled-document/evidence tables. Synthetic
 * Aster/Birch fixtures only, no live database.
 */

import { describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeTenantContext } from "@/lib/__tests__/tenant-fixtures";

const DOCUMENT_A = "document-aster-1";
const DOCUMENT_B = "document-birch-1";
const REVISION_A = "revision-aster-1";
const REVISION_B = "revision-birch-1";
const EVIDENCE_A = "evidence-aster-1";
const EVIDENCE_B = "evidence-birch-1";

const documentA = { id: DOCUMENT_A, organisationId: ORG_A, reference: "POL-A-001" };
const documentB = { id: DOCUMENT_B, organisationId: ORG_B, reference: "POL-B-001" };

const revisionA = { id: REVISION_A, organisationId: ORG_A, documentId: DOCUMENT_A, revisionNumber: 1 };
const revisionB = { id: REVISION_B, organisationId: ORG_B, documentId: DOCUMENT_B, revisionNumber: 1 };
const REVISION_A2 = "revision-aster-2";
/** A same-tenant Organisation A revision belonging to a *different* Organisation A document — the nested-parent-substitution guard proves this, not just cross-tenant denial. */
const documentA2 = { id: "document-aster-2", organisationId: ORG_A, reference: "POL-A-002" };
const revisionAOtherDocument = { id: REVISION_A2, organisationId: ORG_A, documentId: documentA2.id, revisionNumber: 1 };

const evidenceObjectA = { id: EVIDENCE_A, organisationId: ORG_A, filename: "a.pdf" };
const evidenceObjectB = { id: EVIDENCE_B, organisationId: ORG_B, filename: "b.pdf" };

function fakeFindFirst<T extends Record<string, unknown>>(rows: T[]) {
  return vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    return rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null;
  });
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    controlledDocument: { findFirst: fakeFindFirst([documentA, documentB]) },
    controlledDocumentRevision: { findFirst: fakeFindFirst([revisionA, revisionB, revisionAOtherDocument]) },
    evidenceObject: { findFirst: fakeFindFirst([evidenceObjectA, evidenceObjectB]) },
    evidenceLink: { findFirst: fakeFindFirst([]) },
  },
}));

const {
  findTenantControlledDocument,
  findTenantControlledDocumentRevision,
  findTenantEvidenceObject,
  findTenantEvidenceLink,
  TenantOwnershipError,
} = await import("@/lib/repositories/documents-repository");

const ctxA = makeTenantContext(ORG_A);
const ctxB = makeTenantContext(ORG_B);

describe("findTenantControlledDocument", () => {
  it("allows an Organisation A caller reading Document A", async () => {
    await expect(findTenantControlledDocument(ctxA, DOCUMENT_A)).resolves.toEqual(documentA);
  });

  it("denies an Organisation A caller reading Document B (foreign tenant)", async () => {
    await expect(findTenantControlledDocument(ctxA, DOCUMENT_B)).rejects.toThrow(TenantOwnershipError);
  });

  it("denies a missing document id identically to a foreign one", async () => {
    await expect(findTenantControlledDocument(ctxA, "does-not-exist")).rejects.toThrow(TenantOwnershipError);
  });
});

describe("findTenantControlledDocumentRevision", () => {
  it("allows an Organisation A caller reading Revision A", async () => {
    await expect(findTenantControlledDocumentRevision(ctxA, REVISION_A)).resolves.toEqual(revisionA);
  });

  it("denies an Organisation A caller reading Revision B (foreign tenant)", async () => {
    await expect(findTenantControlledDocumentRevision(ctxA, REVISION_B)).resolves.toBeNull();
  });

  it("guards against a same-tenant revision attached to a different document id than expected (nested-parent substitution)", async () => {
    // revisionAOtherDocument is a genuine Organisation A row, so the tenant
    // check alone would pass it — only the expectedDocumentId comparison
    // catches "Revision A2 fetched through Document A1's route".
    await expect(
      findTenantControlledDocumentRevision(ctxA, REVISION_A2, DOCUMENT_A),
    ).rejects.toThrow(TenantOwnershipError);
    await expect(findTenantControlledDocumentRevision(ctxA, REVISION_A, DOCUMENT_A)).resolves.toEqual(revisionA);
  });
});

describe("findTenantEvidenceObject", () => {
  it("allows an Organisation A caller reading Evidence A", async () => {
    await expect(findTenantEvidenceObject(ctxA, EVIDENCE_A)).resolves.toEqual(evidenceObjectA);
  });

  it("denies an Organisation A caller reading Evidence B (foreign tenant)", async () => {
    await expect(findTenantEvidenceObject(ctxA, EVIDENCE_B)).rejects.toThrow(TenantOwnershipError);
  });

  it("denies an Organisation B caller reading Evidence A (foreign tenant, reverse direction)", async () => {
    await expect(findTenantEvidenceObject(ctxB, EVIDENCE_A)).rejects.toThrow(TenantOwnershipError);
  });
});

describe("findTenantEvidenceLink", () => {
  it("denies a missing evidence link identically to a foreign one", async () => {
    await expect(findTenantEvidenceLink(ctxA, "does-not-exist")).rejects.toThrow(TenantOwnershipError);
  });
});

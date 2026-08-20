/**
 * Two-tenant adversarial tests for the T17 LCA repository, per
 * Docs/PHASE1_ADVERSARIAL_TEST_MATRIX.md §1 (mandatory access matrix) and
 * §2 (export/download). Focused on the detail/export/version/evidence paths
 * the T17 task packet names explicitly. Synthetic Aster/Birch fixtures only,
 * no real environmental data, and no live database — Prisma is replaced with
 * an in-memory fake that applies the same flat-equality/nested-join `where`
 * filtering a real tenant-scoped query would.
 */

import { describe, expect, it, vi } from "vitest";
import {
  ASSESSMENT_A,
  ASSESSMENT_B,
  EVIDENCE_A,
  EVIDENCE_B,
  ORG_A,
  PRODUCT_A,
  PRODUCT_B,
  SUPPLIER_A,
  SUPPLIER_B,
  SUPPLIER_PCF_A,
  SUPPLIER_PCF_B,
  VERSION_A,
  VERSION_B,
  assessmentA,
  assessmentB,
  assessmentVersionA,
  assessmentVersionB,
  evidenceA,
  evidenceB,
  lcaOrgContextA,
  lcaOrgContextB,
  productA,
  productB,
  supplierA,
  supplierB,
  supplierPcfA,
  supplierPcfB,
} from "@/lib/__tests__/tenant-fixtures";

const processA = { id: "process-a-1", assessmentId: ASSESSMENT_A, name: "A process" };
const processB = { id: "process-b-1", assessmentId: ASSESSMENT_B, name: "B process" };

const itemA = { id: "item-a-1", assessmentId: ASSESSMENT_A, name: "A item" };
const itemB = { id: "item-b-1", assessmentId: ASSESSMENT_B, name: "B item" };

const runA = { id: "run-a-1", assessmentId: ASSESSMENT_A };
const runB = { id: "run-b-1", assessmentId: ASSESSMENT_B };

const resultA = { id: "result-a-1", assessmentId: ASSESSMENT_A, runId: runA.id };
const resultB = { id: "result-b-1", assessmentId: ASSESSMENT_B, runId: runB.id };

const evidenceBlobA = { evidenceId: EVIDENCE_A, bytes: Buffer.from("synthetic-a") };
const evidenceBlobB = { evidenceId: EVIDENCE_B, bytes: Buffer.from("synthetic-b") };

const methodologyPlatform = { id: "methodology-platform", organisationId: null, name: "Platform default" };
const methodologyOwnedByA = { id: "methodology-a", organisationId: ORG_A, name: "A custom" };

const assessmentsById = new Map([
  [ASSESSMENT_A, assessmentA],
  [ASSESSMENT_B, assessmentB],
]);

/** Flat-equality `findFirst` fake, mimicking a real tenant-scoped query. */
function fakeFindFirst<T extends Record<string, unknown>>(rows: T[]) {
  return vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    return rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null;
  });
}

/** `findFirst` fake for a child row joined through `assessment: { organisationId }` — the composite-parent-link pattern for LcaProcess/LcaInventoryItem. */
function fakeFindFirstViaAssessment<T extends { id: string; assessmentId: string }>(rows: T[]) {
  return vi.fn(async ({ where }: { where: { id: string; assessment: { organisationId: string } } }) => {
    const row = rows.find((r) => r.id === where.id);
    if (!row) return null;
    const parent = assessmentsById.get(row.assessmentId);
    if (!parent || parent.organisationId !== where.assessment.organisationId) return null;
    return row;
  });
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lcaAssessment: { findFirst: fakeFindFirst([assessmentA, assessmentB]) },
    product: { findFirst: fakeFindFirst([productA, productB]) },
    supplier: { findFirst: fakeFindFirst([supplierA, supplierB]) },
    lcaEvidence: { findFirst: fakeFindFirst([evidenceA, evidenceB]) },
    lcaEvidenceBlob: {
      findUnique: vi.fn(async ({ where }: { where: { evidenceId: string } }) =>
        [evidenceBlobA, evidenceBlobB].find((blob) => blob.evidenceId === where.evidenceId) ?? null,
      ),
    },
    lcaAssessmentVersion: { findFirst: fakeFindFirst([assessmentVersionA, assessmentVersionB]) },
    lcaSupplierPcf: { findFirst: fakeFindFirst([supplierPcfA, supplierPcfB]) },
    lcaMethodologyProfile: { findFirst: fakeFindFirst([methodologyPlatform, methodologyOwnedByA]) },
    lcaProcess: { findFirst: fakeFindFirstViaAssessment([processA, processB]) },
    lcaInventoryItem: { findFirst: fakeFindFirstViaAssessment([itemA, itemB]) },
    lcaCalculationRun: { findFirst: fakeFindFirstViaAssessment([runA, runB]) },
    lcaCalculationResult: { findFirst: fakeFindFirstViaAssessment([resultA, resultB]) },
  },
}));

const {
  findTenantAssessmentVersion,
  findTenantEvidence,
  findTenantEvidenceBlob,
  findTenantInventoryItem,
  findTenantProcess,
  findTenantResult,
  findTenantRun,
  findTenantSupplierPcf,
  findVisibleMethodologyProfile,
  requireAssessmentInScope,
  requireProductInScope,
  requireSupplierInScope,
  toTenantRepositoryContext,
  TenantOwnershipError,
} = await import("@/lib/repositories/lca-repository");

describe("requireAssessmentInScope (detail path)", () => {
  it("allows an Organisation A member reading Assessment A", async () => {
    await expect(requireAssessmentInScope(lcaOrgContextA, ASSESSMENT_A)).resolves.toEqual(assessmentA);
  });

  it("denies an Organisation A member reading Assessment B (foreign tenant) — the assessment detail path", async () => {
    await expect(requireAssessmentInScope(lcaOrgContextA, ASSESSMENT_B)).rejects.toThrow(TenantOwnershipError);
  });

  it("an ORGANISATION_WIDE B member cannot read A's assessment by guessing its ID", async () => {
    await expect(requireAssessmentInScope(lcaOrgContextB, ASSESSMENT_A)).rejects.toThrow(TenantOwnershipError);
  });
});

describe("requireProductInScope / requireSupplierInScope", () => {
  it("allows same-tenant reads and denies cross-tenant reads for Product", async () => {
    await expect(requireProductInScope(lcaOrgContextA, PRODUCT_A)).resolves.toEqual(productA);
    await expect(requireProductInScope(lcaOrgContextA, PRODUCT_B)).rejects.toThrow(TenantOwnershipError);
  });

  it("allows same-tenant reads and denies cross-tenant reads for Supplier", async () => {
    await expect(requireSupplierInScope(lcaOrgContextA, SUPPLIER_A)).resolves.toEqual(supplierA);
    await expect(requireSupplierInScope(lcaOrgContextA, SUPPLIER_B)).rejects.toThrow(TenantOwnershipError);
  });
});

describe("findTenantEvidence (evidence download path)", () => {
  const ctxA = toTenantRepositoryContext(lcaOrgContextA);

  it("finds A's own evidence", async () => {
    await expect(findTenantEvidence(ctxA, EVIDENCE_A)).resolves.toEqual(evidenceA);
  });

  it("returns null for B's evidence — the export/download IDOR case, indistinguishable from a missing id", async () => {
    await expect(findTenantEvidence(ctxA, EVIDENCE_B)).resolves.toBeNull();
  });

  it("denies A's own evidence read through the wrong assessment id (nested-parent substitution)", async () => {
    await expect(findTenantEvidence(ctxA, EVIDENCE_A, ASSESSMENT_B)).rejects.toThrow(TenantOwnershipError);
  });

  it("allows A's evidence when the expected assessment id matches", async () => {
    await expect(findTenantEvidence(ctxA, EVIDENCE_A, ASSESSMENT_A)).resolves.toEqual(evidenceA);
  });
});

describe("findTenantEvidenceBlob (evidence bytes, gated on findTenantEvidence's tenant check)", () => {
  const ctxA = toTenantRepositoryContext(lcaOrgContextA);

  it("returns A's own evidence blob", async () => {
    await expect(findTenantEvidenceBlob(ctxA, EVIDENCE_A)).resolves.toEqual(evidenceBlobA);
  });

  it("returns null for B's evidence blob — never resolves a foreign-tenant blob by guessing its evidence id", async () => {
    await expect(findTenantEvidenceBlob(ctxA, EVIDENCE_B)).resolves.toBeNull();
  });

  it("returns null for a missing evidence id identically to a foreign one", async () => {
    await expect(findTenantEvidenceBlob(ctxA, "does-not-exist")).resolves.toBeNull();
  });
});

describe("findTenantAssessmentVersion (version path)", () => {
  const ctxA = toTenantRepositoryContext(lcaOrgContextA);

  it("finds A's own version", async () => {
    await expect(findTenantAssessmentVersion(ctxA, VERSION_A)).resolves.toEqual(assessmentVersionA);
  });

  it("returns null for B's version — a foreign-tenant issued version must not be readable by guessing its ID", async () => {
    await expect(findTenantAssessmentVersion(ctxA, VERSION_B)).resolves.toBeNull();
  });

  it("denies A's own version read through a spoofed assessment id in the URL", async () => {
    await expect(findTenantAssessmentVersion(ctxA, VERSION_A, ASSESSMENT_B)).rejects.toThrow(TenantOwnershipError);
  });
});

describe("findTenantSupplierPcf", () => {
  const ctxA = toTenantRepositoryContext(lcaOrgContextA);

  it("finds A's own supplier PCF and returns null for B's — a foreign-tenant PCF must never be resolvable into A's factor selection", async () => {
    await expect(findTenantSupplierPcf(ctxA, SUPPLIER_PCF_A)).resolves.toEqual(supplierPcfA);
    await expect(findTenantSupplierPcf(ctxA, SUPPLIER_PCF_B)).resolves.toBeNull();
  });
});

describe("findVisibleMethodologyProfile", () => {
  const ctxA = toTenantRepositoryContext(lcaOrgContextA);
  const ctxB = toTenantRepositoryContext(lcaOrgContextB);

  it("a platform-shared (null organisationId) profile is visible to every tenant", async () => {
    await expect(findVisibleMethodologyProfile(ctxA, methodologyPlatform.id)).resolves.toEqual(methodologyPlatform);
    await expect(findVisibleMethodologyProfile(ctxB, methodologyPlatform.id)).resolves.toEqual(methodologyPlatform);
  });

  it("an organisation-owned profile is visible only to its own tenant", async () => {
    await expect(findVisibleMethodologyProfile(ctxA, methodologyOwnedByA.id)).resolves.toEqual(methodologyOwnedByA);
    await expect(findVisibleMethodologyProfile(ctxB, methodologyOwnedByA.id)).resolves.toBeNull();
  });
});

describe("findTenantProcess / findTenantInventoryItem (child ID under assessment route)", () => {
  const ctxA = toTenantRepositoryContext(lcaOrgContextA);

  it("finds A's own process/item under A's assessment", async () => {
    await expect(findTenantProcess(ctxA, processA.id, ASSESSMENT_A)).resolves.toEqual(processA);
    await expect(findTenantInventoryItem(ctxA, itemA.id, ASSESSMENT_A)).resolves.toEqual(itemA);
  });

  it("returns null for B's process/item — 'Child ID from B under A assessment route'", async () => {
    await expect(findTenantProcess(ctxA, processB.id)).resolves.toBeNull();
    await expect(findTenantInventoryItem(ctxA, itemB.id)).resolves.toBeNull();
  });
});

describe("findTenantRun / findTenantResult (results/export path)", () => {
  const ctxA = toTenantRepositoryContext(lcaOrgContextA);

  it("finds A's own run/result and denies B's — 'Export B run through A assessment route'", async () => {
    await expect(findTenantRun(ctxA, runA.id, ASSESSMENT_A)).resolves.toEqual(runA);
    await expect(findTenantRun(ctxA, runB.id)).resolves.toBeNull();

    await expect(findTenantResult(ctxA, resultA.id, ASSESSMENT_A)).resolves.toEqual(resultA);
    await expect(findTenantResult(ctxA, resultB.id)).resolves.toBeNull();
  });

  it("denies A's own result read through a spoofed assessment id", async () => {
    await expect(findTenantResult(ctxA, resultA.id, ASSESSMENT_B)).rejects.toThrow(TenantOwnershipError);
  });
});

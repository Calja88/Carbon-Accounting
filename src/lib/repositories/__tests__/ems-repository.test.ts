/**
 * Two-tenant adversarial tests for the T23 EMS repository, per
 * Docs/PHASE1_ADVERSARIAL_TEST_MATRIX.md's mandatory-access-matrix pattern
 * applied to the new EMS programme/scope/context tables. Synthetic
 * Aster/Birch fixtures only, no live database.
 */

import { describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeTenantContext } from "@/lib/__tests__/tenant-fixtures";

const PROGRAMME_A = "programme-aster-1";
const PROGRAMME_B = "programme-birch-1";
const VERSION_A = "scope-version-aster-1";
const VERSION_B = "scope-version-birch-1";
const PARTY_A = "party-aster-1";
const PARTY_B = "party-birch-1";
const REQUIREMENT_A = "requirement-aster-1";

const programmeA = { id: PROGRAMME_A, organisationId: ORG_A, name: "Aster EMS" };
const programmeB = { id: PROGRAMME_B, organisationId: ORG_B, name: "Birch EMS" };

const versionA = { id: VERSION_A, organisationId: ORG_A, programmeId: PROGRAMME_A, versionNumber: 1 };
const versionB = { id: VERSION_B, organisationId: ORG_B, programmeId: PROGRAMME_B, versionNumber: 1 };
const VERSION_A2 = "scope-version-aster-2";
/** A same-tenant Organisation A version belonging to a *different* Organisation A programme — the nested-parent-substitution guard proves this, not just cross-tenant denial. */
const programmeA2 = { id: "programme-aster-2", organisationId: ORG_A, name: "Aster EMS 2" };
const versionAOtherProgramme = { id: VERSION_A2, organisationId: ORG_A, programmeId: programmeA2.id, versionNumber: 1 };

const partyA = { id: PARTY_A, organisationId: ORG_A, name: "Aster regulator" };
const partyB = { id: PARTY_B, organisationId: ORG_B, name: "Birch regulator" };

const requirementA = { id: REQUIREMENT_A, organisationId: ORG_A, interestedPartyId: PARTY_A, summary: "Annual consent" };
const REQUIREMENT_A2 = "requirement-aster-2";
const partyA2 = { id: "party-aster-2", organisationId: ORG_A, name: "Aster council" };
const requirementAOtherParty = { id: REQUIREMENT_A2, organisationId: ORG_A, interestedPartyId: partyA2.id, summary: "Other" };

function fakeFindFirst<T extends Record<string, unknown>>(rows: T[]) {
  return vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    return rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null;
  });
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emsProgramme: { findFirst: fakeFindFirst([programmeA, programmeB]) },
    emsScopeVersion: { findFirst: fakeFindFirst([versionA, versionB, versionAOtherProgramme]) },
    interestedParty: { findFirst: fakeFindFirst([partyA, partyB]) },
    interestedPartyRequirement: { findFirst: fakeFindFirst([requirementA, requirementAOtherParty]) },
    standardRequirementMap: { findFirst: fakeFindFirst([]) },
    contextIssue: { findFirst: fakeFindFirst([]) },
    emsRiskOpportunity: { findFirst: fakeFindFirst([]) },
    changeAssessment: { findFirst: fakeFindFirst([]) },
    environmentalPolicyRecord: { findFirst: fakeFindFirst([]) },
  },
}));

const {
  findTenantEmsProgramme,
  findTenantEmsScopeVersion,
  findTenantInterestedParty,
  findTenantInterestedPartyRequirement,
  TenantOwnershipError,
} = await import("@/lib/repositories/ems-repository");

const ctxA = makeTenantContext(ORG_A);
const ctxB = makeTenantContext(ORG_B);

describe("findTenantEmsProgramme", () => {
  it("allows an Organisation A caller reading Programme A", async () => {
    await expect(findTenantEmsProgramme(ctxA, PROGRAMME_A)).resolves.toEqual(programmeA);
  });

  it("denies an Organisation A caller reading Programme B (foreign tenant)", async () => {
    await expect(findTenantEmsProgramme(ctxA, PROGRAMME_B)).rejects.toThrow(TenantOwnershipError);
  });

  it("denies a missing programme id identically to a foreign one", async () => {
    await expect(findTenantEmsProgramme(ctxA, "does-not-exist")).rejects.toThrow(TenantOwnershipError);
  });
});

describe("findTenantEmsScopeVersion", () => {
  it("allows an Organisation A caller reading Version A", async () => {
    await expect(findTenantEmsScopeVersion(ctxA, VERSION_A)).resolves.toEqual(versionA);
  });

  it("denies an Organisation A caller reading Version B (foreign tenant)", async () => {
    await expect(findTenantEmsScopeVersion(ctxA, VERSION_B)).resolves.toBeNull();
  });

  it("guards against a same-tenant version attached to a different programme id than expected (nested-parent substitution)", async () => {
    await expect(findTenantEmsScopeVersion(ctxA, VERSION_A2, PROGRAMME_A)).rejects.toThrow(TenantOwnershipError);
    await expect(findTenantEmsScopeVersion(ctxA, VERSION_A, PROGRAMME_A)).resolves.toEqual(versionA);
  });
});

describe("findTenantInterestedParty", () => {
  it("allows an Organisation A caller reading Party A", async () => {
    await expect(findTenantInterestedParty(ctxA, PARTY_A)).resolves.toEqual(partyA);
  });

  it("denies an Organisation B caller reading Party A (reverse direction)", async () => {
    await expect(findTenantInterestedParty(ctxB, PARTY_A)).rejects.toThrow(TenantOwnershipError);
  });
});

describe("findTenantInterestedPartyRequirement", () => {
  it("allows an Organisation A caller reading Requirement A", async () => {
    await expect(findTenantInterestedPartyRequirement(ctxA, REQUIREMENT_A)).resolves.toEqual(requirementA);
  });

  it("guards against a same-tenant requirement attached to a different interested party id than expected", async () => {
    await expect(findTenantInterestedPartyRequirement(ctxA, REQUIREMENT_A2, PARTY_A)).rejects.toThrow(TenantOwnershipError);
    await expect(findTenantInterestedPartyRequirement(ctxA, REQUIREMENT_A, PARTY_A)).resolves.toEqual(requirementA);
  });
});

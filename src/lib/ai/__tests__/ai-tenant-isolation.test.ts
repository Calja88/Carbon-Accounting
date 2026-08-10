/**
 * Phase 1 tenancy (T18) adversarial tests for the AI layer's tenant
 * boundary, per Docs/PHASE1_ADVERSARIAL_TEST_MATRIX.md §7 ("AI isolation
 * tests"). Synthetic Aster/Birch fixtures only (from tenant-fixtures.ts), no
 * real environmental data, and no live database — Prisma is replaced with an
 * in-memory fake, same convention as lca-repository.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import { FactorVisibility, Role } from "@prisma/client";
import {
  ENTITY_A,
  ENTITY_B,
  ORG_A,
  ORG_B,
  SITE_A,
  SITE_B,
  orgContextA,
  orgContextB,
  restrictedOrgContextA,
} from "@/lib/__tests__/tenant-fixtures";

const DOCUMENT_A = "document-aster-1";
const DOCUMENT_B = "document-birch-1";
const ASSESSMENT_A = "assessment-aster-1";
const ASSESSMENT_B = "assessment-birch-1";

const usersById: Record<string, { id: string; name: string; role: Role }> = {
  [`user-${ORG_A}`]: { id: `user-${ORG_A}`, name: "Aster User", role: Role.SUSTAINABILITY_LEAD },
  [`user-${ORG_B}`]: { id: `user-${ORG_B}`, name: "Birch User", role: Role.SUSTAINABILITY_LEAD },
};

const sitesTable = [
  { id: SITE_A, entityId: ENTITY_A, isActive: true },
  { id: SITE_B, entityId: ENTITY_B, isActive: true },
];
const entityOrganisationOf: Record<string, string> = { [ENTITY_A]: ORG_A, [ENTITY_B]: ORG_B };

const documentsTable = [
  { id: DOCUMENT_A, organisationId: ORG_A, siteId: SITE_A },
  { id: DOCUMENT_B, organisationId: ORG_B, siteId: SITE_B },
];

const assessmentsTable = [
  { id: ASSESSMENT_A, organisationId: ORG_A, entityId: ENTITY_A },
  { id: ASSESSMENT_B, organisationId: ORG_B, entityId: ENTITY_B },
];

const PLATFORM_SET = "factor-set-platform";
const ORG_A_SET = "factor-set-aster-supplier";
const ORG_B_SET = "factor-set-birch-supplier";

const factorSetsTable: Record<string, { visibility: FactorVisibility; ownerOrganisationId: string | null }> = {
  [PLATFORM_SET]: { visibility: FactorVisibility.PLATFORM, ownerOrganisationId: null },
  [ORG_A_SET]: { visibility: FactorVisibility.ORGANISATION, ownerOrganisationId: ORG_A },
  [ORG_B_SET]: { visibility: FactorVisibility.ORGANISATION, ownerOrganisationId: ORG_B },
};

const factorsTable = [
  { id: "factor-platform-1", factorSetId: PLATFORM_SET, category: "grid_electricity" },
  { id: "factor-aster-1", factorSetId: ORG_A_SET, category: "freight_road" },
  { id: "factor-birch-1", factorSetId: ORG_B_SET, category: "freight_road" },
];

function matchesFactorSetVisibility(setId: string, visibilityOr: { visibility: FactorVisibility; ownerOrganisationId?: string }[]) {
  const set = factorSetsTable[setId];
  return visibilityOr.some(
    (clause) => set.visibility === clause.visibility && (clause.ownerOrganisationId === undefined || set.ownerOrganisationId === clause.ownerOrganisationId),
  );
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => usersById[where.id] ?? null),
    },
    site: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { isActive?: boolean; entity?: { organisationId?: string }; OR?: [{ id: { in: string[] } }, { entityId: { in: string[] } }] };
        }) => {
          return sitesTable
            .filter((s) => where.isActive === undefined || s.isActive === where.isActive)
            .filter((s) => !where.entity?.organisationId || entityOrganisationOf[s.entityId] === where.entity.organisationId)
            .filter((s) => {
              if (!where.OR) return true;
              const [byId, byEntity] = where.OR;
              return byId.id.in.includes(s.id) || byEntity.entityId.in.includes(s.entityId);
            })
            .map(({ id, entityId }) => ({ id, entityId }));
        },
      ),
    },
    sourceDocument: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; organisationId: string } }) => {
        return documentsTable.find((d) => d.id === where.id && d.organisationId === where.organisationId) ?? null;
      }),
    },
    lcaAssessment: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; organisationId: string } }) => {
        return assessmentsTable.find((a) => a.id === where.id && a.organisationId === where.organisationId) ?? null;
      }),
    },
    emissionFactor: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { category?: string; factorSet: { AND: [{ OR: { visibility: FactorVisibility; ownerOrganisationId?: string }[] }] } };
        }) => {
          const visibilityOr = where.factorSet.AND[0].OR;
          return factorsTable
            .filter((f) => matchesFactorSetVisibility(f.factorSetId, visibilityOr))
            .filter((f) => !where.category || f.category === where.category)
            .map((f) => ({ ...f, factorSet: { name: "Test", publisher: "Test", vintageYear: 2026, sourceType: "OFFICIAL_DEFRA_DESNZ", sourceUrl: null, isPlaceholder: false }, scope: "SCOPE_3", subtypeKey: null, basis: "STANDARD", region: "UK", unit: "km", co2eFactor: "0.1", notes: null }));
        },
      ),
    },
  },
}));

const { resolveAiActor, assertDocumentInScope, assertLcaAssessmentInScope, AiAuthorizationError } = await import(
  "@/lib/ai/authorization"
);
const { findFactorCandidates } = await import("@/lib/ai/services/factor-suggest");

describe("resolveAiActor: Organisation scoping", () => {
  it("scopes an ORGANISATION_WIDE Organisation A member to only Organisation A's entities/sites", async () => {
    const actor = await resolveAiActor(orgContextA);
    expect(actor).not.toBeNull();
    expect(actor!.organisationId).toBe(ORG_A);
    expect(actor!.siteIds).toEqual([SITE_A]);
    expect(actor!.entityIds).toEqual([ENTITY_A]);
    // The other tenant's site/entity must never appear, however wide this membership's own access is.
    expect(actor!.siteIds).not.toContain(SITE_B);
    expect(actor!.entityIds).not.toContain(ENTITY_B);
  });

  it("scopes an ORGANISATION_WIDE Organisation B member to only Organisation B's entities/sites", async () => {
    const actor = await resolveAiActor(orgContextB);
    expect(actor!.siteIds).toEqual([SITE_B]);
    expect(actor!.entityIds).toEqual([ENTITY_B]);
  });

  it("further narrows a RESTRICTED Organisation A member without ever crossing into Organisation B", async () => {
    const actor = await resolveAiActor(restrictedOrgContextA);
    expect(actor!.siteIds).toEqual([SITE_A]);
    expect(actor!.entityIds).toEqual([ENTITY_A]);
  });

  it("carries the resolved organisationId and correlationId onto the actor", async () => {
    const actor = await resolveAiActor(orgContextA);
    expect(actor!.organisationId).toBe(orgContextA.organisationId);
    expect(actor!.correlationId).toBe(orgContextA.correlationId);
  });
});

describe("assertDocumentInScope: tenant ownership before bytes are read", () => {
  it("allows Organisation A to see its own document", async () => {
    const actor = await resolveAiActor(orgContextA);
    await expect(assertDocumentInScope(actor!, DOCUMENT_A)).resolves.toBeUndefined();
  });

  it("refuses Organisation A reading Organisation B's document by guessing its id — indistinguishable from a missing document", async () => {
    const actor = await resolveAiActor(orgContextA);
    await expect(assertDocumentInScope(actor!, DOCUMENT_B)).rejects.toThrow(AiAuthorizationError);
    await expect(assertDocumentInScope(actor!, DOCUMENT_B)).rejects.toThrow("doesn't exist");
  });
});

describe("assertLcaAssessmentInScope: the LCA copilot refuses a foreign assessment id", () => {
  it("allows Organisation A to see its own assessment", async () => {
    const actor = await resolveAiActor(orgContextA);
    await expect(assertLcaAssessmentInScope(actor!, ASSESSMENT_A)).resolves.toBeUndefined();
  });

  it("refuses Organisation A reading Organisation B's assessment by guessing its id", async () => {
    const actor = await resolveAiActor(orgContextA);
    await expect(assertLcaAssessmentInScope(actor!, ASSESSMENT_B)).rejects.toThrow(AiAuthorizationError);
  });

  it("refuses an ORGANISATION_WIDE Organisation B member reading Organisation A's assessment", async () => {
    const actor = await resolveAiActor(orgContextB);
    await expect(assertLcaAssessmentInScope(actor!, ASSESSMENT_A)).rejects.toThrow(AiAuthorizationError);
  });
});

describe("findFactorCandidates: platform factors plus this Organisation's own, never another tenant's supplier set", () => {
  it("includes the platform factor and Organisation A's own supplier factor for an Organisation A caller", async () => {
    const candidates = await findFactorCandidates(ORG_A, { description: "road freight" });
    const ids = candidates.map((c) => c.id);
    expect(ids).toContain("factor-platform-1");
    expect(ids).toContain("factor-aster-1");
    expect(ids).not.toContain("factor-birch-1");
  });

  it("includes the platform factor and Organisation B's own supplier factor for an Organisation B caller, never Organisation A's", async () => {
    const candidates = await findFactorCandidates(ORG_B, { description: "road freight" });
    const ids = candidates.map((c) => c.id);
    expect(ids).toContain("factor-platform-1");
    expect(ids).toContain("factor-birch-1");
    expect(ids).not.toContain("factor-aster-1");
  });
});

/**
 * Safe removal controls for the EMS foundation module (safe-deletion pass).
 * Context issues, interested parties/requirements, risks/opportunities,
 * draft EMS programmes and draft scope versions previously had create/edit
 * UI and no removal action at all. Synthetic Aster/Birch fixtures only; no
 * real environmental data, no live database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const tables = vi.hoisted(() => ({
  programmes: [] as Row[],
  scopeVersions: [] as Row[],
  scopeEntities: [] as Row[],
  scopeSites: [] as Row[],
  scopeActivities: [] as Row[],
  contextIssues: [] as Row[],
  interestedParties: [] as Row[],
  interestedPartyRequirements: [] as Row[],
  riskOpportunities: [] as Row[],
  changeAssessments: [] as Row[],
  evidenceLinks: [] as Row[],
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function table(rows: Row[]) {
  return {
    findFirst: vi.fn(async ({ where }: { where: Row }) => rows.find((row) => matches(row, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Row }) => rows.filter((row) => matches(row, where))),
    count: vi.fn(async ({ where }: { where: Row }) => rows.filter((row) => matches(row, where)).length),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const row = rows.find((item) => item.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
    delete: vi.fn(async ({ where }: { where: Row }) => {
      const index = rows.findIndex((item) => item.id === where.id);
      if (index < 0) throw new Error("not found");
      return rows.splice(index, 1)[0];
    }),
    deleteMany: vi.fn(async ({ where }: { where: Row }) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (matches(rows[i], where)) { rows.splice(i, 1); count += 1; }
      }
      return { count };
    }),
  };
}

vi.mock("@/lib/prisma", () => {
  const client: Row = {
    emsProgramme: table(tables.programmes),
    emsScopeVersion: table(tables.scopeVersions),
    emsScopeEntity: table(tables.scopeEntities),
    emsScopeSite: table(tables.scopeSites),
    emsScopeActivity: table(tables.scopeActivities),
    contextIssue: table(tables.contextIssues),
    interestedParty: table(tables.interestedParties),
    interestedPartyRequirement: table(tables.interestedPartyRequirements),
    emsRiskOpportunity: table(tables.riskOpportunities),
    changeAssessment: table(tables.changeAssessments),
    evidenceLink: table(tables.evidenceLinks),
  };
  client.$transaction = vi.fn(async (callback: (tx: Row) => Promise<unknown>) => callback(client));
  return { prisma: client };
});

vi.mock("@/lib/repositories/audit-repository", () => ({
  recordAuditEvent: vi.fn(async () => ({ id: "synthetic-audit" })),
}));
vi.mock("@/lib/jobs/outbox-service", () => ({ enqueueTenantJob: vi.fn(async () => undefined) }));

const contextService = await import("@/lib/ems/foundation/context-service");
const programmeService = await import("@/lib/ems/foundation/programme-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const ALL = new Set(["ems.view", "ems.programme.manage", "ems.policy.manage"]) as never;
const contextA = makeOrganisationContext(ORG_A, { userId: "user-a", membershipId: "membership-a", permissions: ALL });
const contextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: ALL });
const viewerA = makeOrganisationContext(ORG_A, {
  userId: "user-a", membershipId: "membership-a", permissions: new Set(["ems.view"]) as never,
});

beforeEach(() => {
  Object.values(tables).forEach((rows) => { rows.length = 0; });
  vi.clearAllMocks();
  tables.programmes.push({ id: "programme-a", organisationId: ORG_A, name: "Aster EMS", status: "DRAFT" });
  tables.contextIssues.push({ id: "issue-a", organisationId: ORG_A, programmeId: "programme-a", title: "Drought risk", type: "EXTERNAL" });
  tables.interestedParties.push({ id: "party-a", organisationId: ORG_A, programmeId: "programme-a", name: "Regulator", isActive: true });
  tables.riskOpportunities.push({
    id: "risk-a", organisationId: ORG_A, programmeId: "programme-a", kind: "RISK", category: "Flooding",
    status: "OPEN", residualRating: null,
  });
});

describe("deleteContextIssue", () => {
  it("deletes an issue with no change-assessment citation", async () => {
    const result = await contextService.deleteContextIssue(contextA, "issue-a", "user-a");
    expect(result.id).toBe("issue-a");
    expect(tables.contextIssues).toHaveLength(0);
  });

  it("blocks deletion when a change assessment cites the issue", async () => {
    tables.changeAssessments.push({
      id: "ca-1", organisationId: ORG_A, affectedRefs: [{ resourceType: "context_issue", resourceId: "issue-a" }],
    });
    await expect(contextService.deleteContextIssue(contextA, "issue-a", "user-a")).rejects.toThrow(contextService.EmsContextError);
    expect(tables.contextIssues).toHaveLength(1);
  });

  it("refuses a foreign-tenant issue id", async () => {
    await expect(contextService.deleteContextIssue(contextB, "issue-a", "user-b")).rejects.toThrow(TenantOwnershipError);
  });

  it("refuses a viewer without ems.programme.manage", async () => {
    await expect(contextService.deleteContextIssue(viewerA, "issue-a", "user-a")).rejects.toThrow(PermissionDeniedError);
  });
});

describe("deleteInterestedParty / deleteInterestedPartyRequirement", () => {
  it("deletes a party with zero requirements", async () => {
    const result = await contextService.deleteInterestedParty(contextA, "party-a", "user-a");
    expect(result.id).toBe("party-a");
    expect(tables.interestedParties).toHaveLength(0);
  });

  it("blocks deletion once the party has a requirement — deactivate instead", async () => {
    tables.interestedPartyRequirements.push({ id: "req-a", organisationId: ORG_A, interestedPartyId: "party-a", summary: "Annual report" });
    await expect(contextService.deleteInterestedParty(contextA, "party-a", "user-a")).rejects.toThrow(contextService.EmsContextError);
    expect(tables.interestedParties).toHaveLength(1);
  });

  it("deletes a requirement and its evidence links, leaving the party intact", async () => {
    tables.interestedPartyRequirements.push({ id: "req-a", organisationId: ORG_A, interestedPartyId: "party-a", summary: "Annual report" });
    tables.evidenceLinks.push({ id: "link-1", organisationId: ORG_A, resourceType: "interested_party_requirement", resourceId: "req-a" });
    const result = await contextService.deleteInterestedPartyRequirement(contextA, "req-a", "user-a");
    expect(result.id).toBe("req-a");
    expect(tables.interestedPartyRequirements).toHaveLength(0);
    expect(tables.evidenceLinks).toHaveLength(0);
    expect(tables.interestedParties).toHaveLength(1);
  });

  it("refuses a foreign-tenant party id", async () => {
    await expect(contextService.deleteInterestedParty(contextB, "party-a", "user-b")).rejects.toThrow(TenantOwnershipError);
  });
});

describe("deleteEmsRiskOpportunity", () => {
  it("deletes an OPEN risk with no residual rating", async () => {
    const result = await contextService.deleteEmsRiskOpportunity(contextA, "risk-a", "user-a");
    expect(result.id).toBe("risk-a");
    expect(tables.riskOpportunities).toHaveLength(0);
  });

  it("blocks deletion once a residual rating has been recorded", async () => {
    tables.riskOpportunities[0].residualRating = { likelihood: "LOW" };
    await expect(contextService.deleteEmsRiskOpportunity(contextA, "risk-a", "user-a")).rejects.toThrow(contextService.EmsContextError);
  });

  it("blocks deletion once status has moved past OPEN", async () => {
    tables.riskOpportunities[0].status = "CLOSED";
    await expect(contextService.deleteEmsRiskOpportunity(contextA, "risk-a", "user-a")).rejects.toThrow(contextService.EmsContextError);
  });

  it("blocks deletion when cited by a change assessment", async () => {
    tables.changeAssessments.push({
      id: "ca-1", organisationId: ORG_A, affectedRefs: [{ resourceType: "ems_risk_opportunity", resourceId: "risk-a" }],
    });
    await expect(contextService.deleteEmsRiskOpportunity(contextA, "risk-a", "user-a")).rejects.toThrow(contextService.EmsContextError);
  });

  it("refuses a foreign-tenant risk id", async () => {
    await expect(contextService.deleteEmsRiskOpportunity(contextB, "risk-a", "user-b")).rejects.toThrow(TenantOwnershipError);
  });
});

describe("deleteDraftEmsProgramme", () => {
  it("deletes an empty draft programme", async () => {
    const result = await programmeService.deleteDraftEmsProgramme(contextA, "programme-a", "user-a");
    expect(result.id).toBe("programme-a");
    expect(tables.programmes).toHaveLength(0);
  });

  it("blocks deletion once a scope version exists", async () => {
    tables.scopeVersions.push({ id: "version-a", organisationId: ORG_A, programmeId: "programme-a", status: "DRAFT", versionNumber: 1 });
    await expect(programmeService.deleteDraftEmsProgramme(contextA, "programme-a", "user-a")).rejects.toThrow(
      programmeService.EmsProgrammeError,
    );
    expect(tables.programmes).toHaveLength(1);
  });

  it("blocks deletion once the programme is no longer DRAFT", async () => {
    tables.programmes[0].status = "ACTIVE";
    await expect(programmeService.deleteDraftEmsProgramme(contextA, "programme-a", "user-a")).rejects.toThrow(
      programmeService.EmsProgrammeError,
    );
  });

  it("refuses a foreign-tenant programme id", async () => {
    await expect(programmeService.deleteDraftEmsProgramme(contextB, "programme-a", "user-b")).rejects.toThrow(TenantOwnershipError);
  });
});

describe("deleteDraftScopeVersion", () => {
  beforeEach(() => {
    tables.scopeVersions.push({ id: "version-a", organisationId: ORG_A, programmeId: "programme-a", status: "DRAFT", versionNumber: 2 });
    tables.scopeEntities.push({ id: "se-1", organisationId: ORG_A, scopeVersionId: "version-a", entityId: "entity-a" });
  });

  it("deletes a draft version and its boundary links", async () => {
    const result = await programmeService.deleteDraftScopeVersion(contextA, "version-a", "user-a");
    expect(result.id).toBe("version-a");
    expect(tables.scopeVersions).toHaveLength(0);
    expect(tables.scopeEntities).toHaveLength(0);
  });

  it("blocks deletion once the version has left DRAFT", async () => {
    tables.scopeVersions[0].status = "IN_REVIEW";
    await expect(programmeService.deleteDraftScopeVersion(contextA, "version-a", "user-a")).rejects.toThrow(
      programmeService.EmsProgrammeError,
    );
    expect(tables.scopeVersions).toHaveLength(1);
  });

  it("refuses a foreign-tenant scope version id", async () => {
    await expect(programmeService.deleteDraftScopeVersion(contextB, "version-a", "user-b")).rejects.toThrow(TenantOwnershipError);
  });
});

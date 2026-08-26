/**
 * Lifecycle-exit coverage (EMS/carbon lifecycle-coverage completion pass).
 *
 * Every entity here previously had create/edit UI and no way at all to close
 * the record out. These tests prove the exit chosen for each one: that it
 * refuses on an immutable/issued record, that it refuses a foreign-tenant id,
 * and that the permission gate holds. Synthetic Aster/Birch fixtures only —
 * no live database and no real environmental data.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const tables = vi.hoisted(() => ({
  emergencyPlans: [] as Row[],
  auditProgrammes: [] as Row[],
  emsAudits: [] as Row[],
  applicabilityAssessments: [] as Row[],
  applicabilityScopes: [] as Row[],
  evidenceLinks: [] as Row[],
  requirements: [] as Row[],
  requirementVersions: [] as Row[],
  requirementScopes: [] as Row[],
  assignments: [] as Row[],
  evidence: [] as Row[],
  legalHolds: [] as Row[],
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    if (key === "OR" && Array.isArray(value)) return value.some((clause: Row) => matches(row, clause));
    return row[key] === value;
  });
}

function table(rows: Row[], idPrefix: string) {
  return {
    findFirst: vi.fn(async ({ where }: { where: Row }) => rows.find((row) => matches(row, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Row }) => rows.filter((row) => matches(row, where))),
    count: vi.fn(async ({ where }: { where: Row }) => rows.filter((row) => matches(row, where)).length),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `${idPrefix}-${rows.length + 1}`, ...data };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const row = rows.find((item) => matches(item, where.organisationId_id ?? where));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
    delete: vi.fn(async ({ where }: { where: Row }) => {
      const index = rows.findIndex((item) => matches(item, where.organisationId_id ?? where));
      if (index < 0) throw new Error("not found");
      return rows.splice(index, 1)[0];
    }),
    deleteMany: vi.fn(async ({ where }: { where: Row }) => {
      let count = 0;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (matches(rows[index], where)) { rows.splice(index, 1); count += 1; }
      }
      return { count };
    }),
  };
}

vi.mock("@/lib/prisma", () => {
  const client: Row = {
    emergencyPlan: table(tables.emergencyPlans, "plan"),
    auditProgramme: table(tables.auditProgrammes, "programme"),
    emsAudit: table(tables.emsAudits, "audit"),
    applicabilityAssessment: table(tables.applicabilityAssessments, "assessment"),
    applicabilityAssessmentScope: table(tables.applicabilityScopes, "scope"),
    evidenceLink: table(tables.evidenceLinks, "link"),
    competenceRequirement: table(tables.requirements, "requirement"),
    competenceRequirementVersion: table(tables.requirementVersions, "version"),
    competenceRequirementScope: table(tables.requirementScopes, "reqscope"),
    competenceAssignment: table(tables.assignments, "assignment"),
    competenceEvidence: table(tables.evidence, "evidence"),
    legalHold: table(tables.legalHolds, "hold"),
  };
  client.$transaction = vi.fn(async (callback: (tx: Row) => Promise<unknown>) => callback(client));
  return { prisma: client };
});

vi.mock("@/lib/repositories/audit-repository", () => ({
  recordAuditEvent: vi.fn(async () => ({ id: "synthetic-audit" })),
}));
vi.mock("@/lib/documents/evidence-service", () => ({
  linkEvidence: vi.fn(),
  uploadEvidenceObject: vi.fn(async () => ({ id: "synthetic-evidence" })),
}));

const emergency = await import("@/lib/ems/emergency/emergency-service");
const programmes = await import("@/lib/ems/audits/programme-service");
const applicability = await import("@/lib/ems/legal/applicability-service");
const requirements = await import("@/lib/ems/competence/requirement-service");
const assignments = await import("@/lib/ems/competence/assignment-service");
const evidence = await import("@/lib/ems/competence/evidence-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const ALL = new Set([
  "ems.view",
  "ems.emergency_plan.manage",
  "ems.audit_programme.manage",
  "ems.applicability.assess",
  "ems.competence.manage",
  "ems.competence.view",
]) as never;

const contextA = makeOrganisationContext(ORG_A, { userId: "user-a", membershipId: "membership-a", permissions: ALL });
const contextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: ALL });
const viewerA = makeOrganisationContext(ORG_A, {
  userId: "user-a", membershipId: "membership-a", permissions: new Set(["ems.view"]) as never,
});

beforeEach(() => {
  Object.values(tables).forEach((rows) => { rows.length = 0; });
  vi.clearAllMocks();
});

describe("retireEmergencyPlan", () => {
  beforeEach(() => {
    tables.emergencyPlans.push(
      { id: "plan-a", organisationId: ORG_A, scenarioId: "scenario-a", version: 1, status: "ACTIVE" },
      { id: "plan-a-superseded", organisationId: ORG_A, scenarioId: "scenario-a", version: 0, status: "SUPERSEDED" },
    );
  });

  it("retires an active plan without touching its controlled-document revision", async () => {
    const retired = await emergency.retireEmergencyPlan(contextA, "plan-a", "Scenario withdrawn.", "user-a");
    expect(retired.status).toBe("RETIRED");
    expect(tables.emergencyPlans).toHaveLength(2);
  });

  it("refuses a superseded plan — the revision chain stays immutable", async () => {
    await expect(
      emergency.retireEmergencyPlan(contextA, "plan-a-superseded", "Tidy up.", "user-a"),
    ).rejects.toThrow(/draft or active/i);
  });

  it("requires a reason", async () => {
    await expect(emergency.retireEmergencyPlan(contextA, "plan-a", "  ", "user-a")).rejects.toThrow(/Record why/i);
  });

  it("refuses a foreign-tenant plan id", async () => {
    await expect(emergency.retireEmergencyPlan(contextB, "plan-a", "Cross-tenant.", "user-b"))
      .rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("denies a caller without ems.emergency_plan.manage", async () => {
    await expect(emergency.retireEmergencyPlan(viewerA, "plan-a", "No permission.", "user-a"))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("cancelAuditProgramme", () => {
  beforeEach(() => {
    tables.auditProgrammes.push(
      { id: "programme-a", organisationId: ORG_A, name: "Aster synthetic programme", status: "DRAFT" },
      { id: "programme-a-active", organisationId: ORG_A, name: "Aster active programme", status: "ACTIVE" },
      { id: "programme-a-done", organisationId: ORG_A, name: "Aster completed programme", status: "COMPLETED" },
    );
  });

  it("cancels a programme that has produced no audits", async () => {
    const cancelled = await programmes.cancelAuditProgramme(contextA, "programme-a", "Deferred a year.", "user-a");
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("refuses once an audit exists under it — audit history stays intact", async () => {
    tables.emsAudits.push({ id: "audit-a", organisationId: ORG_A, programmeId: "programme-a-active" });
    await expect(
      programmes.cancelAuditProgramme(contextA, "programme-a-active", "Deferred.", "user-a"),
    ).rejects.toThrow(/Complete it instead/i);
  });

  it("refuses a completed programme", async () => {
    await expect(programmes.cancelAuditProgramme(contextA, "programme-a-done", "Deferred.", "user-a"))
      .rejects.toThrow(/draft, approved or active/i);
  });

  it("refuses a foreign-tenant programme id", async () => {
    await expect(programmes.cancelAuditProgramme(contextB, "programme-a", "Cross-tenant.", "user-b"))
      .rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("denies a caller without ems.audit_programme.manage", async () => {
    await expect(programmes.cancelAuditProgramme(viewerA, "programme-a", "No permission.", "user-a"))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("discardApplicabilityAssessmentDraft", () => {
  beforeEach(() => {
    tables.applicabilityAssessments.push(
      { id: "assessment-a", organisationId: ORG_A, status: "DRAFT", instrumentId: "instrument-1", otherRequirementSourceId: null },
      { id: "assessment-a-decided", organisationId: ORG_A, status: "APPLICABLE", instrumentId: "instrument-1", otherRequirementSourceId: null },
      { id: "assessment-a-review", organisationId: ORG_A, status: "IN_REVIEW", instrumentId: "instrument-1", otherRequirementSourceId: null },
    );
    tables.applicabilityScopes.push({ id: "scope-a", organisationId: ORG_A, assessmentId: "assessment-a" });
    tables.evidenceLinks.push({
      id: "link-a", organisationId: ORG_A, resourceType: "applicability_assessment", resourceId: "assessment-a",
    });
  });

  it("removes a draft with its scopes and evidence links", async () => {
    await applicability.discardApplicabilityAssessmentDraft(contextA, "assessment-a", "user-a");
    expect(tables.applicabilityAssessments.find((row) => row.id === "assessment-a")).toBeUndefined();
    expect(tables.applicabilityScopes).toHaveLength(0);
    expect(tables.evidenceLinks).toHaveLength(0);
  });

  it("refuses a decided assessment — a legal record is superseded, never deleted", async () => {
    await expect(applicability.discardApplicabilityAssessmentDraft(contextA, "assessment-a-decided", "user-a"))
      .rejects.toThrow(/Only a draft/i);
    expect(tables.applicabilityAssessments.find((row) => row.id === "assessment-a-decided")).toBeDefined();
  });

  it("refuses an assessment already submitted for review", async () => {
    await expect(applicability.discardApplicabilityAssessmentDraft(contextA, "assessment-a-review", "user-a"))
      .rejects.toThrow(/Only a draft/i);
  });

  it("refuses a draft under legal hold", async () => {
    tables.legalHolds.push({
      id: "hold-a", organisationId: ORG_A, resourceType: "applicability_assessment",
      resourceId: "assessment-a", status: "ACTIVE",
    });
    await expect(applicability.discardApplicabilityAssessmentDraft(contextA, "assessment-a", "user-a"))
      .rejects.toThrow(/legal hold/i);
    expect(tables.applicabilityAssessments.find((row) => row.id === "assessment-a")).toBeDefined();
  });

  it("refuses a foreign-tenant assessment id", async () => {
    await expect(applicability.discardApplicabilityAssessmentDraft(contextB, "assessment-a", "user-b"))
      .rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("denies a caller without ems.applicability.assess", async () => {
    await expect(applicability.discardApplicabilityAssessmentDraft(viewerA, "assessment-a", "user-a"))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("discardCompetenceRequirementVersionDraft", () => {
  beforeEach(() => {
    tables.requirements.push(
      { id: "requirement-a", organisationId: ORG_A, requirementKey: "synthetic-req-a" },
      { id: "requirement-a-multi", organisationId: ORG_A, requirementKey: "synthetic-req-a-multi" },
    );
    tables.requirementVersions.push(
      { id: "version-a", organisationId: ORG_A, requirementId: "requirement-a", version: 1, title: "Synthetic requirement", status: "DRAFT" },
      { id: "version-a-active", organisationId: ORG_A, requirementId: "requirement-a-multi", version: 1, title: "Synthetic active", status: "ACTIVE" },
      { id: "version-a-draft2", organisationId: ORG_A, requirementId: "requirement-a-multi", version: 2, title: "Synthetic successor", status: "DRAFT" },
    );
    tables.requirementScopes.push({ id: "reqscope-a", organisationId: ORG_A, requirementVersionId: "version-a" });
  });

  it("removes a sole draft version and the now-empty requirement shell", async () => {
    await requirements.discardCompetenceRequirementVersionDraft(contextA, "version-a", "user-a");
    expect(tables.requirementVersions.find((row) => row.id === "version-a")).toBeUndefined();
    expect(tables.requirementScopes).toHaveLength(0);
    expect(tables.requirements.find((row) => row.id === "requirement-a")).toBeUndefined();
  });

  it("keeps the requirement when other versions remain", async () => {
    await requirements.discardCompetenceRequirementVersionDraft(contextA, "version-a-draft2", "user-a");
    expect(tables.requirements.find((row) => row.id === "requirement-a-multi")).toBeDefined();
    expect(tables.requirementVersions.find((row) => row.id === "version-a-active")).toBeDefined();
  });

  it("refuses an active version — the controlled revision chain is immutable", async () => {
    await expect(requirements.discardCompetenceRequirementVersionDraft(contextA, "version-a-active", "user-a"))
      .rejects.toThrow(/Only a draft/i);
  });

  it("refuses a draft under legal hold", async () => {
    tables.legalHolds.push({
      id: "hold-a", organisationId: ORG_A, resourceType: "competence_requirement_version",
      resourceId: "version-a", status: "ACTIVE",
    });
    await expect(requirements.discardCompetenceRequirementVersionDraft(contextA, "version-a", "user-a"))
      .rejects.toThrow(/legal hold/i);
  });

  it("refuses a foreign-tenant version id", async () => {
    await expect(requirements.discardCompetenceRequirementVersionDraft(contextB, "version-a", "user-b"))
      .rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("denies a caller without ems.competence.manage", async () => {
    await expect(requirements.discardCompetenceRequirementVersionDraft(viewerA, "version-a", "user-a"))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("withdrawCompetenceAssignment", () => {
  beforeEach(() => {
    tables.assignments.push({
      id: "assignment-a", organisationId: ORG_A, personId: "person-a", requirementVersionId: "version-a",
      status: "COMPETENT", competentUntil: new Date("2027-01-01"), gapSince: null, gapNote: null,
    });
  });

  it("withdraws the assignment and clears the expiry clock, keeping the record", async () => {
    const withdrawn = await assignments.withdrawCompetenceAssignment(contextA, "assignment-a", "Role change.", "user-a");
    expect(withdrawn.status).toBe("WITHDRAWN");
    expect(withdrawn.competentUntil).toBeNull();
    expect(tables.assignments).toHaveLength(1);
  });

  it("refuses an already-withdrawn assignment", async () => {
    await assignments.withdrawCompetenceAssignment(contextA, "assignment-a", "Role change.", "user-a");
    await expect(assignments.withdrawCompetenceAssignment(contextA, "assignment-a", "Again.", "user-a"))
      .rejects.toThrow(/already withdrawn/i);
  });

  it("requires a reason", async () => {
    await expect(assignments.withdrawCompetenceAssignment(contextA, "assignment-a", "  ", "user-a"))
      .rejects.toThrow(/Record why/i);
  });

  it("refuses a foreign-tenant assignment id", async () => {
    await expect(assignments.withdrawCompetenceAssignment(contextB, "assignment-a", "Cross-tenant.", "user-b"))
      .rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("denies a caller without ems.competence.manage", async () => {
    await expect(assignments.withdrawCompetenceAssignment(viewerA, "assignment-a", "No permission.", "user-a"))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("withdrawCompetenceEvidence", () => {
  beforeEach(() => {
    tables.assignments.push({
      id: "assignment-a", organisationId: ORG_A, personId: "person-a",
      requirementVersionId: "version-a", status: "EVIDENCE_SUBMITTED",
    });
    tables.evidence.push(
      { id: "evidence-a", organisationId: ORG_A, assignmentId: "assignment-a", personId: "person-a", status: "SUBMITTED" },
      { id: "evidence-a-verified", organisationId: ORG_A, assignmentId: "assignment-a", personId: "person-a", status: "VERIFIED" },
    );
  });

  it("withdraws submitted evidence without deleting the row", async () => {
    const withdrawn = await evidence.withdrawCompetenceEvidence(contextA, "evidence-a", "Wrong file.", "user-a");
    expect(withdrawn.status).toBe("WITHDRAWN");
    expect(tables.evidence).toHaveLength(2);
  });

  it("reverts the assignment to IN_PROGRESS once nothing outstanding remains", async () => {
    tables.evidence.splice(1, 1); // only the submitted row is left
    await evidence.withdrawCompetenceEvidence(contextA, "evidence-a", "Wrong file.", "user-a");
    expect(tables.assignments[0].status).toBe("IN_PROGRESS");
  });

  it("leaves the assignment alone while verified evidence still stands", async () => {
    await evidence.withdrawCompetenceEvidence(contextA, "evidence-a", "Wrong file.", "user-a");
    expect(tables.assignments[0].status).toBe("EVIDENCE_SUBMITTED");
  });

  it("refuses verified evidence — a verifier has already acted on it", async () => {
    await expect(evidence.withdrawCompetenceEvidence(contextA, "evidence-a-verified", "Changed mind.", "user-a"))
      .rejects.toThrow(/not yet been verified or rejected/i);
  });

  it("requires a reason", async () => {
    await expect(evidence.withdrawCompetenceEvidence(contextA, "evidence-a", "  ", "user-a"))
      .rejects.toThrow(/Record why/i);
  });

  it("refuses a foreign-tenant evidence id", async () => {
    await expect(evidence.withdrawCompetenceEvidence(contextB, "evidence-a", "Cross-tenant.", "user-b"))
      .rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("denies a caller without ems.competence.manage", async () => {
    await expect(evidence.withdrawCompetenceEvidence(viewerA, "evidence-a", "No permission.", "user-a"))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

/**
 * Competence evidence tests (task T71). No live database or storage —
 * Prisma, the T22 evidence upload/link pipeline, and the audit-event side
 * effect are all stubbed. Covers: submit -> EVIDENCE_SUBMITTED, the
 * "attendance alone does not prove competence unless policy says so" rule
 * (trainingSatisfiesRequirement gate), reject -> revert, and tenant
 * isolation. All fixtures are fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  assignments: [] as Row[],
  requirementVersions: [] as Row[],
  evidence: [] as Row[],
  nextId: 1,
}));

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    const operators = expected as { in?: unknown[] };
    if (operators.in) return operators.in.includes(actual);
    return false;
  }
  return actual === expected;
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => matchValue(row[key], value));
}

function find(rows: Row[], where: Row) {
  return rows.filter((row) => matches(row, where))[0] ?? null;
}

function simpleModel(rows: Row[], prefix: string, defaults: Row = {}) {
  return {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(rows, key as Row);
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => rows.filter((r) => matches(r, (where ?? {}) as Row))),
    count: vi.fn(async ({ where }: FindArgs) => rows.filter((r) => matches(r, (where ?? {}) as Row)).length),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `${prefix}-${tables.nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...defaults, ...data };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(rows, key as Row);
      if (!row) throw new Error(`${prefix} not found`);
      Object.assign(row, data);
      return row;
    }),
  };
}

vi.mock("@/lib/prisma", () => {
  const competenceAssignment = simpleModel(tables.assignments, "assignment");
  const competenceRequirementVersion = simpleModel(tables.requirementVersions, "version");
  const competenceEvidence = simpleModel(tables.evidence, "evidence", { status: "SUBMITTED" });

  const prismaClient = {
    competenceAssignment,
    competenceRequirementVersion,
    competenceEvidence,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-event-synthetic" })) }));

const uploadEvidenceObject = vi.fn(async () => ({ id: "evidence-object-synthetic", storageKey: "key-1" }));
const linkEvidence = vi.fn(async () => ({ id: "link-synthetic" }));
vi.mock("@/lib/documents/evidence-service", () => ({ uploadEvidenceObject, linkEvidence }));

const {
  CompetenceEvidenceError,
  TenantOwnershipError,
  submitCompetenceEvidence,
  verifyCompetenceEvidence,
  rejectCompetenceEvidence,
} = await import("@/lib/ems/competence/evidence-service");

const orgContextA = makeOrganisationContext(ORG_A, {
  permissions: new Set(["ems.competence.manage", "ems.competence.sensitive.view"]) as unknown as ReturnType<
    typeof makeOrganisationContext
  >["permissions"],
});

const file = { fileName: "certificate.pdf", mimeType: "application/pdf", bytes: Buffer.from("synthetic") };

beforeEach(() => {
  tables.assignments.length = 0;
  tables.requirementVersions.length = 0;
  tables.evidence.length = 0;
  tables.nextId = 1;
  uploadEvidenceObject.mockClear();
  linkEvidence.mockClear();

  tables.assignments.push({
    id: "assignment-1",
    organisationId: ORG_A,
    personId: "person-1",
    requirementVersionId: "version-training-gated",
    status: "REQUIRED",
    competentUntil: null,
  });
  tables.requirementVersions.push({
    id: "version-training-gated",
    organisationId: ORG_A,
    trainingSatisfiesRequirement: true,
  });
  tables.requirementVersions.push({
    id: "version-strict",
    organisationId: ORG_A,
    trainingSatisfiesRequirement: false,
  });
});

describe("submitCompetenceEvidence", () => {
  it("uploads the file, links it, and advances the assignment to EVIDENCE_SUBMITTED", async () => {
    const evidence = await submitCompetenceEvidence(orgContextA, {
      assignmentId: "assignment-1",
      evidenceType: "TRAINING",
      file,
      actorUserId: "user-1",
    });
    expect(uploadEvidenceObject).toHaveBeenCalledTimes(1);
    expect(linkEvidence).toHaveBeenCalledWith(
      orgContextA,
      expect.objectContaining({ evidenceId: "evidence-object-synthetic", resourceType: "competence_evidence", resourceId: evidence.id }),
    );
    expect(find(tables.assignments, { id: "assignment-1" })?.status).toBe("EVIDENCE_SUBMITTED");
  });

  it("does not disturb an already-COMPETENT assignment's status", async () => {
    const assignment = find(tables.assignments, { id: "assignment-1" })!;
    assignment.status = "COMPETENT";
    await submitCompetenceEvidence(orgContextA, {
      assignmentId: "assignment-1",
      evidenceType: "LICENCE",
      file,
      actorUserId: "user-1",
    });
    expect(assignment.status).toBe("COMPETENT");
  });

  it("denies a foreign-tenant assignment", async () => {
    const contextB = makeOrganisationContext(ORG_B, { permissions: orgContextA.permissions });
    await expect(
      submitCompetenceEvidence(contextB, { assignmentId: "assignment-1", evidenceType: "TRAINING", file, actorUserId: "user-1" }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

describe("verifyCompetenceEvidence — attendance does not automatically prove competence", () => {
  it("moves the assignment to COMPETENT for TRAINING evidence when the requirement version allows it", async () => {
    const expiryDate = new Date("2027-01-01");
    const evidence = await submitCompetenceEvidence(orgContextA, {
      assignmentId: "assignment-1",
      evidenceType: "TRAINING",
      expiryDate,
      file,
      actorUserId: "user-1",
    });
    const updated = await verifyCompetenceEvidence(orgContextA, evidence.id, "user-1");
    expect(updated.status).toBe("VERIFIED");
    expect(find(tables.assignments, { id: "assignment-1" })?.status).toBe("COMPETENT");
    expect(find(tables.assignments, { id: "assignment-1" })?.competentUntil).toEqual(expiryDate);
  });

  it("leaves the assignment at EVIDENCE_SUBMITTED for TRAINING evidence when the requirement version does NOT allow attendance alone", async () => {
    const assignment = find(tables.assignments, { id: "assignment-1" })!;
    assignment.requirementVersionId = "version-strict";
    const evidence = await submitCompetenceEvidence(orgContextA, {
      assignmentId: "assignment-1",
      evidenceType: "TRAINING",
      file,
      actorUserId: "user-1",
    });
    await verifyCompetenceEvidence(orgContextA, evidence.id, "user-1");
    expect(assignment.status).toBe("EVIDENCE_SUBMITTED");
  });

  it("never auto-completes from non-TRAINING evidence, even when the requirement version allows training alone", async () => {
    const evidence = await submitCompetenceEvidence(orgContextA, {
      assignmentId: "assignment-1",
      evidenceType: "LICENCE",
      file,
      actorUserId: "user-1",
    });
    await verifyCompetenceEvidence(orgContextA, evidence.id, "user-1");
    expect(find(tables.assignments, { id: "assignment-1" })?.status).toBe("EVIDENCE_SUBMITTED");
  });

  it("rejects verifying evidence that is not SUBMITTED", async () => {
    const evidence = await submitCompetenceEvidence(orgContextA, {
      assignmentId: "assignment-1",
      evidenceType: "TRAINING",
      file,
      actorUserId: "user-1",
    });
    await verifyCompetenceEvidence(orgContextA, evidence.id, "user-1");
    await expect(verifyCompetenceEvidence(orgContextA, evidence.id, "user-1")).rejects.toThrow(CompetenceEvidenceError);
  });
});

describe("rejectCompetenceEvidence", () => {
  it("reverts EVIDENCE_SUBMITTED back to IN_PROGRESS when no other evidence remains outstanding", async () => {
    const evidence = await submitCompetenceEvidence(orgContextA, {
      assignmentId: "assignment-1",
      evidenceType: "LICENCE",
      file,
      actorUserId: "user-1",
    });
    expect(find(tables.assignments, { id: "assignment-1" })?.status).toBe("EVIDENCE_SUBMITTED");
    const rejected = await rejectCompetenceEvidence(orgContextA, evidence.id, "Certificate illegible.", "user-1");
    expect(rejected.status).toBe("REJECTED");
    expect(find(tables.assignments, { id: "assignment-1" })?.status).toBe("IN_PROGRESS");
  });

  it("requires a rejection reason", async () => {
    const evidence = await submitCompetenceEvidence(orgContextA, {
      assignmentId: "assignment-1",
      evidenceType: "LICENCE",
      file,
      actorUserId: "user-1",
    });
    await expect(rejectCompetenceEvidence(orgContextA, evidence.id, "  ", "user-1")).rejects.toThrow(CompetenceEvidenceError);
  });
});

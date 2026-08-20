/**
 * Competence assessment tests (task T71). No live database — Prisma is
 * replaced with an in-memory fake and the audit-event side effect is
 * stubbed. Covers: DRAFT -> COMPLETED -> SUPERSEDED, outcome driving the
 * assignment to COMPETENT/GAP, and tenant isolation. All fixtures are
 * fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  assignments: [] as Row[],
  assessments: [] as Row[],
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
  const competenceAssessment = simpleModel(tables.assessments, "assessment", { status: "DRAFT" });

  const prismaClient = {
    competenceAssignment,
    competenceAssessment,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-event-synthetic" })) }));

const {
  CompetenceAssessmentError,
  TenantOwnershipError,
  createCompetenceAssessment,
  completeCompetenceAssessment,
} = await import("@/lib/ems/competence/assessment-service");

const orgContextA = makeOrganisationContext(ORG_A, {
  permissions: new Set(["ems.competence.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});

beforeEach(() => {
  tables.assignments.length = 0;
  tables.assessments.length = 0;
  tables.nextId = 1;
  tables.assignments.push({ id: "assignment-1", organisationId: ORG_A, status: "EVIDENCE_SUBMITTED", competentUntil: null });
});

describe("createCompetenceAssessment", () => {
  it("creates a DRAFT assessment", async () => {
    const assessment = await createCompetenceAssessment(orgContextA, {
      assignmentId: "assignment-1",
      method: "Practical observation",
      actorUserId: "user-1",
    });
    expect(assessment.status).toBe("DRAFT");
  });

  it("rejects a second draft for the same assignment", async () => {
    await createCompetenceAssessment(orgContextA, { assignmentId: "assignment-1", method: "Interview", actorUserId: "user-1" });
    await expect(
      createCompetenceAssessment(orgContextA, { assignmentId: "assignment-1", method: "Interview", actorUserId: "user-1" }),
    ).rejects.toThrow(CompetenceAssessmentError);
  });

  it("denies a foreign-tenant assignment", async () => {
    const contextB = makeOrganisationContext(ORG_B, { permissions: orgContextA.permissions });
    await expect(
      createCompetenceAssessment(contextB, { assignmentId: "assignment-1", method: "Interview", actorUserId: "user-1" }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

describe("completeCompetenceAssessment — outcome drives the assignment, not attendance", () => {
  it("moves the assignment to COMPETENT on a COMPETENT outcome, using reassessmentDueDate as the expiry", async () => {
    const assessment = await createCompetenceAssessment(orgContextA, {
      assignmentId: "assignment-1",
      method: "Practical observation",
      actorUserId: "user-1",
    });
    const dueDate = new Date("2027-06-01");
    const completed = await completeCompetenceAssessment(orgContextA, assessment.id, {
      assessorUserId: "assessor-1",
      outcome: "COMPETENT",
      reassessmentDueDate: dueDate,
      actorUserId: "user-1",
    });
    expect(completed.status).toBe("COMPLETED");
    const assignment = find(tables.assignments, { id: "assignment-1" });
    expect(assignment?.status).toBe("COMPETENT");
    expect(assignment?.competentUntil).toEqual(dueDate);
  });

  it("moves the assignment to GAP on a NOT_COMPETENT outcome", async () => {
    const assessment = await createCompetenceAssessment(orgContextA, {
      assignmentId: "assignment-1",
      method: "Practical observation",
      actorUserId: "user-1",
    });
    await completeCompetenceAssessment(orgContextA, assessment.id, {
      assessorUserId: "assessor-1",
      outcome: "NOT_COMPETENT",
      actorUserId: "user-1",
    });
    const assignment = find(tables.assignments, { id: "assignment-1" });
    expect(assignment?.status).toBe("GAP");
    expect(assignment?.gapNote).toBeTruthy();
  });

  it("supersedes the prior COMPLETED assessment on a reassessment", async () => {
    const first = await createCompetenceAssessment(orgContextA, {
      assignmentId: "assignment-1",
      method: "Practical observation",
      actorUserId: "user-1",
    });
    await completeCompetenceAssessment(orgContextA, first.id, {
      assessorUserId: "assessor-1",
      outcome: "COMPETENT",
      actorUserId: "user-1",
    });

    const second = await createCompetenceAssessment(orgContextA, {
      assignmentId: "assignment-1",
      method: "Reassessment interview",
      actorUserId: "user-1",
    });
    const completedSecond = await completeCompetenceAssessment(orgContextA, second.id, {
      assessorUserId: "assessor-1",
      outcome: "COMPETENT",
      actorUserId: "user-1",
    });

    expect(find(tables.assessments, { id: first.id })?.status).toBe("SUPERSEDED");
    expect(completedSecond.supersedesAssessmentId).toBe(first.id);
  });

  it("rejects completing an assessment that is not DRAFT", async () => {
    const assessment = await createCompetenceAssessment(orgContextA, {
      assignmentId: "assignment-1",
      method: "Practical observation",
      actorUserId: "user-1",
    });
    await completeCompetenceAssessment(orgContextA, assessment.id, {
      assessorUserId: "assessor-1",
      outcome: "COMPETENT",
      actorUserId: "user-1",
    });
    await expect(
      completeCompetenceAssessment(orgContextA, assessment.id, { assessorUserId: "assessor-1", outcome: "COMPETENT", actorUserId: "user-1" }),
    ).rejects.toThrow(CompetenceAssessmentError);
  });
});

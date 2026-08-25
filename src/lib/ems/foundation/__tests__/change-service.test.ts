/**
 * EMS change assessment lifecycle tests (task T23). No live database —
 * Prisma is replaced with an in-memory fake, following the T22 pattern.
 * Covers the DRAFT -> REVIEW -> APPROVED -> IMPLEMENTED ->
 * EFFECTIVENESS_REVIEWED state machine and the `affectedRefs` allow-list /
 * tenant-ownership validation.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

const { programmes, assessments, scopeVersions, resetTables, nextIdRef } = vi.hoisted(() => {
  const programmes: { id: string; organisationId: string }[] = [];
  const assessments: Record<string, unknown>[] = [];
  const scopeVersions: { id: string; organisationId: string }[] = [];
  const nextIdRef = { n: 1 };
  function resetTables() {
    programmes.length = 0;
    assessments.length = 0;
    scopeVersions.length = 0;
    nextIdRef.n = 1;
  }
  return { programmes, assessments, scopeVersions, resetTables, nextIdRef };
});

function nextId(prefix: string): string {
  return `${prefix}-${nextIdRef.n++}`;
}

function matches(row: object, where: Record<string, unknown>): boolean {
  const record = row as Record<string, unknown>;
  return Object.entries(where).every(([key, value]) => record[key] === value);
}

vi.mock("@/lib/prisma", () => {
  const emsProgramme = { findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => programmes.find((p) => matches(p, where)) ?? null) };
  const emsScopeVersion = { findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => scopeVersions.find((v) => matches(v, where)) ?? null) };
  const contextIssue = { findFirst: vi.fn(async () => null) };
  const interestedParty = { findFirst: vi.fn(async () => null) };
  const environmentalPolicyRecord = { findFirst: vi.fn(async () => null) };

  const changeAssessment = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: nextId("change"), status: "DRAFT", affectedRefs: [], ...data };
      assessments.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = assessments.find((a) => a.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => assessments.find((a) => matches(a, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => assessments.filter((a) => matches(a, where))),
  };

  const prismaClient = {
    emsProgramme,
    emsScopeVersion,
    contextIssue,
    interestedParty,
    environmentalPolicyRecord,
    changeAssessment,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({
  recordAuditEvent: vi.fn(async () => ({ id: "audit-1" })),
}));

const {
  createChangeAssessment,
  submitChangeAssessmentForReview,
  approveChangeAssessment,
  recordChangeImplementation,
  recordChangeEffectivenessReview,
  listChangeAssessments,
  ChangeAssessmentError,
} = await import("@/lib/ems/foundation/change-service");

const orgContextA = makeOrganisationContext(ORG_A, {
  userId: "user-lead",
  permissions: new Set(["ems.programme.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});

beforeEach(() => {
  resetTables();
  vi.clearAllMocks();
  programmes.push({ id: "programme-1", organisationId: ORG_A });
  scopeVersions.push({ id: "scope-version-1", organisationId: ORG_A });
});

async function draftToImplemented() {
  const assessment = await createChangeAssessment(orgContextA, {
    programmeId: "programme-1",
    proposedChange: "Add a new production line",
    triggerType: "structural",
    affectedRefs: [{ resourceType: "ems_scope_version", resourceId: "scope-version-1" }],
    actorUserId: "user-lead",
  });
  await submitChangeAssessmentForReview(orgContextA, assessment.id, "Assessed against current scope.", "user-lead");
  await approveChangeAssessment(orgContextA, assessment.id, "Proceed.", "user-approver");
  return recordChangeImplementation(orgContextA, assessment.id, "user-lead");
}

describe("ChangeAssessment lifecycle", () => {
  it("moves DRAFT -> REVIEW -> APPROVED -> IMPLEMENTED -> EFFECTIVENESS_REVIEWED", async () => {
    const implemented = await draftToImplemented();
    expect(implemented.status).toBe("IMPLEMENTED");

    const reviewed = await recordChangeEffectivenessReview(orgContextA, implemented.id, "No adverse impact observed.", "user-lead");
    expect(reviewed.status).toBe("EFFECTIVENESS_REVIEWED");

    const changes = await listChangeAssessments(orgContextA, "programme-1");
    expect(changes).toHaveLength(1);
    expect(changes[0].status).toBe("EFFECTIVENESS_REVIEWED");
  });

  it("refuses to approve a DRAFT assessment (must be REVIEW first)", async () => {
    const assessment = await createChangeAssessment(orgContextA, {
      programmeId: "programme-1",
      proposedChange: "Add a new production line",
      triggerType: "structural",
      actorUserId: "user-lead",
    });
    await expect(approveChangeAssessment(orgContextA, assessment.id, "Proceed.", "user-approver")).rejects.toThrow(ChangeAssessmentError);
  });

  it("refuses to skip straight from APPROVED to EFFECTIVENESS_REVIEWED", async () => {
    const assessment = await createChangeAssessment(orgContextA, {
      programmeId: "programme-1",
      proposedChange: "Add a new production line",
      triggerType: "structural",
      actorUserId: "user-lead",
    });
    await submitChangeAssessmentForReview(orgContextA, assessment.id, "Assessed.", "user-lead");
    await approveChangeAssessment(orgContextA, assessment.id, "Proceed.", "user-approver");
    await expect(recordChangeEffectivenessReview(orgContextA, assessment.id, "Skip ahead.", "user-lead")).rejects.toThrow(ChangeAssessmentError);
  });
});

describe("affectedRefs validation", () => {
  it("rejects an unknown resource type", async () => {
    await expect(
      createChangeAssessment(orgContextA, {
        programmeId: "programme-1",
        proposedChange: "Add a new production line",
        triggerType: "structural",
        affectedRefs: [{ resourceType: "ems_aspect", resourceId: "aspect-1" }],
        actorUserId: "user-lead",
      }),
    ).rejects.toThrow(/cannot reference resource type/);
  });

  it("rejects a foreign-tenant scope version reference", async () => {
    scopeVersions.push({ id: "scope-version-birch", organisationId: ORG_B });
    await expect(
      createChangeAssessment(orgContextA, {
        programmeId: "programme-1",
        proposedChange: "Add a new production line",
        triggerType: "structural",
        affectedRefs: [{ resourceType: "ems_scope_version", resourceId: "scope-version-birch" }],
        actorUserId: "user-lead",
      }),
    ).rejects.toThrow();
  });

  it("accepts a same-tenant scope version reference", async () => {
    const assessment = await createChangeAssessment(orgContextA, {
      programmeId: "programme-1",
      proposedChange: "Add a new production line",
      triggerType: "structural",
      affectedRefs: [{ resourceType: "ems_scope_version", resourceId: "scope-version-1" }],
      actorUserId: "user-lead",
    });
    expect(assessment.affectedRefs).toEqual([{ resourceType: "ems_scope_version", resourceId: "scope-version-1" }]);
  });
});

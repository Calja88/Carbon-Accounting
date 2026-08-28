/**
 * `deleteDraftAssessment` — the removal action for an accidental or
 * duplicate LCA assessment. Synthetic fixtures only; no live database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, ENTITY_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const tables = vi.hoisted(() => ({
  assessments: [] as Row[],
  auditEvents: [] as Row[],
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function countsFor(assessment: Row) {
  return {
    evidence: assessment._evidence ?? 0,
    calculationRuns: assessment._calculationRuns ?? 0,
    results: assessment._results ?? 0,
    versions: assessment._versions ?? 0,
    verifications: assessment._verifications ?? 0,
    revisions: assessment._revisions ?? 0,
    scenarioCopies: assessment._scenarioCopies ?? 0,
  };
}

vi.mock("@/lib/prisma", () => {
  const client: Row = {
    lcaAssessment: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => tables.assessments.find((row) => matches(row, where)) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: Row }) => {
        const row = tables.assessments.find((item) => item.id === where.id);
        if (!row) throw new Error("not found");
        return { _count: countsFor(row) };
      }),
      delete: vi.fn(async ({ where }: { where: Row }) => {
        const index = tables.assessments.findIndex((item) => item.id === where.id);
        if (index === -1) throw new Error("not found");
        const [row] = tables.assessments.splice(index, 1);
        return row;
      }),
    },
    lcaAuditEvent: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = { id: `audit-${tables.auditEvents.length + 1}`, ...data };
        tables.auditEvents.push(row);
        return row;
      }),
    },
  };
  client.$transaction = vi.fn(async (operation: (tx: Row) => Promise<unknown>) => operation(client));
  return { prisma: client };
});

const assessmentService = await import("@/lib/lca/assessment-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");

const contextA = makeOrganisationContext(ORG_A, { userId: "user-a", membershipId: "membership-a" });
const contextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b" });

const baseAssessment = {
  id: "assessment-a",
  organisationId: ORG_A,
  entityId: ENTITY_A,
  reference: "LCA-001",
  title: "Synthetic widget",
  status: "DRAFT",
};

beforeEach(() => {
  tables.assessments.length = 0;
  tables.auditEvents.length = 0;
  vi.clearAllMocks();
  tables.assessments.push({ ...baseAssessment });
});

describe("deleteDraftAssessment", () => {
  it("deletes an eligible empty draft and writes an audit event", async () => {
    await assessmentService.deleteDraftAssessment(contextA, "assessment-a", "user-a");
    expect(tables.assessments).toHaveLength(0);
    expect(tables.auditEvents).toHaveLength(1);
    expect(tables.auditEvents[0]).toMatchObject({
      entityType: "assessment",
      entityId: "assessment-a",
      action: "deleted",
      actorUserId: "user-a",
    });
    expect(tables.auditEvents[0].assessmentId).toBeUndefined();
  });

  it("refuses an assessment that is not DRAFT", async () => {
    tables.assessments[0].status = "VERIFIED";
    await expect(assessmentService.deleteDraftAssessment(contextA, "assessment-a", "user-a")).rejects.toThrow(
      /only a draft assessment can be deleted/i,
    );
    expect(tables.assessments).toHaveLength(1);
  });

  it.each([
    ["evidence", "_evidence", /evidence file/i],
    ["calculationRuns", "_calculationRuns", /calculation run/i],
    ["results", "_results", /calculation result/i],
    ["versions", "_versions", /issued version/i],
    ["verifications", "_verifications", /verification record/i],
    ["revisions", "_revisions", /later revision/i],
    ["scenarioCopies", "_scenarioCopies", /scenario/i],
  ])("blocks deletion when it has %s", async (_label, field, expected) => {
    tables.assessments[0][field] = 1;
    await expect(assessmentService.deleteDraftAssessment(contextA, "assessment-a", "user-a")).rejects.toThrow(expected);
    expect(tables.assessments).toHaveLength(1);
  });

  it("refuses a foreign-tenant assessment id", async () => {
    await expect(assessmentService.deleteDraftAssessment(contextB, "assessment-a", "user-b")).rejects.toBeInstanceOf(
      TenantOwnershipError,
    );
    expect(tables.assessments).toHaveLength(1);
  });

  it("refuses an id that does not exist", async () => {
    await expect(assessmentService.deleteDraftAssessment(contextA, "missing", "user-a")).rejects.toBeInstanceOf(
      TenantOwnershipError,
    );
  });
});

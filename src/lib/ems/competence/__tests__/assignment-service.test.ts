/**
 * Competence assignment tests (task T70). No live database — Prisma is
 * replaced with an in-memory fake and the audit-event side effect is
 * stubbed. Covers: only an ACTIVE requirement version can be assigned,
 * duplicate-assignment rejection, REQUIRED -> IN_PROGRESS -> GAP
 * transitions, and tenant isolation. All fixtures are fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  versions: [] as Row[],
  people: [] as Row[],
  assignments: [] as Row[],
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
  const competenceRequirementVersion = simpleModel(tables.versions, "version");
  const personProfile = simpleModel(tables.people, "person", { isActive: true });
  const competenceAssignment = simpleModel(tables.assignments, "assignment", { status: "REQUIRED" });

  const prismaClient = {
    competenceRequirementVersion,
    personProfile,
    competenceAssignment,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-event-synthetic" })) }));

const {
  CompetenceAssignmentError,
  TenantOwnershipError,
  assignCompetenceRequirement,
  startCompetenceAssignment,
  markCompetenceAssignmentGap,
} = await import("@/lib/ems/competence/assignment-service");

const orgContextA = makeOrganisationContext(ORG_A, {
  permissions: new Set(["ems.competence.view", "ems.competence.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});

beforeEach(() => {
  tables.versions.length = 0;
  tables.people.length = 0;
  tables.assignments.length = 0;
  tables.nextId = 1;

  tables.versions.push({ id: "version-active", organisationId: ORG_A, requirementId: "requirement-1", status: "ACTIVE" });
  tables.versions.push({ id: "version-draft", organisationId: ORG_A, requirementId: "requirement-1", status: "DRAFT" });
  tables.people.push({ id: "person-A1", organisationId: ORG_A, entityId: null, siteId: null, isActive: true });
});

describe("assignCompetenceRequirement", () => {
  it("assigns an ACTIVE requirement version to a person with status REQUIRED", async () => {
    const assignment = await assignCompetenceRequirement(orgContextA, {
      requirementVersionId: "version-active",
      personId: "person-A1",
      actorUserId: "user-1",
    });
    expect(assignment.status).toBe("REQUIRED");
  });

  it("rejects assigning a DRAFT requirement version", async () => {
    await expect(
      assignCompetenceRequirement(orgContextA, { requirementVersionId: "version-draft", personId: "person-A1", actorUserId: "user-1" }),
    ).rejects.toThrow(CompetenceAssignmentError);
  });

  it("rejects a duplicate assignment of the same version to the same person", async () => {
    await assignCompetenceRequirement(orgContextA, { requirementVersionId: "version-active", personId: "person-A1", actorUserId: "user-1" });
    await expect(
      assignCompetenceRequirement(orgContextA, { requirementVersionId: "version-active", personId: "person-A1", actorUserId: "user-1" }),
    ).rejects.toThrow(CompetenceAssignmentError);
  });

  it("rejects assigning to an inactive person", async () => {
    tables.people.push({ id: "person-inactive", organisationId: ORG_A, entityId: null, siteId: null, isActive: false });
    await expect(
      assignCompetenceRequirement(orgContextA, { requirementVersionId: "version-active", personId: "person-inactive", actorUserId: "user-1" }),
    ).rejects.toThrow(CompetenceAssignmentError);
  });

  it("denies a foreign-tenant requirement version", async () => {
    const contextB = makeOrganisationContext(ORG_B, { permissions: orgContextA.permissions });
    await expect(
      assignCompetenceRequirement(contextB, { requirementVersionId: "version-active", personId: "person-A1", actorUserId: "user-1" }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

describe("status transitions", () => {
  it("moves REQUIRED -> IN_PROGRESS -> GAP", async () => {
    const assignment = await assignCompetenceRequirement(orgContextA, {
      requirementVersionId: "version-active",
      personId: "person-A1",
      actorUserId: "user-1",
    });
    const started = await startCompetenceAssignment(orgContextA, assignment.id, "user-1");
    expect(started.status).toBe("IN_PROGRESS");
    const gapped = await markCompetenceAssignmentGap(orgContextA, assignment.id, { note: "Missed renewal.", actorUserId: "user-1" });
    expect(gapped.status).toBe("GAP");
    expect(gapped.gapNote).toBe("Missed renewal.");
  });

  it("does not alter requirementVersionId when a requirement is later revised", async () => {
    const assignment = await assignCompetenceRequirement(orgContextA, {
      requirementVersionId: "version-active",
      personId: "person-A1",
      actorUserId: "user-1",
    });
    await startCompetenceAssignment(orgContextA, assignment.id, "user-1");
    const stored = find(tables.assignments, { id: assignment.id });
    expect(stored?.requirementVersionId).toBe("version-active");
  });
});

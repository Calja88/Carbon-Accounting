/**
 * Objective metric definition versioning and approval tests (task T50). No
 * live database — Prisma is replaced with an in-memory fake. Covers the
 * DRAFT -> ACTIVE -> SUPERSEDED state machine, the approval transaction
 * (active-pointer move, four-eyes self-approval denial), successor
 * versions, and tenant isolation.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row; orderBy?: Row | Row[] };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  objectives: [] as Row[],
  definitions: [] as Row[],
  versions: [] as Row[],
  nextId: 1,
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function find(rows: Row[], where: Row, orderBy?: Row) {
  let candidates = rows.filter((row) => matches(row, where));
  if (orderBy) {
    const [key, direction] = Object.entries(orderBy)[0] as [string, "asc" | "desc"];
    candidates = [...candidates].sort((a, b) => {
      const av = a[key] as number;
      const bv = b[key] as number;
      return direction === "desc" ? bv - av : av - bv;
    });
  }
  return candidates[0] ?? null;
}

vi.mock("@/lib/prisma", () => {
  const environmentalObjective = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.objectives, key as Row);
    }),
  };

  const objectiveMetricDefinition = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.definitions, key as Row);
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => tables.definitions.filter((row) => matches(row, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const id = `metric-def-${tables.nextId++}`;
      const row: Row = { id, activeVersionId: null, createdAt: new Date(), ...data };
      tables.definitions.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.definitions, key);
      if (!row) throw new Error("definition not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const objectiveMetricVersion = {
    findFirst: vi.fn(async ({ where, orderBy }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.versions, key as Row, orderBy as Row);
    }),
    findUnique: vi.fn(async ({ where }: FindArgs) => find(tables.versions, where ?? {})),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const id = `metric-version-${tables.nextId++}`;
      const row: Row = {
        id,
        status: "DRAFT",
        approvedByUserId: null,
        approvedAt: null,
        supersedesVersionId: null,
        preparedAt: new Date(),
        createdAt: new Date(),
        ...data,
      };
      tables.versions.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.versions, key);
      if (!row) throw new Error("version not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const prismaClient = {
    environmentalObjective,
    objectiveMetricDefinition,
    objectiveMetricVersion,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-synthetic" })) }));

const {
  createObjectiveMetricDefinition,
  updateObjectiveMetricVersionDraft,
  approveObjectiveMetricVersion,
  createSuccessorObjectiveMetricVersion,
  ObjectiveMetricError,
} = await import("@/lib/ems/objectives/metric-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const EDIT_ONLY = new Set(["ems.view", "ems.objective.manage"]) as never;
const APPROVE_ONLY = new Set(["ems.view", "ems.objective.approve"]) as never;
const BOTH = new Set(["ems.view", "ems.objective.manage", "ems.objective.approve"]) as never;

const contextA = makeOrganisationContext(ORG_A, { userId: "user-drafter", membershipId: "membership-drafter", permissions: BOTH });
const contextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: BOTH });
const editOnlyContextA = makeOrganisationContext(ORG_A, { userId: "user-drafter", membershipId: "membership-drafter", permissions: EDIT_ONLY });
const approverContextA = makeOrganisationContext(ORG_A, { userId: "user-approver", membershipId: "membership-approver", permissions: APPROVE_ONLY });
const authorAsApproverContextA = makeOrganisationContext(ORG_A, {
  userId: "user-drafter",
  membershipId: "membership-drafter",
  permissions: APPROVE_ONLY,
});

function baseDraft(overrides: Record<string, unknown> = {}) {
  return {
    objectiveId: "objective-a",
    name: "Synthetic Scope 2 intensity metric",
    sourceType: "MANUAL" as const,
    unit: "tCO2e/unit",
    frequency: "Monthly",
    actorUserId: "user-drafter",
    ...overrides,
  };
}

beforeEach(() => {
  tables.objectives.length = 0;
  tables.definitions.length = 0;
  tables.versions.length = 0;
  tables.nextId = 1;

  tables.objectives.push({ id: "objective-a", organisationId: ORG_A });
  tables.objectives.push({ id: "objective-b", organisationId: ORG_B });
});

describe("createObjectiveMetricDefinition", () => {
  it("requires ems.objective.manage", async () => {
    await expect(createObjectiveMetricDefinition(approverContextA, baseDraft())).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("denies a foreign-tenant objective id", async () => {
    await expect(createObjectiveMetricDefinition(contextB, baseDraft({ objectiveId: "objective-a" }))).rejects.toBeInstanceOf(
      TenantOwnershipError,
    );
  });

  it("requires name, unit, and frequency", async () => {
    await expect(createObjectiveMetricDefinition(contextA, baseDraft({ name: "" }))).rejects.toBeInstanceOf(ObjectiveMetricError);
    await expect(createObjectiveMetricDefinition(contextA, baseDraft({ unit: "" }))).rejects.toBeInstanceOf(ObjectiveMetricError);
    await expect(createObjectiveMetricDefinition(contextA, baseDraft({ frequency: "" }))).rejects.toBeInstanceOf(ObjectiveMetricError);
  });

  it("creates a metric definition and its first DRAFT version, version 1", async () => {
    const { definition, version } = await createObjectiveMetricDefinition(contextA, baseDraft());
    expect(definition.objectiveId).toBe("objective-a");
    expect(version.status).toBe("DRAFT");
    expect(version.version).toBe(1);
  });
});

describe("approveObjectiveMetricVersion", () => {
  it("requires ems.objective.approve", async () => {
    const { version } = await createObjectiveMetricDefinition(contextA, baseDraft());
    await expect(approveObjectiveMetricVersion(editOnlyContextA, version.id, { actorUserId: "user-drafter" })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("denies self-approval when four-eyes is enabled (default)", async () => {
    const { version } = await createObjectiveMetricDefinition(contextA, baseDraft());
    await expect(approveObjectiveMetricVersion(authorAsApproverContextA, version.id, { actorUserId: "user-drafter" })).rejects.toThrow(
      /four.?eyes|self/i,
    );
  });

  it("only approves a DRAFT version", async () => {
    const { version } = await createObjectiveMetricDefinition(contextA, baseDraft());
    await approveObjectiveMetricVersion(approverContextA, version.id, { actorUserId: "user-approver" });
    await expect(approveObjectiveMetricVersion(approverContextA, version.id, { actorUserId: "user-approver" })).rejects.toBeInstanceOf(
      ObjectiveMetricError,
    );
  });

  it("moves the version to ACTIVE and the definition's active pointer to this version", async () => {
    const { definition, version } = await createObjectiveMetricDefinition(contextA, baseDraft());
    const approved = await approveObjectiveMetricVersion(approverContextA, version.id, { actorUserId: "user-approver" });
    expect(approved.status).toBe("ACTIVE");
    const updatedDefinition = tables.definitions.find((d) => d.id === definition.id);
    expect(updatedDefinition?.activeVersionId).toBe(version.id);
  });

  it("supersedes the previously ACTIVE version when a successor is approved", async () => {
    const { definition, version: v1 } = await createObjectiveMetricDefinition(contextA, baseDraft());
    await approveObjectiveMetricVersion(approverContextA, v1.id, { actorUserId: "user-approver" });

    const v2 = await createSuccessorObjectiveMetricVersion(contextA, definition.id, baseDraft());
    await approveObjectiveMetricVersion(approverContextA, v2.id, { actorUserId: "user-approver" });

    const supersededV1 = tables.versions.find((v) => v.id === v1.id);
    expect(supersededV1?.status).toBe("SUPERSEDED");
    const updatedDefinition = tables.definitions.find((d) => d.id === definition.id);
    expect(updatedDefinition?.activeVersionId).toBe(v2.id);
  });
});

describe("draft editing", () => {
  it("only edits a DRAFT version", async () => {
    const { version } = await createObjectiveMetricDefinition(contextA, baseDraft());
    await expect(updateObjectiveMetricVersionDraft(contextA, version.id, baseDraft({ name: "Updated" }))).resolves.toMatchObject({
      name: "Updated",
    });
    await approveObjectiveMetricVersion(approverContextA, version.id, { actorUserId: "user-approver" });
    await expect(updateObjectiveMetricVersionDraft(contextA, version.id, baseDraft())).rejects.toBeInstanceOf(ObjectiveMetricError);
  });
});

describe("createSuccessorObjectiveMetricVersion", () => {
  it("refuses a successor while the latest version is still DRAFT", async () => {
    const { definition } = await createObjectiveMetricDefinition(contextA, baseDraft());
    await expect(createSuccessorObjectiveMetricVersion(contextA, definition.id, baseDraft())).rejects.toBeInstanceOf(ObjectiveMetricError);
  });

  it("increments version and links supersedesVersionId", async () => {
    const { definition, version: v1 } = await createObjectiveMetricDefinition(contextA, baseDraft());
    await approveObjectiveMetricVersion(approverContextA, v1.id, { actorUserId: "user-approver" });
    const v2 = await createSuccessorObjectiveMetricVersion(contextA, definition.id, baseDraft());
    expect(v2.version).toBe(2);
    expect(v2.supersedesVersionId).toBe(v1.id);
  });
});

describe("tenant isolation", () => {
  it("Organisation B cannot read or act on an Organisation A metric version", async () => {
    const { version } = await createObjectiveMetricDefinition(contextA, baseDraft());
    await expect(approveObjectiveMetricVersion(contextB, version.id, { actorUserId: "user-b" })).rejects.toBeInstanceOf(TenantOwnershipError);
  });
});

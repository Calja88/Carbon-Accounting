/**
 * Action programmes and reminders tests (task T52). No live database —
 * Prisma is replaced with an in-memory fake, and the audit/notification
 * side-effects (already covered by their own T20/T24 suites) are stubbed so
 * these tests stay focused on: the closed-action lifecycle (completion,
 * verification with four-eyes, and the sole reopen escape hatch),
 * reassignment/status/progress history, dependency gating, and tenant
 * isolation. All titles/dates/notes below are fictional test fixtures only.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row; orderBy?: Row | Row[] };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  memberships: [] as Row[],
  objectives: [] as Row[],
  programmes: [] as Row[],
  actionItems: [] as Row[],
  dependencies: [] as Row[],
  progressUpdates: [] as Row[],
  statusHistory: [] as Row[],
  nextId: 1,
}));

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    const operators = expected as { in?: unknown[]; notIn?: unknown[]; lt?: Date };
    if (operators.in) return operators.in.includes(actual);
    if (operators.notIn) return !operators.notIn.includes(actual);
    if (operators.lt) return actual instanceof Date && actual.getTime() < operators.lt.getTime();
    return false;
  }
  return actual === expected;
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => matchValue(row[key], value));
}

function find(rows: Row[], where: Row) {
  return rows.find((row) => matches(row, where)) ?? null;
}

vi.mock("@/lib/prisma", () => {
  const organisationMembership = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.memberships, where ?? {})) };
  const environmentalObjective = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.objectives, where ?? {})) };

  const actionProgramme = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.programmes, key as Row);
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => tables.programmes.filter((row) => matches(row, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `programme-${tables.nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      tables.programmes.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.programmes, key);
      if (!row) throw new Error("programme not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const actionItem = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.actionItems, key as Row);
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => tables.actionItems.filter((row) => matches(row, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row & { dependenciesOn?: { create: Row[] } } }) => {
      const { dependenciesOn: depsEnvelope, ...itemData } = data;
      const id = `action-${tables.nextId++}`;
      const row: Row = {
        id,
        status: "OPEN",
        completedAt: null,
        completedByUserId: null,
        completionEvidenceNote: null,
        verifiedAt: null,
        verifiedByUserId: null,
        reopenedAt: null,
        reopenedByUserId: null,
        reopenReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...itemData,
      };
      tables.actionItems.push(row);
      const depRows = (depsEnvelope?.create ?? []).map((dep) => ({ id: `dep-${tables.nextId++}`, actionItemId: id, ...dep }));
      tables.dependencies.push(...depRows);
      return { ...row, dependenciesOn: depRows };
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.actionItems, key);
      if (!row) throw new Error("action item not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const actionDependency = {
    findMany: vi.fn(async ({ where }: FindArgs) => {
      const rows = tables.dependencies.filter((row) => matches(row, where ?? {}));
      return rows.map((row) => ({
        ...row,
        dependsOnActionItem: find(tables.actionItems, { id: row.dependsOnActionItemId }),
      }));
    }),
  };

  const actionProgressUpdate = {
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `progress-${tables.nextId++}`, recordedAt: new Date(), ...data };
      tables.progressUpdates.push(row);
      return row;
    }),
  };

  const actionStatusHistory = {
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `history-${tables.nextId++}`, occurredAt: new Date(), ...data };
      tables.statusHistory.push(row);
      return row;
    }),
  };

  const prismaClient = {
    organisationMembership,
    environmentalObjective,
    actionProgramme,
    actionItem,
    actionDependency,
    actionProgressUpdate,
    actionStatusHistory,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-synthetic" })) }));

const suppressNotificationsForResource = vi.fn(async (...args: unknown[]) => {
  void args;
  return 0;
});
vi.mock("@/lib/notifications/notification-service", () => ({
  notifyMembership: vi.fn(async () => ({ id: "notification-synthetic", status: "DELIVERED" })),
  suppressNotificationsForResource: (...args: unknown[]) => suppressNotificationsForResource(...args),
}));

const {
  createActionProgramme,
  createActionItem,
  reassignActionItem,
  setActionItemStatus,
  recordActionProgress,
  completeActionItem,
  verifyActionItem,
  reopenActionItem,
  ActionError,
} = await import("@/lib/ems/actions/action-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const MANAGE_ONLY = new Set(["ems.view", "ems.action.manage"]) as never;

const contextA = makeOrganisationContext(ORG_A, { userId: "user-owner", membershipId: "membership-owner", permissions: MANAGE_ONLY });
const contextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: MANAGE_ONLY });
const noPermissionContextA = makeOrganisationContext(ORG_A, { userId: "user-owner", membershipId: "membership-owner", permissions: new Set(["ems.view"]) as never });
const verifierContextA = makeOrganisationContext(ORG_A, { userId: "user-verifier", membershipId: "membership-verifier", permissions: MANAGE_ONLY });

beforeEach(() => {
  tables.memberships.length = 0;
  tables.objectives.length = 0;
  tables.programmes.length = 0;
  tables.actionItems.length = 0;
  tables.dependencies.length = 0;
  tables.progressUpdates.length = 0;
  tables.statusHistory.length = 0;
  tables.nextId = 1;
  suppressNotificationsForResource.mockClear();

  tables.memberships.push({ id: "membership-owner", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-verifier", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-b", organisationId: ORG_B, status: "ACTIVE" });
});

async function createProgramme(context = contextA, overrides: Row = {}) {
  return createActionProgramme(context, {
    title: "Synthetic pilot-site waste reduction programme",
    ownerMembershipId: "membership-owner",
    actorUserId: "user-owner",
    ...overrides,
  });
}

async function createAction(programmeId: string, overrides: Row = {}) {
  return createActionItem(contextA, {
    programmeId,
    title: "Synthetic fictional action",
    ownerMembershipId: "membership-owner",
    dueDate: new Date("2027-01-01"),
    actorUserId: "user-owner",
    ...overrides,
  } as never);
}

describe("createActionProgramme / createActionItem", () => {
  it("requires ems.action.manage", async () => {
    await expect(createActionProgramme(noPermissionContextA, { title: "x", ownerMembershipId: "membership-owner", actorUserId: "user-owner" })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("denies an owner membership from a foreign organisation", async () => {
    await expect(createProgramme(contextA, { ownerMembershipId: "membership-b" })).rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("creates an action within a programme, defaulting to OPEN", async () => {
    const programme = await createProgramme();
    const action = await createAction(programme.id);
    expect(action.status).toBe("OPEN");
    expect(action.programmeId).toBe(programme.id);
  });

  it("denies a dependency on a foreign-tenant action", async () => {
    const programme = await createProgramme();
    await expect(
      createActionItem(contextB, {
        programmeId: (await createProgramme(contextB, { ownerMembershipId: "membership-b" })).id,
        title: "Cross-tenant dependency attempt",
        ownerMembershipId: "membership-b",
        dueDate: new Date("2027-01-01"),
        dependsOnActionItemIds: [(await createAction(programme.id)).id],
        actorUserId: "user-b",
      } as never),
    ).rejects.toBeInstanceOf(TenantOwnershipError);
  });
});

describe("status transitions and dependency gating", () => {
  it("cannot move to IN_PROGRESS while a dependency is unmet", async () => {
    const programme = await createProgramme();
    const blocker = await createAction(programme.id, { title: "Blocking action" });
    const action = await createAction(programme.id, { dependsOnActionItemIds: [blocker.id] } as never);
    await expect(setActionItemStatus(contextA, action.id, "IN_PROGRESS", "user-owner")).rejects.toBeInstanceOf(ActionError);
  });

  it("allows IN_PROGRESS once the dependency is completed", async () => {
    const programme = await createProgramme();
    const blocker = await createAction(programme.id, { title: "Blocking action" });
    const action = await createAction(programme.id, { dependsOnActionItemIds: [blocker.id] } as never);
    await completeActionItem(contextA, blocker.id, { completionEvidenceNote: "Synthetic evidence.", actorUserId: "user-owner" });
    await expect(setActionItemStatus(contextA, action.id, "IN_PROGRESS", "user-owner")).resolves.toMatchObject({ status: "IN_PROGRESS" });
  });

  it("rejects an invalid transition", async () => {
    const programme = await createProgramme();
    const action = await createAction(programme.id);
    await expect(setActionItemStatus(contextA, action.id, "VERIFIED", "user-owner")).rejects.toBeInstanceOf(ActionError);
  });
});

describe("reassignment and progress — audited, non-closed only", () => {
  it("records reassignment history and suppresses stale notifications for the old owner", async () => {
    const programme = await createProgramme();
    const action = await createAction(programme.id);
    const updated = await reassignActionItem(contextA, action.id, {
      newOwnerMembershipId: "membership-verifier",
      actorUserId: "user-owner",
    });
    expect(updated.ownerMembershipId).toBe("membership-verifier");
    expect(tables.statusHistory.some((row) => row.eventType === "REASSIGNED" && row.actionItemId === action.id)).toBe(true);
    expect(suppressNotificationsForResource).toHaveBeenCalledWith(expect.anything(), expect.anything(), "action", action.id);
  });

  it("records a progress update without changing status", async () => {
    const programme = await createProgramme();
    const action = await createAction(programme.id);
    await recordActionProgress(contextA, action.id, { progressPercent: 40, note: "Synthetic progress note.", actorUserId: "user-owner" });
    expect(tables.progressUpdates).toHaveLength(1);
    expect(find(tables.actionItems, { id: action.id })?.status).toBe("OPEN");
  });
});

describe("completion, verification and objective independence", () => {
  it("completing an action never mutates an EnvironmentalObjective", async () => {
    tables.objectives.push({ id: "objective-1", organisationId: ORG_A, activeVersionId: "version-1" });
    const programme = await createProgramme(contextA, { objectiveId: "objective-1" });
    const action = await createAction(programme.id);
    await completeActionItem(contextA, action.id, { completionEvidenceNote: "Synthetic evidence.", actorUserId: "user-owner" });
    expect(find(tables.objectives, { id: "objective-1" })).toMatchObject({ activeVersionId: "version-1" });
  });

  it("denies the completor from also verifying (four-eyes)", async () => {
    const programme = await createProgramme();
    const action = await createAction(programme.id);
    await completeActionItem(contextA, action.id, { completionEvidenceNote: "Synthetic evidence.", actorUserId: "user-owner" });
    await expect(verifyActionItem(contextA, action.id, { actorUserId: "user-owner" })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("allows a different verifier", async () => {
    const programme = await createProgramme();
    const action = await createAction(programme.id);
    await completeActionItem(contextA, action.id, { completionEvidenceNote: "Synthetic evidence.", actorUserId: "user-owner" });
    await expect(verifyActionItem(verifierContextA, action.id, { actorUserId: "user-verifier" })).resolves.toMatchObject({ status: "VERIFIED" });
  });
});

describe("closed-action immutability and reopen", () => {
  it("refuses to reassign, change status or record progress on a closed action", async () => {
    const programme = await createProgramme();
    const action = await createAction(programme.id);
    await completeActionItem(contextA, action.id, { completionEvidenceNote: "Synthetic evidence.", actorUserId: "user-owner" });

    await expect(reassignActionItem(contextA, action.id, { newOwnerMembershipId: "membership-verifier", actorUserId: "user-owner" })).rejects.toBeInstanceOf(
      ActionError,
    );
    await expect(setActionItemStatus(contextA, action.id, "IN_PROGRESS", "user-owner")).rejects.toBeInstanceOf(ActionError);
    await expect(recordActionProgress(contextA, action.id, { note: "attempt", actorUserId: "user-owner" })).rejects.toBeInstanceOf(ActionError);
    await expect(completeActionItem(contextA, action.id, { completionEvidenceNote: "again", actorUserId: "user-owner" })).rejects.toBeInstanceOf(
      ActionError,
    );
  });

  it("reopen is the only accepted transition on a closed action, and re-enables normal mutation", async () => {
    const programme = await createProgramme();
    const action = await createAction(programme.id);
    await completeActionItem(contextA, action.id, { completionEvidenceNote: "Synthetic evidence.", actorUserId: "user-owner" });

    const reopened = await reopenActionItem(contextA, action.id, { reopenReason: "Synthetic follow-up required.", actorUserId: "user-owner" });
    expect(reopened.status).toBe("REOPENED");
    expect(tables.statusHistory.some((row) => row.eventType === "REOPENED" && row.actionItemId === action.id)).toBe(true);

    await expect(setActionItemStatus(contextA, action.id, "IN_PROGRESS", "user-owner")).resolves.toMatchObject({ status: "IN_PROGRESS" });
  });

  it("cannot reopen an action that isn't closed", async () => {
    const programme = await createProgramme();
    const action = await createAction(programme.id);
    await expect(reopenActionItem(contextA, action.id, { reopenReason: "not closed", actorUserId: "user-owner" })).rejects.toBeInstanceOf(ActionError);
  });
});

describe("tenant isolation", () => {
  it("denies reading/mutating an action item that belongs to a different organisation", async () => {
    const programmeA = await createProgramme();
    const actionA = await createAction(programmeA.id);
    await expect(
      reassignActionItem(contextB, actionA.id, { newOwnerMembershipId: "membership-b", actorUserId: "user-b" }),
    ).rejects.toBeInstanceOf(TenantOwnershipError);
    await expect(setActionItemStatus(contextB, actionA.id, "IN_PROGRESS", "user-b")).rejects.toBeInstanceOf(TenantOwnershipError);
  });
});

/**
 * Corrective action tests (task T64). No live database — Prisma is
 * replaced with an in-memory fake covering `CorrectiveAction`,
 * `OrganisationMembership`, `ActionItem` and `Notification`, so the real
 * T24 `notifyMembership` dedupe/active-membership logic runs for the
 * overdue-escalation tests, not a stub. All fixtures are fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  memberships: [] as Row[],
  nonconformities: [] as Row[],
  correctiveActions: [] as Row[],
  actionItems: [] as Row[],
  notifications: [] as Row[],
  nextId: 1,
}));

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    const operators = expected as { in?: unknown[]; notIn?: unknown[]; not?: unknown; lt?: Date };
    if (operators.notIn) return !operators.notIn.includes(actual);
    if (operators.in) return operators.in.includes(actual);
    if (operators.lt) return actual instanceof Date && actual.getTime() < operators.lt.getTime();
    if ("not" in operators) return actual !== operators.not;
    return false;
  }
  return actual === expected;
}

function matchesSimple(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => matchValue(row[key], value));
}

function find(rows: Row[], where: Row) {
  return rows.filter((row) => matchesSimple(row, where))[0] ?? null;
}

function simpleModel(rows: Row[], prefix: string, defaults: Row = {}) {
  return {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(rows, key as Row);
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => rows.filter((r) => matchesSimple(r, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `${prefix}-${tables.nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...defaults, ...data };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(rows, key);
      if (!row) throw new Error(`${prefix} not found`);
      Object.assign(row, data);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const matched = rows.filter((r) => matchesSimple(r, where));
      matched.forEach((r) => Object.assign(r, data));
      return { count: matched.length };
    }),
  };
}

vi.mock("@/lib/prisma", () => {
  const organisationMembership = simpleModel(tables.memberships, "membership");
  const nonconformity = simpleModel(tables.nonconformities, "nc", { status: "OPEN" });
  const correctiveAction = simpleModel(tables.correctiveActions, "corrective-action", { status: "OPEN" });
  const actionItem = simpleModel(tables.actionItems, "action-item");
  const notification = simpleModel(tables.notifications, "notification", { status: "PENDING" });

  const prismaClient = {
    organisationMembership,
    nonconformity,
    correctiveAction,
    actionItem,
    notification,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-event-synthetic" })) }));
vi.mock("@/lib/documents/evidence-service", () => ({
  uploadEvidenceObject: vi.fn(async () => ({ id: "evidence-synthetic" })),
  linkEvidence: vi.fn(async () => ({ id: "evidence-link-synthetic" })),
  listEvidenceForResource: vi.fn(async () => [{ id: "evidence-synthetic", filename: "synthetic-evidence.txt" }]),
}));

const {
  CorrectiveActionError,
  createCorrectiveAction,
  listCorrectiveActions,
  reassignCorrectiveAction,
  setCorrectiveActionStatus,
  completeCorrectiveAction,
  verifyCorrectiveAction,
  reopenCorrectiveAction,
  notifyOverdueCorrectiveActions,
  listCorrectiveActionEvidence,
} = await import("@/lib/ems/nonconformity/corrective-action-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const MANAGE_PERMS = new Set(["ems.view", "ems.corrective_action.manage"]) as never;
const VIEW_ONLY = new Set(["ems.view"]) as never;

const managerContextA = makeOrganisationContext(ORG_A, { userId: "user-manager", membershipId: "membership-manager", permissions: MANAGE_PERMS });
const viewerContextA = makeOrganisationContext(ORG_A, { userId: "user-viewer", membershipId: "membership-viewer", permissions: VIEW_ONLY });
const managerContextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: MANAGE_PERMS });

beforeEach(() => {
  for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
    if (key === "nextId") continue;
    (tables[key] as Row[]).length = 0;
  }
  tables.nextId = 1;
  tables.memberships.push({ id: "membership-manager", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-owner", organisationId: ORG_A, status: "ACTIVE" });
  tables.nonconformities.push({ id: "nc-root-cause-approved", organisationId: ORG_A, reference: "NC-1", status: "ROOT_CAUSE_APPROVED" });
  tables.nonconformities.push({ id: "nc-contained", organisationId: ORG_A, reference: "NC-2", status: "CONTAINED" });
  tables.nonconformities.push({ id: "nc-b", organisationId: ORG_B, reference: "NC-B1", status: "ROOT_CAUSE_APPROVED" });
});

function actionInput(overrides: Partial<Parameters<typeof createCorrectiveAction>[2]> = {}) {
  return {
    description: "Fictional retraining and procedure update.",
    ownerMembershipId: "membership-owner",
    dueDate: new Date("2026-09-01"),
    actorUserId: managerContextA.userId,
    ...overrides,
  };
}

describe("createCorrectiveAction", () => {
  it("creates an OPEN action and moves ROOT_CAUSE_APPROVED nonconformity to ACTIONS_IN_PROGRESS", async () => {
    const action = await createCorrectiveAction(managerContextA, "nc-root-cause-approved", actionInput());
    expect(action.status).toBe("OPEN");
    const nc = tables.nonconformities.find((row) => row.id === "nc-root-cause-approved");
    expect(nc?.status).toBe("ACTIONS_IN_PROGRESS");
  });

  it("allows a second action once already ACTIONS_IN_PROGRESS without changing status again", async () => {
    await createCorrectiveAction(managerContextA, "nc-root-cause-approved", actionInput());
    await createCorrectiveAction(managerContextA, "nc-root-cause-approved", actionInput());
    const actions = await listCorrectiveActions(managerContextA, "nc-root-cause-approved");
    expect(actions).toHaveLength(2);
  });

  it("refuses while the nonconformity has not had root cause approved", async () => {
    await expect(createCorrectiveAction(managerContextA, "nc-contained", actionInput())).rejects.toThrow(CorrectiveActionError);
  });

  it("refuses without a description", async () => {
    await expect(createCorrectiveAction(managerContextA, "nc-root-cause-approved", actionInput({ description: "  " }))).rejects.toThrow(CorrectiveActionError);
  });

  it("denies a caller without ems.corrective_action.manage", async () => {
    await expect(createCorrectiveAction(viewerContextA, "nc-root-cause-approved", actionInput())).rejects.toThrow(PermissionDeniedError);
  });

  it("refuses a foreign-tenant nonconformity id", async () => {
    await expect(createCorrectiveAction(managerContextB, "nc-root-cause-approved", actionInput({ actorUserId: managerContextB.userId }))).rejects.toThrow(
      TenantOwnershipError,
    );
  });

  it("refuses a foreign-tenant owner membership id", async () => {
    await expect(createCorrectiveAction(managerContextA, "nc-root-cause-approved", actionInput({ ownerMembershipId: "membership-b" }))).rejects.toThrow(
      TenantOwnershipError,
    );
  });
});

describe("status transitions, completion and verification", () => {
  it("moves OPEN -> IN_PROGRESS -> COMPLETED -> VERIFIED", async () => {
    const action = await createCorrectiveAction(managerContextA, "nc-root-cause-approved", actionInput());
    await setCorrectiveActionStatus(managerContextA, action.id, "IN_PROGRESS", managerContextA.userId);
    const completed = await completeCorrectiveAction(managerContextA, action.id, { completionEvidenceNote: "Fictional evidence.", actorUserId: managerContextA.userId });
    expect(completed.status).toBe("COMPLETED");
    const secondReviewerContext = makeOrganisationContext(ORG_A, { userId: "user-second-reviewer", membershipId: "membership-second-reviewer", permissions: MANAGE_PERMS });
    tables.memberships.push({ id: "membership-second-reviewer", organisationId: ORG_A, status: "ACTIVE" });
    const verified = await verifyCorrectiveAction(secondReviewerContext, action.id, { actorUserId: secondReviewerContext.userId });
    expect(verified.status).toBe("VERIFIED");
    expect(verified.verifiedByMembershipId).toBe("membership-second-reviewer");
  });

  it("denies the completor from also verifying when four-eyes is enabled", async () => {
    const action = await createCorrectiveAction(managerContextA, "nc-root-cause-approved", actionInput());
    const ownerContext = makeOrganisationContext(ORG_A, { userId: "user-manager", membershipId: "membership-owner", permissions: MANAGE_PERMS });
    await completeCorrectiveAction(ownerContext, action.id, { completionEvidenceNote: "Fictional evidence.", actorUserId: ownerContext.userId });
    await expect(verifyCorrectiveAction(ownerContext, action.id, { actorUserId: ownerContext.userId })).rejects.toThrow(CorrectiveActionError);
  });

  it("refuses to change status on a closed action", async () => {
    const action = await createCorrectiveAction(managerContextA, "nc-root-cause-approved", actionInput());
    await completeCorrectiveAction(managerContextA, action.id, { completionEvidenceNote: "Evidence.", actorUserId: managerContextA.userId });
    await expect(setCorrectiveActionStatus(managerContextA, action.id, "IN_PROGRESS", managerContextA.userId)).rejects.toThrow(CorrectiveActionError);
  });

  it("reopens a completed action with a reason, preserving history fields", async () => {
    const action = await createCorrectiveAction(managerContextA, "nc-root-cause-approved", actionInput());
    await completeCorrectiveAction(managerContextA, action.id, { completionEvidenceNote: "Evidence.", actorUserId: managerContextA.userId });
    const reopened = await reopenCorrectiveAction(managerContextA, action.id, { reopenReason: "Fictional recurrence.", actorUserId: managerContextA.userId });
    expect(reopened.status).toBe("REOPENED");
    expect(reopened.completedAt).toBeTruthy();
    expect(reopened.reopenReason).toBe("Fictional recurrence.");
  });

  it("reassigns an open action to a new owner and suppresses stale notifications", async () => {
    const action = await createCorrectiveAction(managerContextA, "nc-root-cause-approved", actionInput());
    tables.notifications.push({ id: "notif-1", organisationId: ORG_A, resourceType: "corrective_action", resourceId: action.id, status: "PENDING" });
    const reassigned = await reassignCorrectiveAction(managerContextA, action.id, { newOwnerMembershipId: "membership-manager", actorUserId: managerContextA.userId });
    expect(reassigned.ownerMembershipId).toBe("membership-manager");
    expect(tables.notifications[0].status).toBe("SUPPRESSED");
  });
});

describe("notifyOverdueCorrectiveActions", () => {
  it("delivers one deduplicated notification per overdue open action, and skips closed ones", async () => {
    const action = await createCorrectiveAction(managerContextA, "nc-root-cause-approved", actionInput({ dueDate: new Date("2026-01-01") }));
    const asOf = new Date("2026-08-13");
    const first = await notifyOverdueCorrectiveActions(managerContextA, asOf);
    const second = await notifyOverdueCorrectiveActions(managerContextA, asOf);
    expect(first).toEqual([{ correctiveActionId: action.id, id: expect.any(String), status: "DELIVERED" }]);
    expect(second[0]).toMatchObject({ status: "DELIVERED", id: first[0].id });
    expect(tables.notifications).toHaveLength(1);
  });

  it("does not notify once the action is completed", async () => {
    const action = await createCorrectiveAction(managerContextA, "nc-root-cause-approved", actionInput({ dueDate: new Date("2026-01-01") }));
    await completeCorrectiveAction(managerContextA, action.id, { completionEvidenceNote: "Evidence.", actorUserId: managerContextA.userId });
    const result = await notifyOverdueCorrectiveActions(managerContextA, new Date("2026-08-13"));
    expect(result).toHaveLength(0);
  });
});

describe("listCorrectiveActionEvidence (UI08)", () => {
  it("returns evidence linked to the corrective action", async () => {
    const action = await createCorrectiveAction(managerContextA, "nc-root-cause-approved", actionInput());
    const evidence = await listCorrectiveActionEvidence(managerContextA, action.id);
    expect(evidence).toEqual([{ id: "evidence-synthetic", filename: "synthetic-evidence.txt" }]);
  });

  it("refuses a foreign-tenant corrective action id", async () => {
    const action = await createCorrectiveAction(managerContextA, "nc-root-cause-approved", actionInput());
    await expect(listCorrectiveActionEvidence(managerContextB, action.id)).rejects.toThrow(TenantOwnershipError);
  });
});

/**
 * Overdue-action reminder tests (task T52). No live database — Prisma is
 * replaced with an in-memory fake covering `ActionItem`,
 * `OrganisationMembership` and `Notification` so the real T24
 * `notifyMembership` dedupe/active-membership logic runs, not a stub.
 * Fictional fixtures only.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;

const tables = vi.hoisted(() => ({
  actionItems: [] as Row[],
  memberships: [] as Row[],
  notifications: [] as Row[],
  nextId: 1,
}));

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    const operators = expected as { in?: unknown[]; notIn?: unknown[]; lt?: Date };
    if (operators.notIn) return !operators.notIn.includes(actual);
    if (operators.in) return operators.in.includes(actual);
    if (operators.lt) return actual instanceof Date && actual.getTime() < operators.lt.getTime();
    return false;
  }
  return actual === expected;
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => matchValue(row[key], value));
}

vi.mock("@/lib/prisma", () => {
  const actionItem = {
    findMany: vi.fn(async ({ where }: { where: Row }) => tables.actionItems.filter((row) => matches(row, where))),
  };
  const organisationMembership = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.memberships.find((row) => matches(row, where)) ?? null),
  };
  const notification = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.notifications.find((row) => matches(row, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `notification-${tables.nextId++}`, ...data };
      tables.notifications.push(row);
      return row;
    }),
  };
  const client: Row = { actionItem, organisationMembership, notification };
  client.$transaction = vi.fn(async (callback: (tx: Row) => Promise<unknown>) => callback(client));
  return { prisma: client };
});

const { notifyOverdueActionItems } = await import("@/lib/ems/actions/reminder-handler");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const context = makeOrganisationContext(ORG_A, {
  userId: "user-owner",
  membershipId: "membership-owner",
  permissions: new Set(["ems.view", "ems.action.manage"]) as never,
});

beforeEach(() => {
  tables.actionItems.length = 0;
  tables.memberships.length = 0;
  tables.notifications.length = 0;
  tables.nextId = 1;
  tables.memberships.push({ id: "membership-owner", organisationId: ORG_A, status: "ACTIVE" });
});

describe("notifyOverdueActionItems", () => {
  it("requires ems.action.manage", async () => {
    const noPermission = makeOrganisationContext(ORG_A, { permissions: new Set(["ems.view"]) as never });
    await expect(notifyOverdueActionItems(noPermission)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("delivers one deduplicated notification per overdue open action, and skips closed ones", async () => {
    tables.actionItems.push({
      id: "action-overdue",
      organisationId: ORG_A,
      status: "OPEN",
      ownerMembershipId: "membership-owner",
      dueDate: new Date("2026-01-01T00:00:00.000Z"),
    });
    tables.actionItems.push({
      id: "action-closed-overdue",
      organisationId: ORG_A,
      status: "COMPLETED",
      ownerMembershipId: "membership-owner",
      dueDate: new Date("2026-01-01T00:00:00.000Z"),
    });

    const asOf = new Date("2026-08-13T00:00:00.000Z");
    const first = await notifyOverdueActionItems(context, asOf);
    const second = await notifyOverdueActionItems(context, asOf);

    expect(first).toEqual([{ actionItemId: "action-overdue", id: expect.any(String), status: "DELIVERED" }]);
    expect(second[0]).toMatchObject({ status: "DELIVERED", id: first[0].id });
    expect(tables.notifications).toHaveLength(1);
  });

  it("raises a fresh reminder when the due date changes", async () => {
    tables.actionItems.push({
      id: "action-1",
      organisationId: ORG_A,
      status: "OPEN",
      ownerMembershipId: "membership-owner",
      dueDate: new Date("2026-01-01T00:00:00.000Z"),
    });
    const asOf = new Date("2026-08-13T00:00:00.000Z");
    await notifyOverdueActionItems(context, asOf);
    (tables.actionItems[0] as Row).dueDate = new Date("2026-02-01T00:00:00.000Z");
    await notifyOverdueActionItems(context, asOf);
    expect(tables.notifications).toHaveLength(2);
  });

  it("does not notify a suspended owner", async () => {
    tables.memberships[0].status = "SUSPENDED";
    tables.actionItems.push({
      id: "action-1",
      organisationId: ORG_A,
      status: "OPEN",
      ownerMembershipId: "membership-owner",
      dueDate: new Date("2026-01-01T00:00:00.000Z"),
    });
    const result = await notifyOverdueActionItems(context, new Date("2026-08-13T00:00:00.000Z"));
    expect(result).toEqual([{ actionItemId: "action-1", id: null, status: "SUPPRESSED" }]);
    expect(tables.notifications).toHaveLength(0);
  });
});

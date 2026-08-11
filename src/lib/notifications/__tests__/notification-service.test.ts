/**
 * In-app notification service tests (task T24). No live database — Prisma
 * is replaced with an in-memory fake, following the T22/T23 pattern.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

const { notifications, memberships, resetTables, nextIdRef } = vi.hoisted(() => {
  const notifications: Record<string, unknown>[] = [];
  const memberships: { id: string; organisationId: string; status: string }[] = [];
  const nextIdRef = { n: 1 };
  function resetTables() {
    notifications.length = 0;
    memberships.length = 0;
    nextIdRef.n = 1;
  }
  return { notifications, memberships, resetTables, nextIdRef };
});

function nextId(prefix: string): string {
  return `${prefix}-${nextIdRef.n++}`;
}

function matches(row: object, where: Record<string, unknown>): boolean {
  const record = row as Record<string, unknown>;
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "in" in (value as Record<string, unknown>)) {
      return (value as { in: unknown[] }).in.includes(record[key]);
    }
    return record[key] === value;
  });
}

vi.mock("@/lib/prisma", () => {
  const notification = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => notifications.find((n) => matches(n, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => notifications.filter((n) => matches(n, where))),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const dup = notifications.find(
        (n) =>
          n.organisationId === data.organisationId &&
          n.recipientMembershipId === data.recipientMembershipId &&
          n.dedupeKey === data.dedupeKey,
      );
      if (dup) {
        const err = new Error("Unique constraint failed") as Error & { code: string };
        err.code = "P2002";
        throw err;
      }
      const row = { id: nextId("notif"), status: "PENDING", ...data };
      notifications.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = notifications.find((n) => n.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const matched = notifications.filter((n) => matches(n, where));
      for (const row of matched) Object.assign(row, data);
      return { count: matched.length };
    }),
  };

  const organisationMembership = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => memberships.find((m) => matches(m, where)) ?? null),
  };

  const prismaClient = {
    notification,
    organisationMembership,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaClient)),
  };
  return { prisma: prismaClient };
});

const { notifyMembership, suppressNotificationsForResource, acknowledgeNotification, dismissNotification, listMyNotifications } =
  await import("@/lib/notifications/notification-service");
const { prisma } = await import("@/lib/prisma");
const { createTenantRepositoryContext } = await import("@/lib/repositories/context");

const MEMBER_A = "membership-a-1";
const MEMBER_A2 = "membership-a-2";

function ctxA() {
  return createTenantRepositoryContext({ organisationId: ORG_A, userId: "user-a", correlationId: "corr-a" });
}

describe("notifyMembership", () => {
  beforeEach(() => {
    resetTables();
    memberships.push({ id: MEMBER_A, organisationId: ORG_A, status: "ACTIVE" });
    memberships.push({ id: MEMBER_A2, organisationId: ORG_A, status: "SUSPENDED" });
  });

  it("delivers to an active, in-scope recipient with generic, non-disclosing text", async () => {
    const result = await notifyMembership(prisma, ctxA(), {
      type: "review.due",
      recipientMembershipId: MEMBER_A,
      resourceType: "compliance_obligation",
      resourceId: "obligation-secret-42",
      dedupeKey: "rule-1:review.due:obligation-secret-42",
    });

    expect(result.status).toBe("DELIVERED");
    expect(result.id).toBeTruthy();
    const row = notifications.find((n) => n.id === result.id) as Record<string, unknown>;
    expect(row.status).toBe("DELIVERED");
    expect(row.title).toBe("Review due");
    expect(String(row.body)).not.toContain("obligation-secret-42");
    expect(String(row.body)).not.toMatch(/secret/i);
  });

  it("does not create a row and reports SUPPRESSED for an inactive recipient", async () => {
    const result = await notifyMembership(prisma, ctxA(), {
      type: "review.due",
      recipientMembershipId: MEMBER_A2,
      resourceType: "compliance_obligation",
      resourceId: "obligation-1",
      dedupeKey: "rule-1:review.due:obligation-1",
    });

    expect(result).toEqual({ id: null, status: "SUPPRESSED" });
    expect(notifications).toHaveLength(0);
  });

  it("deduplicates repeated triggers for the same recipient/dedupeKey", async () => {
    const first = await notifyMembership(prisma, ctxA(), {
      type: "review.due",
      recipientMembershipId: MEMBER_A,
      resourceType: "compliance_obligation",
      resourceId: "obligation-1",
      dedupeKey: "rule-1:review.due:obligation-1",
    });
    const second = await notifyMembership(prisma, ctxA(), {
      type: "review.due",
      recipientMembershipId: MEMBER_A,
      resourceType: "compliance_obligation",
      resourceId: "obligation-1",
      dedupeKey: "rule-1:review.due:obligation-1",
    });

    expect(second.id).toBe(first.id);
    expect(notifications).toHaveLength(1);
  });

  it("rejects an unknown notification type", async () => {
    await expect(
      notifyMembership(prisma, ctxA(), {
        type: "not.a.real.type" as never,
        recipientMembershipId: MEMBER_A,
        resourceType: "compliance_obligation",
        resourceId: "obligation-1",
        dedupeKey: "x",
      }),
    ).rejects.toThrow();
  });
});

describe("suppressNotificationsForResource", () => {
  beforeEach(() => {
    resetTables();
    memberships.push({ id: MEMBER_A, organisationId: ORG_A, status: "ACTIVE" });
  });

  it("suppresses stale reminders for a reassigned/closed resource", async () => {
    await notifyMembership(prisma, ctxA(), {
      type: "action.overdue",
      recipientMembershipId: MEMBER_A,
      resourceType: "action",
      resourceId: "action-1",
      dedupeKey: "rule-1:action.overdue:action-1",
    });

    const count = await suppressNotificationsForResource(prisma, ctxA(), "action", "action-1");

    expect(count).toBe(1);
    expect(notifications[0]).toMatchObject({ status: "SUPPRESSED" });
  });
});

describe("acknowledge / dismiss / list", () => {
  const contextA = makeOrganisationContext(ORG_A, { membershipId: MEMBER_A });
  const contextAOther = makeOrganisationContext(ORG_A, { membershipId: "membership-a-3" });
  const contextB = makeOrganisationContext(ORG_B, { membershipId: "membership-b-1" });

  beforeEach(async () => {
    resetTables();
    memberships.push({ id: MEMBER_A, organisationId: ORG_A, status: "ACTIVE" });
    await notifyMembership(prisma, ctxA(), {
      type: "approval.requested",
      recipientMembershipId: MEMBER_A,
      resourceType: "controlled_document",
      resourceId: "doc-1",
      dedupeKey: "rule-1:approval.requested:doc-1",
    });
  });

  it("lists only the caller's own notifications", async () => {
    const rows = await listMyNotifications(contextA);
    expect(rows).toHaveLength(1);
    const otherOrgRows = await listMyNotifications(contextB);
    expect(otherOrgRows).toHaveLength(0);
  });

  it("lets the recipient acknowledge (mark read) their own notification", async () => {
    const id = notifications[0].id as string;
    const updated = await acknowledgeNotification(contextA, id);
    expect(updated.status).toBe("READ");
  });

  it("denies acknowledging another member's notification", async () => {
    const id = notifications[0].id as string;
    await expect(acknowledgeNotification(contextAOther, id)).rejects.toThrow();
  });

  it("lets the recipient dismiss their own notification", async () => {
    const id = notifications[0].id as string;
    const updated = await dismissNotification(contextA, id);
    expect(updated.status).toBe("DISMISSED");
  });

  it("denies acting on a foreign-organisation notification", async () => {
    const id = notifications[0].id as string;
    await expect(acknowledgeNotification(contextB, id)).rejects.toThrow();
  });
});

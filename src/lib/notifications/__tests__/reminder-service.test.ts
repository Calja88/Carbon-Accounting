/**
 * Reminder rule service tests (task T24). No live database — Prisma is
 * replaced with an in-memory fake, following the T22/T23 pattern.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ORG_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

const { rules, notifications, memberships, membershipRoles, resetTables, nextIdRef } = vi.hoisted(() => {
  const rules: Record<string, unknown>[] = [];
  const notifications: Record<string, unknown>[] = [];
  const memberships: { id: string; organisationId: string; status: string }[] = [];
  const membershipRoles: { membershipId: string; permissionCode: string }[] = [];
  const nextIdRef = { n: 1 };
  function resetTables() {
    rules.length = 0;
    notifications.length = 0;
    memberships.length = 0;
    membershipRoles.length = 0;
    nextIdRef.n = 1;
  }
  return { rules, notifications, memberships, membershipRoles, resetTables, nextIdRef };
});

function nextId(prefix: string): string {
  return `${prefix}-${nextIdRef.n++}`;
}

function matches(row: object, where: Record<string, unknown>): boolean {
  const record = row as Record<string, unknown>;
  return Object.entries(where).every(([key, value]) => record[key] === value);
}

vi.mock("@/lib/prisma", () => {
  const reminderRule = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rules.find((r) => matches(r, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rules.filter((r) => matches(r, where))),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: nextId("rule"), isActive: true, ...data };
      rules.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rules.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const notification = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => notifications.find((n) => matches(n, where)) ?? null),
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
  };

  const organisationMembership = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const candidates = memberships.filter((m) => matches(m, { id: where.id, organisationId: where.organisationId, status: where.status }));
      return candidates[0] ?? null;
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> & { roles?: { some: { role: { permissions: { some: { permissionCode: string } } } } } } }) => {
      const permissionCode = where.roles?.some.role.permissions.some.permissionCode;
      return memberships
        .filter((m) => m.organisationId === where.organisationId && m.status === "ACTIVE")
        .filter((m) => !permissionCode || membershipRoles.some((mr) => mr.membershipId === m.id && mr.permissionCode === permissionCode))
        .map((m) => ({ id: m.id }));
    }),
  };

  const prismaClient = {
    reminderRule,
    notification,
    organisationMembership,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/rbac/authorize", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rbac/authorize")>("@/lib/rbac/authorize");
  return actual;
});

const { createReminderRule, setReminderRuleActive, evaluateReminderRule } = await import("@/lib/notifications/reminder-service");

const MEMBER_OWNER = "membership-owner";
const MEMBER_APPROVER = "membership-approver";

const managerContext = makeOrganisationContext(ORG_A, {
  membershipId: MEMBER_OWNER,
  permissions: new Set(["ems.notification.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});
const noPermissionContext = makeOrganisationContext(ORG_A, { membershipId: MEMBER_OWNER, permissions: new Set() as unknown as ReturnType<typeof makeOrganisationContext>["permissions"] });

describe("createReminderRule", () => {
  beforeEach(() => resetTables());

  it("denies creating a rule without ems.notification.manage", async () => {
    await expect(
      createReminderRule(noPermissionContext, {
        resourceType: "compliance_obligation",
        event: "review_due",
        offsetDays: -7,
        recipientsPolicy: { kind: "membership", membershipId: MEMBER_OWNER },
      }),
    ).rejects.toThrow();
  });

  it("creates a rule with a valid recipients policy", async () => {
    const rule = await createReminderRule(managerContext, {
      resourceType: "compliance_obligation",
      event: "review_due",
      offsetDays: -7,
      recipientsPolicy: { kind: "membership", membershipId: MEMBER_OWNER },
    });
    expect(rule.resourceType).toBe("compliance_obligation");
    expect(rule.isActive).toBe(true);
  });

  it("rejects a malformed recipients policy", async () => {
    await expect(
      createReminderRule(managerContext, {
        resourceType: "compliance_obligation",
        event: "review_due",
        offsetDays: -7,
        recipientsPolicy: { kind: "bogus" } as never,
      }),
    ).rejects.toThrow();
  });
});

describe("evaluateReminderRule", () => {
  beforeEach(() => {
    resetTables();
    memberships.push({ id: MEMBER_OWNER, organisationId: ORG_A, status: "ACTIVE" });
    memberships.push({ id: MEMBER_APPROVER, organisationId: ORG_A, status: "ACTIVE" });
    membershipRoles.push({ membershipId: MEMBER_APPROVER, permissionCode: "ems.compliance_obligation.approve" });
  });

  const baseRule = {
    id: "rule-1",
    resourceType: "compliance_obligation",
    event: "review_due",
    offsetDays: -7,
    recipientsPolicy: { kind: "membership", membershipId: MEMBER_OWNER },
  };

  it("notifies the resolved recipient for a due subject", async () => {
    const asOf = new Date("2026-08-11T00:00:00Z");
    const results = await evaluateReminderRule(managerContext, {
      rule: baseRule,
      notificationType: "review.due",
      asOf,
      subjects: [{ resourceId: "obligation-1", referenceDate: new Date("2026-08-15T00:00:00Z") }],
    });

    expect(results).toHaveLength(1);
    expect(results[0].notifiedMembershipIds).toEqual([MEMBER_OWNER]);
    expect(notifications).toHaveLength(1);
  });

  it("skips a subject that is not yet due", async () => {
    const asOf = new Date("2026-08-01T00:00:00Z");
    const results = await evaluateReminderRule(managerContext, {
      rule: baseRule,
      notificationType: "review.due",
      asOf,
      subjects: [{ resourceId: "obligation-1", referenceDate: new Date("2026-08-15T00:00:00Z") }],
    });

    expect(results[0].skippedReason).toBe("NOT_DUE");
    expect(notifications).toHaveLength(0);
  });

  it("suppresses a closed subject even when due", async () => {
    const asOf = new Date("2026-08-11T00:00:00Z");
    const results = await evaluateReminderRule(managerContext, {
      rule: baseRule,
      notificationType: "review.due",
      asOf,
      subjects: [{ resourceId: "obligation-1", referenceDate: new Date("2026-08-15T00:00:00Z"), closed: true }],
    });

    expect(results[0].skippedReason).toBe("CLOSED");
    expect(notifications).toHaveLength(0);
  });

  it("suppresses a reassigned subject even when due", async () => {
    const asOf = new Date("2026-08-11T00:00:00Z");
    const results = await evaluateReminderRule(managerContext, {
      rule: baseRule,
      notificationType: "review.due",
      asOf,
      subjects: [{ resourceId: "obligation-1", referenceDate: new Date("2026-08-15T00:00:00Z"), reassigned: true }],
    });

    expect(results[0].skippedReason).toBe("REASSIGNED");
    expect(notifications).toHaveLength(0);
  });

  it("resolves recipients by permission, not a fixed membership list", async () => {
    const asOf = new Date("2026-08-11T00:00:00Z");
    const results = await evaluateReminderRule(managerContext, {
      rule: { ...baseRule, recipientsPolicy: { kind: "permission", permission: "ems.compliance_obligation.approve" } },
      notificationType: "approval.requested",
      asOf,
      subjects: [{ resourceId: "obligation-2", referenceDate: new Date("2026-08-15T00:00:00Z") }],
    });

    expect(results[0].notifiedMembershipIds).toEqual([MEMBER_APPROVER]);
  });

  it("deduplicates against a previously delivered notification for the same rule/resource/recipient", async () => {
    const asOf = new Date("2026-08-11T00:00:00Z");
    const options = {
      rule: baseRule,
      notificationType: "review.due" as const,
      asOf,
      subjects: [{ resourceId: "obligation-1", referenceDate: new Date("2026-08-15T00:00:00Z") }],
    };
    await evaluateReminderRule(managerContext, options);
    await evaluateReminderRule(managerContext, options);

    expect(notifications).toHaveLength(1);
  });
});

describe("setReminderRuleActive", () => {
  beforeEach(() => resetTables());

  it("toggles a rule's active flag under permission", async () => {
    const rule = await createReminderRule(managerContext, {
      resourceType: "compliance_obligation",
      event: "review_due",
      offsetDays: -7,
      recipientsPolicy: { kind: "membership", membershipId: MEMBER_OWNER },
    });
    const updated = await setReminderRuleActive(managerContext, rule.id, false);
    expect(updated.isActive).toBe(false);
  });
});

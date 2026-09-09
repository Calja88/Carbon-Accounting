/**
 * Competence expiry tests (task T71). No live database — Prisma is
 * replaced with an in-memory fake; `notifyMembership` and
 * `evaluateReminderRule` (T24) are stubbed so this suite only exercises the
 * T71 expiry logic itself. Covers: COMPETENT -> EXPIRED transition past
 * `competentUntil`, the notification dedupe key staying stable across
 * repeated runs, idempotency (an already-EXPIRED assignment is left alone),
 * and delegating "upcoming" reminders to T24's reminder engine. All
 * fixtures are fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  assignments: [] as Row[],
}));

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    const operators = expected as { in?: unknown[]; lte?: Date; not?: unknown };
    if (operators.in) return operators.in.includes(actual);
    if (operators.lte !== undefined) return actual !== null && (actual as Date) <= operators.lte;
    if ("not" in operators) return actual !== operators.not;
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

vi.mock("@/lib/prisma", () => {
  const competenceAssignment = {
    findMany: vi.fn(async ({ where }: FindArgs) => tables.assignments.filter((r) => matches(r, (where ?? {}) as Row))),
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.assignments, key as Row);
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.assignments, key as Row);
      if (!row) throw new Error("assignment not found");
      Object.assign(row, data);
      return row;
    }),
  };
  const prismaClient = {
    competenceAssignment,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-event-synthetic" })) }));

const notifyMembership = vi.fn<(...args: unknown[]) => Promise<{ id: string; status: "DELIVERED" }>>();
notifyMembership.mockImplementation(async () => ({ id: "notification-synthetic", status: "DELIVERED" }));
vi.mock("@/lib/notifications/notification-service", () => ({ notifyMembership }));

const evaluateReminderRule = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();
evaluateReminderRule.mockImplementation(async () => []);
vi.mock("@/lib/notifications/reminder-service", () => ({ evaluateReminderRule }));

const { checkCompetenceExpiry, evaluateUpcomingCompetenceExpiryReminders } = await import(
  "@/lib/ems/competence/expiry-service"
);

const orgContextA = makeOrganisationContext(ORG_A, {
  permissions: new Set(["ems.competence.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});

const asOf = new Date("2026-08-20T00:00:00Z");

beforeEach(() => {
  tables.assignments.length = 0;
  notifyMembership.mockClear();
  evaluateReminderRule.mockClear();
});

describe("checkCompetenceExpiry", () => {
  it("moves a COMPETENT assignment past its competentUntil to EXPIRED and raises a deduplicated notification", async () => {
    tables.assignments.push({
      id: "assignment-1",
      organisationId: ORG_A,
      status: "COMPETENT",
      competentUntil: new Date("2026-08-01"),
      assignedByMembershipId: "membership-assigner",
      person: { membershipId: "membership-person" },
    });

    const expired = await checkCompetenceExpiry(orgContextA, "user-1", asOf);
    expect(expired).toEqual(["assignment-1"]);
    expect(find(tables.assignments, { id: "assignment-1" })?.status).toBe("EXPIRED");
    expect(notifyMembership).toHaveBeenCalledTimes(1);
    expect(notifyMembership.mock.calls[0][2]).toMatchObject({
      type: "expiry.expired",
      recipientMembershipId: "membership-person",
      dedupeKey: "competence_expiry_expired:assignment-1",
    });
  });

  it("falls back to the assigning membership when the person has no login identity", async () => {
    tables.assignments.push({
      id: "assignment-2",
      organisationId: ORG_A,
      status: "COMPETENT",
      competentUntil: new Date("2026-08-01"),
      assignedByMembershipId: "membership-assigner",
      person: { membershipId: null },
    });
    await checkCompetenceExpiry(orgContextA, "user-1", asOf);
    expect(notifyMembership.mock.calls[0][2]).toMatchObject({ recipientMembershipId: "membership-assigner" });
  });

  it("does not touch an assignment not yet due", async () => {
    tables.assignments.push({
      id: "assignment-3",
      organisationId: ORG_A,
      status: "COMPETENT",
      competentUntil: new Date("2027-01-01"),
      assignedByMembershipId: "membership-assigner",
      person: { membershipId: null },
    });
    const expired = await checkCompetenceExpiry(orgContextA, "user-1", asOf);
    expect(expired).toEqual([]);
    expect(find(tables.assignments, { id: "assignment-3" })?.status).toBe("COMPETENT");
  });

  it("is idempotent — re-running after the first pass raises no further notification for the same assignment", async () => {
    tables.assignments.push({
      id: "assignment-4",
      organisationId: ORG_A,
      status: "COMPETENT",
      competentUntil: new Date("2026-08-01"),
      assignedByMembershipId: "membership-assigner",
      person: { membershipId: "membership-person" },
    });
    await checkCompetenceExpiry(orgContextA, "user-1", asOf);
    expect(notifyMembership).toHaveBeenCalledTimes(1);
    await checkCompetenceExpiry(orgContextA, "user-1", asOf);
    expect(notifyMembership).toHaveBeenCalledTimes(1);
  });

  it("does not touch a REQUIRED/GAP assignment, only COMPETENT ones", async () => {
    tables.assignments.push({
      id: "assignment-5",
      organisationId: ORG_A,
      status: "GAP",
      competentUntil: new Date("2026-08-01"),
      assignedByMembershipId: "membership-assigner",
      person: { membershipId: "membership-person" },
    });
    const expired = await checkCompetenceExpiry(orgContextA, "user-1", asOf);
    expect(expired).toEqual([]);
    expect(notifyMembership).not.toHaveBeenCalled();
  });
});

describe("evaluateUpcomingCompetenceExpiryReminders", () => {
  it("delegates to T24's evaluateReminderRule with subjects built from COMPETENT assignments", async () => {
    tables.assignments.push({
      id: "assignment-6",
      organisationId: ORG_A,
      status: "COMPETENT",
      competentUntil: new Date("2026-09-01"),
      assignedByMembershipId: "membership-assigner",
      person: { membershipId: "membership-person" },
    });
    const rule = { id: "rule-1", resourceType: "competence_assignment", event: "expiry", offsetDays: -14, recipientsPolicy: { kind: "permission", permission: "ems.competence.manage" } };

    await evaluateUpcomingCompetenceExpiryReminders(orgContextA, rule, asOf);

    expect(evaluateReminderRule).toHaveBeenCalledTimes(1);
    const options = evaluateReminderRule.mock.calls[0][1] as {
      rule: unknown;
      notificationType: string;
      subjects: Array<Record<string, unknown>>;
    };
    expect(options.rule).toBe(rule);
    expect(options.notificationType).toBe("expiry.upcoming");
    expect(options.subjects).toHaveLength(1);
    expect(options.subjects[0]).toMatchObject({
      resourceId: "assignment-6",
      recipientsPolicy: { kind: "membership", membershipId: "membership-person" },
    });
  });
});

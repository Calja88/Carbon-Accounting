/**
 * Management review scheduling, attendees and exact-version input linking
 * tests (task T72). No live database — Prisma is replaced with an
 * in-memory fake, the audit-event side effect is stubbed, and the
 * input-adapter registry is replaced with a synthetic fixed candidate list
 * so this suite never has to fake T45/T52/T61/T64/T71's own tables.
 * Covers: scheduling validation, membership/agenda-version validation,
 * attendee management, linking a review input to an adapter-resolved exact
 * source version, open-prior-actions read model, and tenant isolation. All
 * fixtures are fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row; orderBy?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  memberships: [] as Row[],
  persons: [] as Row[],
  agendaTemplateVersions: [] as Row[],
  inputDefinitions: [] as Row[],
  reviews: [] as Row[],
  attendees: [] as Row[],
  inputLinks: [] as Row[],
  actionItems: [] as Row[],
  nextId: 1,
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const operators = value as { in?: unknown[] };
      if (operators.in) return operators.in.includes(row[key]);
      return false;
    }
    return row[key] === value;
  });
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

function simpleModel(rows: Row[], prefix: string, defaults: Row = {}) {
  return {
    findFirst: vi.fn(async ({ where, orderBy }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(rows, key as Row, orderBy);
    }),
    findUnique: vi.fn(async ({ where }: FindArgs) => find(rows, (where ?? {}) as Row)),
    findMany: vi.fn(async ({ where, orderBy }: FindArgs) => {
      let candidates = rows.filter((r) => matches(r, (where ?? {}) as Row));
      if (orderBy) {
        const [key, direction] = Object.entries(orderBy)[0] as [string, "asc" | "desc"];
        candidates = [...candidates].sort((a, b) => {
          const av = a[key] as number;
          const bv = b[key] as number;
          return direction === "desc" ? bv - av : av - bv;
        });
      }
      return candidates;
    }),
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
    upsert: vi.fn(async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const key = Object.values(where)[0] as Row;
      const existing = find(rows, key);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row: Row = { id: `${prefix}-${tables.nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...defaults, ...create };
      rows.push(row);
      return row;
    }),
    delete: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      const row = find(rows, key as Row);
      if (row) rows.splice(rows.indexOf(row), 1);
      return row;
    }),
  };
}

vi.mock("@/lib/prisma", () => {
  const organisationMembership = simpleModel(tables.memberships, "membership");
  const personProfile = simpleModel(tables.persons, "person");
  const managementReviewAgendaTemplateVersion = simpleModel(tables.agendaTemplateVersions, "template-version");
  const managementReviewInputDefinition = simpleModel(tables.inputDefinitions, "input-def", { isActive: true });
  const managementReview = simpleModel(tables.reviews, "review", { status: "PLANNED" });
  const managementReviewAttendee = simpleModel(tables.attendees, "attendee", { invited: true, role: "MEMBER" });
  const managementReviewInputLink = simpleModel(tables.inputLinks, "input-link");
  const actionItem = simpleModel(tables.actionItems, "action");

  const prismaClient = {
    organisationMembership,
    personProfile,
    managementReviewAgendaTemplateVersion,
    managementReviewInputDefinition,
    managementReview,
    managementReviewAttendee,
    managementReviewInputLink,
    actionItem,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-event-synthetic" })) }));

vi.mock("@/lib/ems/review/input-adapters", () => ({
  getReviewInputAdapter: vi.fn(() => ({
    sourceType: "COMPLIANCE_EVALUATION",
    resolveCandidates: vi.fn(async () => [
      {
        sourceType: "COMPLIANCE_EVALUATION",
        sourceRecordId: "evaluation-1",
        sourceVersionLabel: "2026-06-01T00:00:00.000Z",
        summary: { periodStart: "2026-01-01" },
        isStale: false,
      },
    ]),
  })),
}));

const {
  ManagementReviewError,
  TenantOwnershipError,
  scheduleManagementReview,
  addManagementReviewAttendee,
  removeManagementReviewAttendee,
  linkManagementReviewInput,
  listOpenPriorActions,
  startManagementReviewInputCollection,
} = await import("@/lib/ems/review/review-service");

const orgContextA = makeOrganisationContext(ORG_A, {
  permissions: new Set(["ems.view", "ems.management_review.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});
const orgContextB = makeOrganisationContext(ORG_B, {
  permissions: new Set(["ems.view", "ems.management_review.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});

beforeEach(() => {
  tables.memberships.length = 0;
  tables.persons.length = 0;
  tables.agendaTemplateVersions.length = 0;
  tables.inputDefinitions.length = 0;
  tables.reviews.length = 0;
  tables.attendees.length = 0;
  tables.inputLinks.length = 0;
  tables.actionItems.length = 0;
  tables.nextId = 1;

  tables.memberships.push(
    { id: "membership-org-aster-demo", organisationId: ORG_A, status: "ACTIVE" },
    { id: "chair-A1", organisationId: ORG_A, status: "ACTIVE" },
    { id: "coordinator-A1", organisationId: ORG_A, status: "ACTIVE" },
  );
  tables.persons.push({ id: "person-A1", organisationId: ORG_A, displayName: "A. Reviewer" });
  tables.agendaTemplateVersions.push({
    id: "template-version-A1",
    organisationId: ORG_A,
    templateId: "template-A1",
    version: 1,
    status: "ACTIVE",
  });
  tables.inputDefinitions.push({
    id: "input-def-A1",
    organisationId: ORG_A,
    key: "compliance_status",
    label: "Compliance status",
    sourceType: "COMPLIANCE_EVALUATION",
    isActive: true,
  });
});

async function schedule(overrides: Partial<Parameters<typeof scheduleManagementReview>[1]> = {}) {
  return scheduleManagementReview(orgContextA, {
    reference: "MR-2026-01",
    periodStart: new Date("2026-01-01"),
    periodEnd: new Date("2026-06-30"),
    cutoffDate: new Date("2026-06-15"),
    scheduledDate: new Date("2026-07-01"),
    chairMembershipId: "chair-A1",
    coordinatorMembershipId: "coordinator-A1",
    agendaTemplateVersionId: "template-version-A1",
    actorUserId: "user-1",
    ...overrides,
  });
}

describe("scheduleManagementReview", () => {
  it("schedules a review pinned to the exact agenda template version", async () => {
    const review = await schedule();
    expect(review.status).toBe("PLANNED");
    expect(review.agendaTemplateVersionId).toBe("template-version-A1");
    expect(review.agendaTemplateId).toBe("template-A1");
  });

  it("rejects a period end before period start", async () => {
    await expect(schedule({ periodEnd: new Date("2025-01-01") })).rejects.toThrow(ManagementReviewError);
  });

  it("rejects scheduling against a DRAFT agenda template version", async () => {
    tables.agendaTemplateVersions.push({
      id: "template-version-draft",
      organisationId: ORG_A,
      templateId: "template-A2",
      version: 1,
      status: "DRAFT",
    });
    await expect(schedule({ agendaTemplateVersionId: "template-version-draft" })).rejects.toThrow(ManagementReviewError);
  });

  it("denies a chair membership belonging to another tenant", async () => {
    tables.memberships.push({ id: "chair-B1", organisationId: ORG_B, status: "ACTIVE" });
    await expect(schedule({ chairMembershipId: "chair-B1" })).rejects.toThrow(TenantOwnershipError);
  });
});

describe("attendees", () => {
  it("adds and removes an attendee linked to a PersonProfile", async () => {
    const review = await schedule();
    const attendee = await addManagementReviewAttendee(orgContextA, review.id, { personId: "person-A1", actorUserId: "user-1" });
    expect(attendee.personId).toBe("person-A1");
    expect(tables.attendees).toHaveLength(1);

    await removeManagementReviewAttendee(orgContextA, attendee.id, "user-1");
    expect(tables.attendees).toHaveLength(0);
  });

  it("rejects adding the same person twice", async () => {
    const review = await schedule();
    await addManagementReviewAttendee(orgContextA, review.id, { personId: "person-A1", actorUserId: "user-1" });
    await expect(
      addManagementReviewAttendee(orgContextA, review.id, { personId: "person-A1", actorUserId: "user-1" }),
    ).rejects.toThrow(ManagementReviewError);
  });

  it("denies linking a person from another tenant", async () => {
    const review = await schedule();
    tables.persons.push({ id: "person-B1", organisationId: ORG_B, displayName: "B. Reviewer" });
    await expect(
      addManagementReviewAttendee(orgContextA, review.id, { personId: "person-B1", actorUserId: "user-1" }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

describe("linkManagementReviewInput", () => {
  it("links the adapter-resolved exact source record and version label", async () => {
    const review = await schedule();
    const link = await linkManagementReviewInput(orgContextA, review.id, {
      inputDefinitionKey: "compliance_status",
      actorUserId: "user-1",
    });
    expect(link.sourceRecordId).toBe("evaluation-1");
    expect(link.sourceVersionLabel).toBe("2026-06-01T00:00:00.000Z");
    expect(link.sourceType).toBe("COMPLIANCE_EVALUATION");
  });

  it("is idempotent when linking the same source record twice (re-resolve, not duplicate)", async () => {
    const review = await schedule();
    await linkManagementReviewInput(orgContextA, review.id, { inputDefinitionKey: "compliance_status", actorUserId: "user-1" });
    await linkManagementReviewInput(orgContextA, review.id, { inputDefinitionKey: "compliance_status", actorUserId: "user-1" });
    expect(tables.inputLinks).toHaveLength(1);
  });

  it("rejects linking an unknown input definition key", async () => {
    const review = await schedule();
    await expect(
      linkManagementReviewInput(orgContextA, review.id, { inputDefinitionKey: "unknown_key", actorUserId: "user-1" }),
    ).rejects.toThrow(ManagementReviewError);
  });

  it("rejects linking once the review has moved past input collection", async () => {
    const review = await schedule();
    await startManagementReviewInputCollection(orgContextA, review.id, "user-1");
    tables.reviews.find((r) => r.id === review.id)!.status = "HELD";
    await expect(
      linkManagementReviewInput(orgContextA, review.id, { inputDefinitionKey: "compliance_status", actorUserId: "user-1" }),
    ).rejects.toThrow(ManagementReviewError);
  });
});

describe("listOpenPriorActions", () => {
  it("returns only open-status action items for the organisation", async () => {
    const review = await schedule();
    tables.actionItems.push(
      { id: "action-open-1", organisationId: ORG_A, programmeId: "programme-A1", title: "Fix leak", status: "OPEN", dueDate: new Date("2026-07-01"), ownerMembershipId: "membership-org-aster-demo" },
      { id: "action-completed-1", organisationId: ORG_A, programmeId: "programme-A1", title: "Done already", status: "COMPLETED", dueDate: new Date("2026-01-01"), ownerMembershipId: "membership-org-aster-demo" },
      { id: "action-other-org", organisationId: ORG_B, programmeId: "programme-B1", title: "Other tenant", status: "OPEN", dueDate: new Date("2026-07-01"), ownerMembershipId: "membership-B" },
    );

    const rows = await listOpenPriorActions(orgContextA, review.id);
    expect(rows.map((r) => r.actionItemId)).toEqual(["action-open-1"]);
  });

  it("denies listing prior actions for a review belonging to another tenant", async () => {
    const review = await schedule();
    await expect(listOpenPriorActions(orgContextB, review.id)).rejects.toThrow(TenantOwnershipError);
  });
});

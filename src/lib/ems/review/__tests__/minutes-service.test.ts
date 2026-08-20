/**
 * Management review hold/decisions/approved minutes/action-link tests (task
 * T73). No live database — Prisma is replaced with an in-memory fake and
 * the audit-event side effect is stubbed, mirroring review-service.test.ts
 * (T72). Covers: explicit decision recording (never inferred), the
 * HELD -> MINUTES_DRAFT -> APPROVED state machine, approved-minutes
 * immutability, correction addenda, decision -> ActionItem link-only
 * behaviour, and tenant isolation. All fixtures are fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row; orderBy?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  memberships: [] as Row[],
  reviews: [] as Row[],
  attendees: [] as Row[],
  decisions: [] as Row[],
  minuteRevisions: [] as Row[],
  aiNarratives: [] as Row[],
  actionItems: [] as Row[],
  actionLinks: [] as Row[],
  nextId: 1,
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function find(rows: Row[], where: Row) {
  return rows.find((row) => matches(row, where)) ?? null;
}

function simpleModel(rows: Row[], prefix: string, defaults: Row = {}) {
  return {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(rows, key as Row);
    }),
    findMany: vi.fn(async ({ where, orderBy }: FindArgs) => {
      let candidates = rows.filter((r) => matches(r, (where ?? {}) as Row));
      if (orderBy) {
        const [key, direction] = Object.entries(orderBy)[0] as [string, "asc" | "desc"];
        candidates = [...candidates].sort((a, b) => {
          const av = a[key] as number | string;
          const bv = b[key] as number | string;
          if (av === bv) return 0;
          const lt = av < bv;
          return direction === "desc" ? (lt ? 1 : -1) : lt ? -1 : 1;
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
  const managementReview = simpleModel(tables.reviews, "review", { status: "PLANNED" });
  const managementReviewAttendee = simpleModel(tables.attendees, "attendee");
  const managementReviewDecision = simpleModel(tables.decisions, "decision", { recordedAt: new Date("2026-07-10T10:00:00.000Z") });
  const managementReviewMinuteRevision = simpleModel(tables.minuteRevisions, "minutes", { status: "DRAFT" });
  const managementReviewAiNarrative = simpleModel(tables.aiNarratives, "narrative", { status: "PENDING_REVIEW" });
  const actionItem = simpleModel(tables.actionItems, "action");
  const managementReviewActionLink = simpleModel(tables.actionLinks, "action-link");

  const prismaClient = {
    organisationMembership,
    managementReview,
    managementReviewAttendee,
    managementReviewDecision,
    managementReviewMinuteRevision,
    managementReviewAiNarrative,
    actionItem,
    managementReviewActionLink,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-event-synthetic" })) }));

const {
  ManagementReviewMinutesError,
  TenantOwnershipError,
  holdManagementReview,
  recordManagementReviewDecision,
  listManagementReviewDecisions,
  draftManagementReviewMinutes,
  approveManagementReviewMinutes,
  createManagementReviewMinutesAddendum,
  closeManagementReview,
  linkManagementReviewAction,
  unlinkManagementReviewAction,
} = await import("@/lib/ems/review/minutes-service");

const orgContextA = makeOrganisationContext(ORG_A, {
  membershipId: "membership-A-chair",
  permissions: new Set(["ems.view", "ems.management_review.manage", "ems.management_review.approve"]) as unknown as ReturnType<
    typeof makeOrganisationContext
  >["permissions"],
});
const orgContextAManageOnly = makeOrganisationContext(ORG_A, {
  membershipId: "membership-A-chair",
  permissions: new Set(["ems.view", "ems.management_review.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});
const orgContextB = makeOrganisationContext(ORG_B, {
  membershipId: "membership-B-chair",
  permissions: new Set(["ems.view", "ems.management_review.manage", "ems.management_review.approve"]) as unknown as ReturnType<
    typeof makeOrganisationContext
  >["permissions"],
});

function resetTables() {
  tables.memberships.length = 0;
  tables.reviews.length = 0;
  tables.attendees.length = 0;
  tables.decisions.length = 0;
  tables.minuteRevisions.length = 0;
  tables.aiNarratives.length = 0;
  tables.actionItems.length = 0;
  tables.actionLinks.length = 0;
  tables.nextId = 1;
}

beforeEach(() => {
  resetTables();
  tables.memberships.push(
    { id: "membership-A-chair", organisationId: ORG_A, status: "ACTIVE" },
    { id: "owner-A1", organisationId: ORG_A, status: "ACTIVE" },
  );
  tables.reviews.push({
    id: "review-A1",
    organisationId: ORG_A,
    reference: "MR-2026-01",
    status: "PACK_ISSUED",
  });
  tables.actionItems.push({ id: "action-A1", organisationId: ORG_A, programmeId: "programme-A1", status: "OPEN" });
});

describe("holdManagementReview", () => {
  it("moves PACK_ISSUED -> HELD and sets heldDate", async () => {
    const held = await holdManagementReview(orgContextA, "review-A1", new Date("2026-07-10"), "user-1");
    expect(held.status).toBe("HELD");
    expect(held.heldDate).toEqual(new Date("2026-07-10"));
  });

  it("rejects holding before the pack is issued", async () => {
    tables.reviews[0].status = "INPUT_COLLECTION";
    await expect(holdManagementReview(orgContextA, "review-A1", new Date(), "user-1")).rejects.toThrow(ManagementReviewMinutesError);
  });

  it("denies cross-tenant access", async () => {
    await expect(holdManagementReview(orgContextB, "review-A1", new Date(), "user-1")).rejects.toThrow(TenantOwnershipError);
  });
});

describe("recordManagementReviewDecision — always explicit, never inferred", () => {
  it("rejects before the review has been held", async () => {
    await expect(
      recordManagementReviewDecision(orgContextA, "review-A1", {
        decisionType: "RESOURCE_ALLOCATION",
        text: "Approve additional headcount for the sustainability team.",
        actorUserId: "user-1",
      }),
    ).rejects.toThrow(ManagementReviewMinutesError);
  });

  it("records a decision from explicit caller-supplied fields once the review is held", async () => {
    tables.reviews[0].status = "HELD";
    const decision = await recordManagementReviewDecision(orgContextA, "review-A1", {
      decisionType: "OBJECTIVE_OR_POLICY_CHANGE",
      text: "Revise the 2027 emissions objective.",
      rationale: "Prior-year performance data reviewed at this meeting.",
      ownerMembershipId: "owner-A1",
      actorUserId: "user-1",
    });
    expect(decision.text).toBe("Revise the 2027 emissions objective.");
    expect(decision.recordedByMembershipId).toBe("membership-A-chair");
  });

  it("rejects an empty decision text", async () => {
    tables.reviews[0].status = "HELD";
    await expect(
      recordManagementReviewDecision(orgContextA, "review-A1", { decisionType: "OTHER", text: "  ", actorUserId: "user-1" }),
    ).rejects.toThrow(ManagementReviewMinutesError);
  });

  it("rejects once the review is closed", async () => {
    tables.reviews[0].status = "CLOSED";
    await expect(
      recordManagementReviewDecision(orgContextA, "review-A1", { decisionType: "OTHER", text: "Late decision.", actorUserId: "user-1" }),
    ).rejects.toThrow(ManagementReviewMinutesError);
  });

  it("has no update or delete export — a recorded decision can never be edited", async () => {
    const moduleExports = await import("@/lib/ems/review/minutes-service");
    expect((moduleExports as Record<string, unknown>).updateManagementReviewDecision).toBeUndefined();
    expect((moduleExports as Record<string, unknown>).deleteManagementReviewDecision).toBeUndefined();
  });

  it("denies cross-tenant access", async () => {
    tables.reviews[0].status = "HELD";
    await expect(listManagementReviewDecisions(orgContextB, "review-A1")).rejects.toThrow(TenantOwnershipError);
  });
});

async function holdAndDecide() {
  tables.reviews[0].status = "HELD";
  await recordManagementReviewDecision(orgContextA, "review-A1", {
    decisionType: "RESOURCE_ALLOCATION",
    text: "Fund an additional site energy audit next quarter.",
    actorUserId: "user-1",
  });
}

describe("draftManagementReviewMinutes / approveManagementReviewMinutes", () => {
  it("drafts minutes only from HELD, moving the review to MINUTES_DRAFT", async () => {
    await holdAndDecide();
    const revision = await draftManagementReviewMinutes(orgContextA, "review-A1", { actorUserId: "user-1" });
    expect(revision.revisionNumber).toBe(1);
    expect(revision.status).toBe("DRAFT");
    expect(tables.reviews[0].status).toBe("MINUTES_DRAFT");
    const content = revision.content as { decisions: unknown[] };
    expect(content.decisions).toHaveLength(1);
  });

  it("rejects drafting minutes before the review is held", async () => {
    await expect(draftManagementReviewMinutes(orgContextA, "review-A1", { actorUserId: "user-1" })).rejects.toThrow(
      ManagementReviewMinutesError,
    );
  });

  it("requires ems.management_review.approve to approve minutes", async () => {
    await holdAndDecide();
    const revision = await draftManagementReviewMinutes(orgContextA, "review-A1", { actorUserId: "user-1" });
    await expect(approveManagementReviewMinutes(orgContextAManageOnly, revision.id as string, "user-2")).rejects.toThrow(
      PermissionDeniedError,
    );
  });

  it("approving the primary revision freezes content/checksum and moves the review to APPROVED", async () => {
    await holdAndDecide();
    const revision = await draftManagementReviewMinutes(orgContextA, "review-A1", { actorUserId: "user-1" });
    const approved = await approveManagementReviewMinutes(orgContextA, revision.id as string, "user-2");
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedByMembershipId).toBe("membership-A-chair");
    expect(approved.checksumSha256).toBeTruthy();
    expect(tables.reviews[0].status).toBe("APPROVED");
  });

  it("approved minutes are immutable — approving twice is rejected", async () => {
    await holdAndDecide();
    const revision = await draftManagementReviewMinutes(orgContextA, "review-A1", { actorUserId: "user-1" });
    await approveManagementReviewMinutes(orgContextA, revision.id as string, "user-2");
    await expect(approveManagementReviewMinutes(orgContextA, revision.id as string, "user-2")).rejects.toThrow(
      ManagementReviewMinutesError,
    );
  });

  it("a decision recorded after approval never rewrites the already-approved revision's frozen content", async () => {
    await holdAndDecide();
    const revision = await draftManagementReviewMinutes(orgContextA, "review-A1", { actorUserId: "user-1" });
    const approved = await approveManagementReviewMinutes(orgContextA, revision.id as string, "user-2");
    const contentBefore = JSON.stringify(approved.content);

    await recordManagementReviewDecision(orgContextA, "review-A1", {
      decisionType: "OTHER",
      text: "A later decision recorded after minutes approval, for a future addendum.",
      actorUserId: "user-1",
    });

    const stillApproved = tables.minuteRevisions.find((r) => r.id === approved.id)!;
    expect(JSON.stringify(stillApproved.content)).toBe(contentBefore);
  });

  it("only a REVIEWED AI narrative may be referenced from minutes", async () => {
    await holdAndDecide();
    tables.aiNarratives.push({ id: "narrative-1", organisationId: ORG_A, packId: "pack-A1", status: "PENDING_REVIEW" });
    await expect(
      draftManagementReviewMinutes(orgContextA, "review-A1", { narrativeId: "narrative-1", actorUserId: "user-1" }),
    ).rejects.toThrow(ManagementReviewMinutesError);
  });

  it("denies cross-tenant access", async () => {
    await expect(draftManagementReviewMinutes(orgContextB, "review-A1", { actorUserId: "user-1" })).rejects.toThrow(TenantOwnershipError);
  });
});

describe("createManagementReviewMinutesAddendum — corrections require a successor", () => {
  async function approveOriginal() {
    await holdAndDecide();
    const revision = await draftManagementReviewMinutes(orgContextA, "review-A1", { actorUserId: "user-1" });
    return approveManagementReviewMinutes(orgContextA, revision.id as string, "user-2");
  }

  it("rejects an addendum before the primary minutes are approved", async () => {
    await holdAndDecide();
    await draftManagementReviewMinutes(orgContextA, "review-A1", { actorUserId: "user-1" });
    await expect(
      createManagementReviewMinutesAddendum(orgContextA, "review-A1", { reason: "Correction.", actorUserId: "user-1" }),
    ).rejects.toThrow(ManagementReviewMinutesError);
  });

  it("creates a new DRAFT revision referencing the approved revision it corrects", async () => {
    const approved = await approveOriginal();
    const addendum = await createManagementReviewMinutesAddendum(orgContextA, "review-A1", {
      reason: "Corrected the resource allocation figure discussed at the meeting.",
      actorUserId: "user-1",
    });
    expect(addendum.status).toBe("DRAFT");
    expect(addendum.supersedesRevisionId).toBe(approved.id);
    expect(addendum.revisionNumber).toBe((approved.revisionNumber as number) + 1);
  });

  it("never replaces the original approved revision — it stays APPROVED and unchanged", async () => {
    const approved = await approveOriginal();
    const contentBefore = JSON.stringify(approved.content);
    await createManagementReviewMinutesAddendum(orgContextA, "review-A1", { reason: "Correction.", actorUserId: "user-1" });
    const original = tables.minuteRevisions.find((r) => r.id === approved.id)!;
    expect(original.status).toBe("APPROVED");
    expect(JSON.stringify(original.content)).toBe(contentBefore);
  });

  it("an addendum must itself be approved — approving it does not re-move review status", async () => {
    await approveOriginal();
    const addendum = await createManagementReviewMinutesAddendum(orgContextA, "review-A1", { reason: "Correction.", actorUserId: "user-1" });
    const approvedAddendum = await approveManagementReviewMinutes(orgContextA, addendum.id as string, "user-2");
    expect(approvedAddendum.status).toBe("APPROVED");
    expect(tables.reviews[0].status).toBe("APPROVED");
  });

  it("rejects a second addendum while one already exists for the latest approved revision", async () => {
    await approveOriginal();
    await createManagementReviewMinutesAddendum(orgContextA, "review-A1", { reason: "First correction.", actorUserId: "user-1" });
    await expect(
      createManagementReviewMinutesAddendum(orgContextA, "review-A1", { reason: "Second correction.", actorUserId: "user-1" }),
    ).rejects.toThrow(ManagementReviewMinutesError);
  });
});

describe("closeManagementReview", () => {
  it("moves APPROVED -> CLOSED", async () => {
    tables.reviews[0].status = "APPROVED";
    const closed = await closeManagementReview(orgContextA, "review-A1", "user-1");
    expect(closed.status).toBe("CLOSED");
  });

  it("rejects closing before approval", async () => {
    tables.reviews[0].status = "MINUTES_DRAFT";
    await expect(closeManagementReview(orgContextA, "review-A1", "user-1")).rejects.toThrow(ManagementReviewMinutesError);
  });
});

describe("management review action links — link-only, never mutates the ActionItem", () => {
  it("links a decision to an existing ActionItem without touching its status", async () => {
    await holdAndDecide();
    const decision = tables.decisions[0];
    const link = await linkManagementReviewAction(orgContextA, decision.id as string, { actionItemId: "action-A1", actorUserId: "user-1" });
    expect(link.decisionId).toBe(decision.id);
    expect(link.actionItemId).toBe("action-A1");
    expect(tables.actionItems[0].status).toBe("OPEN");
  });

  it("rejects linking the same action to the same decision twice", async () => {
    await holdAndDecide();
    const decision = tables.decisions[0];
    await linkManagementReviewAction(orgContextA, decision.id as string, { actionItemId: "action-A1", actorUserId: "user-1" });
    await expect(
      linkManagementReviewAction(orgContextA, decision.id as string, { actionItemId: "action-A1", actorUserId: "user-1" }),
    ).rejects.toThrow(ManagementReviewMinutesError);
  });

  it("unlinking removes the link but never touches the ActionItem", async () => {
    await holdAndDecide();
    const decision = tables.decisions[0];
    const link = await linkManagementReviewAction(orgContextA, decision.id as string, { actionItemId: "action-A1", actorUserId: "user-1" });
    await unlinkManagementReviewAction(orgContextA, link.id as string, "user-1");
    expect(tables.actionLinks).toHaveLength(0);
    expect(tables.actionItems[0].status).toBe("OPEN");
  });

  it("denies linking a foreign-tenant ActionItem", async () => {
    await holdAndDecide();
    tables.actionItems.push({ id: "action-B1", organisationId: ORG_B, programmeId: "programme-B1", status: "OPEN" });
    const decision = tables.decisions[0];
    await expect(
      linkManagementReviewAction(orgContextA, decision.id as string, { actionItemId: "action-B1", actorUserId: "user-1" }),
    ).rejects.toThrow(TenantOwnershipError);
  });

  it("denies cross-tenant access to the decision itself", async () => {
    await holdAndDecide();
    const decision = tables.decisions[0];
    await expect(
      linkManagementReviewAction(orgContextB, decision.id as string, { actionItemId: "action-A1", actorUserId: "user-1" }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

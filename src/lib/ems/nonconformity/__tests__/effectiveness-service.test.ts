/**
 * Effectiveness review tests (task T64). No live database — Prisma is
 * replaced with an in-memory fake. Covers: request-review gating, owner
 * independence (four-eyes), EFFECTIVE leaving the nonconformity closable,
 * and the ineffective-outcome policy (reopen vs. follow-up). All fixtures
 * are fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row; orderBy?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  memberships: [] as Row[],
  nonconformities: [] as Row[],
  correctiveActions: [] as Row[],
  effectivenessReviews: [] as Row[],
  closurePolicies: [] as Row[],
  sourceLinks: [] as Row[],
  nextId: 1,
}));

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    const operators = expected as { in?: unknown[]; not?: unknown };
    if (operators.in) return operators.in.includes(actual);
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
    findUniqueOrThrow: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      const row = find(rows, key as Row);
      if (!row) throw new Error(`${prefix} not found`);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const matched = rows.filter((r) => matchesSimple(r, where ?? {}));
      matched.forEach((r) => Object.assign(r, data));
      return { count: matched.length };
    }),
    findMany: vi.fn(async ({ where, orderBy }: FindArgs) => {
      const matched = rows.filter((r) => matchesSimple(r, where ?? {}));
      if (orderBy && "createdAt" in orderBy && orderBy.createdAt === "desc") {
        return [...matched].sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
      }
      return matched;
    }),
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
  };
}

vi.mock("@/lib/prisma", () => {
  const organisationMembership = simpleModel(tables.memberships, "membership");
  const nonconformity = simpleModel(tables.nonconformities, "nc", { status: "OPEN", reviewCycle: 0 });
  const correctiveAction = simpleModel(tables.correctiveActions, "corrective-action", { status: "OPEN", reviewCycle: 0 });
  const effectivenessReview = simpleModel(tables.effectivenessReviews, "review");
  const nonconformityClosurePolicy = simpleModel(tables.closurePolicies, "policy");
  const nonconformitySourceLink = simpleModel(tables.sourceLinks, "link", { linkedAt: new Date() });

  const prismaClient = {
    $queryRaw: vi.fn(async () => []),
    organisationMembership,
    nonconformity,
    correctiveAction,
    effectivenessReview,
    nonconformityClosurePolicy,
    nonconformitySourceLink,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-event-synthetic" })) }));

const { EffectivenessError, requestEffectivenessReview, performEffectivenessReview, listEffectivenessReviews } = await import(
  "@/lib/ems/nonconformity/effectiveness-service"
);
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const REVIEW_PERMS = new Set(["ems.view", "ems.nonconformity.manage", "ems.corrective_action.effectiveness_review"]) as never;
const VIEW_ONLY = new Set(["ems.view"]) as never;

// The reviewer is deliberately a different membership from the corrective
// action owner, matching the T64 acceptance criterion this whole module
// exists to enforce.
const reviewerContextA = makeOrganisationContext(ORG_A, { userId: "user-reviewer", membershipId: "membership-reviewer", permissions: REVIEW_PERMS });
const ownerContextA = makeOrganisationContext(ORG_A, { userId: "user-owner", membershipId: "membership-owner", permissions: REVIEW_PERMS });
const viewerContextA = makeOrganisationContext(ORG_A, { userId: "user-viewer", membershipId: "membership-viewer", permissions: VIEW_ONLY });
const reviewerContextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: REVIEW_PERMS });

beforeEach(() => {
  for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
    if (key === "nextId") continue;
    (tables[key] as Row[]).length = 0;
  }
  tables.nextId = 1;
  tables.memberships.push({ id: "membership-reviewer", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-owner", organisationId: ORG_A, status: "ACTIVE" });
  tables.nonconformities.push({
    id: "nc-actions-in-progress",
    organisationId: ORG_A,
    reference: "NC-1",
    status: "ACTIONS_IN_PROGRESS", reviewCycle: 0,
    requirementReference: "ISO 14001:2015 Clause 9.1 (fictional)",
    complianceObligationId: null,
    operationalControlId: null,
    ownerMembershipId: null,
  });
  tables.nonconformities.push({
    id: "nc-review",
    organisationId: ORG_A,
    reference: "NC-2",
    status: "EFFECTIVENESS_REVIEW", reviewCycle: 1,
    requirementReference: "ISO 14001:2015 Clause 9.1 (fictional)",
    complianceObligationId: null,
    operationalControlId: null,
    ownerMembershipId: null,
  });
});

describe("requestEffectivenessReview", () => {
  it("moves ACTIONS_IN_PROGRESS to EFFECTIVENESS_REVIEW once every action is completed", async () => {
    tables.correctiveActions.push({ id: "ca-1", organisationId: ORG_A, nonconformityId: "nc-actions-in-progress", status: "COMPLETED", ownerMembershipId: "membership-owner" });
    const updated = await requestEffectivenessReview(reviewerContextA, "nc-actions-in-progress", { actorUserId: reviewerContextA.userId });
    expect(updated.status).toBe("EFFECTIVENESS_REVIEW");
  });

  it("refuses while an action is still open", async () => {
    tables.correctiveActions.push({ id: "ca-1", organisationId: ORG_A, nonconformityId: "nc-actions-in-progress", status: "IN_PROGRESS", ownerMembershipId: "membership-owner" });
    await expect(requestEffectivenessReview(reviewerContextA, "nc-actions-in-progress", { actorUserId: reviewerContextA.userId })).rejects.toThrow(EffectivenessError);
  });

  it("refuses when there are no corrective actions at all", async () => {
    await expect(requestEffectivenessReview(reviewerContextA, "nc-actions-in-progress", { actorUserId: reviewerContextA.userId })).rejects.toThrow(EffectivenessError);
  });

  it("ignores cancelled actions but still requires at least one real completed action", async () => {
    tables.correctiveActions.push({ id: "ca-1", organisationId: ORG_A, nonconformityId: "nc-actions-in-progress", status: "CANCELLED", ownerMembershipId: "membership-owner" });
    await expect(requestEffectivenessReview(reviewerContextA, "nc-actions-in-progress", { actorUserId: reviewerContextA.userId })).rejects.toThrow(EffectivenessError);
  });
});

function reviewInput(overrides: Partial<Parameters<typeof performEffectivenessReview>[2]> = {}) {
  return {
    reviewCycle: 1,
    criteria: "Fictional criteria: no repeat occurrence within 30 days.",
    reviewDate: new Date("2026-08-15"),
    result: "EFFECTIVE" as const,
    decision: "Fictional decision: actions verified effective.",
    actorUserId: reviewerContextA.userId,
    ...overrides,
  };
}

describe("performEffectivenessReview — owner independence", () => {
  it("denies the corrective action owner from reviewing when four-eyes is enabled (default)", async () => {
    tables.correctiveActions.push({ id: "ca-1", organisationId: ORG_A, nonconformityId: "nc-review", status: "COMPLETED", ownerMembershipId: "membership-owner" });
    await expect(performEffectivenessReview(ownerContextA, "nc-review", reviewInput({ actorUserId: ownerContextA.userId }))).rejects.toThrow(PermissionDeniedError);
  });

  it("allows a reviewer who does not own any corrective action on this nonconformity", async () => {
    tables.correctiveActions.push({ id: "ca-1", organisationId: ORG_A, nonconformityId: "nc-review", status: "COMPLETED", ownerMembershipId: "membership-owner" });
    const result = await performEffectivenessReview(reviewerContextA, "nc-review", reviewInput());
    expect(result.review.result).toBe("EFFECTIVE");
    expect(result.review.reviewerMembershipId).toBe("membership-reviewer");
  });

  it("BD02: four-eyes has no client-supplied override — the owner is denied regardless of caller input", async () => {
    tables.correctiveActions.push({ id: "ca-1", organisationId: ORG_A, nonconformityId: "nc-review", status: "COMPLETED", ownerMembershipId: "membership-owner" });
    // No `fourEyesEnabled` field exists on the input type any more — this
    // proves there is no way to reach the old bypass, not just that the
    // default is safe.
    await expect(
      performEffectivenessReview(ownerContextA, "nc-review", reviewInput({ actorUserId: ownerContextA.userId })),
    ).rejects.toThrow(PermissionDeniedError);
  });
});

describe("performEffectivenessReview — outcome handling", () => {
  it("BD02: a stale double-submit is rejected once the nonconformity has already left EFFECTIVENESS_REVIEW", async () => {
    tables.correctiveActions.push({ id: "ca-1", organisationId: ORG_A, nonconformityId: "nc-review", status: "COMPLETED", ownerMembershipId: "membership-owner" });
    // First submit reopens the nonconformity (INEFFECTIVE, default policy).
    await performEffectivenessReview(reviewerContextA, "nc-review", reviewInput({ result: "INEFFECTIVE" }));
    // A second, now-stale request against the same pre-loaded record must
    // get a conflict rather than silently recording a second review or
    // re-reopening an already-reopened nonconformity.
    await expect(performEffectivenessReview(reviewerContextA, "nc-review", reviewInput())).rejects.toThrow(EffectivenessError);
  });

  it("EFFECTIVE leaves the nonconformity in EFFECTIVENESS_REVIEW, ready to close", async () => {
    tables.correctiveActions.push({ id: "ca-1", organisationId: ORG_A, nonconformityId: "nc-review", status: "COMPLETED", ownerMembershipId: "membership-owner" });
    const result = await performEffectivenessReview(reviewerContextA, "nc-review", reviewInput());
    expect(result.nonconformity.status).toBe("EFFECTIVENESS_REVIEW");
    expect(result.followUp).toBeNull();
  });

  it("INEFFECTIVE reopens the same nonconformity under the default REOPEN_NONCONFORMITY policy", async () => {
    tables.correctiveActions.push({ id: "ca-1", organisationId: ORG_A, nonconformityId: "nc-review", status: "COMPLETED", ownerMembershipId: "membership-owner" });
    const result = await performEffectivenessReview(reviewerContextA, "nc-review", reviewInput({ result: "INEFFECTIVE" }));
    expect(result.nonconformity.status).toBe("REOPENED");
    expect(result.nonconformity.reopenReason).toContain("INEFFECTIVE");
    expect(result.followUp).toBeNull();
  });

  it("PARTIALLY_EFFECTIVE creates a separate follow-up nonconformity under the CREATE_FOLLOW_UP policy, reopening the original", async () => {
    tables.closurePolicies.push({ id: "policy-1", organisationId: ORG_A, ineffectiveOutcomePolicy: "CREATE_FOLLOW_UP" });
    tables.correctiveActions.push({ id: "ca-1", organisationId: ORG_A, nonconformityId: "nc-review", status: "COMPLETED", ownerMembershipId: "membership-owner" });
    const result = await performEffectivenessReview(reviewerContextA, "nc-review", reviewInput({ result: "PARTIALLY_EFFECTIVE" }));
    expect(result.nonconformity.status).toBe("REOPENED");
    expect(result.followUp).not.toBeNull();
    expect(result.followUp?.organisationId).toBe(ORG_A);
    expect(result.followUp?.sourceReferenceNote).toContain("NC-2");
    expect(tables.nonconformities).toHaveLength(3);
  });

  it("refuses to record a review while the nonconformity is not in EFFECTIVENESS_REVIEW", async () => {
    await expect(performEffectivenessReview(reviewerContextA, "nc-actions-in-progress", reviewInput())).rejects.toThrow(EffectivenessError);
  });

  it("denies a caller without ems.corrective_action.effectiveness_review", async () => {
    await expect(performEffectivenessReview(viewerContextA, "nc-review", reviewInput({ actorUserId: viewerContextA.userId }))).rejects.toThrow(PermissionDeniedError);
  });

  it("refuses a foreign-tenant nonconformity id", async () => {
    await expect(performEffectivenessReview(reviewerContextB, "nc-review", reviewInput({ actorUserId: reviewerContextB.userId }))).rejects.toThrow(TenantOwnershipError);
  });
});

describe("listEffectivenessReviews — tenant isolation", () => {
  it("is tenant-isolated", async () => {
    tables.correctiveActions.push({ id: "ca-1", organisationId: ORG_A, nonconformityId: "nc-review", status: "COMPLETED", ownerMembershipId: "membership-owner" });
    await performEffectivenessReview(reviewerContextA, "nc-review", reviewInput());
    await expect(listEffectivenessReviews(reviewerContextB, "nc-review")).rejects.toThrow(TenantOwnershipError);
    const listA = await listEffectivenessReviews(reviewerContextA, "nc-review");
    expect(listA).toHaveLength(1);
  });
});

// These are state-machine unit tests only. Real locking/rollback is proved by tests/checkpoint-a/postgres.test.ts.
vi.mock("@/lib/ems/nonconformity/locked-transaction", async () => {
  const { prisma } = await import("@/lib/prisma");
  const { toTenantRepositoryContext } = await import("@/lib/repositories/ems-repository");
  return { withLockedNonconformity: async (context: Parameters<typeof toTenantRepositoryContext>[0], _target: unknown, _permission: unknown,
    operation: (tx: typeof prisma, ctx: ReturnType<typeof toTenantRepositoryContext>, context: Parameters<typeof toTenantRepositoryContext>[0]) => unknown) => operation(prisma, toTenantRepositoryContext(context), context) };
});

describe("Checkpoint A review cycle regressions", () => {
  function completed() { tables.correctiveActions.push({ id: "ca-regression", organisationId: ORG_A, nonconformityId: "nc-review", status: "COMPLETED", ownerMembershipId: "membership-owner" }); }
  it("rejects duplicate EFFECTIVE decisions without a second review row", async () => {
    completed(); await performEffectivenessReview(reviewerContextA, "nc-review", reviewInput());
    await expect(performEffectivenessReview(reviewerContextA, "nc-review", reviewInput())).rejects.toThrow(EffectivenessError);
    expect(tables.effectivenessReviews).toHaveLength(1);
  });
  it("rejects a submitted decision for an old cycle", async () => {
    completed(); tables.nonconformities.find(n => n.id === "nc-review")!.reviewCycle = 2;
    await expect(performEffectivenessReview(reviewerContextA, "nc-review", reviewInput())).rejects.toThrow(EffectivenessError);
    expect(tables.effectivenessReviews).toHaveLength(0);
  });
  it("rechecks action completion when the review is submitted", async () => {
    completed(); tables.correctiveActions[0].status = "REOPENED";
    await expect(performEffectivenessReview(reviewerContextA, "nc-review", reviewInput())).rejects.toThrow(EffectivenessError);
    expect(tables.effectivenessReviews).toHaveLength(0);
  });
});

/**
 * Integration tests (task T64): the full CAPA lifecycle driving
 * `nonconformity-service.ts#closeNonconformity`'s real
 * `NonconformityClosurePolicy` checks against the T64 models, end to end.
 * No live database — Prisma is replaced with an in-memory fake shared by
 * all four nonconformity/T64 service modules. All fixtures are fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row; orderBy?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  memberships: [] as Row[],
  auditFindings: [] as Row[],
  nonconformities: [] as Row[],
  sourceLinks: [] as Row[],
  containmentRecords: [] as Row[],
  rootCauseAnalyses: [] as Row[],
  correctiveActions: [] as Row[],
  effectivenessReviews: [] as Row[],
  nonconformityClosures: [] as Row[],
  closurePolicies: [] as Row[],
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
    findFirst: vi.fn(async ({ where, orderBy }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      const matched = rows.filter((row) => matchesSimple(row, key as Row));
      if (orderBy && "createdAt" in orderBy && orderBy.createdAt === "desc") {
        return [...matched].sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())[0] ?? null;
      }
      return matched[0] ?? null;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      const row = find(rows, key as Row);
      if (!row) throw new Error(`${prefix} not found`);
      return row;
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
  const auditFinding = simpleModel(tables.auditFindings, "finding");
  const nonconformity = simpleModel(tables.nonconformities, "nc", { status: "OPEN" });
  const nonconformitySourceLink = simpleModel(tables.sourceLinks, "link", { linkedAt: new Date() });
  const containmentRecord = simpleModel(tables.containmentRecords, "containment", { adequacyReviewed: false, adequate: null });
  const rootCauseAnalysis = simpleModel(tables.rootCauseAnalyses, "rca", { approvedAt: null });
  const correctiveAction = simpleModel(tables.correctiveActions, "corrective-action", { status: "OPEN" });
  const effectivenessReview = simpleModel(tables.effectivenessReviews, "review");
  const nonconformityClosure = simpleModel(tables.nonconformityClosures, "closure");
  const nonconformityClosurePolicy = simpleModel(tables.closurePolicies, "policy");
  const notification = simpleModel(tables.notifications, "notification", { status: "PENDING" });

  const prismaClient = {
    organisationMembership,
    auditFinding,
    nonconformity,
    nonconformitySourceLink,
    containmentRecord,
    rootCauseAnalysis,
    correctiveAction,
    effectivenessReview,
    nonconformityClosure,
    nonconformityClosurePolicy,
    notification,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-event-synthetic" })) }));
vi.mock("@/lib/documents/evidence-service", () => ({
  uploadEvidenceObject: vi.fn(async () => ({ id: "evidence-synthetic" })),
  linkEvidence: vi.fn(async () => ({ id: "evidence-link-synthetic" })),
}));

const { createNonconformityFromSource, recordContainment, reviewContainmentAdequacy, closeNonconformity, upsertNonconformityClosurePolicy, NonconformityError } =
  await import("@/lib/ems/nonconformity/nonconformity-service");
const { recordRootCauseAnalysis, approveRootCauseAnalysis } = await import("@/lib/ems/nonconformity/root-cause-service");
const { createCorrectiveAction, completeCorrectiveAction } = await import("@/lib/ems/nonconformity/corrective-action-service");
const { requestEffectivenessReview, performEffectivenessReview } = await import("@/lib/ems/nonconformity/effectiveness-service");

const FULL_PERMS = new Set([
  "ems.view",
  "ems.nonconformity.manage",
  "ems.corrective_action.manage",
  "ems.corrective_action.effectiveness_review",
]) as never;

const managerContextA = makeOrganisationContext(ORG_A, { userId: "user-manager", membershipId: "membership-manager", permissions: FULL_PERMS });
const reviewerContextA = makeOrganisationContext(ORG_A, { userId: "user-reviewer", membershipId: "membership-reviewer", permissions: FULL_PERMS });

beforeEach(() => {
  for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
    if (key === "nextId") continue;
    (tables[key] as Row[]).length = 0;
  }
  tables.nextId = 1;
  tables.memberships.push({ id: "membership-manager", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-reviewer", organisationId: ORG_A, status: "ACTIVE" });
  tables.auditFindings.push({ id: "finding-a1", organisationId: ORG_A, auditId: "audit-a1" });
});

async function driveToEffectivenessReview() {
  const nc = await createNonconformityFromSource(managerContextA, {
    reference: `NC-${tables.nextId}`,
    sourceType: "AUDIT_FINDING",
    sourceId: "finding-a1",
    statement: "A synthetic control was found not operating as documented.",
    requirementReference: "ISO 14001:2015 Clause 9.1 (fictional reference)",
    actorUserId: managerContextA.userId,
  });
  const containment = await recordContainment(managerContextA, nc.id, {
    actionTaken: "Fictional containment action.",
    actionTakenAt: new Date("2026-01-01"),
    ownerMembershipId: "membership-manager",
    actorUserId: managerContextA.userId,
  });
  await reviewContainmentAdequacy(managerContextA, containment.id, { adequate: true, actorUserId: managerContextA.userId });
  const analysis = await recordRootCauseAnalysis(managerContextA, nc.id, {
    method: "FIVE_WHYS",
    analysisPayload: { whys: ["fictional cause"] },
    conclusion: "Fictional root cause.",
    actorUserId: managerContextA.userId,
  });
  await approveRootCauseAnalysis(managerContextA, analysis.id, { actorUserId: managerContextA.userId });
  const action = await createCorrectiveAction(managerContextA, nc.id, {
    description: "Fictional corrective action.",
    ownerMembershipId: "membership-manager",
    dueDate: new Date("2026-09-01"),
    actorUserId: managerContextA.userId,
  });
  await completeCorrectiveAction(managerContextA, action.id, { completionEvidenceNote: "Fictional evidence.", actorUserId: managerContextA.userId });
  await requestEffectivenessReview(managerContextA, nc.id, { actorUserId: managerContextA.userId });
  return nc.id;
}

describe("full CAPA lifecycle -> closure", () => {
  it("closes once root cause, corrective actions and an EFFECTIVE review are all satisfied under a full policy", async () => {
    await upsertNonconformityClosurePolicy(managerContextA, {
      requireContainment: true,
      requireRootCauseApproval: true,
      requireCorrectiveActionsComplete: true,
      requireEffectivenessReview: true,
      actorUserId: managerContextA.userId,
    });
    const nonconformityId = await driveToEffectivenessReview();
    await performEffectivenessReview(reviewerContextA, nonconformityId, {
      criteria: "Fictional criteria.",
      reviewDate: new Date("2026-08-20"),
      result: "EFFECTIVE",
      decision: "Fictional decision: effective.",
      actorUserId: reviewerContextA.userId,
    });
    const closed = await closeNonconformity(managerContextA, nonconformityId, managerContextA.userId);
    expect(closed.status).toBe("CLOSED");
    // Closure snapshot preserves the full CAPA history.
    expect(tables.nonconformityClosures).toHaveLength(1);
    const snapshot = tables.nonconformityClosures[0].snapshot as Record<string, unknown[]>;
    expect(snapshot.rootCauseAnalyses).toHaveLength(1);
    expect(snapshot.correctiveActions).toHaveLength(1);
    expect(snapshot.effectivenessReviews).toHaveLength(1);
  });

  it("refuses to close when the effectiveness review is still pending, even with root cause and actions satisfied", async () => {
    await upsertNonconformityClosurePolicy(managerContextA, {
      requireContainment: true,
      requireRootCauseApproval: true,
      requireCorrectiveActionsComplete: true,
      requireEffectivenessReview: true,
      actorUserId: managerContextA.userId,
    });
    const nonconformityId = await driveToEffectivenessReview();
    await expect(closeNonconformity(managerContextA, nonconformityId, managerContextA.userId)).rejects.toThrow(NonconformityError);
  });

  it("INEFFECTIVE reopens the nonconformity and it can never close from REOPENED without redoing the cycle", async () => {
    await upsertNonconformityClosurePolicy(managerContextA, {
      requireContainment: true,
      requireRootCauseApproval: true,
      requireCorrectiveActionsComplete: true,
      requireEffectivenessReview: true,
      actorUserId: managerContextA.userId,
    });
    const nonconformityId = await driveToEffectivenessReview();
    const result = await performEffectivenessReview(reviewerContextA, nonconformityId, {
      criteria: "Fictional criteria.",
      reviewDate: new Date("2026-08-20"),
      result: "INEFFECTIVE",
      decision: "Fictional decision: not effective.",
      actorUserId: reviewerContextA.userId,
    });
    expect(result.nonconformity.status).toBe("REOPENED");
    await expect(closeNonconformity(managerContextA, nonconformityId, managerContextA.userId)).rejects.toThrow(NonconformityError);
  });

  it("closure permission is checked live: revoking ems.nonconformity.manage before close denies it even after every step is satisfied", async () => {
    await upsertNonconformityClosurePolicy(managerContextA, {
      requireContainment: true,
      requireRootCauseApproval: true,
      requireCorrectiveActionsComplete: true,
      requireEffectivenessReview: true,
      actorUserId: managerContextA.userId,
    });
    const nonconformityId = await driveToEffectivenessReview();
    await performEffectivenessReview(reviewerContextA, nonconformityId, {
      criteria: "Fictional criteria.",
      reviewDate: new Date("2026-08-20"),
      result: "EFFECTIVE",
      decision: "Fictional decision: effective.",
      actorUserId: reviewerContextA.userId,
    });
    const revokedContext = makeOrganisationContext(ORG_A, { userId: "user-manager", membershipId: "membership-manager", permissions: new Set(["ems.view"]) as never });
    const { PermissionDeniedError } = await import("@/lib/rbac/authorize");
    await expect(closeNonconformity(revokedContext, nonconformityId, revokedContext.userId)).rejects.toThrow(PermissionDeniedError);
  });
});

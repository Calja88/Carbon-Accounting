/**
 * Environmental objective versioning and approval tests (task T50). No live
 * database — Prisma is replaced with an in-memory fake, and the audit
 * side-effect (already covered by its own T20 test suite) is stubbed so
 * these tests stay focused on the state machine itself: versioned drafts,
 * the approval transaction (including the active-pointer move and
 * four-eyes self-approval denial), approved-version immutability-by-
 * construction, successor versions, achievement review (not linked-action
 * completion), and tenant isolation.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row; orderBy?: Row | Row[] };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  memberships: [] as Row[],
  policyRecords: [] as Row[],
  aspectAssessments: [] as Row[],
  obligationVersions: [] as Row[],
  riskOpportunities: [] as Row[],
  objectives: [] as Row[],
  versions: [] as Row[],
  sourceLinks: [] as Row[],
  approvals: [] as Row[],
  nextId: 1,
}));

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    const operators = expected as { in?: unknown[] };
    if (operators.in) return operators.in.includes(actual);
    return false;
  }
  return actual === expected;
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => matchValue(row[key], value));
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

vi.mock("@/lib/prisma", () => {
  const organisationMembership = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.memberships, where ?? {})) };
  const environmentalPolicyRecord = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.policyRecords, where ?? {})) };
  const aspectAssessment = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.aspectAssessments, where ?? {})) };
  const complianceObligationVersion = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.obligationVersions, where ?? {})) };
  const emsRiskOpportunity = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.riskOpportunities, where ?? {})) };

  const environmentalObjective = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.objectives, key as Row);
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => tables.objectives.filter((row) => matches(row, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const id = `objective-${tables.nextId++}`;
      const row: Row = { id, activeVersionId: null, createdAt: new Date(), ...data };
      tables.objectives.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.objectives, key);
      if (!row) throw new Error("objective not found");
      Object.assign(row, data);
      return row;
    }),
  };

  const environmentalObjectiveVersion = {
    findFirst: vi.fn(async ({ where, orderBy }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.versions, key as Row, orderBy as Row);
    }),
    findUnique: vi.fn(async ({ where }: FindArgs) => find(tables.versions, where ?? {})),
    create: vi.fn(async ({ data }: { data: Row & { sourceLinks?: { create: Row[] } } }) => {
      const { sourceLinks: linksEnvelope, ...versionData } = data;
      const id = `version-${tables.nextId++}`;
      const row: Row = {
        id,
        status: "DRAFT",
        approvedByUserId: null,
        approvedAt: null,
        achievementDecidedByUserId: null,
        achievementDecidedAt: null,
        achievementRationale: null,
        revisionRationale: null,
        supersedesVersionId: null,
        preparedAt: new Date(),
        createdAt: new Date(),
        ...versionData,
      };
      tables.versions.push(row);
      const linkRows = (linksEnvelope?.create ?? []).map((link) => ({ id: `link-${tables.nextId++}`, objectiveVersionId: id, ...link }));
      tables.sourceLinks.push(...linkRows);
      return { ...row, sourceLinks: linkRows };
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs & { data: Row & { sourceLinks?: { create: Row[] } } }) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.versions, key);
      if (!row) throw new Error("version not found");
      const { sourceLinks: linksEnvelope, ...versionData } = data;
      Object.assign(row, versionData);
      if (linksEnvelope?.create) {
        const linkRows = linksEnvelope.create.map((link) => ({ id: `link-${tables.nextId++}`, objectiveVersionId: row.id, ...link }));
        tables.sourceLinks.push(...linkRows);
      }
      return row;
    }),
  };

  const objectiveSourceLink = {
    deleteMany: vi.fn(async ({ where }: FindArgs) => {
      const remaining = tables.sourceLinks.filter((row) => !matches(row, where ?? {}));
      const removed = tables.sourceLinks.length - remaining.length;
      tables.sourceLinks.length = 0;
      tables.sourceLinks.push(...remaining);
      return { count: removed };
    }),
  };

  const objectiveApproval = {
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `approval-${tables.nextId++}`, decidedAt: new Date(), ...data };
      tables.approvals.push(row);
      return row;
    }),
  };

  const prismaClient = {
    organisationMembership,
    environmentalPolicyRecord,
    aspectAssessment,
    complianceObligationVersion,
    emsRiskOpportunity,
    environmentalObjective,
    environmentalObjectiveVersion,
    objectiveSourceLink,
    objectiveApproval,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-synthetic" })) }));

const {
  createEnvironmentalObjective,
  updateEnvironmentalObjectiveVersionDraft,
  submitEnvironmentalObjectiveVersionForReview,
  approveEnvironmentalObjectiveVersion,
  rejectEnvironmentalObjectiveVersion,
  returnEnvironmentalObjectiveVersionForRevision,
  decideObjectiveAchievement,
  cancelEnvironmentalObjectiveVersion,
  createSuccessorEnvironmentalObjectiveVersion,
  ObjectiveError,
} = await import("@/lib/ems/objectives/objective-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const EDIT_ONLY = new Set(["ems.view", "ems.objective.manage"]) as never;
const APPROVE_ONLY = new Set(["ems.view", "ems.objective.approve"]) as never;
const BOTH = new Set(["ems.view", "ems.objective.manage", "ems.objective.approve"]) as never;

const contextA = makeOrganisationContext(ORG_A, { userId: "user-drafter", membershipId: "membership-drafter", permissions: BOTH });
const contextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: BOTH });
const editOnlyContextA = makeOrganisationContext(ORG_A, { userId: "user-drafter", membershipId: "membership-drafter", permissions: EDIT_ONLY });
const approverContextA = makeOrganisationContext(ORG_A, { userId: "user-approver", membershipId: "membership-approver", permissions: APPROVE_ONLY });
const authorAsApproverContextA = makeOrganisationContext(ORG_A, {
  userId: "user-drafter",
  membershipId: "membership-drafter",
  permissions: APPROVE_ONLY,
});

function baseDraft(overrides: Record<string, unknown> = {}) {
  return {
    title: "Reduce synthetic scope 2 intensity",
    intent: "Fictional pilot objective for test coverage only.",
    ownerMembershipId: "membership-drafter",
    baselineDescription: "Synthetic FY25 baseline placeholder.",
    baselineDate: new Date("2025-01-01"),
    targetValue: 10,
    unit: "tCO2e/unit",
    targetDate: new Date("2027-01-01"),
    evaluationMethod: "Synthetic quarterly review of fictional data.",
    sourceLinks: [],
    actorUserId: "user-drafter",
    revisionRationale: "Synthetic revision.",
    ...overrides,
  };
}

async function createDraft(context = contextA, overrides: Record<string, unknown> = {}) {
  return createEnvironmentalObjective(context, baseDraft(overrides));
}

beforeEach(() => {
  tables.memberships.length = 0;
  tables.policyRecords.length = 0;
  tables.aspectAssessments.length = 0;
  tables.obligationVersions.length = 0;
  tables.riskOpportunities.length = 0;
  tables.objectives.length = 0;
  tables.versions.length = 0;
  tables.sourceLinks.length = 0;
  tables.approvals.length = 0;
  tables.nextId = 1;

  tables.memberships.push({ id: "membership-drafter", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-approver", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-b", organisationId: ORG_B, status: "ACTIVE" });
  tables.aspectAssessments.push({ id: "aspect-assessment-a", organisationId: ORG_A, aspectId: "aspect-1" });
  tables.riskOpportunities.push({ id: "risk-a", organisationId: ORG_A, category: "synthetic" });
});

describe("createEnvironmentalObjective", () => {
  it("requires ems.objective.manage", async () => {
    await expect(createEnvironmentalObjective(approverContextA, baseDraft())).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("requires either a numeric target with unit or a qualitative target, not both", async () => {
    await expect(createDraft(contextA, { targetValue: undefined, unit: undefined, targetQualitative: undefined })).rejects.toBeInstanceOf(
      ObjectiveError,
    );
    await expect(createDraft(contextA, { targetValue: 5, targetQualitative: "also qualitative" })).rejects.toBeInstanceOf(ObjectiveError);
    await expect(createDraft(contextA, { targetValue: 5, unit: undefined })).rejects.toBeInstanceOf(ObjectiveError);
  });

  it("denies an owner membership from a foreign organisation", async () => {
    await expect(createDraft(contextA, { ownerMembershipId: "membership-b" })).rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("creates an objective and its first DRAFT version, version 1", async () => {
    const { objective, version } = await createDraft();
    expect(objective.organisationId).toBe(ORG_A);
    expect(version.status).toBe("DRAFT");
    expect(version.version).toBe(1);
    expect(version.objectiveId).toBe(objective.id);
  });

  it("validates a source link points at a same-organisation record of the matching type", async () => {
    await expect(
      createDraft(contextA, {
        sourceLinks: [{ linkType: "ASPECT_ASSESSMENT", aspectAssessmentId: "aspect-assessment-a" }],
      }),
    ).resolves.toBeDefined();

    await expect(
      createDraft(contextB, {
        ownerMembershipId: "membership-b",
        sourceLinks: [{ linkType: "ASPECT_ASSESSMENT", aspectAssessmentId: "aspect-assessment-a" }],
      }),
    ).rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("rejects a source link with zero or multiple identifying fields set", async () => {
    await expect(createDraft(contextA, { sourceLinks: [{ linkType: "POLICY" }] })).rejects.toBeInstanceOf(ObjectiveError);
    await expect(
      createDraft(contextA, {
        sourceLinks: [{ linkType: "POLICY", policyRecordId: "p1", aspectAssessmentId: "aspect-assessment-a" }],
      }),
    ).rejects.toBeInstanceOf(ObjectiveError);
  });
});

describe("draft editing and submission", () => {
  it("only edits a DRAFT version", async () => {
    const { version } = await createDraft();
    await expect(updateEnvironmentalObjectiveVersionDraft(contextA, version.id, baseDraft({ title: "Updated" }))).resolves.toMatchObject({
      title: "Updated",
    });
    await submitEnvironmentalObjectiveVersionForReview(contextA, version.id, "user-drafter");
    await expect(updateEnvironmentalObjectiveVersionDraft(contextA, version.id, baseDraft())).rejects.toBeInstanceOf(ObjectiveError);
  });

  it("denies a foreign-tenant version id", async () => {
    const { version } = await createDraft();
    await expect(submitEnvironmentalObjectiveVersionForReview(contextB, version.id, "user-b")).rejects.toBeInstanceOf(TenantOwnershipError);
  });
});

describe("approveEnvironmentalObjectiveVersion", () => {
  async function toReview() {
    const { objective, version } = await createDraft();
    await submitEnvironmentalObjectiveVersionForReview(contextA, version.id, "user-drafter");
    return { objective, version };
  }

  it("requires ems.objective.approve", async () => {
    const { version } = await toReview();
    await expect(approveEnvironmentalObjectiveVersion(editOnlyContextA, version.id, { actorUserId: "user-drafter" })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("denies self-approval when four-eyes is enabled (default)", async () => {
    const { version } = await toReview();
    await expect(
      approveEnvironmentalObjectiveVersion(authorAsApproverContextA, version.id, { actorUserId: "user-drafter" }),
    ).rejects.toThrow(/four.?eyes|self/i);
  });

  it("allows self-approval when four-eyes is explicitly disabled", async () => {
    const { version } = await toReview();
    await expect(
      approveEnvironmentalObjectiveVersion(authorAsApproverContextA, version.id, { actorUserId: "user-drafter", fourEyesEnabled: false }),
    ).resolves.toMatchObject({ status: "ACTIVE" });
  });

  it("only approves an IN_REVIEW version", async () => {
    const { version } = await createDraft();
    await expect(approveEnvironmentalObjectiveVersion(approverContextA, version.id, { actorUserId: "user-approver" })).rejects.toBeInstanceOf(
      ObjectiveError,
    );
  });

  it("moves the version to ACTIVE and the objective's active pointer to this version", async () => {
    const { objective, version } = await toReview();
    const approved = await approveEnvironmentalObjectiveVersion(approverContextA, version.id, { actorUserId: "user-approver" });
    expect(approved.status).toBe("ACTIVE");
    expect(approved.approvedByUserId).toBe("user-approver");
    const updatedObjective = tables.objectives.find((o) => o.id === objective.id);
    expect(updatedObjective?.activeVersionId).toBe(version.id);
  });

  it("supersedes the previously ACTIVE version when a successor is approved", async () => {
    const { objective, version: v1 } = await toReview();
    await approveEnvironmentalObjectiveVersion(approverContextA, v1.id, { actorUserId: "user-approver" });

    const v2 = await createSuccessorEnvironmentalObjectiveVersion(contextA, objective.id, baseDraft({ revisionRationale: "Synthetic revision." }));
    await submitEnvironmentalObjectiveVersionForReview(contextA, v2.id, "user-drafter");
    await approveEnvironmentalObjectiveVersion(approverContextA, v2.id, { actorUserId: "user-approver" });

    const supersededV1 = tables.versions.find((v) => v.id === v1.id);
    expect(supersededV1?.status).toBe("SUPERSEDED");
    const updatedObjective = tables.objectives.find((o) => o.id === objective.id);
    expect(updatedObjective?.activeVersionId).toBe(v2.id);
  });

  it("records an append-only approval decision", async () => {
    const { version } = await toReview();
    await approveEnvironmentalObjectiveVersion(approverContextA, version.id, { actorUserId: "user-approver", comment: "Looks good" });
    expect(tables.approvals).toHaveLength(1);
    expect(tables.approvals[0]).toMatchObject({ decision: "APPROVED", objectiveVersionId: version.id, approverMembershipId: "membership-approver" });
  });
});

describe("reject and return", () => {
  async function toReview() {
    const { version } = await createDraft();
    await submitEnvironmentalObjectiveVersionForReview(contextA, version.id, "user-drafter");
    return version;
  }

  it("rejects an in-review version to CANCELLED", async () => {
    const version = await toReview();
    const rejected = await rejectEnvironmentalObjectiveVersion(approverContextA, version.id, { actorUserId: "user-approver" });
    expect(rejected.status).toBe("CANCELLED");
  });

  it("returns an in-review version to DRAFT for revision", async () => {
    const version = await toReview();
    const returned = await returnEnvironmentalObjectiveVersionForRevision(approverContextA, version.id, { actorUserId: "user-approver" });
    expect(returned.status).toBe("DRAFT");
  });
});

describe("objective achievement — decided only by explicit review, never by action completion", () => {
  async function toActive() {
    const { objective, version } = await createDraft();
    await submitEnvironmentalObjectiveVersionForReview(contextA, version.id, "user-drafter");
    const active = await approveEnvironmentalObjectiveVersion(approverContextA, version.id, { actorUserId: "user-approver" });
    return { objective, version: active };
  }

  it("requires ems.objective.approve", async () => {
    const { version } = await toActive();
    await expect(
      decideObjectiveAchievement(editOnlyContextA, version.id as string, { actorUserId: "user-drafter", achieved: true, rationale: "r" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("only decides achievement on an ACTIVE version", async () => {
    const { version } = await createDraft();
    await expect(
      decideObjectiveAchievement(approverContextA, version.id, { actorUserId: "user-approver", achieved: true, rationale: "r" }),
    ).rejects.toBeInstanceOf(ObjectiveError);
  });

  it("requires a rationale", async () => {
    const { version } = await toActive();
    await expect(
      decideObjectiveAchievement(approverContextA, version.id as string, { actorUserId: "user-approver", achieved: true, rationale: "" }),
    ).rejects.toBeInstanceOf(ObjectiveError);
  });

  it("marks ACHIEVED/NOT_ACHIEVED via explicit decision and clears the active pointer", async () => {
    const { objective, version } = await toActive();
    const decided = await decideObjectiveAchievement(approverContextA, version.id as string, {
      actorUserId: "user-approver",
      achieved: true,
      rationale: "Synthetic evidence review complete.",
    });
    expect(decided.status).toBe("ACHIEVED");
    expect(decided.achievementDecidedByUserId).toBe("user-approver");
    const updatedObjective = tables.objectives.find((o) => o.id === objective.id);
    expect(updatedObjective?.activeVersionId).toBeNull();
  });
});

describe("cancelEnvironmentalObjectiveVersion", () => {
  it("only cancels an ACTIVE version and requires a rationale", async () => {
    const { version } = await createDraft();
    await submitEnvironmentalObjectiveVersionForReview(contextA, version.id, "user-drafter");
    const active = await approveEnvironmentalObjectiveVersion(approverContextA, version.id, { actorUserId: "user-approver" });
    await expect(
      cancelEnvironmentalObjectiveVersion(approverContextA, active.id as string, { actorUserId: "user-approver", rationale: "" }),
    ).rejects.toBeInstanceOf(ObjectiveError);
    const cancelled = await cancelEnvironmentalObjectiveVersion(approverContextA, active.id as string, {
      actorUserId: "user-approver",
      rationale: "No longer relevant (synthetic).",
    });
    expect(cancelled.status).toBe("CANCELLED");
  });
});

describe("createSuccessorEnvironmentalObjectiveVersion", () => {
  it("refuses a successor while the latest version is still DRAFT/IN_REVIEW", async () => {
    const { objective } = await createDraft();
    await expect(
      createSuccessorEnvironmentalObjectiveVersion(contextA, objective.id, baseDraft({ revisionRationale: "r" })),
    ).rejects.toBeInstanceOf(ObjectiveError);
  });

  it("requires a revision rationale", async () => {
    const { objective, version } = await createDraft();
    await submitEnvironmentalObjectiveVersionForReview(contextA, version.id, "user-drafter");
    await approveEnvironmentalObjectiveVersion(approverContextA, version.id, { actorUserId: "user-approver" });
    await expect(
      createSuccessorEnvironmentalObjectiveVersion(contextA, objective.id, baseDraft({ revisionRationale: "" })),
    ).rejects.toBeInstanceOf(ObjectiveError);
  });

  it("increments version and links supersedesVersionId, leaving the predecessor row untouched", async () => {
    const { objective, version: v1 } = await createDraft();
    await submitEnvironmentalObjectiveVersionForReview(contextA, v1.id, "user-drafter");
    await approveEnvironmentalObjectiveVersion(approverContextA, v1.id, { actorUserId: "user-approver" });

    const v2 = await createSuccessorEnvironmentalObjectiveVersion(contextA, objective.id, baseDraft({ revisionRationale: "Synthetic revision." }));
    expect(v2.version).toBe(2);
    expect(v2.supersedesVersionId).toBe(v1.id);
    const predecessor = tables.versions.find((v) => v.id === v1.id);
    expect(predecessor?.title).toBe(v1.title);
  });

  it("denies a foreign-tenant objective id", async () => {
    await expect(
      createSuccessorEnvironmentalObjectiveVersion(contextB, "objective-does-not-exist", baseDraft({ revisionRationale: "r" })),
    ).rejects.toBeInstanceOf(TenantOwnershipError);
  });
});

describe("tenant isolation", () => {
  it("Organisation B cannot read or act on an Organisation A objective version", async () => {
    const { version } = await createDraft(contextA);
    await expect(submitEnvironmentalObjectiveVersionForReview(contextB, version.id, "user-b")).rejects.toBeInstanceOf(TenantOwnershipError);
    await expect(approveEnvironmentalObjectiveVersion(contextB, version.id, { actorUserId: "user-b" })).rejects.toBeInstanceOf(
      TenantOwnershipError,
    );
  });
});

/**
 * Deterministic management-review pack generation, freeze-on-issue and AI
 * narrative tests (task T73). No live database — Prisma is replaced with an
 * in-memory fake and the audit-event side effect is stubbed, mirroring
 * review-service.test.ts (T72). Covers: repeated-generation determinism,
 * issue freezing inputs into snapshots, one-way issue, AI narrative
 * labelling/review gate, and tenant isolation. All fixtures are fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row; orderBy?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row; organisationId_reviewId?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  reviews: [] as Row[],
  attendees: [] as Row[],
  inputLinks: [] as Row[],
  packs: [] as Row[],
  inputSnapshots: [] as Row[],
  aiNarratives: [] as Row[],
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
      const key = (where as Row & { organisationId_id?: Row; organisationId_reviewId?: Row })?.organisationId_id
        ?? (where as Row & { organisationId_reviewId?: Row })?.organisationId_reviewId
        ?? where
        ?? {};
      return find(rows, key as Row);
    }),
    findMany: vi.fn(async ({ where, orderBy }: FindArgs) => {
      let candidates = rows.filter((r) => matches(r, (where ?? {}) as Row));
      if (orderBy) {
        const [key, direction] = Object.entries(orderBy)[0] as [string, "asc" | "desc"];
        candidates = [...candidates].sort((a, b) => {
          const av = String(a[key]);
          const bv = String(b[key]);
          return direction === "desc" ? (av < bv ? 1 : -1) : av < bv ? -1 : 1;
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
      const key = where.organisationId_id ?? where.organisationId_reviewId ?? where;
      const row = find(rows, key as Row);
      if (!row) throw new Error(`${prefix} not found`);
      Object.assign(row, data);
      return row;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      const row = find(rows, key as Row);
      if (!row) throw new Error(`${prefix} not found`);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const matching = rows.filter((row) => matches(row, where));
      for (const row of matching) Object.assign(row, data);
      return { count: matching.length };
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
  };
}

vi.mock("@/lib/prisma", () => {
  const managementReview = simpleModel(tables.reviews, "review", { status: "PLANNED" });
  const managementReviewAttendee = simpleModel(tables.attendees, "attendee");
  const managementReviewInputLink = simpleModel(tables.inputLinks, "input-link");
  const managementReviewPack = simpleModel(tables.packs, "pack", { status: "DRAFT" });
  const managementReviewInputSnapshot = simpleModel(tables.inputSnapshots, "snapshot");
  const managementReviewAiNarrative = simpleModel(tables.aiNarratives, "narrative", { status: "PENDING_REVIEW" });

  const prismaClient = {
    $queryRaw: vi.fn(async () => []),
    managementReview,
    managementReviewAttendee,
    managementReviewInputLink,
    managementReviewPack,
    managementReviewInputSnapshot,
    managementReviewAiNarrative,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-event-synthetic" })) }));

const {
  ManagementReviewPackError,
  TenantOwnershipError,
  generateManagementReviewPack,
  issueManagementReviewPack,
  getManagementReviewPack,
  addManagementReviewAiNarrative,
  reviewManagementReviewAiNarrative,
} = await import("@/lib/ems/review/pack-service");

const orgContextA = makeOrganisationContext(ORG_A, {
  permissions: new Set(["ems.view", "ems.management_review.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});
const orgContextB = makeOrganisationContext(ORG_B, {
  permissions: new Set(["ems.view", "ems.management_review.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});
const orgContextANoManage = makeOrganisationContext(ORG_A, {
  permissions: new Set(["ems.view"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});

function resetTables() {
  tables.reviews.length = 0;
  tables.attendees.length = 0;
  tables.inputLinks.length = 0;
  tables.packs.length = 0;
  tables.inputSnapshots.length = 0;
  tables.aiNarratives.length = 0;
  tables.nextId = 1;
}

function seedReview(overrides: Row = {}) {
  const review: Row = {
    id: "review-A1",
    organisationId: ORG_A,
    reference: "MR-2026-01",
    periodStart: new Date("2026-01-01"),
    periodEnd: new Date("2026-06-30"),
    cutoffDate: new Date("2026-06-15"),
    scheduledDate: new Date("2026-07-01"),
    agendaTemplateVersionId: "template-version-A1",
    status: "INPUT_COLLECTION",
    ...overrides,
  };
  tables.reviews.push(review);
  return review;
}

beforeEach(() => {
  resetTables();
  seedReview();
  tables.attendees.push(
    { id: "attendee-A1", organisationId: ORG_A, reviewId: "review-A1", personId: "person-A2", role: "MEMBER", invited: true },
    { id: "attendee-A2", organisationId: ORG_A, reviewId: "review-A1", personId: "person-A1", role: "CHAIR", invited: true },
  );
  tables.inputLinks.push(
    {
      id: "link-A1",
      organisationId: ORG_A,
      reviewId: "review-A1",
      inputDefinitionKey: "compliance_status",
      sourceType: "COMPLIANCE_EVALUATION",
      sourceRecordId: "evaluation-1",
      sourceVersionLabel: "2026-06-01T00:00:00.000Z",
      summary: { periodStart: "2026-01-01" },
      isStale: false,
    },
    {
      id: "link-A2",
      organisationId: ORG_A,
      reviewId: "review-A1",
      inputDefinitionKey: "audit_results",
      sourceType: "AUDIT_REPORT",
      sourceRecordId: "report-1",
      sourceVersionLabel: "1",
      summary: { findings: 2 },
      isStale: false,
    },
  );
});

describe("generateManagementReviewPack", () => {
  it("is deterministic: repeated generation from the same inputs produces the same checksum", async () => {
    const first = await generateManagementReviewPack(orgContextA, "review-A1", "user-1");
    const second = await generateManagementReviewPack(orgContextA, "review-A1", "user-1");
    expect(first.checksumSha256).toBe(second.checksumSha256);
    expect(first.checksumSha256).toBeTruthy();
    expect(first.status).toBe("DRAFT");
  });

  it("produces the same checksum regardless of input-link insertion order", async () => {
    const first = await generateManagementReviewPack(orgContextA, "review-A1", "user-1");
    // Reorder the underlying rows — checksum must not depend on table order.
    tables.inputLinks.reverse();
    const second = await generateManagementReviewPack(orgContextA, "review-A1", "user-1");
    expect(first.checksumSha256).toBe(second.checksumSha256);
  });

  it("rejects generation outside input collection", async () => {
    tables.reviews[0].status = "PLANNED";
    await expect(generateManagementReviewPack(orgContextA, "review-A1", "user-1")).rejects.toThrow(ManagementReviewPackError);
  });

  it("denies a caller without manage permission", async () => {
    await expect(generateManagementReviewPack(orgContextANoManage, "review-A1", "user-1")).rejects.toThrow(PermissionDeniedError);
  });

  it("denies cross-tenant access", async () => {
    await expect(generateManagementReviewPack(orgContextB, "review-A1", "user-1")).rejects.toThrow(TenantOwnershipError);
  });
});

describe("issueManagementReviewPack", () => {
  it("freezes current input links into snapshots and moves the review to PACK_ISSUED", async () => {
    await generateManagementReviewPack(orgContextA, "review-A1", "user-1");
    const issued = await issueManagementReviewPack(orgContextA, "review-A1", "user-1");

    expect(issued.status).toBe("ISSUED");
    expect(issued.issuedByUserId).toBe("user-1");
    expect(tables.reviews[0].status).toBe("PACK_ISSUED");

    const snapshots = tables.inputSnapshots.filter((s) => s.packId === issued.id);
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((s) => s.sourceRecordId).sort()).toEqual(["evaluation-1", "report-1"]);
  });

  it("issuing reproduces the same checksum generate last computed", async () => {
    const generated = await generateManagementReviewPack(orgContextA, "review-A1", "user-1");
    const issued = await issueManagementReviewPack(orgContextA, "review-A1", "user-1");
    expect(issued.checksumSha256).toBe(generated.checksumSha256);
  });

  it("rejects issuing without a generated pack", async () => {
    await expect(issueManagementReviewPack(orgContextA, "review-A1", "user-1")).rejects.toThrow(ManagementReviewPackError);
  });

  it("rejects issuing twice — the pack is frozen after issue", async () => {
    await generateManagementReviewPack(orgContextA, "review-A1", "user-1");
    await issueManagementReviewPack(orgContextA, "review-A1", "user-1");
    await expect(issueManagementReviewPack(orgContextA, "review-A1", "user-1")).rejects.toThrow(ManagementReviewPackError);
  });

  it("rejects regenerating an already-issued pack", async () => {
    await generateManagementReviewPack(orgContextA, "review-A1", "user-1");
    await issueManagementReviewPack(orgContextA, "review-A1", "user-1");
    await expect(generateManagementReviewPack(orgContextA, "review-A1", "user-1")).rejects.toThrow(ManagementReviewPackError);
  });

  it("re-proves DRAFT status inside the transaction (CAS), not just before it — a racer that flips status first wins, the other gets a conflict", async () => {
    await generateManagementReviewPack(orgContextA, "review-A1", "user-1");
    // Simulate a concurrent issuer having already committed between this
    // call's pre-transaction read and its transactional write.
    tables.packs[0].status = "ISSUED";
    await expect(issueManagementReviewPack(orgContextA, "review-A1", "user-1")).rejects.toThrow(ManagementReviewPackError);
    // No duplicate input snapshots were created by the losing racer.
    expect(tables.inputSnapshots).toHaveLength(0);
  });

  it("a later input-link change never rewrites an already-issued pack's frozen snapshot", async () => {
    await generateManagementReviewPack(orgContextA, "review-A1", "user-1");
    const issued = await issueManagementReviewPack(orgContextA, "review-A1", "user-1");
    const snapshotBefore = tables.inputSnapshots.find((s) => s.packId === issued.id && s.sourceRecordId === "evaluation-1");

    // Mutate the live input link after issue.
    const link = tables.inputLinks.find((l) => l.id === "link-A1")!;
    link.summary = { periodStart: "2099-01-01" };

    expect(snapshotBefore?.summary).toEqual({ periodStart: "2026-01-01" });
  });
});

describe("getManagementReviewPack", () => {
  it("denies cross-tenant access", async () => {
    await expect(getManagementReviewPack(orgContextB, "review-A1")).rejects.toThrow(TenantOwnershipError);
  });
});

describe("AI narrative — optional, labelled, reviewed", () => {
  async function issuePack() {
    await generateManagementReviewPack(orgContextA, "review-A1", "user-1");
    return issueManagementReviewPack(orgContextA, "review-A1", "user-1");
  }

  it("cannot be attached before the pack is issued", async () => {
    await generateManagementReviewPack(orgContextA, "review-A1", "user-1");
    const draftPack = tables.packs[0];
    await expect(
      addManagementReviewAiNarrative(orgContextA, draftPack.id as string, { content: "Draft narrative.", actorUserId: "user-1" }),
    ).rejects.toThrow(ManagementReviewPackError);
  });

  it("starts PENDING_REVIEW and requires an explicit human review before use", async () => {
    const pack = await issuePack();
    const narrative = await addManagementReviewAiNarrative(orgContextA, pack.id as string, {
      content: "Synthetic AI-drafted summary of the frozen pack.",
      actorUserId: "user-1",
    });
    expect(narrative.status).toBe("PENDING_REVIEW");
    expect(narrative.generatedByUserId).toBe("user-1");

    const reviewed = await reviewManagementReviewAiNarrative(orgContextA, narrative.id as string, {
      decision: "REVIEWED",
      actorUserId: "user-2",
    });
    expect(reviewed.status).toBe("REVIEWED");
    expect(reviewed.reviewedByUserId).toBe("user-2");
  });

  it("can be rejected with a reason instead of approved", async () => {
    const pack = await issuePack();
    const narrative = await addManagementReviewAiNarrative(orgContextA, pack.id as string, {
      content: "Synthetic AI-drafted summary.",
      actorUserId: "user-1",
    });
    const rejected = await reviewManagementReviewAiNarrative(orgContextA, narrative.id as string, {
      decision: "REJECTED",
      rejectionReason: "Inaccurate framing of the audit findings.",
      actorUserId: "user-2",
    });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionReason).toBe("Inaccurate framing of the audit findings.");
  });

  it("cannot be reviewed twice", async () => {
    const pack = await issuePack();
    const narrative = await addManagementReviewAiNarrative(orgContextA, pack.id as string, {
      content: "Synthetic AI-drafted summary.",
      actorUserId: "user-1",
    });
    await reviewManagementReviewAiNarrative(orgContextA, narrative.id as string, { decision: "REVIEWED", actorUserId: "user-2" });
    await expect(
      reviewManagementReviewAiNarrative(orgContextA, narrative.id as string, { decision: "REVIEWED", actorUserId: "user-2" }),
    ).rejects.toThrow(ManagementReviewPackError);
  });

  it("denies cross-tenant access to a narrative", async () => {
    const pack = await issuePack();
    const narrative = await addManagementReviewAiNarrative(orgContextA, pack.id as string, {
      content: "Synthetic AI-drafted summary.",
      actorUserId: "user-1",
    });
    await expect(
      reviewManagementReviewAiNarrative(orgContextB, narrative.id as string, { decision: "REVIEWED", actorUserId: "user-2" }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

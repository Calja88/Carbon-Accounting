/**
 * Root-cause analysis tests (task T64). No live database — Prisma is
 * replaced with an in-memory fake. Covers: recording, approval-moves-NC,
 * status guards, and tenant isolation. All fixtures are fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  memberships: [] as Row[],
  nonconformities: [] as Row[],
  rootCauseAnalyses: [] as Row[],
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
  };
}

vi.mock("@/lib/prisma", () => {
  const organisationMembership = simpleModel(tables.memberships, "membership");
  const nonconformity = simpleModel(tables.nonconformities, "nc", { status: "OPEN" });
  const rootCauseAnalysis = simpleModel(tables.rootCauseAnalyses, "rca", { approvedAt: null });

  const prismaClient = {
    organisationMembership,
    nonconformity,
    rootCauseAnalysis,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-event-synthetic" })) }));

const { RootCauseError, recordRootCauseAnalysis, approveRootCauseAnalysis, listRootCauseAnalyses } = await import(
  "@/lib/ems/nonconformity/root-cause-service"
);
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const MANAGE_PERMS = new Set(["ems.view", "ems.nonconformity.manage"]) as never;
const VIEW_ONLY = new Set(["ems.view"]) as never;

const managerContextA = makeOrganisationContext(ORG_A, { userId: "user-manager", membershipId: "membership-manager", permissions: MANAGE_PERMS });
const viewerContextA = makeOrganisationContext(ORG_A, { userId: "user-viewer", membershipId: "membership-viewer", permissions: VIEW_ONLY });
const managerContextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: MANAGE_PERMS });

beforeEach(() => {
  for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
    if (key === "nextId") continue;
    (tables[key] as Row[]).length = 0;
  }
  tables.nextId = 1;
  tables.memberships.push({ id: "membership-manager", organisationId: ORG_A, status: "ACTIVE" });
  tables.nonconformities.push({ id: "nc-open", organisationId: ORG_A, reference: "NC-1", status: "OPEN" });
  tables.nonconformities.push({ id: "nc-contained", organisationId: ORG_A, reference: "NC-2", status: "CONTAINED" });
  tables.nonconformities.push({ id: "nc-b", organisationId: ORG_B, reference: "NC-B1", status: "CONTAINED" });
});

function analysisInput(overrides: Partial<Parameters<typeof recordRootCauseAnalysis>[2]> = {}) {
  return {
    method: "FIVE_WHYS" as const,
    analysisPayload: { whys: ["fictional cause 1", "fictional cause 2"] },
    conclusion: "A fictional process gap caused the nonconformity.",
    actorUserId: managerContextA.userId,
    ...overrides,
  };
}

describe("recordRootCauseAnalysis", () => {
  it("records an analysis against a CONTAINED nonconformity", async () => {
    const analysis = await recordRootCauseAnalysis(managerContextA, "nc-contained", analysisInput());
    expect(analysis.nonconformityId).toBe("nc-contained");
    expect(analysis.approvedAt).toBeNull();
  });

  it("refuses while the nonconformity is OPEN (not yet contained)", async () => {
    await expect(recordRootCauseAnalysis(managerContextA, "nc-open", analysisInput())).rejects.toThrow(RootCauseError);
  });

  it("refuses without a conclusion", async () => {
    await expect(recordRootCauseAnalysis(managerContextA, "nc-contained", analysisInput({ conclusion: "  " }))).rejects.toThrow(RootCauseError);
  });

  it("denies a caller without ems.nonconformity.manage", async () => {
    await expect(recordRootCauseAnalysis(viewerContextA, "nc-contained", analysisInput())).rejects.toThrow(PermissionDeniedError);
  });

  it("refuses a foreign-tenant nonconformity id", async () => {
    await expect(recordRootCauseAnalysis(managerContextB, "nc-contained", analysisInput({ actorUserId: managerContextB.userId }))).rejects.toThrow(
      TenantOwnershipError,
    );
  });
});

describe("approveRootCauseAnalysis", () => {
  it("approves an analysis and moves the nonconformity to ROOT_CAUSE_APPROVED", async () => {
    const analysis = await recordRootCauseAnalysis(managerContextA, "nc-contained", analysisInput());
    const approved = await approveRootCauseAnalysis(managerContextA, analysis.id, { actorUserId: managerContextA.userId });
    expect(approved.approvedAt).toBeTruthy();
    expect(approved.approvedByMembershipId).toBe("membership-manager");
    const nc = tables.nonconformities.find((row) => row.id === "nc-contained");
    expect(nc?.status).toBe("ROOT_CAUSE_APPROVED");
  });

  it("refuses to approve the same analysis twice", async () => {
    const analysis = await recordRootCauseAnalysis(managerContextA, "nc-contained", analysisInput());
    await approveRootCauseAnalysis(managerContextA, analysis.id, { actorUserId: managerContextA.userId });
    await expect(approveRootCauseAnalysis(managerContextA, analysis.id, { actorUserId: managerContextA.userId })).rejects.toThrow(RootCauseError);
  });

  it("refuses a foreign-tenant root-cause analysis id", async () => {
    await expect(approveRootCauseAnalysis(managerContextB, "rca-does-not-exist", { actorUserId: managerContextB.userId })).rejects.toThrow(
      TenantOwnershipError,
    );
  });
});

describe("listRootCauseAnalyses — tenant isolation", () => {
  it("is tenant-isolated", async () => {
    await recordRootCauseAnalysis(managerContextA, "nc-contained", analysisInput());
    await expect(listRootCauseAnalyses(managerContextB, "nc-contained")).rejects.toThrow(TenantOwnershipError);
    const listA = await listRootCauseAnalyses(managerContextA, "nc-contained");
    expect(listA).toHaveLength(1);
  });
});

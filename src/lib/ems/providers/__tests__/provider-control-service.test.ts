import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

// Test-only in-memory Prisma rows intentionally accept heterogeneous model fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const tables = vi.hoisted(() => ({
  aspects: [] as Row[],
  memberships: [] as Row[],
  providerControls: [] as Row[],
  evaluations: [] as Row[],
  notifications: [] as Row[],
  nextId: 1,
}));

function scalarMatches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (["aspectLinks", "applicabilities", "OR", "in"].includes(key)) return true;
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    if (value && typeof value === "object" && "lt" in value) return row[key] < value.lt;
    return row[key] === value;
  });
}

vi.mock("@/lib/prisma", () => {
  const environmentalAspect = {
    findMany: vi.fn(async ({ where }: { where: Row }) => tables.aspects.filter((row) => scalarMatches(row, where))),
  };
  const externalProviderControl = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.providerControls.find((row) => scalarMatches(row, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Row }) => tables.providerControls.filter((row) => scalarMatches(row, where))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `provider-${tables.nextId++}`, status: "ACTIVE", ...data, aspectLinks: data.aspectLinks.create.map((link: Row) => ({ ...link })) };
      tables.providerControls.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const key = where.organisationId_id ?? where;
      const row = tables.providerControls.find((item) => scalarMatches(item, key));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };
  const organisationMembership = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.memberships.find((row) => scalarMatches(row, where)) ?? null),
  };
  const externalProviderEvaluation = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.evaluations.find((row) => scalarMatches(row, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `evaluation-${tables.nextId++}`, ...data };
      tables.evaluations.push(row);
      return row;
    }),
  };
  const notification = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.notifications.find((row) => scalarMatches(row, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `notification-${tables.nextId++}`, ...data };
      tables.notifications.push(row);
      return row;
    }),
    updateMany: vi.fn(async () => ({ count: 0 })),
  };
  const client: Row = { environmentalAspect, externalProviderControl, organisationMembership, externalProviderEvaluation, notification };
  client.$transaction = vi.fn(async (callback: (tx: Row) => Promise<unknown>) => callback(client));
  return { prisma: client };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "synthetic-audit" })) }));
vi.mock("@/lib/documents/evidence-service", () => ({
  linkEvidence: vi.fn(),
  uploadEvidenceObject: vi.fn(),
}));

const {
  ExternalProviderControlError,
  createExternalProviderControl,
  notifyOverdueProviderReviews,
  recordExternalProviderEvaluation,
} = await import("@/lib/ems/providers/provider-control-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");

const context = makeOrganisationContext(ORG_A, {
  userId: "synthetic-user-a",
  membershipId: "membership-a",
  permissions: new Set(["ems.view", "ems.control.manage"]) as never,
});
const baseInput = {
  providerReference: "synthetic-provider",
  providerName: "Synthetic Logistics Ltd",
  providedDescription: "Synthetic waste haulage",
  communicatedRequirements: "Segregate synthetic waste streams",
  evaluationFrequency: "Annually",
  ownerMembershipId: "membership-a",
  nextReviewDueDate: new Date("2026-09-01T00:00:00.000Z"),
  aspectIds: ["aspect-a"],
  actorUserId: "synthetic-user-a",
};

beforeEach(() => {
  Object.values(tables).forEach((value) => { if (Array.isArray(value)) value.length = 0; });
  tables.nextId = 1;
  vi.clearAllMocks();
  tables.memberships.push({ id: "membership-a", organisationId: ORG_A, status: "ACTIVE" });
  tables.aspects.push({ id: "aspect-a", organisationId: ORG_A, name: "Synthetic aspect" });
});

describe("T35 external-provider control workflow", () => {
  it("creates a provider control linked to at least one aspect", async () => {
    const control = await createExternalProviderControl(context, baseInput);
    expect(control).toMatchObject({ providerReference: "synthetic-provider", status: "ACTIVE" });
    expect(control.aspectLinks).toEqual([{ organisationId: ORG_A, aspectId: "aspect-a" }]);
  });

  it("rejects a duplicate provider reference", async () => {
    await createExternalProviderControl(context, baseInput);
    await expect(createExternalProviderControl(context, baseInput)).rejects.toThrow(ExternalProviderControlError);
  });

  it("denies a foreign-organisation aspect before writing a provider control", async () => {
    tables.aspects[0].organisationId = ORG_B;
    await expect(createExternalProviderControl(context, baseInput)).rejects.toThrow(TenantOwnershipError);
    expect(tables.providerControls).toHaveLength(0);
  });

  it("records an evaluation as a new row and moves the review clock forward without altering prior evaluations", async () => {
    const control = await createExternalProviderControl(context, baseInput);
    const first = await recordExternalProviderEvaluation(context, {
      providerControlId: control.id,
      evaluatedAt: new Date("2026-08-01T00:00:00.000Z"),
      result: "PASS",
      nextReviewDueDate: new Date("2027-08-01T00:00:00.000Z"),
      actorUserId: "synthetic-user-a",
    });
    const second = await recordExternalProviderEvaluation(context, {
      providerControlId: control.id,
      evaluatedAt: new Date("2026-09-01T00:00:00.000Z"),
      result: "FAIL",
      nextReviewDueDate: new Date("2026-10-01T00:00:00.000Z"),
      actorUserId: "synthetic-user-a",
    });
    expect(tables.evaluations).toHaveLength(2);
    expect(first.id).not.toEqual(second.id);
    expect(first.result).toBe("PASS");
    const updatedControl = tables.providerControls.find((row) => row.id === control.id);
    expect(updatedControl?.nextReviewDueDate).toEqual(new Date("2026-10-01T00:00:00.000Z"));
  });

  it("delivers one deduplicated notification for an overdue active provider review", async () => {
    await createExternalProviderControl(context, { ...baseInput, nextReviewDueDate: new Date("2026-07-01T00:00:00.000Z") });
    const first = await notifyOverdueProviderReviews(context, new Date("2026-08-13T00:00:00.000Z"));
    const second = await notifyOverdueProviderReviews(context, new Date("2026-08-13T00:00:00.000Z"));
    expect(first).toEqual([{ providerControlId: expect.any(String), id: expect.any(String), status: "DELIVERED" }]);
    expect(second[0]).toMatchObject({ status: "DELIVERED", id: first[0].id });
    expect(tables.notifications).toHaveLength(1);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

// Test-only in-memory Prisma rows intentionally accept heterogeneous model fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const tables = vi.hoisted(() => ({
  memberships: [] as Row[],
  plans: [] as Row[],
  records: [] as Row[],
  revisions: [] as Row[],
  nextId: 1,
}));

function scalarMatches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (["records"].includes(key)) return true;
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
}

vi.mock("@/lib/prisma", () => {
  const organisationMembership = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.memberships.find((row) => scalarMatches(row, where)) ?? null),
  };
  const communicationPlan = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.plans.find((row) => scalarMatches(row, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Row }) => tables.plans.filter((row) => scalarMatches(row, where))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `plan-${tables.nextId++}`, status: "ACTIVE", ...data };
      tables.plans.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const key = where.organisationId_id ?? where;
      const row = tables.plans.find((item) => scalarMatches(item, key));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };
  const communicationRecord = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.records.find((row) => scalarMatches(row, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `record-${tables.nextId++}`, ...data };
      tables.records.push(row);
      return row;
    }),
  };
  const controlledDocumentRevision = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.revisions.find((row) => scalarMatches(row, where)) ?? null),
  };
  const client: Row = { organisationMembership, communicationPlan, communicationRecord, controlledDocumentRevision };
  client.$transaction = vi.fn(async (callback: (tx: Row) => Promise<unknown>) => callback(client));
  return { prisma: client };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "synthetic-audit" })) }));
vi.mock("@/lib/documents/evidence-service", () => ({
  linkEvidence: vi.fn(),
  uploadEvidenceObject: vi.fn(),
}));

const { CommunicationError, createCommunicationPlan, recordCommunication } = await import(
  "@/lib/ems/communications/communication-service"
);
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");

const context = makeOrganisationContext(ORG_A, {
  userId: "synthetic-user-a",
  membershipId: "membership-a",
  permissions: new Set(["ems.view", "ems.communication.manage"]) as never,
});

beforeEach(() => {
  Object.values(tables).forEach((value) => { if (Array.isArray(value)) value.length = 0; });
  tables.nextId = 1;
  vi.clearAllMocks();
  tables.memberships.push({ id: "membership-a", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "approver-a", organisationId: ORG_A, status: "ACTIVE" });
});

describe("T35 communications workflow", () => {
  it("creates a plan and denies a foreign-organisation owner", async () => {
    const plan = await createCommunicationPlan(context, {
      subject: "Synthetic annual update",
      audience: "INTERNAL",
      triggerFrequency: "Annually",
      method: "Email",
      approvalRequired: false,
      ownerMembershipId: "membership-a",
      actorUserId: "synthetic-user-a",
    });
    expect(plan).toMatchObject({ subject: "Synthetic annual update", status: "ACTIVE" });

    tables.memberships[0].organisationId = ORG_B;
    await expect(createCommunicationPlan(context, {
      subject: "Denied",
      audience: "INTERNAL",
      triggerFrequency: "Annually",
      method: "Email",
      approvalRequired: false,
      ownerMembershipId: "membership-a",
      actorUserId: "synthetic-user-a",
    })).rejects.toThrow(TenantOwnershipError);
  });

  it("rejects an external communication from an approval-required plan with no approver", async () => {
    const plan = await createCommunicationPlan(context, {
      subject: "Synthetic regulator update",
      audience: "EXTERNAL",
      triggerFrequency: "As needed",
      method: "Letter",
      approvalRequired: true,
      ownerMembershipId: "membership-a",
      actorUserId: "synthetic-user-a",
    });
    await expect(recordCommunication(context, {
      planId: plan.id,
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      audience: "EXTERNAL",
      parties: "Synthetic regulator",
      contentSummary: "Synthetic content",
      senderMembershipId: "membership-a",
      actorUserId: "synthetic-user-a",
    })).rejects.toThrow(CommunicationError);
    expect(tables.records).toHaveLength(0);
  });

  it("records an external communication once approval is configured", async () => {
    const plan = await createCommunicationPlan(context, {
      subject: "Synthetic regulator update",
      audience: "EXTERNAL",
      triggerFrequency: "As needed",
      method: "Letter",
      approvalRequired: true,
      ownerMembershipId: "membership-a",
      actorUserId: "synthetic-user-a",
    });
    const record = await recordCommunication(context, {
      planId: plan.id,
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      audience: "EXTERNAL",
      parties: "Synthetic regulator",
      contentSummary: "Synthetic content",
      approverMembershipId: "approver-a",
      approvedAt: new Date("2026-07-30T00:00:00.000Z"),
      senderMembershipId: "membership-a",
      actorUserId: "synthetic-user-a",
    });
    expect(record).toMatchObject({ audience: "EXTERNAL", approverMembershipId: "approver-a" });
    expect(tables.records).toHaveLength(1);
  });

  it("allows an internal communication with no plan and no approval", async () => {
    const record = await recordCommunication(context, {
      occurredAt: new Date("2026-08-01T00:00:00.000Z"),
      audience: "INTERNAL",
      parties: "All staff",
      contentSummary: "Synthetic internal notice",
      senderMembershipId: "membership-a",
      actorUserId: "synthetic-user-a",
    });
    expect(record).toMatchObject({ audience: "INTERNAL", planId: null });
  });
});

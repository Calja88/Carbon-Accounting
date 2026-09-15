import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

// Test-only in-memory Prisma rows intentionally accept heterogeneous model fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const tables = vi.hoisted(() => ({
  aspects: [] as Row[],
  memberships: [] as Row[],
  revisions: [] as Row[],
  controls: [] as Row[],
  checks: [] as Row[],
  notifications: [] as Row[],
  nextId: 1,
}));

function scalarMatches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (["assessments", "operationalControlLinks", "aspectLinks", "applicabilities", "OR"].includes(key)) return true;
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    if (value && typeof value === "object" && "lt" in value) return row[key] < value.lt;
    return row[key] === value;
  });
}

vi.mock("@/lib/prisma", () => {
  const environmentalAspect = {
    findMany: vi.fn(async ({ where }: { where: Row }) => {
      let rows = tables.aspects.filter((row) => scalarMatches(row, where));
      if (where.assessments?.some) rows = rows.filter((row) => row.finalSignificant === true && row.assessmentStatus === "APPROVED");
      if (where.operationalControlLinks?.none) {
        rows = rows.filter((row) => !tables.controls.some((control) => control.organisationId === row.organisationId && control.status === "ACTIVE" && control.aspectLinks.some((link: Row) => link.aspectId === row.id)));
      }
      return rows;
    }),
  };
  const operationalControl = {
    findFirst: vi.fn(async ({ where, orderBy }: { where: Row; orderBy?: Row }) => {
      const rows = tables.controls.filter((row) => scalarMatches(row, where));
      if (orderBy?.version === "desc") rows.sort((a, b) => b.version - a.version);
      return rows[0] ?? null;
    }),
    findMany: vi.fn(async ({ where }: { where: Row }) => tables.controls.filter((row) => scalarMatches(row, where))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `control-${tables.nextId++}`, status: "ACTIVE", ...data, aspectLinks: [], applicabilities: [] };
      tables.controls.push(row);
      return row;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: Row }) => {
      const row = tables.controls.find((item) => item.id === where.id);
      if (!row) throw new Error("not found");
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const key = where.organisationId_id ?? where;
      const row = tables.controls.find((item) => scalarMatches(item, key));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };
  const operationalControlAspect = {
    createMany: vi.fn(async ({ data }: { data: Row[] }) => {
      for (const item of data) tables.controls.find((c) => c.id === item.controlId)?.aspectLinks.push({ ...item });
      return { count: data.length };
    }),
  };
  const controlApplicability = {
    createMany: vi.fn(async ({ data }: { data: Row[] }) => {
      for (const item of data) tables.controls.find((c) => c.id === item.controlId)?.applicabilities.push({ ...item });
      return { count: data.length };
    }),
  };
  const organisationMembership = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.memberships.find((row) => scalarMatches(row, where)) ?? null),
  };
  const controlledDocumentRevision = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.revisions.find((row) => scalarMatches(row, where)) ?? null),
  };
  const controlCheck = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.checks.find((row) => scalarMatches(row, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `check-${tables.nextId++}`, ...data };
      tables.checks.push(row);
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
  const client: Row = {
    environmentalAspect,
    operationalControl,
    operationalControlAspect,
    controlApplicability,
    organisationMembership,
    controlledDocumentRevision,
    controlCheck,
    notification,
    entity: { findFirst: vi.fn(async () => null) },
    site: { findFirst: vi.fn(async () => null) },
    activityProcess: { findFirst: vi.fn(async () => null) },
  };
  client.$transaction = vi.fn(async (callback: (tx: Row) => Promise<unknown>) => callback(client));
  return { prisma: client };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "synthetic-audit" })) }));
vi.mock("@/lib/documents/evidence-service", () => ({
  linkEvidence: vi.fn(),
  uploadEvidenceObject: vi.fn(),
}));

const {
  OperationalControlError,
  createOperationalControl,
  listSignificantAspectControlGaps,
  notifyOverdueControlReviews,
  recordControlCheck,
  reviseOperationalControl,
} = await import("@/lib/ems/controls/control-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");

const context = makeOrganisationContext(ORG_A, {
  userId: "synthetic-user-a",
  membershipId: "membership-a",
  permissions: new Set(["ems.view", "ems.control.manage"]) as never,
});
const baseInput = {
  controlKey: "synthetic-control",
  title: "Synthetic handling control",
  type: "PROCEDURAL" as const,
  frequency: "Before each synthetic run",
  acceptanceCriteria: "Synthetic checklist complete",
  effectivenessCriteria: "Synthetic check passes",
  ownerMembershipId: "membership-a",
  reviewDueDate: new Date("2026-09-01T00:00:00.000Z"),
  aspectIds: ["aspect-a"],
  actorUserId: "synthetic-user-a",
};

beforeEach(() => {
  Object.values(tables).forEach((value) => { if (Array.isArray(value)) value.length = 0; });
  tables.nextId = 1;
  vi.clearAllMocks();
  tables.memberships.push({ id: "membership-a", organisationId: ORG_A, status: "ACTIVE" });
  tables.aspects.push({
    id: "aspect-a", organisationId: ORG_A, name: "Synthetic aspect", finalSignificant: true,
    assessmentStatus: "APPROVED", process: { id: "process-a", name: "Synthetic process", siteId: null, entityId: null },
  });
});

describe("T33 operational-control workflow", () => {
  it("keeps the prior version traceable when review creates a successor", async () => {
    const first = await createOperationalControl(context, baseInput);
    const second = await reviseOperationalControl(context, first.id, {
      ...baseInput,
      title: "Synthetic reviewed handling control",
      reviewDueDate: new Date("2027-09-01T00:00:00.000Z"),
    });
    expect(first).toMatchObject({ version: 1, status: "SUPERSEDED" });
    expect(second).toMatchObject({ version: 2, status: "ACTIVE", supersedesControlId: first.id });
    expect(first.aspectLinks).toEqual([{ organisationId: ORG_A, controlId: first.id, aspectId: "aspect-a" }]);
  });

  it("shows a significant aspect as a gap until an active control is linked", async () => {
    await expect(listSignificantAspectControlGaps(context)).resolves.toHaveLength(1);
    await createOperationalControl(context, baseInput);
    await expect(listSignificantAspectControlGaps(context)).resolves.toHaveLength(0);
  });

  it("denies a foreign-organisation aspect before writing a control", async () => {
    tables.aspects[0].organisationId = ORG_B;
    await expect(createOperationalControl(context, baseInput)).rejects.toThrow(TenantOwnershipError);
    expect(tables.controls).toHaveLength(0);
  });

  it("requires a failed check to retain an exception summary", async () => {
    const control = await createOperationalControl(context, baseInput);
    await expect(recordControlCheck(context, {
      controlId: control.id,
      scheduledAt: new Date("2026-08-01T00:00:00.000Z"),
      result: "FAIL",
      actorUserId: "synthetic-user-a",
    })).rejects.toThrow(OperationalControlError);
    expect(tables.checks).toHaveLength(0);
  });

  it("delivers one deduplicated notification for an overdue active review", async () => {
    await createOperationalControl(context, { ...baseInput, reviewDueDate: new Date("2026-07-01T00:00:00.000Z") });
    const first = await notifyOverdueControlReviews(context, new Date("2026-08-13T00:00:00.000Z"));
    const second = await notifyOverdueControlReviews(context, new Date("2026-08-13T00:00:00.000Z"));
    expect(first).toEqual([{ controlId: expect.any(String), id: expect.any(String), status: "DELIVERED" }]);
    expect(second[0]).toMatchObject({ status: "DELIVERED", id: first[0].id });
    expect(tables.notifications).toHaveLength(1);
  });
});

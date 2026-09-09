/** T81 legal hold service tests. All records are synthetic. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

const tables = vi.hoisted(() => ({ holds: [] as Record<string, unknown>[], nextId: 1 }));

function id(prefix: string) {
  return `${prefix}-${tables.nextId++}`;
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "OR" in (value as Record<string, unknown>)) return true;
    return row[key] === value;
  });
}

vi.mock("@/lib/prisma", () => {
  const legalHold = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.OR) {
        const clauses = where.OR as Record<string, unknown>[];
        return (
          tables.holds.find(
            (row) =>
              row.organisationId === where.organisationId &&
              row.status === where.status &&
              clauses.some((clause) => matches(row, clause)),
          ) ?? null
        );
      }
      return tables.holds.find((row) => matches(row, where)) ?? null;
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => tables.holds.filter((row) => matches(row, where))),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: id("hold"), status: "ACTIVE", resourceType: null, resourceId: null, ...data };
      tables.holds.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = tables.holds.find((item) => item.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };
  const prismaClient = {
    legalHold,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-1" })) }));

const { createLegalHold, releaseLegalHold, listLegalHolds, isUnderLegalHold, LegalHoldError } = await import(
  "@/lib/retention/legal-hold-service"
);
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { createTenantRepositoryContext } = await import("@/lib/repositories/context");

const managerContextA = makeOrganisationContext(ORG_A, {
  userId: "synthetic-manager-a",
  permissions: new Set(["organisation.legal_hold.manage"]) as never,
});
const noPermContextA = makeOrganisationContext(ORG_A, {
  userId: "synthetic-nobody-a",
  permissions: new Set([]) as never,
});

beforeEach(() => {
  tables.holds.length = 0;
  tables.nextId = 1;
  vi.clearAllMocks();
});

describe("createLegalHold", () => {
  it("denies a caller without organisation.legal_hold.manage", async () => {
    await expect(
      createLegalHold(noPermContextA, { reason: "Litigation", actorUserId: "synthetic-nobody-a" }),
    ).rejects.toThrow();
    expect(tables.holds).toHaveLength(0);
  });

  it("creates an organisation-wide hold when no resource is given", async () => {
    const hold = await createLegalHold(managerContextA, { reason: "Regulator enquiry", actorUserId: "synthetic-manager-a" });
    expect(hold).toMatchObject({ organisationId: ORG_A, resourceType: null, resourceId: null, status: "ACTIVE" });
  });

  it("creates a resource-scoped hold", async () => {
    const hold = await createLegalHold(managerContextA, {
      resourceType: "evidence_object",
      resourceId: "evidence-1",
      reason: "Litigation preservation",
      actorUserId: "synthetic-manager-a",
    });
    expect(hold).toMatchObject({ resourceType: "evidence_object", resourceId: "evidence-1" });
  });

  it("rejects a mixed scope (resourceType without resourceId)", async () => {
    await expect(
      createLegalHold(managerContextA, { resourceType: "evidence_object", reason: "x", actorUserId: "synthetic-manager-a" }),
    ).rejects.toThrow(LegalHoldError);
  });

  it("rejects an empty reason", async () => {
    await expect(createLegalHold(managerContextA, { reason: "  ", actorUserId: "synthetic-manager-a" })).rejects.toThrow(
      LegalHoldError,
    );
  });
});

describe("releaseLegalHold", () => {
  it("releases an active hold and records who/why", async () => {
    const hold = await createLegalHold(managerContextA, { reason: "Litigation", actorUserId: "synthetic-manager-a" });
    const released = await releaseLegalHold(managerContextA, {
      holdId: hold.id,
      releaseReason: "Matter closed",
      actorUserId: "synthetic-manager-a",
    });
    expect(released).toMatchObject({ status: "RELEASED", releaseReason: "Matter closed" });
  });

  it("rejects releasing an already-released hold", async () => {
    const hold = await createLegalHold(managerContextA, { reason: "Litigation", actorUserId: "synthetic-manager-a" });
    await releaseLegalHold(managerContextA, { holdId: hold.id, releaseReason: "Matter closed", actorUserId: "synthetic-manager-a" });
    await expect(
      releaseLegalHold(managerContextA, { holdId: hold.id, releaseReason: "Again", actorUserId: "synthetic-manager-a" }),
    ).rejects.toThrow(LegalHoldError);
  });

  it("denies releasing a foreign-organisation hold", async () => {
    tables.holds.push({ id: "hold-b", organisationId: ORG_B, status: "ACTIVE", resourceType: null, resourceId: null, reason: "x" });
    await expect(
      releaseLegalHold(managerContextA, { holdId: "hold-b", releaseReason: "x", actorUserId: "synthetic-manager-a" }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

describe("isUnderLegalHold", () => {
  const ctxA = createTenantRepositoryContext({ organisationId: ORG_A, userId: "u", correlationId: "c" });

  it("is false with no holds", async () => {
    expect(await isUnderLegalHold(ctxA, "evidence_object", "evidence-1")).toBe(false);
  });

  it("is true for a resource-specific active hold", async () => {
    tables.holds.push({
      id: "hold-1",
      organisationId: ORG_A,
      status: "ACTIVE",
      resourceType: "evidence_object",
      resourceId: "evidence-1",
      reason: "x",
    });
    expect(await isUnderLegalHold(ctxA, "evidence_object", "evidence-1")).toBe(true);
    expect(await isUnderLegalHold(ctxA, "evidence_object", "evidence-2")).toBe(false);
  });

  it("is true for every resource under an organisation-wide active hold", async () => {
    tables.holds.push({ id: "hold-1", organisationId: ORG_A, status: "ACTIVE", resourceType: null, resourceId: null, reason: "x" });
    expect(await isUnderLegalHold(ctxA, "evidence_object", "evidence-1")).toBe(true);
    expect(await isUnderLegalHold(ctxA, "environmental_aspect", "aspect-99")).toBe(true);
  });

  it("ignores a released hold and a foreign organisation's hold", async () => {
    tables.holds.push({ id: "hold-1", organisationId: ORG_A, status: "RELEASED", resourceType: null, resourceId: null, reason: "x" });
    tables.holds.push({
      id: "hold-2",
      organisationId: ORG_B,
      status: "ACTIVE",
      resourceType: "evidence_object",
      resourceId: "evidence-1",
      reason: "x",
    });
    expect(await isUnderLegalHold(ctxA, "evidence_object", "evidence-1")).toBe(false);
  });
});

describe("listLegalHolds", () => {
  it("denies a caller without organisation.legal_hold.manage", async () => {
    await expect(listLegalHolds(noPermContextA)).rejects.toThrow();
  });

  it("returns only this organisation's holds", async () => {
    await createLegalHold(managerContextA, { reason: "A hold", actorUserId: "synthetic-manager-a" });
    tables.holds.push({ id: "hold-b", organisationId: ORG_B, status: "ACTIVE", resourceType: null, resourceId: null, reason: "B hold" });
    const holds = await listLegalHolds(managerContextA);
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ organisationId: ORG_A });
  });
});

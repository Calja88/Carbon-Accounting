/**
 * Other requirements and manual legal sources tests (task T46). No live
 * database — Prisma is replaced with an in-memory fake and the audit
 * side-effect is stubbed, matching the T43/T44 test pattern exactly. Covers
 * source CRUD, tenant isolation, permission checks, and the status
 * transition rules (a source is never deleted, only moved out of ACTIVE).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row; orderBy?: Row | Row[] };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  sources: [] as Row[],
  memberships: [] as Row[],
  nextId: 1,
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function find(rows: Row[], where: Row) {
  return rows.find((row) => matches(row, where)) ?? null;
}

vi.mock("@/lib/prisma", () => {
  const organisationMembership = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.memberships, where ?? {})) };
  const otherRequirementSource = {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(tables.sources, key as Row);
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => tables.sources.filter((row) => matches(row, where ?? {}))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const id = `source-${tables.nextId++}`;
      const row: Row = { id, status: "ACTIVE", createdAt: new Date(), ...data };
      tables.sources.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.sources, key);
      if (!row) throw new Error("source not found");
      Object.assign(row, data);
      return row;
    }),
  };
  const prismaClient = {
    organisationMembership,
    otherRequirementSource,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-synthetic" })) }));

const {
  createOtherRequirementSource,
  updateOtherRequirementSource,
  changeOtherRequirementSourceStatus,
  listOtherRequirementSources,
  getOtherRequirementSource,
  OtherRequirementSourceError,
} = await import("@/lib/ems/legal/other-requirement-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const MANAGE_ONLY = new Set(["ems.view", "ems.legal_source.manage"]) as never;
const VIEW_ONLY = new Set(["ems.view"]) as never;

const contextA = makeOrganisationContext(ORG_A, { userId: "user-a", membershipId: "membership-a", permissions: MANAGE_ONLY });
const contextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: MANAGE_ONLY });
const viewOnlyContextA = makeOrganisationContext(ORG_A, { userId: "user-a", membershipId: "membership-a", permissions: VIEW_ONLY });

beforeEach(() => {
  tables.sources.length = 0;
  tables.memberships.length = 0;
  tables.nextId = 1;
  tables.memberships.push({ id: "membership-owner", organisationId: ORG_A, status: "ACTIVE" });
});

function baseInput(overrides: Partial<Parameters<typeof createOtherRequirementSource>[1]> = {}) {
  return {
    type: "PERMIT" as const,
    title: "Synthetic Site A discharge consent",
    issuingParty: "Synthetic Environment Agency",
    ownerMembershipId: "membership-owner",
    actorUserId: "user-a",
    ...overrides,
  };
}

describe("createOtherRequirementSource", () => {
  it("creates an ACTIVE source with a clear type and issuing authority", async () => {
    const source = await createOtherRequirementSource(contextA, baseInput());
    expect(source.status).toBe("ACTIVE");
    expect(source.type).toBe("PERMIT");
    expect(source.issuingParty).toBe("Synthetic Environment Agency");
    expect(source.organisationId).toBe(ORG_A);
  });

  it("denies a member without ems.legal_source.manage", async () => {
    await expect(createOtherRequirementSource(viewOnlyContextA, baseInput())).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("rejects an empty title", async () => {
    await expect(createOtherRequirementSource(contextA, baseInput({ title: "  " }))).rejects.toBeInstanceOf(OtherRequirementSourceError);
  });

  it("rejects an empty issuing party", async () => {
    await expect(createOtherRequirementSource(contextA, baseInput({ issuingParty: "  " }))).rejects.toBeInstanceOf(OtherRequirementSourceError);
  });

  it("does not resolve a foreign-tenant owner membership", async () => {
    await expect(createOtherRequirementSource(contextB, baseInput({ ownerMembershipId: "membership-owner" }))).rejects.toBeInstanceOf(
      TenantOwnershipError,
    );
  });

  it("accepts review and expiry dates (manual source gets review/expiry)", async () => {
    const source = await createOtherRequirementSource(
      contextA,
      baseInput({ expiryDate: new Date("2027-01-01"), nextReviewAt: new Date("2026-06-01") }),
    );
    expect(source.expiryDate).toEqual(new Date("2027-01-01"));
    expect(source.nextReviewAt).toEqual(new Date("2026-06-01"));
  });
});

describe("updateOtherRequirementSource", () => {
  it("edits an ACTIVE source's fields", async () => {
    const created = await createOtherRequirementSource(contextA, baseInput());
    const updated = await updateOtherRequirementSource(contextA, created.id as string, baseInput({ title: "Revised title" }));
    expect(updated.title).toBe("Revised title");
  });

  it("denies a caller from another organisation", async () => {
    const created = await createOtherRequirementSource(contextA, baseInput());
    await expect(updateOtherRequirementSource(contextB, created.id as string, baseInput())).rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("refuses to edit a source that is no longer ACTIVE", async () => {
    const created = await createOtherRequirementSource(contextA, baseInput());
    await changeOtherRequirementSourceStatus(contextA, created.id as string, "WITHDRAWN", "user-a");
    await expect(updateOtherRequirementSource(contextA, created.id as string, baseInput())).rejects.toBeInstanceOf(OtherRequirementSourceError);
  });
});

describe("changeOtherRequirementSourceStatus", () => {
  it("moves an ACTIVE source to EXPIRED, SUPERSEDED, or WITHDRAWN without deleting it", async () => {
    const created = await createOtherRequirementSource(contextA, baseInput());
    const updated = await changeOtherRequirementSourceStatus(contextA, created.id as string, "EXPIRED", "user-a");
    expect(updated.status).toBe("EXPIRED");
    const listed = await listOtherRequirementSources(contextA);
    expect(listed.some((row) => row.id === created.id)).toBe(true);
  });

  it("refuses a transition out of a closed status", async () => {
    const created = await createOtherRequirementSource(contextA, baseInput());
    await changeOtherRequirementSourceStatus(contextA, created.id as string, "WITHDRAWN", "user-a");
    await expect(changeOtherRequirementSourceStatus(contextA, created.id as string, "EXPIRED", "user-a")).rejects.toBeInstanceOf(
      OtherRequirementSourceError,
    );
  });

  it("denies a member without ems.legal_source.manage", async () => {
    const created = await createOtherRequirementSource(contextA, baseInput());
    await expect(changeOtherRequirementSourceStatus(viewOnlyContextA, created.id as string, "WITHDRAWN", "user-a")).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });
});

describe("tenant isolation and read access", () => {
  it("only surfaces this organisation's own sources", async () => {
    await createOtherRequirementSource(contextA, baseInput());
    const listedA = await listOtherRequirementSources(contextA);
    const listedB = await listOtherRequirementSources(contextB);
    expect(listedA).toHaveLength(1);
    expect(listedB).toHaveLength(0);
  });

  it("denies reading a foreign-tenant source identically to a missing one", async () => {
    const created = await createOtherRequirementSource(contextA, baseInput());
    await expect(getOtherRequirementSource(contextB, created.id as string)).rejects.toBeInstanceOf(TenantOwnershipError);
    await expect(getOtherRequirementSource(contextB, "unknown-id")).rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("denies listing without ems.view", async () => {
    const noPermsContext = makeOrganisationContext(ORG_A, { permissions: new Set() as never });
    await expect(listOtherRequirementSources(noPermsContext)).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

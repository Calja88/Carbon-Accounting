/**
 * Person profile tests (task T70). No live database — Prisma is replaced
 * with an in-memory fake and the audit-event side effect is stubbed.
 * Covers: login identity linked not duplicated, restricted contact detail
 * gated behind `ems.competence.sensitive.view`, RESTRICTED-membership
 * site/entity visibility (deny by default for an org-wide person), and
 * tenant isolation. All fixtures are fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, ENTITY_A, SITE_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";
import { PermissionDeniedError } from "@/lib/rbac/authorize";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row; organisationId_personId?: Row }; data: Row };
type UpsertArgs = { where: Row & { organisationId_personId?: Row }; create: Row; update: Row };

const tables = vi.hoisted(() => ({
  memberships: [] as Row[],
  entities: [] as Row[],
  sites: [] as Row[],
  personProfiles: [] as Row[],
  personSensitiveProfiles: [] as Row[],
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
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR" && Array.isArray(value)) {
      return (value as Row[]).some((clause) => matches(row, clause));
    }
    return matchValue(row[key], value);
  });
}

function find(rows: Row[], where: Row) {
  return rows.filter((row) => matches(row, where))[0] ?? null;
}

function simpleModel(rows: Row[], prefix: string, defaults: Row = {}) {
  return {
    findFirst: vi.fn(async ({ where }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(rows, key as Row);
    }),
    findUnique: vi.fn(async ({ where }: FindArgs) => find(rows, (where ?? {}) as Row)),
    findMany: vi.fn(async ({ where }: FindArgs) => rows.filter((r) => matches(r, (where ?? {}) as Row))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `${prefix}-${tables.nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...defaults, ...data };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where.organisationId_personId ?? where;
      const row = find(rows, key as Row);
      if (!row) throw new Error(`${prefix} not found`);
      Object.assign(row, data);
      return row;
    }),
    upsert: vi.fn(async ({ where, create, update }: UpsertArgs) => {
      const key = where.organisationId_personId ?? where;
      const existing = find(rows, key as Row);
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
  const organisationMembership = simpleModel(tables.memberships, "membership", { status: "ACTIVE" });
  const entity = simpleModel(tables.entities, "entity");
  const site = simpleModel(tables.sites, "site");
  const personProfile = simpleModel(tables.personProfiles, "person", { isActive: true });
  const personSensitiveProfile = simpleModel(tables.personSensitiveProfiles, "sensitive");

  const prismaClient = {
    organisationMembership,
    entity,
    site,
    personProfile,
    personSensitiveProfile,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-event-synthetic" })) }));

const {
  PersonProfileError,
  TenantOwnershipError,
  createPersonProfile,
  updatePersonProfile,
  setPersonSensitiveProfile,
  getPersonProfile,
  getPersonSensitiveProfile,
  listPersonProfiles,
  deactivatePersonProfile,
} = await import("@/lib/ems/competence/person-service");

const MANAGE = new Set(["ems.competence.view", "ems.competence.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"];
const MANAGE_AND_SENSITIVE = new Set([
  "ems.competence.view",
  "ems.competence.manage",
  "ems.competence.sensitive.view",
]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"];
const VIEW_ONLY = new Set(["ems.competence.view"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"];

function contextA(overrides: Partial<Parameters<typeof makeOrganisationContext>[1]> = {}) {
  return makeOrganisationContext(ORG_A, { permissions: MANAGE_AND_SENSITIVE, ...overrides });
}

beforeEach(() => {
  tables.memberships.length = 0;
  tables.entities.length = 0;
  tables.sites.length = 0;
  tables.personProfiles.length = 0;
  tables.personSensitiveProfiles.length = 0;
  tables.nextId = 1;

  tables.memberships.push({ id: "membership-A1", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-B1", organisationId: ORG_B, status: "ACTIVE" });
  tables.entities.push({ id: ENTITY_A, organisationId: ORG_A });
  tables.sites.push({ id: SITE_A, organisationId: ORG_A, entityId: ENTITY_A });
});

describe("createPersonProfile", () => {
  it("links a login identity via membershipId without duplicating name/email", async () => {
    const person = await createPersonProfile(contextA(), {
      personType: "EMPLOYEE",
      membershipId: "membership-A1",
      actorUserId: "user-1",
    });
    expect(person.membershipId).toBe("membership-A1");
    expect(person.displayName).toBeNull();
  });

  it("requires a display name for a person without a login identity", async () => {
    await expect(
      createPersonProfile(contextA(), { personType: "CONTRACTOR", actorUserId: "user-1" }),
    ).rejects.toThrow(PersonProfileError);
  });

  it("denies linking a foreign-tenant membership", async () => {
    await expect(
      createPersonProfile(contextA(), { personType: "EMPLOYEE", membershipId: "membership-B1", actorUserId: "user-1" }),
    ).rejects.toThrow(TenantOwnershipError);
  });

  it("denies without ems.competence.manage", async () => {
    await expect(
      createPersonProfile(contextA({ permissions: VIEW_ONLY }), {
        personType: "CONTRACTOR",
        displayName: "Synthetic Contractor",
        actorUserId: "user-1",
      }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("stores restricted contact detail separately from the profile", async () => {
    const person = await createPersonProfile(contextA(), {
      personType: "CONTRACTOR",
      displayName: "Synthetic Contractor",
      sensitive: { contactEmail: "synthetic@example.test" },
      actorUserId: "user-1",
    });
    expect(tables.personSensitiveProfiles).toHaveLength(1);
    expect(tables.personSensitiveProfiles[0].personId).toBe(person.id);
  });
});

describe("sensitive profile read gating", () => {
  it("denies reading restricted contact detail without ems.competence.sensitive.view", async () => {
    const person = await createPersonProfile(contextA(), {
      personType: "CONTRACTOR",
      displayName: "Synthetic Contractor",
      sensitive: { contactEmail: "synthetic@example.test" },
      actorUserId: "user-1",
    });
    await expect(getPersonSensitiveProfile(contextA({ permissions: MANAGE }), person.id)).rejects.toThrow(PermissionDeniedError);
  });

  it("allows reading restricted contact detail with ems.competence.sensitive.view", async () => {
    const person = await createPersonProfile(contextA(), {
      personType: "CONTRACTOR",
      displayName: "Synthetic Contractor",
      sensitive: { contactEmail: "synthetic@example.test" },
      actorUserId: "user-1",
    });
    const sensitive = await getPersonSensitiveProfile(contextA(), person.id);
    expect(sensitive?.contactEmail).toBe("synthetic@example.test");
  });

  it("never includes sensitive fields on the non-sensitive profile read", async () => {
    const person = await createPersonProfile(contextA(), {
      personType: "CONTRACTOR",
      displayName: "Synthetic Contractor",
      sensitive: { contactEmail: "synthetic@example.test" },
      actorUserId: "user-1",
    });
    const profile = await getPersonProfile(contextA(), person.id);
    expect(profile).not.toHaveProperty("sensitiveProfile");
  });

  it("setPersonSensitiveProfile only requires ems.competence.manage to write", async () => {
    const person = await createPersonProfile(contextA(), { personType: "CONTRACTOR", displayName: "Synthetic Contractor", actorUserId: "user-1" });
    await expect(
      setPersonSensitiveProfile(contextA({ permissions: MANAGE }), person.id, { contactPhone: "0000", actorUserId: "user-1" }),
    ).resolves.toBeTruthy();
  });
});

describe("tenant isolation and site scoping", () => {
  it("denies updating a foreign-tenant person", async () => {
    const person = await createPersonProfile(contextA(), { personType: "CONTRACTOR", displayName: "Synthetic Contractor", actorUserId: "user-1" });
    const contextB = makeOrganisationContext(ORG_B, { permissions: MANAGE_AND_SENSITIVE });
    await expect(updatePersonProfile(contextB, person.id, { actorUserId: "user-1" })).rejects.toThrow(TenantOwnershipError);
  });

  it("denies a RESTRICTED member from seeing a person with no Entity/Site (deny by default)", async () => {
    await createPersonProfile(contextA(), { personType: "CONTRACTOR", displayName: "Org-wide Person", actorUserId: "user-1" });
    const restricted = makeOrganisationContext(ORG_A, {
      permissions: MANAGE_AND_SENSITIVE,
      access: { mode: "RESTRICTED", entityIds: new Set(), siteIds: new Set([SITE_A]) },
    });
    const visible = await listPersonProfiles(restricted);
    expect(visible).toHaveLength(0);
  });

  it("lets a RESTRICTED member see a person scoped to their granted Site", async () => {
    await createPersonProfile(contextA(), {
      personType: "EMPLOYEE",
      membershipId: "membership-A1",
      siteId: SITE_A,
      entityId: ENTITY_A,
      actorUserId: "user-1",
    });
    const restricted = makeOrganisationContext(ORG_A, {
      permissions: MANAGE_AND_SENSITIVE,
      access: { mode: "RESTRICTED", entityIds: new Set(), siteIds: new Set([SITE_A]) },
    });
    const visible = await listPersonProfiles(restricted);
    expect(visible).toHaveLength(1);
  });
});

describe("deactivation", () => {
  it("deactivates without deleting the profile", async () => {
    const person = await createPersonProfile(contextA(), { personType: "CONTRACTOR", displayName: "Synthetic Contractor", actorUserId: "user-1" });
    const deactivated = await deactivatePersonProfile(contextA(), person.id, "user-1");
    expect(deactivated.isActive).toBe(false);
    expect(tables.personProfiles).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  OrganisationAccessError,
  resolveOrganisationContext,
  type MembershipContextRow,
  type OrganisationContextDb,
} from "@/lib/organisation/context";

function membership(overrides: Partial<MembershipContextRow> = {}): MembershipContextRow {
  return {
    id: "mem_a",
    organisationId: "org_aster",
    status: "ACTIVE",
    accessMode: "ORGANISATION_WIDE",
    lastAccessedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    organisation: { id: "org_aster", slug: "aster-demo", status: "ACTIVE" },
    roles: [
      {
        role: {
          isActive: true,
          permissions: [{ permissionCode: "carbon.view" }, { permissionCode: "carbon.entry.create" }],
        },
      },
    ],
    entityScopes: [],
    siteScopes: [],
    ...overrides,
  };
}

function fakeDb(rows: MembershipContextRow[]): OrganisationContextDb {
  return {
    organisationMembership: {
      async findMany({ where }) {
        return rows.filter((r) => r.status === where.status);
      },
    },
  };
}

describe("resolveOrganisationContext", () => {
  it("resolves the default membership when none is requested", async () => {
    const db = fakeDb([membership()]);
    const context = await resolveOrganisationContext(db, { userId: "user_1" });

    expect(context.organisationId).toBe("org_aster");
    expect(context.organisationSlug).toBe("aster-demo");
    expect(context.membershipId).toBe("mem_a");
    expect(context.userId).toBe("user_1");
    expect(context.permissions.has("carbon.view")).toBe(true);
    expect(context.permissions.has("carbon.entry.create")).toBe(true);
  });

  it("picks the most recently accessed active membership among several", async () => {
    const older = membership({
      id: "mem_old",
      organisationId: "org_old",
      organisation: { id: "org_old", slug: "old-demo", status: "ACTIVE" },
      lastAccessedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const newer = membership({
      id: "mem_new",
      organisationId: "org_new",
      organisation: { id: "org_new", slug: "new-demo", status: "ACTIVE" },
      lastAccessedAt: new Date("2026-06-01T00:00:00Z"),
    });
    const db = fakeDb([older, newer]);

    const context = await resolveOrganisationContext(db, { userId: "user_1" });
    expect(context.organisationId).toBe("org_new");
  });

  it("resolves an explicitly requested organisation by slug or id", async () => {
    const a = membership();
    const b = membership({
      id: "mem_b",
      organisationId: "org_birch",
      organisation: { id: "org_birch", slug: "birch-demo", status: "ACTIVE" },
    });
    const db = fakeDb([a, b]);

    const bySlug = await resolveOrganisationContext(db, {
      userId: "user_1",
      requestedOrganisation: "birch-demo",
    });
    expect(bySlug.organisationId).toBe("org_birch");

    const byId = await resolveOrganisationContext(db, {
      userId: "user_1",
      requestedOrganisation: "org_aster",
    });
    expect(byId.organisationId).toBe("org_aster");
  });

  it("rejects a requested organisation the user is not an active member of", async () => {
    const db = fakeDb([membership()]);
    await expect(
      resolveOrganisationContext(db, { userId: "user_1", requestedOrganisation: "org_birch" }),
    ).rejects.toThrow(OrganisationAccessError);
  });

  it("throws when the user has no active membership at all", async () => {
    const db = fakeDb([]);
    await expect(resolveOrganisationContext(db, { userId: "user_1" })).rejects.toMatchObject({
      reason: "NO_ACTIVE_MEMBERSHIP",
    });
  });

  it("excludes a suspended membership even when explicitly requested", async () => {
    const db = fakeDb([membership({ status: "SUSPENDED" })]);
    await expect(
      resolveOrganisationContext(db, { userId: "user_1", requestedOrganisation: "org_aster" }),
    ).rejects.toThrow(OrganisationAccessError);
  });

  it("excludes a membership in a non-active organisation", async () => {
    const db = fakeDb([
      membership({ organisation: { id: "org_aster", slug: "aster-demo", status: "SUSPENDED" } }),
    ]);
    await expect(resolveOrganisationContext(db, { userId: "user_1" })).rejects.toMatchObject({
      reason: "NO_ACTIVE_MEMBERSHIP",
    });
  });

  it("grants no permissions from a deactivated role", async () => {
    const db = fakeDb([
      membership({
        roles: [
          { role: { isActive: false, permissions: [{ permissionCode: "carbon.view" }] } },
        ],
      }),
    ]);
    const context = await resolveOrganisationContext(db, { userId: "user_1" });
    expect(context.permissions.size).toBe(0);
  });

  it("reports organisation-wide access with empty scope sets", async () => {
    const db = fakeDb([membership()]);
    const context = await resolveOrganisationContext(db, { userId: "user_1" });
    expect(context.access.mode).toBe("ORGANISATION_WIDE");
    expect(context.access.entityIds.size).toBe(0);
    expect(context.access.siteIds.size).toBe(0);
  });

  it("reports restricted access with explicit Entity/Site scopes", async () => {
    const db = fakeDb([
      membership({
        accessMode: "RESTRICTED",
        entityScopes: [{ entityId: "entity_a1" }],
        siteScopes: [{ siteId: "site_a1_north" }],
      }),
    ]);
    const context = await resolveOrganisationContext(db, { userId: "user_1" });
    expect(context.access.mode).toBe("RESTRICTED");
    expect([...context.access.entityIds]).toEqual(["entity_a1"]);
    expect([...context.access.siteIds]).toEqual(["site_a1_north"]);
  });

  it("keeps a dual-member user's B-organisation context isolated from A grants", async () => {
    const a = membership({
      roles: [{ role: { isActive: true, permissions: [{ permissionCode: "ems.compliance_obligation.approve" }] } }],
    });
    const b = membership({
      id: "mem_b",
      organisationId: "org_birch",
      organisation: { id: "org_birch", slug: "birch-demo", status: "ACTIVE" },
      roles: [{ role: { isActive: true, permissions: [{ permissionCode: "carbon.view" }] } }],
    });
    const db = fakeDb([a, b]);

    const context = await resolveOrganisationContext(db, {
      userId: "user_1",
      requestedOrganisation: "org_birch",
    });
    expect(context.permissions.has("ems.compliance_obligation.approve")).toBe(false);
    expect(context.permissions.has("carbon.view")).toBe(true);
  });
});

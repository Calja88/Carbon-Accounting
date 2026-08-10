import { describe, expect, it } from "vitest";
import type { OrganisationContext } from "@/lib/organisation/context";
import {
  PermissionDeniedError,
  assertEntityAccess,
  assertFourEyes,
  assertSiteAccess,
  hasEntityAccess,
  hasPermission,
  hasSiteAccess,
  passesFourEyes,
  requirePermission,
} from "@/lib/rbac/authorize";

function context(overrides: Partial<OrganisationContext> = {}): OrganisationContext {
  return {
    userId: "user_1",
    membershipId: "mem_a",
    organisationId: "org_aster",
    organisationSlug: "aster-demo",
    permissions: new Set(),
    access: { mode: "ORGANISATION_WIDE", entityIds: new Set(), siteIds: new Set() },
    correlationId: "corr_1",
    ...overrides,
  };
}

describe("hasPermission / requirePermission", () => {
  it("denies by default when no permission is granted", () => {
    const ctx = context();
    expect(hasPermission(ctx, "ems.compliance_obligation.approve")).toBe(false);
    expect(() => requirePermission(ctx, "ems.compliance_obligation.approve")).toThrow(
      PermissionDeniedError,
    );
  });

  it("allows only the exact granted codes, not neighbouring ones", () => {
    const ctx = context({ permissions: new Set(["ems.compliance_obligation.edit"]) });
    expect(hasPermission(ctx, "ems.compliance_obligation.edit")).toBe(true);
    expect(hasPermission(ctx, "ems.compliance_obligation.approve")).toBe(false);
  });

  it("mirrors the Organisation Administrator default: role administration without compliance approval", () => {
    const ctx = context({
      permissions: new Set(["organisation.role.manage", "organisation.membership.manage"]),
    });
    expect(hasPermission(ctx, "organisation.role.manage")).toBe(true);
    expect(() => requirePermission(ctx, "ems.compliance_obligation.approve")).toThrow(
      PermissionDeniedError,
    );
  });

  it("throws a reason-carrying error distinguishable from other denials", () => {
    const ctx = context();
    try {
      requirePermission(ctx, "audit.export");
      throw new Error("expected requirePermission to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionDeniedError);
      expect((err as PermissionDeniedError).reason).toBe("MISSING_PERMISSION");
    }
  });

  it("rejects a permission code outside the known catalogue rather than silently denying", () => {
    const ctx = context({ permissions: new Set(["carbon.view"]) });
    expect(() => hasPermission(ctx, "carbon.view.bogus" as never)).toThrow(
      /Unknown permission code/,
    );
  });
});

describe("entity/site scope", () => {
  it("grants an organisation-wide membership access to any entity or site", () => {
    const ctx = context({ access: { mode: "ORGANISATION_WIDE", entityIds: new Set(), siteIds: new Set() } });
    expect(hasEntityAccess(ctx, "entity_a2")).toBe(true);
    expect(hasSiteAccess(ctx, "site_a2_south")).toBe(true);
    expect(() => assertEntityAccess(ctx, "entity_a2")).not.toThrow();
  });

  it("denies a restricted membership access to an entity outside its scope", () => {
    const ctx = context({
      access: { mode: "RESTRICTED", entityIds: new Set(["entity_a1"]), siteIds: new Set() },
    });
    expect(hasEntityAccess(ctx, "entity_a1")).toBe(true);
    expect(hasEntityAccess(ctx, "entity_a2")).toBe(false);
    expect(() => assertEntityAccess(ctx, "entity_a2")).toThrow(PermissionDeniedError);
  });

  it("denies a restricted membership access to a site outside its scope", () => {
    const ctx = context({
      access: { mode: "RESTRICTED", entityIds: new Set(), siteIds: new Set(["site_a1_north"]) },
    });
    expect(hasSiteAccess(ctx, "site_a1_north")).toBe(true);
    expect(hasSiteAccess(ctx, "site_a1_south")).toBe(false);
    expect(() => assertSiteAccess(ctx, "site_a1_south")).toThrow(PermissionDeniedError);
  });

  it("keeps membership restriction authoritative even when the role grants the permission org-wide", () => {
    // "Organisation-wide role plus restricted membership | Membership restriction wins" (adversarial matrix §3).
    const ctx = context({
      permissions: new Set(["carbon.entry.approve"]),
      access: { mode: "RESTRICTED", entityIds: new Set(["entity_a1"]), siteIds: new Set() },
    });
    expect(hasPermission(ctx, "carbon.entry.approve")).toBe(true);
    expect(() => assertEntityAccess(ctx, "entity_a2")).toThrow(PermissionDeniedError);
  });

  it("unions permissions across multiple roles but still enforces the single membership scope", () => {
    // "Multiple roles where one grants permission | Allowed only within membership scope" (adversarial matrix §3).
    const ctx = context({
      permissions: new Set(["carbon.view", "carbon.entry.create"]),
      access: { mode: "RESTRICTED", entityIds: new Set(["entity_a1"]), siteIds: new Set() },
    });
    expect(hasPermission(ctx, "carbon.entry.create")).toBe(true);
    expect(hasEntityAccess(ctx, "entity_a1")).toBe(true);
    expect(hasEntityAccess(ctx, "entity_b1")).toBe(false);
  });
});

describe("four-eyes evaluation", () => {
  it("passes any actor when four-eyes is disabled, including the author", () => {
    expect(passesFourEyes({ enabled: false, actorUserId: "user_1", authorUserId: "user_1" })).toBe(
      true,
    );
  });

  it("denies the author approving their own record when four-eyes is enabled", () => {
    const check = { enabled: true, actorUserId: "user_1", authorUserId: "user_1" };
    expect(passesFourEyes(check)).toBe(false);
    expect(() => assertFourEyes(check)).toThrow(PermissionDeniedError);
  });

  it("allows a different approver when four-eyes is enabled", () => {
    const check = { enabled: true, actorUserId: "user_2", authorUserId: "user_1" };
    expect(passesFourEyes(check)).toBe(true);
    expect(() => assertFourEyes(check)).not.toThrow();
  });
});

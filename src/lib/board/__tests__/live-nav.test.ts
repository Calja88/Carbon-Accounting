import { describe, expect, it } from "vitest";
import type { OrganisationContext, PermissionCode } from "@/lib/organisation/context";
import { resolveBoardNav } from "../live-nav";

function contextWith(permissions: PermissionCode[]): OrganisationContext {
  return {
    userId: "user-1",
    membershipId: "membership-1",
    organisationId: "org-1",
    organisationSlug: "org-1",
    permissions: new Set(permissions),
    access: { mode: "ORGANISATION_WIDE", entityIds: new Set(), siteIds: new Set() },
    correlationId: "test",
  };
}

describe("resolveBoardNav", () => {
  it("returns nothing for a signed-out/no-membership visitor", () => {
    expect(resolveBoardNav(null)).toEqual([]);
  });

  it("includes the carbon-first items once carbon.view is granted", () => {
    const nav = resolveBoardNav(contextWith(["carbon.view", "carbon.factor.view", "lca.view", "ems.view"]));
    const ids = nav.map((item) => item.id);
    expect(ids).toEqual(["overview", "entry", "factors", "evidence", "reports", "advanced"]);
  });

  it("gates overview/entry/evidence/reports on carbon.view", () => {
    const noCarbon = resolveBoardNav(contextWith(["ems.view"]));
    const ids = noCarbon.map((item) => item.id);
    expect(ids).not.toContain("overview");
    expect(ids).not.toContain("entry");
    expect(ids).not.toContain("evidence");
    expect(ids).not.toContain("reports");
  });

  it("gates factors on carbon.factor.view independently of carbon.view", () => {
    expect(resolveBoardNav(contextWith(["carbon.view"])).map((i) => i.id)).not.toContain("factors");
    expect(resolveBoardNav(contextWith(["carbon.factor.view"])).map((i) => i.id)).toContain("factors");
  });

  it("gates advanced on any of ems.view / lca.view / ai.settings.manage, never on carbon.view alone", () => {
    expect(resolveBoardNav(contextWith(["carbon.view"])).map((i) => i.id)).not.toContain("advanced");
    expect(resolveBoardNav(contextWith(["ems.view"])).map((i) => i.id)).toContain("advanced");
    expect(resolveBoardNav(contextWith(["lca.view"])).map((i) => i.id)).toContain("advanced");
    expect(resolveBoardNav(contextWith(["ai.settings.manage"])).map((i) => i.id)).toContain("advanced");
  });

  it("filters each item by its own permission, not a blanket grant", () => {
    const carbonOnly = resolveBoardNav(contextWith(["carbon.view"]));
    expect(carbonOnly.map((item) => item.id).sort()).toEqual(["entry", "evidence", "overview", "reports"]);
  });

  it("leaves every candidate href untouched — no not-yet-built route overrides remain", () => {
    const nav = resolveBoardNav(
      contextWith(["carbon.view", "carbon.factor.view", "lca.view", "ems.view", "ai.settings.manage"]),
    );
    expect(nav.find((i) => i.id === "overview")?.href).toBe("/");
    expect(nav.find((i) => i.id === "entry")?.href).toBe("/entry");
    expect(nav.find((i) => i.id === "factors")?.href).toBe("/admin/factors");
    expect(nav.find((i) => i.id === "evidence")?.href).toBe("/documents");
    expect(nav.find((i) => i.id === "reports")?.href).toBe("/reports");
    expect(nav.find((i) => i.id === "advanced")?.href).toBe("/advanced");
  });
});

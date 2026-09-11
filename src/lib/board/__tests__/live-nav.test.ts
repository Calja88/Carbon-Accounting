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

  it("includes overview and attention once carbon.view is granted — BD05 built both routes", () => {
    const nav = resolveBoardNav(contextWith(["carbon.view", "lca.view", "ems.view"]));
    expect(nav.map((item) => item.id)).toContain("overview");
    expect(nav.map((item) => item.id)).toContain("attention");
  });

  it("gates overview/attention on carbon.view, same as carbon itself", () => {
    const noCarbon = resolveBoardNav(contextWith(["ems.view"]));
    expect(noCarbon.map((item) => item.id)).not.toContain("overview");
    expect(noCarbon.map((item) => item.id)).not.toContain("attention");
  });

  it("filters each item by its own permission, not a blanket grant", () => {
    const carbonOnly = resolveBoardNav(contextWith(["carbon.view"]));
    expect(carbonOnly.map((item) => item.id).sort()).toEqual(["attention", "carbon", "overview"]);
  });

  it("gates every ems.* nav item on ems.view, matching the previous top nav's EMS gate", () => {
    const nav = resolveBoardNav(contextWith(["ems.view"]));
    const ids = nav.map((item) => item.id);
    for (const id of ["aspects", "compliance", "objectives", "audits", "nonconformities", "evidence", "packs"]) {
      expect(ids).toContain(id);
    }
    expect(ids).not.toContain("carbon");
    expect(ids).not.toContain("products");
  });

  it("gates admin on the same platform-admin permissions as the previous top nav", () => {
    expect(resolveBoardNav(contextWith(["carbon.factor.view"])).map((i) => i.id)).toContain("admin");
    expect(resolveBoardNav(contextWith(["ai.settings.manage"])).map((i) => i.id)).toContain("admin");
    expect(resolveBoardNav(contextWith(["ems.view"])).map((i) => i.id)).not.toContain("admin");
  });

  it("redirects the not-yet-built evidence/packs hrefs to routes that exist on this branch", () => {
    const nav = resolveBoardNav(contextWith(["ems.view"]));
    expect(nav.find((i) => i.id === "evidence")?.href).toBe("/ems/evidence");
    expect(nav.find((i) => i.id === "packs")?.href).toBe("/ems/management-reviews");
  });

  it("leaves every other candidate href untouched", () => {
    const nav = resolveBoardNav(contextWith(["carbon.view", "lca.view"]));
    expect(nav.find((i) => i.id === "carbon")?.href).toBe("/carbon");
    expect(nav.find((i) => i.id === "products")?.href).toBe("/assessments");
  });
});

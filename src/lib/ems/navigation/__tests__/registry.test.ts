import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import type { OrganisationContext } from "@/lib/organisation/context";
import { isKnownPermissionCode } from "@/lib/rbac/permission-catalogue";
import { EMS_MODULES, getVisibleEmsModules, isAvailable } from "@/lib/ems/navigation/registry";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../");

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

describe("EMS module registry", () => {
  it("has no duplicate module ids", () => {
    const ids = EMS_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points every 'available' entry at a page file that actually exists on disk", () => {
    // Guards against exactly the failure UI00 found: a page that exists in
    // the tree but was never linked from anywhere, so it silently became
    // unreachable. Every entry claiming to be available must resolve to a
    // real file, or this test — not a manual nav audit — catches it.
    for (const entry of EMS_MODULES) {
      if (!isAvailable(entry)) continue;
      const fullPath = path.join(REPO_ROOT, entry.pageFile);
      expect(existsSync(fullPath), `${entry.id}: expected ${entry.pageFile} to exist`).toBe(true);
      expect(entry.href.startsWith("/ems")).toBe(true);
    }
  });

  it("declares only known permission codes", () => {
    for (const entry of EMS_MODULES) {
      if (entry.permission) {
        expect(isKnownPermissionCode(entry.permission)).toBe(true);
      }
    }
  });

  it("every 'planned' entry names the task expected to build it", () => {
    for (const entry of EMS_MODULES) {
      if (entry.status === "planned") {
        expect(entry.plannedTask.length).toBeGreaterThan(0);
      }
    }
  });

  describe("getVisibleEmsModules", () => {
    it("hides everything without ems.view", () => {
      expect(getVisibleEmsModules(context())).toEqual([]);
    });

    it("shows every module once ems.view is granted, except ones gated on a further permission", () => {
      const visible = getVisibleEmsModules(context({ permissions: new Set(["ems.view"]) }));
      const visibleIds = new Set(visible.map((m) => m.id));
      expect(visibleIds.has("processes")).toBe(true);
      expect(visibleIds.has("legal-provider-health")).toBe(false);
      expect(visible.length).toBe(EMS_MODULES.length - 1);
    });

    it("shows a permission-gated module once its extra permission is also granted", () => {
      const visible = getVisibleEmsModules(
        context({ permissions: new Set(["ems.view", "ems.legal_source.manage"]) }),
      );
      expect(visible.some((m) => m.id === "legal-provider-health")).toBe(true);
    });
  });
});

import { describe, expect, it } from "vitest";
import { CARBON_LIFECYCLE_ITEMS, EMS_ITEM } from "../nav-links";
import { EMS_MODULES, isAvailable } from "@/lib/ems/navigation/registry";

describe("top navigation", () => {
  it("no longer lists individual EMS routes in the Carbon & Lifecycle group", () => {
    // UI01: EMS routes are discoverable through the single /ems hub, not
    // scattered across the nav's other groups — that scattering is what let
    // several implemented routes (T46/T50/T52/T63) go unlinked in the first
    // place (Docs/EMS_UI_COVERAGE.md).
    const hrefs = CARBON_LIFECYCLE_ITEMS.map((item) => item.href);
    for (const href of hrefs) {
      expect(href.startsWith("/ems")).toBe(false);
    }
  });

  it("groups every carbon/LCA top-level route under Carbon & Lifecycle", () => {
    const hrefs = CARBON_LIFECYCLE_ITEMS.map((item) => item.href);
    for (const href of ["/", "/entry", "/documents", "/reports", "/products", "/assessments", "/suppliers", "/methodologies", "/help/lca"]) {
      expect(hrefs).toContain(href);
    }
  });

  it("exposes exactly one EMS entry point, pointing at the landing page", () => {
    expect(EMS_ITEM.href).toBe("/ems");
  });

  it("every available EMS module route is reachable from the /ems hub, which every user with ems.view can reach", () => {
    const availableHrefs = EMS_MODULES.filter(isAvailable).map((m) => m.href);
    expect(availableHrefs.length).toBeGreaterThan(0);
    for (const href of availableHrefs) {
      expect(href.startsWith("/ems/")).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import { BASE_ITEMS, EMS_ITEM, MORE_ITEMS } from "../nav-links";
import { EMS_MODULES, isAvailable } from "@/lib/ems/navigation/registry";

describe("top navigation", () => {
  it("no longer lists individual EMS routes in the main row or More menu", () => {
    // UI01: EMS routes are discoverable through the single /ems hub, not
    // scattered across BASE_ITEMS/MORE_ITEMS — that scattering is what let
    // several implemented routes (T46/T50/T52/T63) go unlinked in the first
    // place (Docs/EMS_UI_COVERAGE.md).
    const hrefs = [...BASE_ITEMS, ...MORE_ITEMS].map((item) => item.href);
    for (const href of hrefs) {
      expect(href.startsWith("/ems")).toBe(false);
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

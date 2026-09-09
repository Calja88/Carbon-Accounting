import { test, expect } from "@playwright/test";
import path from "path";
import { hiddenModulesFor, type PersonaKey } from "./personas";

const authDir = path.join(__dirname, ".auth");

/**
 * UI14: direct-URL access to a module a persona's role does not grant must
 * never blank/500 — it must redirect away cleanly (requireOrganisationContext
 * + requirePermission's documented behaviour, PHASE1_TENANCY_RBAC_SPEC.md §7).
 * Covers "tenant ID substitution"/RBAC-boundary smoke for the critical-flow
 * gate without needing a second organisation fixture.
 */
const PERSONAS_WITH_GAPS: PersonaKey[] = ["contributor", "readOnly", "restrictedSite"];

for (const persona of PERSONAS_WITH_GAPS) {
  test.describe(`${persona} — denied-module direct access`, () => {
    test.use({ storageState: path.join(authDir, `${persona}.json`) });

    const denied = hiddenModulesFor(persona).slice(0, 3);
    for (const mod of denied) {
      test(`${mod.href} does not render its content for ${persona}`, async ({ page }) => {
        const response = await page.goto(mod.href);
        expect(response?.status(), `${mod.href} must not 500 for a denied ${persona}`).toBeLessThan(500);
        await expect(page).not.toHaveURL(mod.href);
        await expect(page.getByText(/application error/i)).toHaveCount(0);
      });
    }
  });
}

test.describe("suspended membership", () => {
  test.use({ storageState: path.join(authDir, "suspended.json") });

  test("cannot reach the EMS hub after suspension", async ({ page }) => {
    const response = await page.goto("/ems");
    expect(response?.status()).toBeLessThan(500);
    await expect(page).not.toHaveURL("/ems");
    await expect(page.getByText(/application error/i)).toHaveCount(0);
  });
});

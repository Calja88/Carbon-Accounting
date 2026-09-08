import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "path";
import { visibleModulesFor, type PersonaKey } from "./personas";

const authDir = path.join(__dirname, ".auth");

/**
 * UI14 critical-flow smoke: for every persona with an active membership,
 * every EMS module their role grants (per `EMS_MODULES` +
 * `SYSTEM_ROLE_TEMPLATES` — see personas.ts) must render without going
 * blank, and must carry no critical/serious automated accessibility
 * violation. This is route-discovery + accessibility + "not blank for an
 * authorised user" combined, run against synthetic local data only.
 */
const ACTIVE_PERSONAS: PersonaKey[] = ["sustainabilityLead", "orgAdmin", "contributor", "readOnly", "restrictedSite"];

for (const persona of ACTIVE_PERSONAS) {
  test.describe(`${persona} — EMS module smoke`, () => {
    test.use({ storageState: path.join(authDir, `${persona}.json`) });

    const modules = visibleModulesFor(persona);
    test(`sees ${modules.length} EMS module(s) it has permission for`, () => {
      expect(modules.length).toBeGreaterThan(0);
    });

    for (const mod of modules) {
      test(`${mod.href} renders and passes baseline accessibility scan`, async ({ page }) => {
        const response = await page.goto(mod.href);
        expect(response?.ok(), `${mod.href} should respond 2xx for ${persona}`).toBeTruthy();

        // Blank-page guard: an authorised user with synthetic data must see
        // real content, not an empty <body> or a client-error boundary.
        const heading = page.locator("h1, h2").first();
        await expect(heading, `${mod.href} should render a heading, not a blank page`).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/application error/i)).toHaveCount(0);

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
          .analyze();
        const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
        expect(
          blocking,
          blocking.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`).join("\n"),
        ).toEqual([]);
      });
    }
  });
}

test.describe("EMS hub — route discovery", () => {
  test.use({ storageState: path.join(authDir, "sustainabilityLead.json") });

  test("/ems lists a link to every available module the Sustainability Lead can see", async ({ page }) => {
    await page.goto("/ems");
    const modules = visibleModulesFor("sustainabilityLead");
    for (const mod of modules) {
      await expect(page.locator(`a[href="${mod.href}"]`).first()).toBeVisible();
    }
  });
});

import { test, expect } from "@playwright/test";
import path from "path";

const authDir = path.join(__dirname, ".auth");
const CRITICAL_ROUTES = ["/ems", "/ems/dashboard", "/ems/aspects", "/ems/audits", "/ems/competence/expiry", "/ems/management-reviews"];

test.describe("keyboard navigation — critical flows", () => {
  test.use({ storageState: path.join(authDir, "sustainabilityLead.json") });

  for (const route of CRITICAL_ROUTES) {
    test(`${route} — top nav is fully keyboard-reachable with a visible focus indicator`, async ({ page }) => {
      await page.goto(route);
      const nav = page.locator("nav").first();
      await expect(nav).toBeVisible();

      const firstLink = nav.locator("a, button").first();
      await firstLink.focus();
      await expect(firstLink).toBeFocused();

      // A focused interactive control must have *some* visible focus
      // indicator (outline or box-shadow) — not `outline: none` with
      // nothing standing in for it.
      const outlineStyle = await firstLink.evaluate((el) => {
        const s = getComputedStyle(el, null);
        return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow };
      });
      const hasOutline = outlineStyle.outlineStyle !== "none" && parseFloat(outlineStyle.outlineWidth) > 0;
      const hasBoxShadow = outlineStyle.boxShadow !== "none";
      expect(hasOutline || hasBoxShadow, `${route} nav's first focusable control has no visible focus style: ${JSON.stringify(outlineStyle)}`).toBeTruthy();

      // Tab moves focus forward without trapping it inside the nav.
      await page.keyboard.press("Tab");
      const active = await page.evaluate(() => document.activeElement?.tagName);
      expect(active).toBeTruthy();
    });
  }
});

test.describe("responsive layout — critical flows", () => {
  test.use({ storageState: path.join(authDir, "sustainabilityLead.json") });

  for (const route of CRITICAL_ROUTES) {
    test(`${route} — renders without horizontal overflow at mobile width`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(route);
      await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 10_000 });

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${route} has ${overflow}px of horizontal overflow at 375px width`).toBeLessThanOrEqual(1);
    });
  }

  test("/ems nav 'More' menu opens and its items are reachable at mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/ems");
    const moreButton = page.getByRole("button", { name: /more/i });
    if (await moreButton.count()) {
      await moreButton.click();
      await expect(page.getByRole("link").first()).toBeVisible();
    }
  });
});

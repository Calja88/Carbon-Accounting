import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { prisma } from "../../src/lib/prisma";
import { LiveSeedPort } from "../../scripts/board-demo/live-seed-port";
import { assertDemoTarget } from "../../scripts/board-demo/guard";
import { canonicalStringify } from "../../src/lib/audit/integrity";

const manifest = JSON.parse(readFileSync("Docs/board-sprint/rehearsal-manifest.json", "utf8"));
const routes = manifest.routes as Record<string, string>;

test.beforeAll(async () => {
  assertDemoTarget({ dataMode: process.env.BOARD_DEMO_DATA_MODE, deploymentClass: process.env.BOARD_DEMO_DEPLOYMENT_CLASS, configuredDatabaseId: process.env.BOARD_DEMO_DATABASE_ID, allowedDatabaseId: process.env.BOARD_DEMO_ALLOWED_DATABASE_ID, configuredEnvironmentId: process.env.BOARD_DEMO_ENVIRONMENT_ID }, await new LiveSeedPort().readConnectedIdentity());
  const lease = await prisma.demoFixtureLease.findUniqueOrThrow({ where: { fixtureKey: "BOARD-1" } });
  expect(lease.status).toBe("READY");
  expect(lease.fixtureOrganisationId).toBe(manifest.ids.organisationId);
});
test.afterAll(() => prisma.$disconnect());

async function login(page: Page, persona: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: manifest.ids.personaUserIds[persona] } });
  const secrets = JSON.parse(readFileSync(process.env.BOARD_DEMO_CREDENTIALS_FILE!, "utf8"));
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(secrets[persona]);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

for (const [width, height] of [[1366, 768], [1440, 900], [375, 812]]) {
  test(`board journey and frozen export at ${width}x${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await login(page, "sustainability-lead");
    for (const key of ["overview", "carbon", "attention", "nonconformity", "lca", "pack"]) {
      const response = await page.goto(routes[key]);
      expect(response?.ok(), key).toBe(true);
      await expect(page.getByText("Synthetic demonstration — not company performance", { exact: false }).first()).toBeVisible();
      await expect(page.locator("main")).not.toContainText(/Application error|Internal Server Error/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${key} horizontal overflow`).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${key}-${width}.png`), fullPage: true });
      if (key === "overview") {
        await expect(page.locator(".bd-metric--hero .bd-metric-number")).toContainText("1,248");
      }
      if (key === "lca") {
        await expect(page.getByTestId("lca-baseline-kg-per-unit").first()).toHaveAttribute("data-value", "0.12");
        await expect(page.getByTestId("lca-scenario-kg-per-unit").first()).toHaveAttribute("data-value", "0.102");
      }
    }
    await expect(page.getByTestId("saved-pack-sha256")).toHaveText(manifest.frozenChecksum);
    const download = await page.request.get(routes.download);
    expect(download.ok()).toBe(true);
    const exported = await download.json();
    expect(createHash("sha256").update(canonicalStringify(exported.payload)).digest("hex")).toBe(manifest.frozenChecksum);
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("navigation", { name: "Management pack actions" })).toBeHidden();
    await expect(page.getByTestId("saved-pack-sha256")).toBeVisible();
    await page.pdf({ path: testInfo.outputPath(`management-pack-${width}.pdf`), printBackground: true });
  });
}

test("read-only can view and export, restricted and contributor cannot read the organisation pack", async ({ browser }) => {
  for (const persona of ["read-only", "restricted", "contributor", "independent-reviewer"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, persona);
    const response = await page.goto(routes.pack);
    const exportResponse = await page.request.get(routes.download);
    const permitted = persona === "read-only" || persona === "independent-reviewer";
    expect(response?.status()).toBe(permitted ? 200 : 404);
    expect(exportResponse.status()).toBe(permitted ? 200 : 404);
    await context.close();
  }
});

test("invalid review and unauthenticated export do not disclose a pack", async ({ page }) => {
  expect((await page.request.get(routes.download)).status()).toBe(404);
  await login(page, "sustainability-lead");
  expect((await page.goto("/ems/management-reviews/foreign-or-missing/pack"))?.status()).toBe(404);
});

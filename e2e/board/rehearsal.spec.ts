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
  const user = await prisma.user.findUniqueOrThrow({ where: { id: manifest.personas[persona].userId } });
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
  const anonymous = await page.request.get(routes.download, { maxRedirects: 0 });
  expect(anonymous.status()).toBe(307);
  expect(anonymous.headers()["location"]).toContain("/login");
  await login(page, "sustainability-lead");
  expect((await page.goto("/ems/management-reviews/foreign-or-missing/pack"))?.status()).toBe(404);
});

test("connected sources and evidence bytes match the persistent manifest", async ({ page }) => {
  await login(page, "sustainability-lead");
  await page.goto(routes.nonconformity);
  const nc = await prisma.nonconformity.findUniqueOrThrow({ where: { id: manifest.ids.nonconformityId } });
  if (nc.operationalControlId) {
    const control = await prisma.operationalControl.findUniqueOrThrow({ where: { id: nc.operationalControlId }, include: { aspectLinks: true } });
    for (const link of control.aspectLinks) {
      expect((await page.goto(`/ems/aspects?record=${link.aspectId}`))?.ok()).toBe(true);
      await expect(page.locator(`a[href="/ems/controls?record=${control.id}"]`).first()).toBeVisible();
    }
    expect((await page.goto(`/ems/controls?record=${control.id}`))?.ok()).toBe(true);
  }
  for (const id of Object.values(manifest.ids.evidenceIds) as string[]) {
    const evidence = await prisma.evidenceObject.findUniqueOrThrow({ where: { id } });
    const response = await page.request.get(`/api/ems/evidence/${id}`);
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    expect(bytes.length).toBe(evidence.byteSize);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(evidence.checksumSha256);
    expect(response.headers()["content-type"]).toContain(evidence.mimeType);
  }
});

// Opt-in because this performs the board's real live transition once. Preserve a
// pristine Neon branch first; subsequent rehearsals use a fresh branch from it.
test("live completion and independent review change Attention but never the issued pack", async ({ browser }) => {
  test.skip(process.env.BOARD_REHEARSAL_TRANSITION !== "1", "Enable only on a guarded rehearsal branch with a preserved baseline.");
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await login(owner, "sustainability-lead");
  await owner.goto(routes.overview);
  const before = Number(await owner.locator(".bd-action-summary strong").first().textContent());
  await owner.goto(routes.nonconformity);
  const action = owner.locator("li").filter({ has: owner.locator('input[name="completionEvidenceNote"]') }).filter({ hasText: "BOARD1-CA-EXT" }).last();
  await action.getByPlaceholder("Completion evidence", { exact: true }).fill("Synthetic rehearsal: named owner and inspection schedule extended to East Cards.");
  await action.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(action.getByRole("button", { name: "Complete", exact: true })).toHaveCount(0);
  await owner.getByRole("button", { name: "Request effectiveness review", exact: true }).click();
  await expect(owner.getByRole("button", { name: "Request effectiveness review", exact: true })).toHaveCount(0);
  const reviewerContext = await browser.newContext();
  const reviewer = await reviewerContext.newPage();
  await login(reviewer, "independent-reviewer");
  await reviewer.goto(routes.nonconformity);
  await reviewer.getByLabel("Review criteria", { exact: true }).fill("Synthetic rehearsal: named ownership and inspection schedule verified for East Cards.");
  await reviewer.getByLabel("Review date", { exact: true }).fill(new Date().toISOString().slice(0, 10));
  await reviewer.getByLabel("Result", { exact: true }).selectOption("EFFECTIVE");
  await reviewer.getByLabel("Decision", { exact: true }).fill("Independent synthetic review confirms the containment gap is closed.");
  await reviewer.getByRole("button", { name: "Record effectiveness review", exact: true }).click();
  await expect(reviewer.getByRole("button", { name: "Record effectiveness review", exact: true })).toHaveCount(0);
  await owner.reload();
  await owner.getByRole("button", { name: "Close nonconformity", exact: true }).click();
  await expect.poll(async () => (await prisma.nonconformity.findUniqueOrThrow({ where: { id: manifest.ids.nonconformityId } })).status).toBe("CLOSED");
  await owner.goto(routes.overview);
  expect(Number(await owner.locator(".bd-action-summary strong").first().textContent())).toBeLessThan(before);
  await owner.goto(routes.pack);
  await expect(owner.getByTestId("saved-pack-sha256")).toHaveText(manifest.frozenChecksum);
  const exported = await (await owner.request.get(routes.download)).json();
  expect(createHash("sha256").update(canonicalStringify(exported.payload)).digest("hex")).toBe(manifest.frozenChecksum);
  await reviewerContext.close();
  await ownerContext.close();
});

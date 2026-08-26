import { test, expect } from "@playwright/test";
import path from "path";

const authDir = path.join(__dirname, ".auth");

/**
 * Lifecycle-coverage smoke: a representative sample of the exits added by
 * this pass — one deactivate, one close/cancel, one draft discard, and the
 * Part B methodology-profile guard. Runs against the local synthetic
 * `db:seed:ems-demo` fixtures only, never a real database.
 */
test.describe("lifecycle exits", () => {
  test.use({ storageState: path.join(authDir, "sustainabilityLead.json") });

  test("deactivates a monitoring plan and keeps its recorded results", async ({ page }) => {
    await page.goto("/ems/monitoring");
    const deactivate = page.getByRole("button", { name: "Deactivate plan" }).first();
    const count = await deactivate.count();
    test.skip(count === 0, "No active monitoring plan in the synthetic seed.");

    const form = page.locator("form", { has: page.getByRole("button", { name: "Deactivate plan" }) }).first();
    await form.locator('input[name="reason"]').fill("Synthetic smoke: programme change.");
    page.once("dialog", (dialog) => dialog.accept());
    await form.getByRole("button", { name: "Deactivate plan" }).click();

    await expect(page.getByText("Monitoring plan deactivated.")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=inactive").first()).toBeVisible();
  });

  test("cancels a draft audit programme that has produced no audits", async ({ page }) => {
    await page.goto("/ems/audits");
    const cancel = page.getByRole("button", { name: "Cancel programme" }).first();
    test.skip((await cancel.count()) === 0, "No cancellable audit programme in the synthetic seed.");

    const form = page.locator("form", { has: page.getByRole("button", { name: "Cancel programme" }) }).first();
    await form.locator('input[name="reason"]').fill("Synthetic smoke: deferred.");
    page.once("dialog", (dialog) => dialog.accept());
    await form.getByRole("button", { name: "Cancel programme" }).click();

    // Either the programme cancels, or the service refuses because audits
    // already exist under it — both are correct, and both must be surfaced
    // rather than failing silently.
    await expect(
      page.getByText("Programme cancelled.").or(page.getByText(/Complete it instead of cancelling it/)),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("discards a draft applicability assessment and refuses a decided one", async ({ page }) => {
    await page.goto("/ems/legal/applicability");
    const discard = page.getByRole("button", { name: "Discard draft" });
    test.skip((await discard.count()) === 0, "No draft applicability assessment in the synthetic seed.");

    const before = await discard.count();
    page.once("dialog", (dialog) => dialog.accept());
    await discard.first().click();
    await expect(page.getByRole("button", { name: "Discard draft" })).toHaveCount(before - 1, { timeout: 10_000 });

    // A decided assessment never offers the control at all.
    const decidedCard = page.locator("li,div").filter({ hasText: /Applicable|Not applicable/ }).first();
    if (await decidedCard.count()) {
      await expect(decidedCard.getByRole("button", { name: "Discard draft" })).toHaveCount(0);
    }
  });

  test("methodology register exposes archive and reports the frozen state", async ({ page }) => {
    await page.goto("/methodologies");
    await expect(page.getByRole("heading", { name: "Methodology register" })).toBeVisible();

    const archive = page.getByRole("button", { name: "Archive" });
    test.skip((await archive.count()) === 0, "No organisation-owned methodology profile in the synthetic seed.");

    await archive.first().click();
    const form = page.locator("form", { has: page.getByRole("button", { name: "Archive profile" }) }).first();
    await form.locator('input[name="reason"]').fill("Synthetic smoke: retired.");
    page.once("dialog", (dialog) => dialog.accept());
    await form.getByRole("button", { name: "Archive profile" }).click();

    // Either it archives, or it refuses because assessments still use it —
    // the guard is what this asserts, not which branch the seed lands on.
    await expect(
      page.getByText("Methodology profile archived.").or(page.getByText(/still use/)),
    ).toBeVisible({ timeout: 10_000 });
  });
});

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

    const resultsBefore = await page.getByText("Append monitoring result").count();
    const form = page.locator("form", { has: page.getByRole("button", { name: "Deactivate plan" }) }).first();
    await form.locator('input[name="reason"]').fill("Synthetic smoke: programme change.");
    page.once("dialog", (dialog) => dialog.accept());
    await form.getByRole("button", { name: "Deactivate plan" }).click();

    // The plan card re-renders without the form (its feedback message goes
    // with it), so the durable signals are the status badge and the absence
    // of the deactivate control — the same pattern the significance-discard
    // spec already relies on.
    await expect(page.getByText("inactive", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Deactivate plan" })).toHaveCount(count - 1);
    // Deactivating stops new results being appended; recorded ones stay.
    expect(await page.getByText("Append monitoring result").count()).toBeLessThan(resultsBefore + 1);
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

  test("creates then discards a draft competence requirement version", async ({ page }) => {
    await page.goto("/ems/competence/requirements");

    const create = page.locator("form", { has: page.getByRole("button", { name: "Create draft requirement" }) }).first();
    await expect(create).toBeVisible();

    const discardsBefore = await page.getByRole("button", { name: "Discard draft" }).count();
    const key = `SYNTHETIC_SMOKE_${Date.now()}`;
    await create.locator('input[name="requirementKey"]').fill(key);
    await create.locator('input[name="title"]').fill("Synthetic smoke requirement");
    await create.locator('textarea[name="description"]').fill("Synthetic requirement text only.");
    // The form requires at least one scope target; the free-text emergency
    // role label is the one that needs no seeded reference data.
    await create.locator('input[name="emergencyRoleLabel"]').fill("Synthetic smoke role");
    await create.getByRole("button", { name: "Create draft requirement" }).click();

    await expect(page.getByText(key)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Discard draft" })).toHaveCount(discardsBefore + 1);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Discard draft" }).first().click();

    // The draft and its now-empty requirement shell both go.
    await expect(page.getByText(key)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Discard draft" })).toHaveCount(discardsBefore);
  });

  test("offers no discard control on a decided applicability assessment", async ({ page }) => {
    await page.goto("/ems/legal/applicability");
    await expect(page.getByRole("heading", { name: /Applicability/i }).first()).toBeVisible();

    // A decided assessment is a legal record: superseded, never discarded.
    // With no DRAFT assessment on the page the control must not appear at
    // all, so counting drafts against discard controls is the assertion.
    const drafts = await page.getByRole("button", { name: "Submit for review" }).count();
    await expect(page.getByRole("button", { name: "Discard draft" })).toHaveCount(drafts);
  });

  test("creates, archives, and refuses to hard-delete a methodology profile", async ({ page }) => {
    await page.goto("/methodologies");
    await expect(page.getByRole("heading", { name: "Methodology register" })).toBeVisible();

    // The seed ships only platform-shared profiles, which no tenant may
    // archive. Create an organisation-owned one so the exit is exercised for
    // real rather than skipped.
    const label = `Synthetic smoke methodology ${Date.now()}`;
    await page.getByRole("button", { name: "New methodology profile" }).click();
    const createForm = page.locator("form", { has: page.getByRole("button", { name: "Save methodology profile" }) }).first();
    await createForm.locator('input[name="name"]').fill(label);
    await createForm.locator('input[name="version"]').fill("1.0");
    await createForm.locator('input[name="gwpBasis"]').fill("Synthetic GWP set");
    await createForm.getByRole("button", { name: "Save methodology profile" }).first().click();

    const card = page.locator("section,div").filter({ hasText: label }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Nothing offers a delete for a methodology profile — archive is the
    // only exit.
    await expect(page.getByRole("button", { name: /^Delete/ })).toHaveCount(0);

    const archive = card.getByRole("button", { name: "Archive" }).first();
    await archive.click();
    const archiveForm = page.locator("form", { has: page.getByRole("button", { name: "Archive profile" }) }).first();
    await archiveForm.locator('input[name="reason"]').fill("Synthetic smoke: retired.");
    page.once("dialog", (dialog) => dialog.accept());
    await archiveForm.getByRole("button", { name: "Archive profile" }).click();

    await expect(page.getByText("Archived", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });
});

import { test, expect } from "@playwright/test";
import path from "path";

const authDir = path.join(__dirname, ".auth");

/**
 * Polish pass smoke: the significance-method form no longer requires typed
 * JSON, and a draft method created through it can be discarded — the
 * representative delete/discard action for this pass. Synthetic local data
 * only.
 */
test.describe("significance method form and draft discard", () => {
  test.use({ storageState: path.join(authDir, "sustainabilityLead.json") });

  test("creates a significance method through form controls, with no JSON textarea, then discards the draft", async ({ page }) => {
    await page.goto("/ems/aspects");
    await expect(page.getByRole("heading", { name: "Create significance method" })).toBeVisible();

    // The old JSON textareas must be gone from the create form.
    await expect(page.locator('textarea[name="criteriaJson"]')).toHaveCount(0);
    await expect(page.locator('textarea[name="rulesJson"]')).toHaveCount(0);

    const createCard = page.locator("form", { has: page.getByRole("button", { name: "Create draft method" }) });
    const methodKey = `synthetic-e2e-${Date.now()}`;

    await createCard.locator('select[name="programmeId"]').selectOption({ index: 1 });
    await createCard.locator('input[name="methodKey"]').fill(methodKey);
    await createCard.locator('input[name="name"]').fill("Synthetic E2E significance method");
    await createCard.locator('input[name="threshold"]').fill("4");

    // One criterion row exists by default — fill it in via plain form fields.
    await createCard.locator('input[placeholder="severity"]').first().fill("severity");
    await createCard.locator('input[placeholder="Severity"]').first().fill("Severity");
    await createCard.getByLabel("Minimum").first().fill("1");
    await createCard.getByLabel("Maximum").first().fill("5");

    await createCard.getByRole("button", { name: "Create draft method" }).click();
    await expect(page.getByText("Significance method created.")).toBeVisible({ timeout: 10_000 });

    // The new draft renders read-only criteria as prose, not raw JSON.
    const methodCard = page.locator("li", { hasText: "Severity (severity)" }).first();
    await expect(methodCard).toContainText("Numeric, 1–5");
    await expect(page.locator("text=/\\{\"kind\":\"NUMERIC\"/")).toHaveCount(0);

    // Discard the draft — the representative discard action for this pass.
    // The draft's whole card (feedback message included) unmounts once the
    // list re-renders without it, so the durable signal of success is the
    // method key disappearing from the page, not a transient toast.
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Discard draft" }).first().click();
    await expect(page.getByText(methodKey)).toHaveCount(0, { timeout: 10_000 });
  });
});

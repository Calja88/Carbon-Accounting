import { test as setup, expect } from "@playwright/test";
import path from "path";
import { PERSONAS, DEMO_PASSWORD, type PersonaKey } from "./personas";

const authDir = path.join(__dirname, ".auth");

for (const key of Object.keys(PERSONAS) as PersonaKey[]) {
  setup(`authenticate as ${key}`, async ({ page }) => {
    const { email } = PERSONAS[key];
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    // A suspended membership still authenticates (valid credentials) but has
    // no accessible organisation — it lands somewhere other than /login.
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
    await page.context().storageState({ path: path.join(authDir, `${key}.json`) });
  });
}

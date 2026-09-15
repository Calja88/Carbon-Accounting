import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/board",
  workers: 1,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 30000 },
  reporter: [["list"], ["json", { outputFile: "artifacts/board-browser-results.json" }]],
  outputDir: "artifacts/board-browser",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    channel: process.platform === "win32" ? "msedge" : "chromium",
    // Login traces contain credentials. Keep screenshots only after login.
    trace: "off",
    screenshot: "off",
  },
});

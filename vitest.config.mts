import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // UI14: Playwright's own spec files (e2e/**) use a `test`/`describe` API
    // that isn't vitest's — they run only via `pnpm run test:e2e`, never here.
    exclude: ["node_modules/**", "e2e/**"],
  },
});

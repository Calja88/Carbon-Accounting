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
    exclude: ["node_modules/**", "e2e/**", "tests/checkpoint-a/postgres.test.ts", "tests/board-product/bd06-chain.test.ts", "tests/board-product/bd08-fixes.test.ts", "tests/board-product/bd08-board1-seed.test.ts", "tests/board-product/checkpoint-b-seed-guard.test.ts", "tests/board-product/checkpoint-b-personas.test.ts", "tests/board-product/checkpoint-b-management-pack.test.ts", "tests/board-product/checkpoint-b-overview.test.ts", "tests/board-product/checkpoint-b-lca-scenarios.test.ts", "tests/board-product/checkpoint-b-ems-chain.test.ts", "tests/board-product/checkpoint-b-coverage.test.ts", "tests/board-product/checkpoint-b-obligation-review.test.ts"],
  },
});

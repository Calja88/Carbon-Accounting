import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { environment: "node", include: ["tests/checkpoint-a/postgres.test.ts", "tests/board-product/bd06-chain.test.ts", "tests/board-product/bd08-fixes.test.ts", "tests/board-product/bd08-board1-seed.test.ts", "tests/board-product/checkpoint-b-seed-guard.test.ts", "tests/board-product/checkpoint-b-personas.test.ts", "tests/board-product/checkpoint-b-management-pack.test.ts", "tests/board-product/checkpoint-b-overview.test.ts", "tests/board-product/checkpoint-b-lca-scenarios.test.ts"], fileParallelism: false, maxWorkers: 1, testTimeout: 30000, hookTimeout: 30000 },
});

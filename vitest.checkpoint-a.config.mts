import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { environment: "node", include: ["tests/checkpoint-a/postgres.test.ts"], fileParallelism: false, maxWorkers: 1, testTimeout: 30000, hookTimeout: 30000 },
});

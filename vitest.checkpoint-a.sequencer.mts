import type { TestSpecification, Vitest } from "vitest/node";

/**
 * Several real-Postgres test files in this suite genuinely depend on
 * running after `bd08-board1-seed.test.ts` (they read the already-built
 * BOARD-1 fixture rather than rebuilding it) — a dependency Vitest's
 * default sequencer does not honour: it does not preserve the `include`
 * array's own order, and empirically reorders files run-to-run once more
 * than a couple of files are listed (confirmed via CI). This sequencer
 * pins that one required ordering explicitly rather than leaving it to
 * chance.
 */
const PRIORITY = [
  "tests/checkpoint-a/postgres.test.ts",
  "tests/board-product/bd06-chain.test.ts",
  "tests/board-product/bd08-fixes.test.ts",
  "tests/board-product/bd08-board1-seed.test.ts",
  "tests/board-product/checkpoint-b-seed-guard.test.ts",
  "tests/board-product/checkpoint-b-personas.test.ts",
  "tests/board-product/checkpoint-b-management-pack.test.ts",
  "tests/board-product/checkpoint-b-overview.test.ts",
  "tests/board-product/checkpoint-b-lca-scenarios.test.ts",
  "tests/board-product/checkpoint-b-ems-chain.test.ts",
  "tests/board-product/checkpoint-b-coverage.test.ts",
];

function priorityOf(moduleId: string): number {
  const index = PRIORITY.findIndex((suffix) => moduleId.endsWith(suffix));
  return index === -1 ? PRIORITY.length : index;
}

export default class CheckpointASequencer {
  constructor(_ctx: Vitest) {}

  async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    return files;
  }

  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => priorityOf(a.moduleId) - priorityOf(b.moduleId));
  }
}

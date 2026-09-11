import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("skips routine builds and allows only the explicit message or force flag", () => {
  for (const [message, force, expected] of [["routine", "", 0], ["fix [vercel deploy]", "", 1], ["routine", "1", 1]] as const) {
    const result = spawnSync(process.execPath, ["scripts/vercel/ignore-build.mjs"], { env: { ...process.env, VERCEL_GIT_COMMIT_MESSAGE: message, BOARD_DEMO_FORCE_DEPLOY: force } });
    expect(result.status).toBe(expected);
  }
});

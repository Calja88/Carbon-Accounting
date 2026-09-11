import { describe, expect, it } from "vitest";
import { decideShouldBuild } from "../lib/should-build.mjs";

describe("decideShouldBuild", () => {
  it("skips a PR/product branch with no force marker", () => {
    const result = decideShouldBuild({
      branch: "board/product-2026-09-22",
      commitMessage: "Add new dashboard widget",
      forceDeployEnv: undefined,
    });

    expect(result.shouldBuild).toBe(false);
    expect(result.reason).toContain("Skipping Vercel build");
    expect(result.reason).toContain("board/product-2026-09-22");
  });

  it("allows a build when the commit message contains [vercel deploy]", () => {
    const result = decideShouldBuild({
      branch: "board/product-2026-09-22",
      commitMessage: "Fix layout bug [vercel deploy]",
      forceDeployEnv: undefined,
    });

    expect(result.shouldBuild).toBe(true);
    expect(result.reason).toContain("[vercel deploy]");
  });

  it("allows a build when FORCE_VERCEL_DEPLOY=1 is set", () => {
    const result = decideShouldBuild({
      branch: "board/product-2026-09-22",
      commitMessage: "Routine commit",
      forceDeployEnv: "1",
    });

    expect(result.shouldBuild).toBe(true);
    expect(result.reason).toContain("FORCE_VERCEL_DEPLOY=1");
  });

  it("allows a build on an approved base branch", () => {
    for (const branch of ["main", "production", "claude/paragon-id-uk-carbon-mvp-1h1uvb"]) {
      const result = decideShouldBuild({
        branch,
        commitMessage: "Routine commit",
        forceDeployEnv: undefined,
      });

      expect(result.shouldBuild).toBe(true);
      expect(result.reason).toContain("approved deploy branch");
    }
  });

  it("skips when branch is missing/unknown rather than throwing", () => {
    const result = decideShouldBuild({});

    expect(result.shouldBuild).toBe(false);
    expect(result.reason).toContain("unknown branch");
  });
});

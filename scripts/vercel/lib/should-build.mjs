/**
 * Decision logic for whether a Vercel build should proceed.
 *
 * Pulled out of ignore-build.mjs so it can be unit tested without needing to
 * spawn the script itself. Vercel's "Ignored Build Step" convention is:
 *   exit code 0  -> skip / ignore the build
 *   exit code 1  -> continue with the build
 * This module returns a plain decision object; ignore-build.mjs is the only
 * place that translates it into a process.exit() call.
 */

// Branches that are always allowed to deploy on Vercel, regardless of commit
// message or env vars. Keep this list short and deliberate.
export const APPROVED_DEPLOY_BRANCHES = [
  "main",
  "production",
  "claude/paragon-id-uk-carbon-mvp-1h1uvb",
];

const FORCE_MARKER = "[vercel deploy]";

/**
 * @param {object} input
 * @param {string} [input.branch] - e.g. VERCEL_GIT_COMMIT_REF
 * @param {string} [input.commitMessage] - e.g. VERCEL_GIT_COMMIT_MESSAGE
 * @param {string} [input.forceDeployEnv] - e.g. FORCE_VERCEL_DEPLOY
 * @returns {{ shouldBuild: boolean, reason: string }}
 */
export function decideShouldBuild({ branch, commitMessage, forceDeployEnv } = {}) {
  const normalizedBranch = (branch ?? "").trim();
  const normalizedMessage = commitMessage ?? "";

  if (forceDeployEnv === "1") {
    return {
      shouldBuild: true,
      reason: "Allowing Vercel build because FORCE_VERCEL_DEPLOY=1 is set.",
    };
  }

  if (normalizedMessage.includes(FORCE_MARKER)) {
    return {
      shouldBuild: true,
      reason: `Allowing Vercel build because commit message contains ${FORCE_MARKER}.`,
    };
  }

  if (APPROVED_DEPLOY_BRANCHES.includes(normalizedBranch)) {
    return {
      shouldBuild: true,
      reason: `Allowing Vercel build because "${normalizedBranch}" is an approved deploy branch.`,
    };
  }

  const branchLabel = normalizedBranch || "(unknown branch)";
  return {
    shouldBuild: false,
    reason: `Skipping Vercel build for branch ${branchLabel}. Add ${FORCE_MARKER} to the commit message to force.`,
  };
}

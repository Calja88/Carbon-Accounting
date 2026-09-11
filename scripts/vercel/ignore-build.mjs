#!/usr/bin/env node
/**
 * Vercel "Ignored Build Step" script.
 *
 * Configure this in the Vercel dashboard under:
 *   Project -> Settings -> Git -> Ignored Build Step
 * as:
 *   node scripts/vercel/ignore-build.mjs
 *
 * Vercel's convention for this hook is inverted from what you might expect:
 *   exit code 0  -> SKIP the build (nothing changed / not wanted)
 *   exit code 1  -> CONTINUE the build
 *
 * By default this skips Vercel builds for every branch except a short list
 * of approved deploy branches, so that ordinary commits/PRs (e.g. from
 * Claude sessions) don't burn Vercel build/function-storage quota. GitHub
 * Actions (.github/workflows/ci.yml) remains the real CI gate — this only
 * controls whether Vercel *also* builds a preview.
 *
 * A build can always be forced by either:
 *   - including "[vercel deploy]" in the commit message, or
 *   - setting the FORCE_VERCEL_DEPLOY=1 environment variable on the project
 *     (or a specific deployment).
 *
 * This script never throws before making a decision: if anything is
 * unexpected it falls back to reading empty/undefined env vars, which
 * resolves to "skip" for non-approved branches - it does not fail closed in
 * a way that blocks an approved branch from deploying.
 */

import { decideShouldBuild } from "./lib/should-build.mjs";

function main() {
  const { shouldBuild, reason } = decideShouldBuild({
    branch: process.env.VERCEL_GIT_COMMIT_REF,
    commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE,
    forceDeployEnv: process.env.FORCE_VERCEL_DEPLOY,
  });

  console.log(reason);

  // Vercel's Ignored Build Step convention: 0 = skip, 1 = continue.
  process.exit(shouldBuild ? 1 : 0);
}

main();

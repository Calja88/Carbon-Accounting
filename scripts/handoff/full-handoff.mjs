#!/usr/bin/env node
/**
 * `npm run handoff:full`
 *
 * Builds a sanitized architecture/source handoff ZIP for external review
 * (Astra/ChatGPT). See Docs/AI_HANDOFF_WORKFLOW.md for when to use this vs.
 * `handoff:review`.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  repoRoot,
  currentBranch,
  headSha,
  isDirty,
  trackedFiles,
  untrackedFiles,
} from "./lib/git.mjs";
import { collectSafeEntries, assertGeneratedContentSafe, SecretScanAbort } from "./lib/collect.mjs";
import { buildManifest } from "./lib/manifest.mjs";
import { createZip } from "./lib/zip.mjs";

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(
    d.getUTCHours(),
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

async function main() {
  const root = repoRoot();
  const branch = currentBranch();
  const head = headSha();
  const dirty = isDirty();
  const ts = timestamp();

  // Tracked + legitimate untracked (git-ignore-aware, so build output and
  // secrets that are already gitignored never even reach the exclusion
  // filter) — the full set of "what does this repository currently look
  // like" without walking the filesystem by hand.
  const candidatePaths = [...new Set([...trackedFiles(), ...untrackedFiles()])].sort();

  const { entries, included, skippedExcluded } = collectSafeEntries(root, candidatePaths, "repo/");

  const manifestContent = assertGeneratedContentSafe(
    "MANIFEST.md",
    buildManifest({
      type: "full",
      timestampUtc: new Date().toISOString(),
      branch,
      headSha: head,
      dirty,
      includedFiles: included,
      extraExclusionNotes: skippedExcluded.length
        ? [`${skippedExcluded.length} additional path(s) matched an exclusion rule and were skipped.`]
        : [],
    }),
  );

  const outDir = path.join(root, "artifacts", "ai-handoff", "full");
  mkdirSync(outDir, { recursive: true });
  const zipPath = path.join(outDir, `carbon-ledger-full-handoff-${ts}.zip`);

  await createZip(zipPath, [...entries, { arcPath: "MANIFEST.md", content: manifestContent }]);

  console.log(`Full handoff written: ${path.relative(root, zipPath)}`);
  console.log(`Files included: ${included.length}`);
  if (skippedExcluded.length) {
    console.log(`Excluded by security rules: ${skippedExcluded.length}`);
  }
}

main().catch((err) => {
  if (err instanceof SecretScanAbort) {
    console.error(`\nHandoff generation ABORTED — suspected secret detected.`);
    console.error(`  File: ${err.relPath}`);
    console.error(`  Category: ${err.category}`);
    console.error(`  (The suspected secret value itself is never printed.)`);
    process.exit(2);
  }
  console.error("Handoff generation failed:", err.message);
  process.exit(1);
});

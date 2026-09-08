#!/usr/bin/env node
/**
 * `npm run handoff:secret-audit -- --task <TASK_ID> [--base <ref>]`
 *
 * Diagnostic-only companion to review-handoff.mjs. The real handoff tools
 * (full-handoff.mjs, review-handoff.mjs) fail fast — they abort at the
 * FIRST suspected secret so nothing unreviewed is ever packaged. That is
 * correct default behaviour, but it means fixing several unrelated false
 * positives in one candidate set means running the real tool, hitting one
 * finding, fixing it, and repeating — one at a time.
 *
 * This tool never packages anything. It scans the exact same candidate
 * file set the review handoff would use for the same --task/--base, using
 * every rule against every candidate file, and reports every finding in
 * one pass — tagged as already reviewed-allowlisted or not — so a human
 * can see everything that needs attention before generating the real
 * bundle. It creates no ZIP, copies no files, and never prints a matched
 * secret value.
 *
 * This file does not change and is not imported by full-handoff.mjs or
 * review-handoff.mjs — normal handoff generation remains exactly as
 * fail-fast/fail-closed as before.
 */
import path from "node:path";
import { readFileSync, existsSync, statSync } from "node:fs";
import { repoRoot, currentBranch, headSha, resolveBaseRef, diffNameStatus, untrackedFiles } from "./lib/git.mjs";
import { isExcluded } from "./lib/exclude.mjs";
import { isLikelyBinary, isAllowlistedForSecretScan, collectAllSecretFindings } from "./lib/secret-scan.mjs";

function parseArgs(argv) {
  const args = { base: undefined, task: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--task") args.task = argv[++i];
    else if (argv[i] === "--base") args.base = argv[++i];
  }
  return args;
}

/** Identical candidate-file selection to review-handoff.mjs's `toCopy`. */
function candidateFiles(baseRef) {
  const nameStatus = diffNameStatus(baseRef);
  const untracked = untrackedFiles();
  const added = [];
  const modified = [];
  for (const { status, path: p } of nameStatus) {
    if (status.startsWith("A")) added.push(p);
    else if (status.startsWith("D")) continue; // a deleted file has no content to scan
    else modified.push(p);
  }
  const newUntracked = untracked.filter((p) => !added.includes(p) && !modified.includes(p));
  return [...new Set([...added, ...modified, ...newUntracked])].sort();
}

function main() {
  const { task, base } = parseArgs(process.argv.slice(2));
  if (!task) {
    console.error("Missing required argument: --task <TASK_ID>\nUsage: npm run handoff:secret-audit -- --task T00 [--base <ref>]");
    process.exit(1);
  }

  const root = repoRoot();
  const branch = currentBranch();
  const head = headSha();
  const baseRef = resolveBaseRef(base);
  const candidates = candidateFiles(baseRef);

  let filesScanned = 0;
  let filesSkippedExcluded = 0;
  let filesSkippedBinary = 0;
  let filesSkippedWholeFileAllowlist = 0;
  const perFileFindings = []; // { relPath, findings: [...] }

  for (const relPath of candidates) {
    if (isExcluded(relPath)) {
      filesSkippedExcluded++;
      continue;
    }
    const absPath = path.join(root, relPath);
    if (!existsSync(absPath) || !statSync(absPath).isFile()) continue;
    if (isLikelyBinary(relPath)) {
      filesSkippedBinary++;
      continue;
    }
    if (isAllowlistedForSecretScan(relPath)) {
      // Same whole-file allowlist normal handoff uses (REVIEWED_SAFE_FIXTURE_FILES)
      // — content is intentionally secret-shaped and already fully reviewed;
      // audit mode doesn't re-scan it either, matching real handoff behaviour.
      filesSkippedWholeFileAllowlist++;
      continue;
    }

    const content = readFileSync(absPath, "utf8");
    const findings = collectAllSecretFindings(content, relPath);
    filesScanned++;
    if (findings.length > 0) perFileFindings.push({ relPath, findings });
  }

  const allFindings = perFileFindings.flatMap((f) => f.findings.map((finding) => ({ relPath: f.relPath, ...finding })));
  const allowlistedCount = allFindings.filter((f) => f.allowlisted).length;
  const unreviewed = allFindings.filter((f) => !f.allowlisted);

  console.log(`# Secret-scan audit — diagnostic only, no ZIP produced`);
  console.log(``);
  console.log(`Task: ${task}`);
  console.log(`Branch: ${branch}`);
  console.log(`HEAD: ${head}`);
  console.log(`Base ref: ${baseRef}`);
  console.log(``);

  if (unreviewed.length > 0) {
    console.log(`## Unreviewed findings (${unreviewed.length})`);
    console.log(``);
    for (const f of unreviewed) {
      // Line numbers are safe here: derived purely from counting newlines
      // before the match start, never from the matched text itself, so
      // reporting the line never requires echoing the value.
      console.log(`- ${f.relPath} — ${f.category} (rule: ${f.ruleId}, line ${f.line})`);
    }
    console.log(``);
  }

  if (allowlistedCount > 0) {
    console.log(`## Reviewed-allowlisted matches (${allowlistedCount}) — not counted as findings requiring action`);
    console.log(``);
    for (const f of allFindings.filter((x) => x.allowlisted)) {
      console.log(`- ${f.relPath} — ${f.category} (rule: ${f.ruleId}, line ${f.line})`);
    }
    console.log(``);
  }

  console.log(`## Summary`);
  console.log(``);
  console.log(`Files scanned: ${filesScanned}`);
  console.log(
    `Files skipped: ${filesSkippedExcluded} excluded, ${filesSkippedBinary} binary, ${filesSkippedWholeFileAllowlist} whole-file-allowlisted`,
  );
  console.log(`Files with findings: ${perFileFindings.length}`);
  console.log(`Total findings: ${allFindings.length}`);
  console.log(`Allowlisted benign matches: ${allowlistedCount}`);
  console.log(`Unreviewed findings: ${unreviewed.length}`);
  console.log(``);
  console.log(`No secret value was printed anywhere above. No ZIP was created; no file was copied.`);

  process.exit(unreviewed.length > 0 ? 1 : 0);
}

main();

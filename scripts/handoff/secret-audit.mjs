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
 * This tool never packages anything. It scans EVERY secret-bearing surface
 * `handoff:review` would scan for the same --task/--base — the candidate
 * source files, the generated unified diff (provenance-aware — see
 * lib/diff-scan.mjs), and the other generated artifacts (status/changed-file
 * listings, task doc, implementation summary) — and reports every finding
 * in one pass, tagged as already reviewed-allowlisted or not, instead of
 * stopping at the first one. It creates no ZIP, copies no files, and never
 * prints a matched secret value.
 *
 * This file does not change and is not imported by full-handoff.mjs or
 * review-handoff.mjs — normal handoff generation remains exactly as
 * fail-fast/fail-closed as before.
 */
import path from "node:path";
import { readFileSync, existsSync, statSync } from "node:fs";
import {
  repoRoot,
  currentBranch,
  headSha,
  resolveBaseRef,
  diffNameStatus,
  diffPatch,
  fullStatusText,
  untrackedFiles,
} from "./lib/git.mjs";
import { isExcluded } from "./lib/exclude.mjs";
import { isLikelyBinary, isAllowlistedForSecretScan, collectAllSecretFindings } from "./lib/secret-scan.mjs";
import { collectAllDiffFindings } from "./lib/diff-scan.mjs";
import { extractTaskSection, buildTaskMd } from "./lib/task-doc.mjs";

function parseArgs(argv) {
  const args = { base: undefined, task: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--task") args.task = argv[++i];
    else if (argv[i] === "--base") args.base = argv[++i];
  }
  return args;
}

/** Identical candidate-file selection to review-handoff.mjs's `toCopy`/change lists. */
function changeLists(baseRef) {
  const nameStatus = diffNameStatus(baseRef);
  const untracked = untrackedFiles();
  const added = [];
  const modified = [];
  const deleted = [];
  for (const { status, path: p } of nameStatus) {
    if (status.startsWith("A")) added.push(p);
    else if (status.startsWith("D")) deleted.push(p);
    else modified.push(p);
  }
  const newUntracked = untracked.filter((p) => !added.includes(p) && !modified.includes(p));
  const toCopy = [...new Set([...added, ...modified, ...newUntracked])].sort();
  return { added, modified, deleted, newUntracked, toCopy };
}

/** Findings for one named blob of plain generated text — no source provenance (Category B/C). */
function findingsForGeneratedText(name, content) {
  return collectAllSecretFindings(content).map((f) => ({ surface: "generated", name, ...f }));
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
  const { added, modified, deleted, newUntracked, toCopy } = changeLists(baseRef);

  // --- 1. Candidate source files -------------------------------------------------
  let sourceFilesScanned = 0;
  let filesSkippedExcluded = 0;
  let filesSkippedBinary = 0;
  let filesSkippedWholeFileAllowlist = 0;
  const skippedExcludedPaths = [];
  const sourceFindings = []; // { surface: "source", relPath, ... }

  for (const relPath of toCopy) {
    if (isExcluded(relPath)) {
      filesSkippedExcluded++;
      skippedExcludedPaths.push(relPath);
      continue;
    }
    const absPath = path.join(root, relPath);
    if (!existsSync(absPath) || !statSync(absPath).isFile()) continue;
    if (isLikelyBinary(relPath)) {
      filesSkippedBinary++;
      continue;
    }
    if (isAllowlistedForSecretScan(relPath)) {
      filesSkippedWholeFileAllowlist++;
      continue;
    }

    const content = readFileSync(absPath, "utf8");
    const findings = collectAllSecretFindings(content, relPath);
    sourceFilesScanned++;
    for (const f of findings) sourceFindings.push({ surface: "source", relPath, ...f });
  }

  // --- 2. Generated unified diff (provenance-aware) ------------------------------
  const patch = diffPatch(baseRef);
  const diffFindings = collectAllDiffFindings(patch).map((f) => ({ surface: "generated-diff", name: "GIT_DIFF.patch", ...f }));

  // --- 3. Other generated artifacts (Category B/C — no source provenance) -------
  // Mirrors review-handoff.mjs's own construction of these exactly, so a
  // finding here is one real handoff generation would also hit.
  const gitStatusText = fullStatusText();
  const changedFilesTxt = [
    `Base ref: ${baseRef}`,
    `Branch: ${branch}`,
    `HEAD: ${head}`,
    ``,
    `Added (${added.length}):`,
    ...added.map((p) => `  A  ${p}`),
    ``,
    `Modified (${modified.length}):`,
    ...modified.map((p) => `  M  ${p}`),
    ``,
    `Deleted (${deleted.length}):`,
    ...deleted.map((p) => `  D  ${p}`),
    ``,
    `New untracked (${newUntracked.length}):`,
    ...newUntracked.map((p) => `  ?  ${p}`),
    ...(skippedExcludedPaths.length
      ? ["", `Excluded by security rules (${skippedExcludedPaths.length}):`, ...skippedExcludedPaths.map((p) => `  x  ${p}`)]
      : []),
    ``,
  ].join("\n");
  const taskMd = buildTaskMd(task, extractTaskSection(root, task));
  const implementationSummary = [
    `# Implementation Summary`,
    ``,
    `Task: ${task}`,
    `Objective:`,
    `Implemented:`,
    `Files changed:`,
    ...toCopy.map((p) => `  - ${p}`),
    `Tests added/changed:`,
    `Checks run: Not run`,
    `Known failures:`,
    `Known limitations:`,
    `Architecture decisions made:`,
    `Architecture decisions escalated:`,
    `Follow-up required:`,
    ``,
  ].join("\n");

  const generatedFindings = [
    ...findingsForGeneratedText("GIT_STATUS.txt", gitStatusText),
    ...findingsForGeneratedText("CHANGED_FILES.txt", changedFilesTxt),
    ...findingsForGeneratedText("TASK.md", taskMd),
    ...findingsForGeneratedText("IMPLEMENTATION_SUMMARY.md", implementationSummary),
  ];
  const generatedArtifactsScanned = 4; // GIT_STATUS.txt, CHANGED_FILES.txt, TASK.md, IMPLEMENTATION_SUMMARY.md

  // --- Combine ---------------------------------------------------------------
  const allFindings = [...sourceFindings, ...diffFindings, ...generatedFindings];
  const allowlisted = allFindings.filter((f) => f.allowlisted);
  const unreviewed = allFindings.filter((f) => !f.allowlisted);

  function describe(f) {
    if (f.surface === "source") return `${f.relPath}`;
    if (f.surface === "generated-diff") return `${f.name}${f.diffRelPath ? ` (${f.diffRelPath})` : " (no source provenance)"}`;
    return `${f.name}`;
  }

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
      // before the match start (or, for diff findings, the diff-tracked
      // old/new line number), never from the matched text itself.
      console.log(`- [${f.surface}] ${describe(f)} — ${f.category} (rule: ${f.ruleId}, line ${f.line ?? "n/a"})`);
    }
    console.log(``);
  }

  if (allowlisted.length > 0) {
    console.log(`## Reviewed-allowlisted matches (${allowlisted.length}) — not counted as findings requiring action`);
    console.log(``);
    for (const f of allowlisted) {
      console.log(`- [${f.surface}] ${describe(f)} — ${f.category} (rule: ${f.ruleId}, line ${f.line ?? "n/a"})`);
    }
    console.log(``);
  }

  console.log(`## Summary`);
  console.log(``);
  console.log(`Source files scanned: ${sourceFilesScanned}`);
  console.log(
    `Source files skipped: ${filesSkippedExcluded} excluded, ${filesSkippedBinary} binary, ${filesSkippedWholeFileAllowlist} whole-file-allowlisted`,
  );
  console.log(`Source reviewed matches: ${sourceFindings.filter((f) => f.allowlisted).length}`);
  console.log(`Source unreviewed findings: ${sourceFindings.filter((f) => !f.allowlisted).length}`);
  console.log(``);
  console.log(`Generated-diff (GIT_DIFF.patch) lines scanned: yes, provenance-aware (added, removed, and context lines)`);
  console.log(`Generated-diff reviewed matches: ${diffFindings.filter((f) => f.allowlisted).length}`);
  console.log(`Generated-diff unreviewed findings: ${diffFindings.filter((f) => !f.allowlisted).length}`);
  console.log(``);
  console.log(`Other generated artifacts scanned: ${generatedArtifactsScanned} (GIT_STATUS.txt, CHANGED_FILES.txt, TASK.md, IMPLEMENTATION_SUMMARY.md)`);
  console.log(`Other generated-artifact findings: ${generatedFindings.length}`);
  console.log(``);
  console.log(`Total findings (all surfaces): ${allFindings.length}`);
  console.log(`Total reviewed-allowlisted: ${allowlisted.length}`);
  console.log(`Total unreviewed findings: ${unreviewed.length}`);
  console.log(``);
  console.log(`No secret value was printed anywhere above. No ZIP was created; no file was copied.`);

  process.exit(unreviewed.length > 0 ? 1 : 0);
}

main();

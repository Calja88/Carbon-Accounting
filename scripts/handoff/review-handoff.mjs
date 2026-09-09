#!/usr/bin/env node
/**
 * `npm run handoff:review -- --task <TASK_ID> [--base <ref>] [--run-checks]`
 *
 * Builds a small, task-scoped review bundle for Astra: what changed, why
 * (via a fillable summary), and the material needed to review it — without
 * shipping the whole repository every time.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  repoRoot,
  currentBranch,
  headSha,
  isDirty,
  resolveBaseRef,
  diffNameStatus,
  diffPatch,
  fullStatusText,
  untrackedFiles,
} from "./lib/git.mjs";
import { collectSafeEntries, assertGeneratedContentSafe, assertDiffContentSafe, SecretScanAbort } from "./lib/collect.mjs";
import { buildManifest } from "./lib/manifest.mjs";
import { createZip } from "./lib/zip.mjs";
import { extractTaskSection, buildTaskMd } from "./lib/task-doc.mjs";

function parseArgs(argv) {
  const args = { base: undefined, task: undefined, runChecks: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--task") args.task = argv[++i];
    else if (argv[i] === "--base") args.base = argv[++i];
    else if (argv[i] === "--run-checks") args.runChecks = true;
  }
  return args;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(
    d.getUTCHours(),
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function runCheck(label, command) {
  try {
    const output = execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return `## ${label}\n\nCommand: \`${command}\`\nResult: PASSED\n\n\`\`\`\n${output.trim().slice(-4000)}\n\`\`\`\n`;
  } catch (err) {
    const output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    return `## ${label}\n\nCommand: \`${command}\`\nResult: FAILED\n\n\`\`\`\n${output.trim().slice(-4000)}\n\`\`\`\n`;
  }
}

async function main() {
  const { task, base, runChecks } = parseArgs(process.argv.slice(2));
  if (!task) {
    console.error('Missing required argument: --task <TASK_ID>\nUsage: npm run handoff:review -- --task T00');
    process.exit(1);
  }

  const root = repoRoot();
  const branch = currentBranch();
  const head = headSha();
  const dirty = isDirty();
  const baseRef = resolveBaseRef(base);

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
  const { entries: changedEntries, included: includedChanged, skippedExcluded } = collectSafeEntries(
    root,
    toCopy,
    "CHANGED_FILES/",
  );

  const migrationPaths = includedChanged.filter((p) => p.startsWith("prisma/migrations/"));
  const { entries: migrationEntries } = collectSafeEntries(root, migrationPaths, "MIGRATIONS/");

  const schemaChanged = includedChanged.includes("prisma/schema.prisma");
  const { entries: schemaEntries } = schemaChanged
    ? collectSafeEntries(root, ["prisma/schema.prisma"], "PRISMA_SCHEMA/")
    : { entries: [] };

  const testPaths = includedChanged.filter((p) => /__tests__|\.test\.[tj]sx?$/.test(p));

  const patch = assertDiffContentSafe("GIT_DIFF.patch", diffPatch(baseRef));
  const gitStatusText = assertGeneratedContentSafe("GIT_STATUS.txt", fullStatusText());

  const changedFilesTxt = assertGeneratedContentSafe(
    "CHANGED_FILES.txt",
    [
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
      ...(skippedExcluded.length
        ? ["", `Excluded by security rules (${skippedExcluded.length}):`, ...skippedExcluded.map((p) => `  x  ${p}`)]
        : []),
      ``,
    ].join("\n"),
  );

  const extractedTask = extractTaskSection(root, task);
  const taskMd = assertGeneratedContentSafe("TASK.md", buildTaskMd(task, extractedTask));

  const implementationSummary = assertGeneratedContentSafe(
    "IMPLEMENTATION_SUMMARY.md",
    [
      `# Implementation Summary`,
      ``,
      `Task: ${task}`,
      `Objective:`,
      `Implemented:`,
      `Files changed:`,
      ...includedChanged.map((p) => `  - ${p}`),
      `Schema/migrations: ${schemaChanged || migrationPaths.length ? "yes — see PRISMA_SCHEMA/ and MIGRATIONS/" : "none"}`,
      `Tests added/changed: ${testPaths.length ? testPaths.join(", ") : "none"}`,
      `Checks run: ${runChecks ? "see TEST_RESULTS.md" : "Not run"}`,
      `Known failures:`,
      `Known limitations:`,
      `Architecture decisions made:`,
      `Architecture decisions escalated:`,
      `Follow-up required:`,
      ``,
    ].join("\n"),
  );

  const testResults = assertGeneratedContentSafe(
    "TEST_RESULTS.md",
    runChecks
      ? [`# Test Results`, ``, runCheck("Unit tests (vitest)", "npm test --silent"), runCheck("Lint", "npm run lint --silent")].join("\n")
      : [`# Test Results`, ``, `Not run.`, ``, `Re-run with \`npm run handoff:review -- --task ${task} --run-checks\` to execute and capture real results here. This tool never fabricates check outcomes.`, ``].join("\n"),
  );

  const securityCheck = assertGeneratedContentSafe(
    "SECURITY_CHECK.md",
    [
      `# Security Check`,
      ``,
      `Files scanned for suspected secrets before packaging: ${includedChanged.length + (schemaChanged ? 0 : 0)}`,
      `Result: PASS — no suspected secrets found. (Generation aborts immediately on a hit, so a completed`,
      `bundle always reflects a clean scan.)`,
      `No live database was queried to build this bundle.`,
      ``,
    ].join("\n"),
  );

  const includedFiles = [
    "TASK.md",
    "IMPLEMENTATION_SUMMARY.md",
    "GIT_STATUS.txt",
    "GIT_DIFF.patch",
    "CHANGED_FILES.txt",
    ...includedChanged.map((p) => `CHANGED_FILES/${p}`),
    ...migrationPaths.map((p) => `MIGRATIONS/${p.replace("prisma/migrations/", "")}`),
    ...(schemaChanged ? ["PRISMA_SCHEMA/schema.prisma"] : []),
    "TEST_RESULTS.md",
    "SECURITY_CHECK.md",
  ];

  const manifestContent = assertGeneratedContentSafe(
    "MANIFEST.md",
    buildManifest({
      type: "review",
      taskId: task,
      timestampUtc: new Date().toISOString(),
      branch,
      headSha: head,
      dirty,
      includedFiles,
      extraExclusionNotes: [
        `Diff base ref used: ${baseRef}`,
        ...(skippedExcluded.length ? [`${skippedExcluded.length} changed path(s) matched an exclusion rule and were omitted from CHANGED_FILES/.`] : []),
      ],
    }),
  );

  const outDir = path.join(root, "artifacts", "ai-handoff", "review");
  mkdirSync(outDir, { recursive: true });
  const ts = timestamp();
  const zipPath = path.join(outDir, `${task}-review-${ts}.zip`);

  await createZip(zipPath, [
    { arcPath: "TASK.md", content: taskMd },
    { arcPath: "IMPLEMENTATION_SUMMARY.md", content: implementationSummary },
    { arcPath: "GIT_STATUS.txt", content: gitStatusText },
    { arcPath: "GIT_DIFF.patch", content: patch },
    { arcPath: "CHANGED_FILES.txt", content: changedFilesTxt },
    ...changedEntries,
    ...migrationEntries,
    ...schemaEntries,
    { arcPath: "TEST_RESULTS.md", content: testResults },
    { arcPath: "SECURITY_CHECK.md", content: securityCheck },
    { arcPath: "MANIFEST.md", content: manifestContent },
  ]);

  console.log(`Review handoff written: ${path.relative(root, zipPath)}`);
  console.log(`Task: ${task} | Base: ${baseRef} | Changed files included: ${includedChanged.length}`);
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

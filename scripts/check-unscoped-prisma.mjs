#!/usr/bin/env node
// CLI entrypoint for the unscoped-Prisma-access check (T03). Fails when a
// file outside the approved infrastructure/repository locations imports the
// Prisma client wrapper or calls it directly. See
// Docs/PHASE0_GUARDRAILS_NEON_SPEC.md section 5.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateUnscopedPrismaRule } from "./lib/unscoped-prisma-rule.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const allowlistPath = path.join(repoRoot, "scripts", "unscoped-prisma-allowlist.json");

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(full, files);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

function collectFiles() {
  return walk(srcRoot).map((absPath) => ({
    path: toPosix(path.relative(repoRoot, absPath)),
    contents: readFileSync(absPath, "utf8"),
  }));
}

function main() {
  const files = collectFiles();
  const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));

  const { matches, newViolations, staleAllowlistEntries } = evaluateUnscopedPrismaRule(
    files,
    allowlist,
  );

  if (newViolations.length > 0) {
    console.error(
      "Unscoped Prisma access detected outside approved infrastructure/repository directories:\n",
    );
    for (const file of newViolations) console.error(`  - ${file}`);
    console.error(
      "\nMove this access into src/lib/repositories/**, src/lib/platform-repositories/**, " +
        "or src/lib/jobs/infrastructure/**, or add it to scripts/unscoped-prisma-allowlist.json " +
        "only with explicit review (the allowlist is ratcheting: it may shrink, never grow casually).",
    );
    process.exit(1);
  }

  if (staleAllowlistEntries.length > 0) {
    console.warn(
      "Note: the following allowlist entries no longer use direct Prisma access and can be removed:\n",
    );
    for (const file of staleAllowlistEntries) console.warn(`  - ${file}`);
  }

  console.log(
    `Unscoped Prisma check passed (${matches.length} allowlisted file(s), 0 new violations).`,
  );
}

main();

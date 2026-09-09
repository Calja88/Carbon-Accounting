import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * T1A acceptance: "no production action reads User.role for authorisation".
 *
 * `User.role` is kept in the schema and in the session for the dual-read
 * rollback window (PHASE1_TENANCY_RBAC_SPEC.md §3), so this can't be a
 * schema-level check — it has to prove the *application code* never
 * branches an authorisation decision on it. This scans every source file
 * for the pattern and fails unless every match is in one of the explicitly
 * allowlisted files below, each with a reason that is not "authorisation".
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");

// user.role / session.user.role — never a chat-turn `.role` (those are
// "user"/"assistant" strings on an unrelated shape, and don't contain this
// substring), so this pattern only ever matches the legacy Prisma field.
const LEGACY_ROLE_PATTERN = /\buser\.role\b/;

const ALLOWED_FILES = new Set([
  // Session assembly only — reads User.role onto the JWT/session for the
  // ROLE_LABELS display below and the T12 backfill mapping; never branches
  // an authorisation decision on it.
  "src/auth.ts",
  // Cosmetic profile-badge label only, not an access-control check.
  "src/app/(app)/layout.tsx",
  // One-time legacy Role -> RoleTemplateKey translation for the T12
  // structural backfill, not a runtime authorisation decision.
  "src/lib/backfill/organisation-backfill.ts",
  // This file: the pattern appears in prose (comment/test title), not code.
  "src/lib/__tests__/no-legacy-role-authorization.test.ts",
]);

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe("no production action reads legacy User.role for authorisation", () => {
  it("only allowlisted, non-authorisation files reference user.role", () => {
    const offenders: { file: string; line: number; text: string }[] = [];

    for (const file of walk(join(REPO_ROOT, "src"))) {
      const relPath = relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (ALLOWED_FILES.has(relPath)) continue;

      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((text, index) => {
        if (LEGACY_ROLE_PATTERN.test(text)) {
          offenders.push({ file: relPath, line: index + 1, text: text.trim() });
        }
      });
    }

    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});

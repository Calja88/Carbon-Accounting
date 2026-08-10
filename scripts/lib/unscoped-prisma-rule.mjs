// Pure rule logic for the unscoped-Prisma-access check (T03). Kept separate
// from the CLI entrypoint so it can be unit tested without touching the real
// filesystem. See Docs/PHASE0_GUARDRAILS_NEON_SPEC.md section 5.

export const ALLOWED_DIRS = [
  "src/lib/prisma.ts",
  "src/lib/repositories/**",
  "src/lib/platform-repositories/**",
  "src/lib/jobs/infrastructure/**",
];

const PRISMA_IMPORT_RE =
  /from\s+["'](?:@\/lib\/prisma|\.{1,2}\/(?:\.\.\/)*lib\/prisma)["']|require\(\s*["'](?:@\/lib\/prisma|\.{1,2}\/(?:\.\.\/)*lib\/prisma)["']\s*\)/;
const PRISMA_CALL_RE = /\bprisma\.[a-zA-Z_$][\w$]*\s*\./;

export function usesUnscopedPrisma(fileContents) {
  return PRISMA_IMPORT_RE.test(fileContents) || PRISMA_CALL_RE.test(fileContents);
}

export function isAllowedPath(relPosixPath, allowedDirs = ALLOWED_DIRS) {
  for (const entry of allowedDirs) {
    if (entry.endsWith("/**")) {
      const dir = entry.slice(0, -3);
      if (relPosixPath === dir || relPosixPath.startsWith(`${dir}/`)) {
        return true;
      }
    } else if (relPosixPath === entry) {
      return true;
    }
  }
  return false;
}

/**
 * Throws if an ALLOWED_DIRS-style list contains a broad glob exception —
 * only exact files or a single trailing "/**" per named directory are valid.
 */
export function validateAllowedDirs(allowedDirs = ALLOWED_DIRS) {
  for (const entry of allowedDirs) {
    const globCount = (entry.match(/\*/g) || []).length;
    const isTrailingDoubleStar = entry.endsWith("/**") && globCount === 2;
    const isExactFile = !entry.includes("*");
    if (!isTrailingDoubleStar && !isExactFile) {
      throw new Error(
        `Invalid ALLOWED_DIRS entry "${entry}": only exact files or a single trailing "/**" are permitted (no broad glob exceptions).`,
      );
    }
  }
}

export function validateAllowlist(allowlist) {
  if (!Array.isArray(allowlist)) {
    throw new Error("Allowlist must be a JSON array of exact file paths.");
  }
  for (const entry of allowlist) {
    if (typeof entry !== "string" || entry.includes("*")) {
      throw new Error(
        `Invalid allowlist entry "${entry}": entries must be exact file paths, wildcards are not permitted.`,
      );
    }
  }
}

/**
 * @param {{path: string, contents: string}[]} files - all candidate source files
 * @param {string[]} allowlist - exact file paths permitted by the ratcheting baseline
 * @param {string[]} allowedDirs - approved infrastructure/repository directories
 */
export function evaluateUnscopedPrismaRule(files, allowlist, allowedDirs = ALLOWED_DIRS) {
  validateAllowedDirs(allowedDirs);
  validateAllowlist(allowlist);

  const matches = files
    .filter((f) => !isAllowedPath(f.path, allowedDirs))
    .filter((f) => usesUnscopedPrisma(f.contents))
    .map((f) => f.path)
    .sort();

  const allowlistSet = new Set(allowlist);
  const newViolations = matches.filter((m) => !allowlistSet.has(m));
  const staleAllowlistEntries = [...allowlistSet].filter((a) => !matches.includes(a));

  return { matches, newViolations, staleAllowlistEntries };
}

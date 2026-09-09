/**
 * Shared "build a safe list of ZIP entries" logic used by both the full and
 * review handoffs: apply exclusions, read each surviving file, run the
 * secret scanner over its content, and fail closed on the first hit.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { isExcluded } from "./exclude.mjs";
import { scanContentForSecrets, isLikelyBinary, isAllowlistedForSecretScan } from "./secret-scan.mjs";
import { scanDiffForSecrets } from "./diff-scan.mjs";

export class SecretScanAbort extends Error {
  constructor(relPath, category, line) {
    super(`Suspected secret in ${relPath} (${category}). Aborting handoff generation.`);
    this.relPath = relPath;
    this.category = category;
    this.line = line;
  }
}

/**
 * @param {string} repoRoot
 * @param {string[]} relPaths repo-relative, posix-style paths to consider
 * @param {string} arcPrefix prefix inside the ZIP, e.g. "repo/" or "CHANGED_FILES/"
 * @returns {{ entries: object[], included: string[], skippedExcluded: string[] }}
 */
export function collectSafeEntries(repoRoot, relPaths, arcPrefix = "") {
  const entries = [];
  const included = [];
  const skippedExcluded = [];

  for (const relPath of relPaths) {
    if (isExcluded(relPath)) {
      skippedExcluded.push(relPath);
      continue;
    }
    const absPath = path.join(repoRoot, relPath);
    if (!existsSync(absPath) || !statSync(absPath).isFile()) continue;

    if (!isLikelyBinary(relPath) && !isAllowlistedForSecretScan(relPath)) {
      const content = readFileSync(absPath, "utf8");
      const finding = scanContentForSecrets(content, relPath);
      if (finding) {
        throw new SecretScanAbort(relPath, finding.category, finding.line);
      }
    }

    entries.push({ arcPath: arcPrefix + relPath, absPath });
    included.push(relPath);
  }

  return { entries, included, skippedExcluded };
}

/**
 * Scans and returns in-memory generated text before it is added to the
 * ZIP. Use only for tool-generated metadata or authored prose (task docs,
 * summaries, manifests, status/changed-file listings) that carries no
 * per-source-file provenance of its own — see `assertDiffContentSafe`
 * below for content that does.
 */
export function assertGeneratedContentSafe(name, content) {
  const finding = scanContentForSecrets(content);
  if (finding) {
    throw new SecretScanAbort(name, finding.category, finding.line);
  }
  return content;
}

/**
 * Provenance-aware counterpart for a generated unified git diff
 * (GIT_DIFF.patch): every content line — added, removed, and context — is
 * still scanned, attributed to its real source path where the diff makes
 * that determinable, so the exact-file/exact-match allowlist applies only
 * under the file it was actually reviewed for. The diff blob itself is
 * never allowlisted as a whole. See scripts/handoff/lib/diff-scan.mjs.
 */
export function assertDiffContentSafe(name, diffText) {
  const finding = scanDiffForSecrets(diffText);
  if (finding) {
    throw new SecretScanAbort(finding.diffRelPath ? `${name} (${finding.diffRelPath})` : name, finding.category, finding.line);
  }
  return diffText;
}

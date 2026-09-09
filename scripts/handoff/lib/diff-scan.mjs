/**
 * Provenance-aware secret scanning for a generated unified git diff
 * (GIT_DIFF.patch). The diff *content itself* is untrusted generated
 * output — this module never grants it a blanket pass — but where a
 * content line can be attributed to a real source file (added, removed,
 * or context), it is scanned using that file's own relPath so the
 * existing exact-file/exact-matched-text allowlist
 * (REVIEWED_SAFE_CREDENTIAL_MATCHES in secret-scan.mjs) applies exactly
 * as it would when scanning that file directly — never more broadly.
 *
 * Every content line in every hunk is scanned, including deleted (`-`)
 * lines: a real secret that existed in the base and was removed in this
 * diff would still appear verbatim in GIT_DIFF.patch and must still block
 * generation. Only the true content is scanned — the leading `+`/`-`/` `
 * unified-diff marker is stripped first so it can never affect matching.
 *
 * Fails closed: any content this parser cannot confidently attribute to a
 * source path (an unrecognised line shape, a hunk line before any path
 * header, or a genuinely malformed diff) is still scanned — with no
 * relPath, so no per-file allowlist can apply to it — rather than
 * silently skipped.
 */
import { scanContentForSecrets, collectAllSecretFindings } from "./secret-scan.mjs";

const DIFF_GIT_RE = /^diff --git a\/(.+) b\/(.+)$/;
const OLD_PATH_RE = /^--- (?:a\/(.+)|\/dev\/null)$/;
const NEW_PATH_RE = /^\+\+\+ (?:b\/(.+)|\/dev\/null)$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const RENAME_FROM_RE = /^rename from (.+)$/;
const RENAME_TO_RE = /^rename to (.+)$/;

// Recognised structural/metadata lines that carry no source content of
// their own and are never scanned as if they were a source line — but see
// the module doc comment: this is a narrow, explicit list, not a general
// "skip anything unfamiliar" rule. Anything NOT matched by one of these
// AND not inside an active hunk falls through to the "unattributed" path
// below rather than being silently dropped.
const METADATA_LINE_RES = [
  /^index [0-9a-f]+\.\.[0-9a-f]+/,
  /^similarity index \d+%$/,
  /^dissimilarity index \d+%$/,
  /^new file mode \d+$/,
  /^deleted file mode \d+$/,
  /^old mode \d+$/,
  /^new mode \d+$/,
  /^copy from (.+)$/,
  /^copy to (.+)$/,
  /^Binary files .+ differ$/,
  /^\\ No newline at end of file$/,
];

function isMetadataLine(line) {
  return METADATA_LINE_RES.some((re) => re.test(line));
}

/**
 * Parses a unified git diff into a flat list of scannable "lines", each
 * tagged with the best-available source path and line number.
 * `relPath: null` means provenance could not be determined — callers must
 * scan those with no allowlist.
 */
export function parseUnifiedDiffLines(diffText) {
  const lines = diffText.split("\n");
  const scannable = [];

  let oldPath = null;
  let newPath = null;
  let inHunk = false;
  let oldLineNo = 0;
  let newLineNo = 0;

  for (const raw of lines) {
    const diffGit = DIFF_GIT_RE.exec(raw);
    if (diffGit) {
      oldPath = diffGit[1];
      newPath = diffGit[2];
      inHunk = false;
      continue;
    }

    const renameFrom = RENAME_FROM_RE.exec(raw);
    if (renameFrom) {
      oldPath = renameFrom[1];
      continue;
    }
    const renameTo = RENAME_TO_RE.exec(raw);
    if (renameTo) {
      newPath = renameTo[1];
      continue;
    }

    const oldHeader = OLD_PATH_RE.exec(raw);
    if (oldHeader) {
      oldPath = oldHeader[1] ?? null; // null => /dev/null (new file)
      inHunk = false;
      continue;
    }
    const newHeader = NEW_PATH_RE.exec(raw);
    if (newHeader) {
      newPath = newHeader[1] ?? null; // null => /dev/null (deleted file)
      inHunk = false;
      continue;
    }

    const hunk = HUNK_HEADER_RE.exec(raw);
    if (hunk) {
      oldLineNo = Number(hunk[1]);
      newLineNo = Number(hunk[2]);
      inHunk = true;
      continue;
    }

    if (isMetadataLine(raw)) continue;

    if (inHunk && raw.length > 0 && (raw[0] === "+" || raw[0] === "-" || raw[0] === " ")) {
      const marker = raw[0];
      const text = raw.slice(1);
      if (marker === "+") {
        // Added/current-side content: attribute to the new path; a brand
        // new file has no old path to fall back to either, so an
        // unresolved new path still fails closed (relPath stays null).
        scannable.push({ relPath: newPath, line: newLineNo, side: "add", text });
        newLineNo++;
      } else if (marker === "-") {
        // Removed/base-side content: attribute to the old path — this is
        // exactly the case that keeps a since-deleted secret from
        // slipping through unscanned.
        scannable.push({ relPath: oldPath, line: oldLineNo, side: "del", text });
        oldLineNo++;
      } else {
        // Context line: identical on both sides. Prefer the new path
        // (matches the file as it exists now) and fall back to the old
        // path only for a deleted file, where there is no new path.
        scannable.push({ relPath: newPath ?? oldPath, line: newLineNo, side: "context", text });
        oldLineNo++;
        newLineNo++;
      }
      continue;
    }

    // Anything else — an empty line at top level, an unrecognised header
    // variant, a hunk-shaped line encountered outside any hunk, or content
    // this parser doesn't have a rule for — is NOT silently dropped. Blank
    // lines carry nothing to find, but any non-blank stray content is
    // scanned with no path so it can never inherit a per-file allowlist.
    if (raw.trim().length > 0) {
      scannable.push({ relPath: null, line: null, side: "unattributed", text: raw });
    }
  }

  return scannable;
}

/**
 * Fail-fast counterpart to `scanContentForSecrets`, for a generated
 * unified diff: returns the first unreviewed finding (provenance-aware —
 * an exact reviewed match is only honoured under its real source path),
 * or `null` if every match in the diff is either a placeholder or already
 * reviewed for the path it was found under.
 */
export function scanDiffForSecrets(diffText) {
  for (const { relPath, line, text } of parseUnifiedDiffLines(diffText)) {
    const finding = scanContentForSecrets(text, relPath ?? undefined);
    if (finding) return { ...finding, line: line ?? finding.line, diffRelPath: relPath };
  }
  return null;
}

/**
 * Diagnostic counterpart used by the audit tool: every finding across the
 * whole diff, each tagged with the diff-line provenance (relPath/side) and
 * whether it was already reviewed under that exact path.
 */
export function collectAllDiffFindings(diffText) {
  const findings = [];
  for (const { relPath, line, side, text } of parseUnifiedDiffLines(diffText)) {
    for (const finding of collectAllSecretFindings(text, relPath ?? undefined)) {
      findings.push({ ...finding, line: line ?? finding.line, diffRelPath: relPath, side });
    }
  }
  return findings;
}

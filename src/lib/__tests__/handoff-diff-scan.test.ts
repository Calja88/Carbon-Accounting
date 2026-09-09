/**
 * Checkpoint A: provenance-aware scanning for the generated unified diff
 * (GIT_DIFF.patch). A diff content line is attributed to its real source
 * path (added lines -> new path, removed lines -> old path, context lines
 * -> the current path) so the existing exact-file/exact-matched-text
 * allowlist applies only under the file it was actually reviewed for —
 * never to the generated diff blob as a whole. No live database, no real
 * secrets.
 */

import { describe, expect, it } from "vitest";
import { parseUnifiedDiffLines, scanDiffForSecrets, collectAllDiffFindings } from "../../../scripts/handoff/lib/diff-scan.mjs";

const join = (...parts: string[]) => parts.join("");

// A reviewed exact match already allowlisted for scripts/rls-spike/setup-test-db.sh.
const rlsOwnerMatch = join("RLS_SPIKE_OWNER_PASSWORD", ":-rls_spike_owner_local_only");
const rlsSpikePath = "scripts/rls-spike/setup-test-db.sh";

function addedFileDiff(newPath: string, contentLines: string[]) {
  return [
    `diff --git a/${newPath} b/${newPath}`,
    `new file mode 100644`,
    `index 0000000..1111111`,
    `--- /dev/null`,
    `+++ b/${newPath}`,
    `@@ -0,0 +1,${contentLines.length} @@`,
    ...contentLines.map((l) => `+${l}`),
  ].join("\n");
}

function modifiedFileDiff(filePath: string, before: string[], after: string[]) {
  const removed = before.map((l) => `-${l}`);
  const added = after.map((l) => `+${l}`);
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `index 1111111..2222222 100644`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${before.length} +1,${after.length} @@`,
    ...removed,
    ...added,
  ].join("\n");
}

function deletedFileDiff(filePath: string, contentLines: string[]) {
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `deleted file mode 100644`,
    `index 1111111..0000000`,
    `--- a/${filePath}`,
    `+++ /dev/null`,
    `@@ -1,${contentLines.length} +0,0 @@`,
    ...contentLines.map((l) => `-${l}`),
  ].join("\n");
}

function renamedFileDiff(oldPath: string, newPath: string, before: string[], after: string[]) {
  return [
    `diff --git a/${oldPath} b/${newPath}`,
    `similarity index 87%`,
    `rename from ${oldPath}`,
    `rename to ${newPath}`,
    `index 1111111..2222222 100644`,
    `--- a/${oldPath}`,
    `+++ b/${newPath}`,
    `@@ -1,${before.length} +1,${after.length} @@`,
    ...before.map((l) => `-${l}`),
    ...after.map((l) => `+${l}`),
  ].join("\n");
}

describe("parseUnifiedDiffLines — provenance tracking", () => {
  it("attributes an added-file line to the new path", () => {
    const diff = addedFileDiff("src/new-file.ts", ["export const x = 1;"]);
    const lines = parseUnifiedDiffLines(diff);
    const added = lines.find((l) => l.side === "add");
    expect(added?.relPath).toBe("src/new-file.ts");
  });

  it("attributes a removed line in a modified file to the old path (== new path when unrenamed)", () => {
    const diff = modifiedFileDiff("src/existing.ts", ["const a = 1;"], ["const a = 2;"]);
    const lines = parseUnifiedDiffLines(diff);
    const removed = lines.find((l) => l.side === "del");
    expect(removed?.relPath).toBe("src/existing.ts");
  });

  it("attributes a deleted-file's removed lines to the old path, with no new path available", () => {
    const diff = deletedFileDiff("src/gone.ts", ["const secretish = 1;"]);
    const lines = parseUnifiedDiffLines(diff);
    const removed = lines.filter((l) => l.side === "del");
    expect(removed).toHaveLength(1);
    expect(removed[0].relPath).toBe("src/gone.ts");
  });

  it("uses old path before rename to / new path after for a renamed file's content lines", () => {
    const diff = renamedFileDiff("src/old-name.ts", "src/new-name.ts", ["const a = 1;"], ["const a = 2;"]);
    const lines = parseUnifiedDiffLines(diff);
    const removed = lines.find((l) => l.side === "del");
    const added = lines.find((l) => l.side === "add");
    expect(removed?.relPath).toBe("src/old-name.ts");
    expect(added?.relPath).toBe("src/new-name.ts");
  });

  it("does not silently drop unparseable content — it is scanned with relPath null", () => {
    const malformed = ["diff --git a/x b/x", "@@ -1,1 +1,1 @@", "this line has no +/-/space prefix at all"].join("\n");
    const lines = parseUnifiedDiffLines(malformed);
    const unattributed = lines.find((l) => l.side === "unattributed");
    expect(unattributed).toBeDefined();
    expect(unattributed?.relPath).toBeNull();
  });
});

describe("scanDiffForSecrets / collectAllDiffFindings — provenance-aware allow/deny", () => {
  it("REVIEWED ADDED LINE: an exact reviewed match added under its real reviewed path is accepted", () => {
    const diff = addedFileDiff(rlsSpikePath, [`OWNER_PASSWORD="\${${rlsOwnerMatch}}"`]);
    expect(scanDiffForSecrets(diff)).toBeNull();
  });

  it("REVIEWED REMOVED LINE: the same exact reviewed match, removed, is accepted using old-path provenance", () => {
    const diff = modifiedFileDiff(rlsSpikePath, [`OWNER_PASSWORD="\${${rlsOwnerMatch}}"`], [`OWNER_PASSWORD="\${SOME_OTHER_DEFAULT}"`]);
    // The removed line matches the reviewed exception; the added replacement
    // line contains no credential-shaped text at all, so the whole diff is clean.
    expect(scanDiffForSecrets(diff)).toBeNull();
  });

  it("UNREVIEWED SECRET IN ADDED LINE: a different real-looking credential added to the reviewed file still fails", () => {
    const fixture = `OWNER_PASSWORD="${join("a-brand-new-real-look", "ing-secret-value")}"`;
    const diff = addedFileDiff(rlsSpikePath, [fixture]);
    expect(scanDiffForSecrets(diff)).not.toBeNull();
  });

  it("UNREVIEWED SECRET IN REMOVED LINE: a credential removed from a file still fails — it still appears in the diff", () => {
    const fixture = `OWNER_PASSWORD="${join("a-since-deleted-real", "-secret-value-here")}"`;
    const diff = modifiedFileDiff(rlsSpikePath, [fixture], ["OWNER_PASSWORD=\"\${SOME_OTHER_DEFAULT}\""]);
    expect(scanDiffForSecrets(diff)).not.toBeNull();
  });

  it("DIFFERENT FILE: the same benign-looking string does not inherit another file's allowlist", () => {
    const diff = addedFileDiff("scripts/rls-spike/some-other-script.sh", [`OWNER_PASSWORD="\${${rlsOwnerMatch}}"`]);
    expect(scanDiffForSecrets(diff)).not.toBeNull();
  });

  it("RENAME: provenance is correct for a renamed file — old path used for removed content", () => {
    const oldPath = "scripts/rls-spike/old-setup-name.sh";
    const diff = renamedFileDiff(oldPath, "scripts/rls-spike/still-not-reviewed.sh", [`OWNER_PASSWORD="\${${rlsOwnerMatch}}"`], ["# renamed"]);
    // Neither the old nor the new path is the exact reviewed path
    // (scripts/rls-spike/setup-test-db.sh), so this must still fail.
    expect(scanDiffForSecrets(diff)).not.toBeNull();
  });

  it("ADDED / DELETED FILE: /dev/null handling is safe for a brand-new file with a reviewed construct", () => {
    const diff = addedFileDiff("src/app/invite/[token]/actions.ts", [`  const ${join("tokenHash ", "= hashInvitationToken")}(parsed.data.token);`]);
    expect(scanDiffForSecrets(diff)).toBeNull();
  });

  it("MALFORMED DIFF: content with no determinable provenance is scanned with no allowlist and fails closed", () => {
    const secretLooking = `API_SECRET = "${join("th1s-l00ks-like-a-real", "-secret-value")}"`;
    const malformed = [`diff --git a/x b/x`, `@@ -1,1 +1,1 @@`, secretLooking].join("\n");
    // No +/-/space prefix means this line is "unattributed" (relPath null) —
    // still scanned, still fails, never silently skipped.
    expect(scanDiffForSecrets(malformed)).not.toBeNull();
  });

  it("collects multiple findings across files in one pass, tagging allowlisted vs. not", () => {
    const diff = [
      addedFileDiff(rlsSpikePath, [`OWNER_PASSWORD="\${${rlsOwnerMatch}}"`]),
      addedFileDiff("src/some/new-file.ts", [`API_SECRET = "${join("th1s-l00ks-like-a-real", "-secret-value")}"`]),
    ].join("\n");
    const findings = collectAllDiffFindings(diff);
    expect(findings.some((f) => f.allowlisted && f.diffRelPath === rlsSpikePath)).toBe(true);
    expect(findings.some((f) => !f.allowlisted && f.diffRelPath === "src/some/new-file.ts")).toBe(true);
  });

  it("NO SECRET ECHO: never includes the matched secret text in a finding", () => {
    const secretValue = join("a-brand-new-real-look", "ing-secret-value");
    const diff = addedFileDiff(rlsSpikePath, [`OWNER_PASSWORD="${secretValue}"`]);
    const finding = scanDiffForSecrets(diff);
    expect(JSON.stringify(finding)).not.toContain(secretValue);
  });
});

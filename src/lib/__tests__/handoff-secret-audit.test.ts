/**
 * Checkpoint A: the diagnostic secret-scan audit mode
 * (scripts/handoff/secret-audit.mjs) collects every finding in one pass
 * rather than failing fast on the first one, without ever packaging a ZIP.
 * These tests cover the shared scanning logic it's built on
 * (collectAllSecretFindings) plus structural guarantees about the script
 * itself. No live database, no real secrets.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scanContentForSecrets, collectAllSecretFindings } from "../../../scripts/handoff/lib/secret-scan.mjs";

const join = (...parts: string[]) => parts.join("");

describe("collectAllSecretFindings — the audit-only, non-fail-fast scan", () => {
  it("collects multiple findings across different rules in one pass", () => {
    const fixture = [
      `DATABASE_URL="postgresql://appuser:${join("S0meR3alLookingPass", "word")}@ep-cool-bird-12345.us-east-2.aws.neon.tech/main"`,
      `API_SECRET = "${join("th1s-l00ks-like-a-real", "-secret-value")}"`,
    ].join("\n");
    const findings = collectAllSecretFindings(fixture);
    // The connection-string fixture also matches the neon-host rule
    // separately, plus the credential-assignment rule on API_SECRET —
    // at least these two distinct rule ids must both be present.
    const ruleIds = new Set(findings.map((f) => f.ruleId));
    expect(ruleIds.has("connection-string")).toBe(true);
    expect(ruleIds.has("credential-assignment")).toBe(true);
    expect(findings.length).toBeGreaterThanOrEqual(2);
  });

  it("tags a reviewed-allowlisted match as allowlisted: true, and an unreviewed one as false, in the same call", () => {
    const ownerMatch = join("RLS_SPIKE_OWNER_PASSWORD", ":-rls_spike_owner_local_only");
    const fixture = [
      `OWNER_PASSWORD="\${${ownerMatch}}"`,
      `API_SECRET = "${join("th1s-l00ks-like-a-real", "-secret-value")}"`,
    ].join("\n");
    const findings = collectAllSecretFindings(fixture, join("scripts/rls-spike/", "setup-test-db.sh"));
    const reviewed = findings.find((f) => f.ruleId === "credential-assignment" && f.line === 1);
    const unreviewed = findings.find((f) => f.ruleId === "credential-assignment" && f.line === 2);
    expect(reviewed?.allowlisted).toBe(true);
    expect(unreviewed?.allowlisted).toBe(false);
  });

  it("never includes the matched secret text in any finding", () => {
    const secretValue = join("th1s-l00ks-like-a-real", "-secret-value");
    const findings = collectAllSecretFindings(`API_SECRET = "${secretValue}"`);
    expect(JSON.stringify(findings)).not.toContain(secretValue);
  });

  it("returns an empty array for clean content", () => {
    expect(collectAllSecretFindings("export const x = 1;")).toEqual([]);
  });

  it("does not change scanContentForSecrets's fail-fast behaviour — still returns only the first finding", () => {
    const fixture = [
      `API_SECRET = "${join("th1s-l00ks-like-a-real", "-secret-value")}"`,
      `API_TOKEN = "${join("another-long-secret", "-value-here")}"`,
    ].join("\n");
    const finding = scanContentForSecrets(fixture);
    expect(finding).not.toBeNull();
    expect(finding?.line).toBe(1);
  });
});

describe("secret-audit.mjs — structural guarantees", () => {
  const source = readFileSync(resolve(__dirname, "../../../scripts/handoff/secret-audit.mjs"), "utf8");

  it("never imports the ZIP builder — the audit tool cannot package anything", () => {
    expect(source).not.toMatch(/zip\.mjs/);
    expect(source).not.toMatch(/createZip/);
  });

  it("exits non-zero when unreviewed findings exist and zero otherwise", () => {
    expect(source).toMatch(/process\.exit\(unreviewed\.length > 0 \? 1 : 0\)/);
  });

  it("does not import full-handoff.mjs / review-handoff.mjs — normal handoff generation is untouched by this file", () => {
    expect(source).not.toMatch(/import[^;]*from\s+["'][^"']*full-handoff\.mjs["']/);
    expect(source).not.toMatch(/import[^;]*from\s+["'][^"']*review-handoff\.mjs["']/);
  });
});

describe("full-handoff.mjs / review-handoff.mjs — unaffected by the audit tool", () => {
  it("review-handoff.mjs does not import secret-audit.mjs", () => {
    const source = readFileSync(resolve(__dirname, "../../../scripts/handoff/review-handoff.mjs"), "utf8");
    expect(source).not.toMatch(/secret-audit\.mjs/);
  });

  it("full-handoff.mjs does not import secret-audit.mjs", () => {
    const source = readFileSync(resolve(__dirname, "../../../scripts/handoff/full-handoff.mjs"), "utf8");
    expect(source).not.toMatch(/secret-audit\.mjs/);
  });
});

describe("generated metadata (CHANGED_FILES.txt / IMPLEMENTATION_SUMMARY.md-shaped content) — no inherited source allowlist", () => {
  it("a reviewed source construct appearing in generic generated prose (no relPath) is NOT allowlisted there", () => {
    // Real generated metadata never actually contains this — it's only
    // file paths and counts — but the guarantee itself must hold: the
    // allowlist is keyed to an exact file path, never to "this text was
    // reviewed somewhere". Scanning with no relPath (exactly what
    // assertGeneratedContentSafe / findingsForGeneratedText do) must never
    // treat a reviewed-elsewhere construct as safe here.
    const ownerMatch = join("RLS_SPIKE_OWNER_PASSWORD", ":-rls_spike_owner_local_only");
    const fixture = `Some generated text mentions OWNER_PASSWORD="\${${ownerMatch}}" without a file path`;
    expect(scanContentForSecrets(fixture)).not.toBeNull();
  });
});

describe("audit/handoff parity — both real paths share the one diff-scan implementation", () => {
  it("secret-audit.mjs uses the provenance-aware diff collector, not a second implementation", () => {
    const source = readFileSync(resolve(__dirname, "../../../scripts/handoff/secret-audit.mjs"), "utf8");
    expect(source).toMatch(/import\s*\{\s*collectAllDiffFindings\s*\}\s*from\s*["']\.\/lib\/diff-scan\.mjs["']/);
  });

  it("collect.mjs's real-handoff diff guard uses the same provenance-aware scanner, not a second implementation", () => {
    const source = readFileSync(resolve(__dirname, "../../../scripts/handoff/lib/collect.mjs"), "utf8");
    expect(source).toMatch(/import\s*\{\s*scanDiffForSecrets\s*\}\s*from\s*["']\.\/diff-scan\.mjs["']/);
  });

  it("review-handoff.mjs scans GIT_DIFF.patch via the provenance-aware guard, not the plain generated-content one", () => {
    const source = readFileSync(resolve(__dirname, "../../../scripts/handoff/review-handoff.mjs"), "utf8");
    expect(source).toMatch(/assertDiffContentSafe\("GIT_DIFF\.patch"/);
    expect(source).not.toMatch(/assertGeneratedContentSafe\("GIT_DIFF\.patch"/);
  });
});

describe("ZIP safety — a real handoff never packages while a diff finding remains unreviewed", () => {
  it("assertDiffContentSafe throws (does not silently pass) for an unreviewed diff finding", async () => {
    const { assertDiffContentSafe, SecretScanAbort } = await import("../../../scripts/handoff/lib/collect.mjs");
    const secretValue = join("a-brand-new-real-look", "ing-secret-value");
    const diff = [
      `diff --git a/src/some/new-file.ts b/src/some/new-file.ts`,
      `new file mode 100644`,
      `index 0000000..1111111`,
      `--- /dev/null`,
      `+++ b/src/some/new-file.ts`,
      `@@ -0,0 +1,1 @@`,
      `+API_SECRET = "${secretValue}"`,
    ].join("\n");
    expect(() => assertDiffContentSafe("GIT_DIFF.patch", diff)).toThrow(SecretScanAbort);
  });

  it("assertDiffContentSafe returns the diff text unchanged when every finding is reviewed", async () => {
    const { assertDiffContentSafe } = await import("../../../scripts/handoff/lib/collect.mjs");
    const diff = [
      `diff --git a/src/app/invite/[token]/actions.ts b/src/app/invite/[token]/actions.ts`,
      `new file mode 100644`,
      `index 0000000..1111111`,
      `--- /dev/null`,
      `+++ b/src/app/invite/[token]/actions.ts`,
      `@@ -0,0 +1,1 @@`,
      `+  const ${join("tokenHash ", "= hashInvitationToken")}(parsed.data.token);`,
    ].join("\n");
    expect(assertDiffContentSafe("GIT_DIFF.patch", diff)).toBe(diff);
  });
});

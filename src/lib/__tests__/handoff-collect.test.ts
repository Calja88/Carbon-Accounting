import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isExcluded } from "../../../scripts/handoff/lib/exclude.mjs";
import { collectSafeEntries, SecretScanAbort } from "../../../scripts/handoff/lib/collect.mjs";

describe("handoff exclusion rules", () => {
  it("excludes known-sensitive paths", () => {
    expect(isExcluded(".env")).toBe(true);
    expect(isExcluded(".env.local")).toBe(true);
    expect(isExcluded(".env.production")).toBe(true);
    expect(isExcluded("node_modules/foo/index.js")).toBe(true);
    expect(isExcluded(".git/config")).toBe(true);
    expect(isExcluded(".next/cache/x")).toBe(true);
    expect(isExcluded("certs/server.pem")).toBe(true);
    expect(isExcluded("keys/id_rsa")).toBe(true);
    expect(isExcluded("artifacts/ai-handoff/full/x.zip")).toBe(true);
  });

  it("allows the placeholder .env.example", () => {
    expect(isExcluded(".env.example")).toBe(false);
  });

  it("allows ordinary source files", () => {
    expect(isExcluded("src/lib/calc-engine.ts")).toBe(false);
    expect(isExcluded("prisma/schema.prisma")).toBe(false);
  });
});

describe("collectSafeEntries", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("never includes excluded files even if explicitly listed", () => {
    dir = mkdtempSync(path.join(tmpdir(), "handoff-test-"));
    writeFileSync(path.join(dir, ".env"), ["DATABASE_URL=postgresql://user:", "pass", "@host/db"].join(""));
    writeFileSync(path.join(dir, "app.ts"), "export const x = 1;");

    const { included, skippedExcluded } = collectSafeEntries(dir, [".env", "app.ts"]);
    expect(included).toEqual(["app.ts"]);
    expect(skippedExcluded).toEqual([".env"]);
  });

  it("aborts with SecretScanAbort when a candidate file contains a likely credential", () => {
    dir = mkdtempSync(path.join(tmpdir(), "handoff-test-"));
    const fixture = ["our staging DB is postgresql://svc:", "R3alLookingSecretPass", "@ep-fake.us-east-2.aws.neon.tech/db"].join("");
    writeFileSync(path.join(dir, "notes.md"), fixture);

    expect(() => collectSafeEntries(dir, ["notes.md"])).toThrow(SecretScanAbort);
  });

  it("does not leak the secret value in the thrown error", () => {
    dir = mkdtempSync(path.join(tmpdir(), "handoff-test-"));
    const secretValue = ["R3alLookingSecret", "Pass"].join("");
    writeFileSync(path.join(dir, "notes.md"), ["postgresql://svc:", secretValue, "@ep-fake.us-east-2.aws.neon.tech/db"].join(""));

    try {
      collectSafeEntries(dir, ["notes.md"]);
      throw new Error("expected collectSafeEntries to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SecretScanAbort);
      expect((err as Error).message).not.toContain(secretValue);
    }
  });

  it("captures legitimate untracked-style new source files", () => {
    dir = mkdtempSync(path.join(tmpdir(), "handoff-test-"));
    writeFileSync(path.join(dir, "new-feature.ts"), "export const feature = true;");

    const { included } = collectSafeEntries(dir, ["new-feature.ts"]);
    expect(included).toEqual(["new-feature.ts"]);
  });

  it("handles safe placeholder .env.example content without aborting", () => {
    dir = mkdtempSync(path.join(tmpdir(), "handoff-test-"));
    writeFileSync(
      path.join(dir, ".env.example"),
      'DATABASE_URL="postgresql://paragon:paragon@localhost:5432/paragon_carbon"\nNEXTAUTH_SECRET="replace-with-a-long-random-string"\n',
    );

    const { included } = collectSafeEntries(dir, [".env.example"]);
    expect(included).toEqual([".env.example"]);
  });
});

import { describe, expect, it } from "vitest";
import { scanContentForSecrets } from "../../../scripts/handoff/lib/secret-scan.mjs";

// Fixtures are assembled at runtime from parts rather than written as literal
// matching strings, so this file's own *source text* never contains anything
// that would trip the scanner when this file itself is scanned as part of a
// generated handoff bundle (see full-handoff.mjs / review-handoff.mjs, which
// scan every candidate file's content, this test file included).
const join = (...parts: string[]) => parts.join("");

describe("handoff secret scanner", () => {
  it("flags a synthetic Postgres connection string with real-looking credentials", () => {
    const fixture = join(
      'DATABASE_URL="postgresql://appuser:',
      "S0meR3alLookingPass",
      '@ep-cool-bird-12345.us-east-2.aws.neon.tech/main"',
    );
    const finding = scanContentForSecrets(fixture);
    expect(finding).not.toBeNull();
    expect(finding?.category).toMatch(/connection string/i);
  });

  it("flags a synthetic OpenRouter-style API key", () => {
    const fixture = join("OPENROUTER_API_KEY=", "sk-or-v1-abc", "defghijklmnopqrstuvwxyz0123456789");
    const finding = scanContentForSecrets(fixture);
    expect(finding).not.toBeNull();
    expect(finding?.category).toMatch(/OpenRouter/i);
  });

  it("flags a synthetic private key block", () => {
    const fixture = join("-----BEGIN RSA PRIV", "ATE KEY-----\n", "MIIFAKEFAKEFAKE\n", "-----END RSA PRIVATE KEY-----");
    const finding = scanContentForSecrets(fixture);
    expect(finding).not.toBeNull();
    expect(finding?.category).toMatch(/private key/i);
  });

  it("flags a synthetic generic secret assignment", () => {
    const fixture = join("API_SECRET = \"", "th1s-l00ks-like-a-real-secret-value", "\"");
    const finding = scanContentForSecrets(fixture);
    expect(finding).not.toBeNull();
  });

  it("does not fabricate the secret value in the finding", () => {
    const secretValue = join("th1s-l00ks-like-a-real", "-secret-value");
    const finding = scanContentForSecrets(join('API_SECRET = "', secretValue, '"'));
    expect(finding).not.toBeNull();
    expect(JSON.stringify(finding)).not.toContain(secretValue);
  });

  it("allows the repo's placeholder .env.example-style content through", () => {
    const finding = scanContentForSecrets(
      [
        'DATABASE_URL="postgresql://paragon:paragon@localhost:5432/paragon_carbon?schema=public"',
        'NEXTAUTH_SECRET="replace-with-a-long-random-string"',
        "OPENROUTER_API_KEY=",
      ].join("\n"),
    );
    expect(finding).toBeNull();
  });

  it("allows ordinary application source with no credentials", () => {
    const finding = scanContentForSecrets(`
      export function calculateEmissions(amount: number, factor: number) {
        return amount * factor;
      }
    `);
    expect(finding).toBeNull();
  });
});

// Checkpoint A: the narrow, exact-match allowlist for
// scripts/rls-spike/setup-test-db.sh's two reviewed synthetic/local-only
// RLS-spike credential defaults — see secret-scan.mjs's
// REVIEWED_SAFE_CREDENTIAL_MATCHES for the full review rationale. Built
// from parts for the same reason as the fixtures above: this test file's
// own source text must never contain the literal matched string.
describe("reviewed exact-match credential allowlist (scripts/rls-spike/setup-test-db.sh)", () => {
  // Split before the ":" (the rule's operator) — splitting only within the
  // value leaves the first fragment alone still keyword+operator+16 chars,
  // which matches on its own.
  const ownerMatch = join("RLS_SPIKE_OWNER_PASSWORD", ":-rls_spike_owner_local_only");
  const appMatch = join("RLS_SPIKE_APP_PASSWORD", ":-rls_spike_app_local_only");
  const rlsSpikePath = join("scripts/rls-spike/", "setup-test-db.sh");

  it("allows the exact reviewed synthetic RLS-spike credential defaults in their file", () => {
    const fixture = [`OWNER_PASSWORD="\${${ownerMatch}}"`, `APP_PASSWORD="\${${appMatch}}"`].join("\n");
    expect(scanContentForSecrets(fixture, rlsSpikePath)).toBeNull();
  });

  it("still fails a different/new credential-like value added to the same file", () => {
    const fixture = `OWNER_PASSWORD="\${RLS_SPIKE_OWNER_PASSWORD:-${join("some-other-real-look", "ing-secret-value")}}"`;
    const finding = scanContentForSecrets(fixture, rlsSpikePath);
    expect(finding).not.toBeNull();
  });

  it("does not allow the same matched text in a different, non-reviewed file", () => {
    const fixture = `OWNER_PASSWORD="\${${ownerMatch}}"`;
    const finding = scanContentForSecrets(fixture, join("scripts/rls-spike/", "some-other-script.sh"));
    expect(finding).not.toBeNull();
  });

  it("still fails the same content when no relPath is given at all", () => {
    const fixture = `OWNER_PASSWORD="\${${ownerMatch}}"`;
    expect(scanContentForSecrets(fixture)).not.toBeNull();
  });

  it("never includes the matched text even for the one case it does still flag here", () => {
    const secretValue = join("some-other-real-look", "ing-secret-value");
    const fixture = `OWNER_PASSWORD="\${RLS_SPIKE_OWNER_PASSWORD:-${secretValue}}"`;
    const finding = scanContentForSecrets(fixture, rlsSpikePath);
    expect(JSON.stringify(finding)).not.toContain(secretValue);
  });
});

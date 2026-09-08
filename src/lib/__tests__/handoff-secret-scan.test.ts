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

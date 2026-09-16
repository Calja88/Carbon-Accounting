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

// Checkpoint A: the narrow, exact-match allowlist for
// src/app/invite/[token]/actions.ts's benign `tokenHash =
// hashInvitationToken(...)` assignment (calls the local SHA-256 helper on
// the visitor's own submitted token; no embedded secret). Built from parts
// for the same self-scanning reason as above.
describe("reviewed exact-match credential allowlist (src/app/invite/[token]/actions.ts)", () => {
  // Split before the "=" (the rule's operator), same reasoning as the
  // RLS-spike fixtures above.
  const tokenHashMatch = join("tokenHash ", "= hashInvitationToken");
  const invitePath = join("src/app/invite/[token]/", "actions.ts");

  it("allows the exact reviewed benign hashInvitationToken assignment in its file", () => {
    const fixture = `  const ${tokenHashMatch}(parsed.data.token);`;
    expect(scanContentForSecrets(fixture, invitePath)).toBeNull();
  });

  it("still fails a literal token/hash/password assignment in the same file", () => {
    for (const fixture of [
      `tokenHash = "${join("actual-secret-value-that", "-is-long-enough")}"`,
      `token = "${join("some-long-secret-value", "-here-too")}"`,
      `apiToken = "${join("another-long-secret", "-value-here")}"`,
      `password = "${join("yet-another-long-secret", "-value")}"`,
    ]) {
      expect(scanContentForSecrets(fixture, invitePath)).not.toBeNull();
    }
  });

  it("still fails a different token-related assignment in the same file unless separately allowlisted", () => {
    const fixture = `otherTokenHash ${join("= hashSomethingElse", "AndDifferent")}(value);`;
    expect(scanContentForSecrets(fixture, invitePath)).not.toBeNull();
  });

  it("does not allow the same matched text in a different, non-reviewed file", () => {
    const fixture = `const ${tokenHashMatch}(parsed.data.token);`;
    expect(scanContentForSecrets(fixture, join("src/app/invite/[token]/", "other-file.ts"))).not.toBeNull();
  });

  it("the reviewed RLS-spike exception is unaffected by this second exception", () => {
    const ownerMatch = join("RLS_SPIKE_OWNER_PASSWORD", ":-rls_spike_owner_local_only");
    const fixture = `OWNER_PASSWORD="\${${ownerMatch}}"`;
    expect(scanContentForSecrets(fixture, join("scripts/rls-spike/", "setup-test-db.sh"))).toBeNull();
  });

  it("never includes the matched text for the cases it still flags here", () => {
    const secretValue = join("actual-secret-value-that", "-is-long-enough");
    const fixture = `tokenHash = "${secretValue}"`;
    const finding = scanContentForSecrets(fixture, invitePath);
    expect(JSON.stringify(finding)).not.toContain(secretValue);
  });
});

// Checkpoint A: the identical reviewed benign hashInvitationToken
// assignment also appears in the sibling page component. Same exact-match
// allowlist mechanism, scoped to this specific file.
describe("reviewed exact-match credential allowlist (src/app/invite/[token]/page.tsx)", () => {
  const tokenHashMatch = join("tokenHash ", "= hashInvitationToken");
  const pagePath = join("src/app/invite/[token]/", "page.tsx");

  it("allows the reviewed benign helper-call assignment in page.tsx", () => {
    const fixture = `  const ${tokenHashMatch}(token);`;
    expect(scanContentForSecrets(fixture, pagePath)).toBeNull();
  });

  it("still fails a literal token assignment in page.tsx", () => {
    const fixture = `token = "${join("some-long-literal-token", "-value-here")}"`;
    expect(scanContentForSecrets(fixture, pagePath)).not.toBeNull();
  });

  it("still fails a literal password/API token assignment in page.tsx", () => {
    for (const fixture of [
      `password = "${join("a-long-literal-password", "-value-here")}"`,
      `apiToken = "${join("a-long-literal-api-token", "-value-here")}"`,
    ]) {
      expect(scanContentForSecrets(fixture, pagePath)).not.toBeNull();
    }
  });

  it("still fails a different, non-allowlisted token assignment in page.tsx", () => {
    const fixture = `sessionToken ${join("= readFromSomewhereElse", "Unrelated")}(value);`;
    expect(scanContentForSecrets(fixture, pagePath)).not.toBeNull();
  });

  it("the actions.ts exception still works alongside this one", () => {
    const fixture = `  const ${tokenHashMatch}(parsed.data.token);`;
    expect(scanContentForSecrets(fixture, join("src/app/invite/[token]/", "actions.ts"))).toBeNull();
  });

  it("the RLS-spike exception still works alongside this one", () => {
    const ownerMatch = join("RLS_SPIKE_OWNER_PASSWORD", ":-rls_spike_owner_local_only");
    const fixture = `OWNER_PASSWORD="\${${ownerMatch}}"`;
    expect(scanContentForSecrets(fixture, join("scripts/rls-spike/", "setup-test-db.sh"))).toBeNull();
  });

  it("never echoes secret values for the cases it still flags in page.tsx", () => {
    const secretValue = join("some-long-literal-token", "-value-here");
    const finding = scanContentForSecrets(`token = "${secretValue}"`, pagePath);
    expect(JSON.stringify(finding)).not.toContain(secretValue);
  });
});

// Checkpoint A: three synthetic Prisma URL-derivation fixtures in
// src/lib/__tests__/prisma-config.test.ts, each matching both the
// connection-string and neon-host rules. Split before the "@" (not just
// after "postgres://"), since neon-host needs no scheme prefix at all.
describe("reviewed exact-match credential allowlist (src/lib/__tests__/prisma-config.test.ts)", () => {
  const prismaConfigPath = join("src/lib/__tests__/", "prisma-config.test.ts");
  const fixtures = [
    { hostFragment: join("synthetic@fake-pooler.example", ".neon.tech/example") },
    { hostFragment: join("synthetic@ep-example-pooler.eu-west-2.aws", ".neon.tech/example") },
    { hostFragment: join("synthetic@ep-example.eu-west-2.aws", ".neon.tech/example") },
  ];

  it.each(fixtures)("allows the reviewed synthetic fixture $hostFragment for both overlapping rules", ({ hostFragment }) => {
    const hostMatch = join("synthetic:", hostFragment);
    const urlMatch = join("postgresql://synthetic:", hostFragment);
    expect(scanContentForSecrets(`const pooled = "${urlMatch}";`, prismaConfigPath)).toBeNull();
    expect(scanContentForSecrets(hostMatch, prismaConfigPath)).toBeNull();
  });

  it("still fails a different synthetic-looking host in the same file", () => {
    const url = join("postgresql://synthetic:", "synthetic@ep-different-fixture-not-reviewed.eu-west-2.aws.neon.tech/example");
    expect(scanContentForSecrets(`const pooled = "${url}";`, prismaConfigPath)).not.toBeNull();
  });

  it("still fails a different username/password on an otherwise-reviewed host", () => {
    const url = join("postgresql://realuser:", "realpass20261234567890@fake-pooler.example.neon.tech/example");
    expect(scanContentForSecrets(`const pooled = "${url}";`, prismaConfigPath)).not.toBeNull();
  });

  it("still fails a literal generic credential assignment in the same file", () => {
    const fixture = `const apiSecret = "${join("th1s-l00ks-like-a-real", "-secret-value")}";`;
    expect(scanContentForSecrets(fixture, prismaConfigPath)).not.toBeNull();
  });

  it("does not allow the same reviewed fixture text in a different, non-reviewed file", () => {
    const urlMatch = join("postgresql://synthetic:", fixtures[0].hostFragment);
    expect(scanContentForSecrets(`const pooled = "${urlMatch}";`, join("src/lib/__tests__/", "other.test.ts"))).not.toBeNull();
  });

  it("other reviewed exceptions (RLS-spike, invite actions/page) are unaffected", () => {
    const ownerMatch = join("RLS_SPIKE_OWNER_PASSWORD", ":-rls_spike_owner_local_only");
    expect(scanContentForSecrets(`OWNER_PASSWORD="\${${ownerMatch}}"`, join("scripts/rls-spike/", "setup-test-db.sh"))).toBeNull();
    const tokenHashMatch = join("tokenHash ", "= hashInvitationToken");
    expect(scanContentForSecrets(`const ${tokenHashMatch}(token);`, join("src/app/invite/[token]/", "actions.ts"))).toBeNull();
  });

  it("never echoes the matched fixture text for a case it still flags", () => {
    const secretValue = join("th1s-l00ks-like-a-real", "-secret-value");
    const finding = scanContentForSecrets(`const apiSecret = "${secretValue}";`, prismaConfigPath);
    expect(JSON.stringify(finding)).not.toContain(secretValue);
  });
});

// Checkpoint A: the synthetic export-service redaction-test fixture in
// src/lib/exports/__tests__/organisation-export-service.test.ts.
describe("reviewed exact-match credential allowlist (src/lib/exports/__tests__/organisation-export-service.test.ts)", () => {
  const exportServicePath = join("src/lib/exports/__tests__/", "organisation-export-service.test.ts");
  const fixtureMatch = join("inviteTokenHash", join(": ", '"super-secret-hash"'));

  it("allows the reviewed synthetic redaction-test fixture", () => {
    expect(scanContentForSecrets(`inviteTokenHash: "${join("super-secret", "-hash")}"`, exportServicePath)).toBeNull();
  });

  it("still fails a different fixture value assigned to the same field", () => {
    const fixture = `inviteTokenHash: "${join("some-other-fixture", "-value-here-too")}"`;
    expect(scanContentForSecrets(fixture, exportServicePath)).not.toBeNull();
  });

  it("still fails an unrelated literal token/password assignment in the same file", () => {
    const fixture = `password = "${join("a-literal-password", "-value-here")}"`;
    expect(scanContentForSecrets(fixture, exportServicePath)).not.toBeNull();
  });

  it("does not allow the same fixture text in a different, non-reviewed file", () => {
    expect(scanContentForSecrets(fixtureMatch, join("src/lib/exports/__tests__/", "other.test.ts"))).not.toBeNull();
  });

  it("never echoes the fixture text for a case it still flags", () => {
    const secretValue = join("some-other-fixture", "-value-here-too");
    const finding = scanContentForSecrets(`inviteTokenHash: "${secretValue}"`, exportServicePath);
    expect(JSON.stringify(finding)).not.toContain(secretValue);
  });
});

// Checkpoint A: the synthetic cookie test fixture in
// src/lib/organisation/__tests__/cookie.test.ts.
describe("reviewed exact-match credential allowlist (src/lib/organisation/__tests__/cookie.test.ts)", () => {
  const cookieTestPath = join("src/lib/organisation/__tests__/", "cookie.test.ts");

  it("allows the reviewed synthetic NEXTAUTH_SECRET test fixture", () => {
    const fixture = `process.env.NEXTAUTH_SECRET = "${join("test-secret-value-not", "-a-real-credential")}";`;
    expect(scanContentForSecrets(fixture, cookieTestPath)).toBeNull();
  });

  it("still fails a different value assigned to NEXTAUTH_SECRET in the same file", () => {
    const fixture = `process.env.NEXTAUTH_SECRET = "${join("some-other-real-look", "ing-secret-value")}";`;
    expect(scanContentForSecrets(fixture, cookieTestPath)).not.toBeNull();
  });

  it("still fails an unrelated literal token assignment in the same file", () => {
    const fixture = `apiToken = "${join("a-literal-api-token", "-value-here")}"`;
    expect(scanContentForSecrets(fixture, cookieTestPath)).not.toBeNull();
  });

  it("does not allow the same fixture text in a different, non-reviewed file", () => {
    const fixture = `process.env.NEXTAUTH_SECRET = "${join("test-secret-value-not", "-a-real-credential")}";`;
    expect(scanContentForSecrets(fixture, join("src/lib/organisation/__tests__/", "other.test.ts"))).not.toBeNull();
  });

  it("never echoes the fixture text for a case it still flags", () => {
    const secretValue = join("some-other-real-look", "ing-secret-value");
    const finding = scanContentForSecrets(`process.env.NEXTAUTH_SECRET = "${secretValue}";`, cookieTestPath);
    expect(JSON.stringify(finding)).not.toContain(secretValue);
  });
});

// Checkpoint A: the runtime token-hash property assignment in the
// production application file src/lib/organisation/invitation-service.ts
// — reviewed with extra scrutiny as production source, not test code.
// Distinct matched text from the actions.ts/page.tsx exception above
// (object-literal `tokenHash: ...` vs. `const tokenHash = ...`).
describe("reviewed exact-match credential allowlist (src/lib/organisation/invitation-service.ts)", () => {
  const invitationServicePath = join("src/lib/organisation/", "invitation-service.ts");
  const propertyMatch = join("tokenHash", ": hashInvitationToken");

  it("allows the reviewed runtime hash-assignment property in its file", () => {
    const fixture = `  return {\n    token,\n    ${propertyMatch}(token),\n    expiresAt,\n  };`;
    expect(scanContentForSecrets(fixture, invitationServicePath)).toBeNull();
  });

  it("still fails a literal token-hash value in the same file", () => {
    const fixture = `tokenHash: "${join("a-hardcoded-literal", "-hash-value-here")}"`;
    expect(scanContentForSecrets(fixture, invitationServicePath)).not.toBeNull();
  });

  it("still fails a different, non-allowlisted token-related property in the same file", () => {
    const fixture = `sessionToken: ${join("computeSomethingElse", "Entirely")}(value)`;
    expect(scanContentForSecrets(fixture, invitationServicePath)).not.toBeNull();
  });

  it("does not allow the same matched text in a different, non-reviewed file", () => {
    expect(scanContentForSecrets(`${propertyMatch}(token)`, join("src/lib/organisation/", "other-service.ts"))).not.toBeNull();
  });

  it("is a distinct exception from the actions.ts/page.tsx assignment-form match", () => {
    // The object-literal colon form is allowlisted for this file; the
    // const-assignment equals form (reviewed for a different file) is not.
    const assignmentMatch = join("tokenHash ", "= hashInvitationToken");
    expect(scanContentForSecrets(`const ${assignmentMatch}(token);`, invitationServicePath)).not.toBeNull();
  });

  it("never echoes the matched text for a case it still flags", () => {
    const secretValue = join("a-hardcoded-literal", "-hash-value-here");
    const finding = scanContentForSecrets(`tokenHash: "${secretValue}"`, invitationServicePath);
    expect(JSON.stringify(finding)).not.toContain(secretValue);
  });
});

// Checkpoint A: the CA06 disposable-PostgreSQL CI gate workflow's two
// fixed synthetic literal passwords for its ephemeral postgres:16 service
// container (POSTGRES_PASSWORD, PGPASSWORD) — both the same literal value,
// never a real credential, never used outside that one job's disposable
// database. Built from parts for the same self-scanning reason as above.
describe("reviewed exact-match credential allowlist (.github/workflows/checkpoint-a-postgres.yml)", () => {
  const workflowPath = join(".github/workflows/", "checkpoint-a-postgres.yml");
  const postgresPasswordMatch = join("POSTGRES_PASSWORD", ": ca_disposable_only");
  const pgpasswordMatch = join("PGPASSWORD", ": ca_disposable_only");

  it("allows the reviewed synthetic disposable-database passwords in their file", () => {
    const fixture = [postgresPasswordMatch, pgpasswordMatch].join("\n");
    expect(scanContentForSecrets(fixture, workflowPath)).toBeNull();
  });

  it("still fails a different/new credential-like value added to the same file", () => {
    const fixture = `${join("SOME_OTHER", "_PASSWORD")}: ${join("a-real-look", "ing-secret-value")}`;
    expect(scanContentForSecrets(fixture, workflowPath)).not.toBeNull();
  });

  it("does not allow the same matched text in a different, non-reviewed file", () => {
    const finding = scanContentForSecrets(postgresPasswordMatch, join(".github/workflows/", "other.yml"));
    expect(finding).not.toBeNull();
  });

  it("never echoes the matched text for a case it still flags", () => {
    const secretValue = join("a-real-look", "ing-secret-value");
    const finding = scanContentForSecrets(`${join("SOME_OTHER", "_PASSWORD")}: ${secretValue}`, workflowPath);
    expect(JSON.stringify(finding)).not.toContain(secretValue);
  });
});

// Checkpoint A: the CA01-CA06 real-PostgreSQL integration suite's one
// synthetic test-user fixture, whose required Prisma passwordHash field is
// the fixed, self-documenting literal "not-a-login-hash" — every user this
// file creates has an @example.invalid email and is discarded with the
// disposable database at the end of the CI job.
describe("reviewed exact-match credential allowlist (tests/checkpoint-a/postgres.test.ts)", () => {
  const postgresTestPath = join("tests/checkpoint-a/", "postgres.test.ts");
  const passwordHashMatch = join("passwordHash", ': "not-a-login-hash"');

  it("allows the reviewed synthetic test-user fixture in its file", () => {
    expect(scanContentForSecrets(passwordHashMatch, postgresTestPath)).toBeNull();
  });

  it("still fails a different/new credential-like value added to the same file", () => {
    const fixture = `passwordHash: "${join("a-real-look", "ing-secret-value")}"`;
    expect(scanContentForSecrets(fixture, postgresTestPath)).not.toBeNull();
  });

  it("does not allow the same matched text in a different, non-reviewed file", () => {
    const finding = scanContentForSecrets(passwordHashMatch, join("tests/checkpoint-a/", "other.test.ts"));
    expect(finding).not.toBeNull();
  });

  it("never echoes the matched text for a case it still flags", () => {
    const secretValue = join("a-real-look", "ing-secret-value");
    const finding = scanContentForSecrets(`passwordHash: "${secretValue}"`, postgresTestPath);
    expect(JSON.stringify(finding)).not.toContain(secretValue);
  });
});

// Checkpoint B remediation: four later real-Postgres test files reuse the
// identical "not-a-login-hash" fixed literal reviewed above, in their own
// synthetic membership fixtures.
describe.each([
  "tests/board-product/checkpoint-b-lca-scenarios.test.ts",
  "tests/board-product/checkpoint-b-management-pack.test.ts",
  "tests/board-product/checkpoint-b-overview.test.ts",
])("reviewed exact-match credential allowlist (%s)", (relPath) => {
  const passwordHashMatch = join("passwordHash", ': "not-a-login-hash"');

  it("allows the reviewed synthetic test-user fixture in its file", () => {
    expect(scanContentForSecrets(passwordHashMatch, relPath)).toBeNull();
  });

  it("still fails a different/new credential-like value added to the same file", () => {
    const fixture = `passwordHash: "${join("a-real-look", "ing-secret-value")}"`;
    expect(scanContentForSecrets(fixture, relPath)).not.toBeNull();
  });

  it("does not allow the same matched text in a different, non-reviewed file", () => {
    const finding = scanContentForSecrets(passwordHashMatch, "tests/board-product/other.test.ts");
    expect(finding).not.toBeNull();
  });
});

// Checkpoint B remediation: bd08-board1-seed.test.ts sets
// BOARD_DEMO_PROVISIONING_TOKEN to its own randomUUID()-derived local
// variable — the matched text is the variable reference, never a literal.
describe("reviewed exact-match credential allowlist (tests/board-product/bd08-board1-seed.test.ts)", () => {
  const seedTestPath = join("tests/board-product/", "bd08-board1-seed.test.ts");
  const tokenVarMatch = join("BOARD_DEMO_PROVISIONING_TOKEN", " = provisioningToken");

  it("allows the reviewed variable-reference assignment in its file", () => {
    expect(scanContentForSecrets(tokenVarMatch, seedTestPath)).toBeNull();
  });

  it("still fails a literal token value assigned in the same file", () => {
    const fixture = join("BOARD_DEMO_PROVISIONING_TOKEN", ' = "', "a-real-look", 'ing-secret-value"');
    expect(scanContentForSecrets(fixture, seedTestPath)).not.toBeNull();
  });

  it("does not allow the same matched text in a different, non-reviewed file", () => {
    const finding = scanContentForSecrets(tokenVarMatch, "tests/board-product/other.test.ts");
    expect(finding).not.toBeNull();
  });

  it("never echoes the matched text for a case it still flags", () => {
    const secretValue = join("a-real-look", "ing-secret-value");
    const finding = scanContentForSecrets(`BOARD_DEMO_PROVISIONING_TOKEN = "${secretValue}"`, seedTestPath);
    expect(JSON.stringify(finding)).not.toContain(secretValue);
  });
});

// Checkpoint B remediation: checkpoint-b-seed-guard.test.ts's negative-case
// fixture for Fix 4 — a deliberately-wrong token value, self-documenting as
// a mismatch fixture, never a real credential.
describe("reviewed exact-match credential allowlist (tests/board-product/checkpoint-b-seed-guard.test.ts)", () => {
  const seedGuardTestPath = join("tests/board-product/", "checkpoint-b-seed-guard.test.ts");
  const mismatchTokenMatch = join("BOARD_DEMO_PROVISIONING_TOKEN", ' = "a-completely-different-token"');

  it("allows the reviewed mismatch-fixture token in its file", () => {
    expect(scanContentForSecrets(mismatchTokenMatch, seedGuardTestPath)).toBeNull();
  });

  it("still fails a different/new credential-like value added to the same file", () => {
    const fixture = join("BOARD_DEMO_PROVISIONING_TOKEN", ' = "', "a-real-look", 'ing-secret-value"');
    expect(scanContentForSecrets(fixture, seedGuardTestPath)).not.toBeNull();
  });

  it("does not allow the same matched text in a different, non-reviewed file", () => {
    const finding = scanContentForSecrets(mismatchTokenMatch, "tests/board-product/other.test.ts");
    expect(finding).not.toBeNull();
  });
});

// Second Checkpoint B corrective handoff: checkpoint-b-obligation-review.test.ts
// reuses the same already-reviewed "not-a-login-hash" fixture literal.
describe("reviewed exact-match credential allowlist (tests/board-product/checkpoint-b-obligation-review.test.ts)", () => {
  const obligationReviewTestPath = join("tests/board-product/", "checkpoint-b-obligation-review.test.ts");
  const passwordHashMatch = join("passwordHash", ': "not-a-login-hash"');

  it("allows the reviewed passwordHash fixture in its file", () => {
    expect(scanContentForSecrets(passwordHashMatch, obligationReviewTestPath)).toBeNull();
  });

  it("still fails a different/new credential-like value added to the same file", () => {
    const fixture = join("passwordHash", ': "', "a-real-look", 'ing-secret-value"');
    expect(scanContentForSecrets(fixture, obligationReviewTestPath)).not.toBeNull();
  });
});

// Second Checkpoint B corrective handoff §4: live-seed-port.ts's persona
// password variables — never a hardcoded value, always read from an
// operator-supplied file or generated fresh in memory.
describe("reviewed exact-match credential allowlist (scripts/board-demo/live-seed-port.ts)", () => {
  const liveSeedPortPath = join("scripts/board-demo/", "live-seed-port.ts");
  const suppliedPasswordMatch = join("suppliedPassword ", "= personaCredentials");
  const plaintextPasswordMatch = join("plaintextPassword ", "= suppliedPassword");

  it("allows the reviewed suppliedPassword/plaintextPassword variable assignments in this file", () => {
    expect(scanContentForSecrets(suppliedPasswordMatch, liveSeedPortPath)).toBeNull();
    expect(scanContentForSecrets(plaintextPasswordMatch, liveSeedPortPath)).toBeNull();
  });

  it("still fails a different/new credential-like value added to the same file", () => {
    const fixture = join("plaintextPassword", ' = "', "a-real-look", 'ing-secret-value"');
    expect(scanContentForSecrets(fixture, liveSeedPortPath)).not.toBeNull();
  });

  it("does not allow the same matched text in a different, non-reviewed file", () => {
    const finding = scanContentForSecrets(suppliedPasswordMatch, "scripts/board-demo/other.ts");
    expect(finding).not.toBeNull();
  });
});

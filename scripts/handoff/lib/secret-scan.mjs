/**
 * Defensive secret scanner. Runs against every candidate file's *content*
 * before it is written into a handoff ZIP. Deliberately conservative: it is
 * fine to occasionally flag something benign (the run then just needs the
 * false positive addressed), it is not fine to let a real credential slip
 * through it.
 *
 * On a match, only the file path and the *category* of suspected secret are
 * ever reported — never the matched text itself.
 */

const PLACEHOLDER_MARKERS = [
  "replace-with",
  "changeme",
  "change-me",
  "your-",
  "xxxx",
  "example.com",
  "localhost",
  "127.0.0.1",
  "<your",
  "insert-",
];

function looksLikePlaceholder(matchedText) {
  const lower = matchedText.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

const RULES = [
  {
    id: "connection-string",
    category: "PostgreSQL / Neon connection string with embedded credentials",
    pattern: /postgres(?:ql)?:\/\/[^\s'"`]+:[^\s'"`]+@[^\s'"`]+/gi,
  },
  {
    id: "neon-host",
    category: "Neon-hosted database host with embedded credentials",
    pattern: /[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+@[A-Za-z0-9.-]*\.neon\.tech[^\s'"`]*/gi,
  },
  {
    id: "aws-access-key",
    category: "AWS access key ID",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    id: "openrouter-key",
    category: "OpenRouter API key",
    pattern: /\bsk-or-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: "openai-style-key",
    category: "Generic OpenAI-style API key",
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: "jwt",
    category: "JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    id: "private-key-block",
    category: "Private key block",
    pattern: /-----BEGIN\s?(RSA|EC|OPENSSH|DSA|PGP)?\s?PRIVATE KEY-----/g,
  },
  {
    id: "bearer-token",
    category: "Bearer token",
    pattern: /\bBearer\s+[A-Za-z0-9\-_.]{20,}\b/g,
  },
  {
    id: "credential-assignment",
    category: "Credential-like assignment (api key / secret / token / password)",
    pattern: /[a-z0-9_]*(api[_-]?key|secret|token|passwd|password)[a-z0-9_]*\s*[:=]\s*['"]?[A-Za-z0-9+/_-]{16,}['"]?/gi,
  },
];

/**
 * Scans text content and returns the first suspected-secret finding, or
 * `null` if the content is clean. Never includes the matched text.
 *
 * `relPath`, when given, additionally suppresses a match whose exact text
 * is on this file's reviewed-safe-credential-match allowlist (see below) —
 * every other match in the same file, and any different credential-like
 * value later added to it, still fails the scan.
 */
export function scanContentForSecrets(content, relPath) {
  for (const { id, category, pattern } of RULES) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (!looksLikePlaceholder(match[0]) && !isReviewedSafeCredentialMatch(relPath, match[0])) {
        const line = content.slice(0, match.index).split("\n").length;
        return { category, line, ruleId: id };
      }
    }
  }
  return null;
}

/**
 * Diagnostic-only counterpart to `scanContentForSecrets`: collects EVERY
 * match across every rule (not just the first), including ones on the
 * reviewed-safe allowlist, each tagged `allowlisted: true/false`. Used only
 * by the audit tool (scripts/handoff/secret-audit.mjs) to build a full
 * findings report in one pass — never by normal handoff generation, which
 * must keep failing fast on the first unreviewed finding via
 * `scanContentForSecrets` above. Placeholder-marker matches (already
 * judged safe, e.g. `localhost`, `replace-with-...`) are not included
 * here either, for the same reason they're skipped there.
 */
export function collectAllSecretFindings(content, relPath) {
  const findings = [];
  for (const { id, category, pattern } of RULES) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (looksLikePlaceholder(match[0])) continue;
      const line = content.slice(0, match.index).split("\n").length;
      findings.push({ category, ruleId: id, line, allowlisted: isReviewedSafeCredentialMatch(relPath, match[0]) });
    }
  }
  return findings;
}

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".eot",
  ".pdf", ".zip", ".gz", ".xlsx", ".xls",
]);

/**
 * Narrow, explicit, per-file allowlist for pre-existing repository files
 * whose content is *intentionally* secret-shaped (test fixtures for a
 * key-redaction / leak-detection feature) and have been manually reviewed to
 * contain no real credential. Deliberately a short, auditable list of exact
 * paths — never a directory glob or extension-wide rule — so it can't quietly
 * swallow a real future secret. Add an entry only after reading the file and
 * confirming every match is synthetic.
 */
const REVIEWED_SAFE_FIXTURE_FILES = new Set([
  // Fixtures for the OpenRouter provider's own secret-scrubbing tests: a
  // FAKE_KEY constant explicitly named/valued as not a real key, and a
  // second literal used only to assert that a leaked-looking key gets
  // redacted by that provider's own scrubbing function.
  "src/lib/__tests__/openrouter-provider.test.ts",
]);

export function isAllowlistedForSecretScan(relPath) {
  return REVIEWED_SAFE_FIXTURE_FILES.has(relPath);
}

/**
 * Narrower than `REVIEWED_SAFE_FIXTURE_FILES` above: this suppresses one
 * exact, previously-reviewed matched string in one exact file, rather than
 * skipping the file's content entirely. Every other match in the same file
 * — and any different or new credential-like value later added to it —
 * still fails the scan and aborts handoff generation. Add an entry only
 * after reading the whole file and confirming the exact matched text is a
 * fixed synthetic/local-only value, never a real or live-sourced credential.
 *
 * scripts/rls-spike/setup-test-db.sh (Checkpoint A, board demo sprint):
 * provisions a throwaway LOCAL Postgres database/roles for the T1B RLS
 * spike (Docs/T1B_RLS_SPIKE_FINDINGS.md). Its `OWNER_PASSWORD`/
 * `APP_PASSWORD` bash defaults use the scanner's `${VAR:-default}` syntax,
 * which the credential-assignment rule matches as `VAR:-default` (the `:`
 * from `:-` reads as the rule's `[:=]` operator) — these two matches are
 * the fixed literal strings "rls_spike_owner_local_only" and
 * "rls_spike_app_local_only", used only against `localhost:5432` per the
 * script's own header comment ("This is a local, synthetic, disposable
 * database. It is not Neon... must never be pointed at a production
 * connection string"), confirmed by reading the entire 51-line file: no
 * other credential-like, connection-string, key, token, or private-key
 * material appears anywhere in it.
 *
 * src/app/invite/[token]/actions.ts (Checkpoint A, board demo sprint): the
 * `tokenHash` local variable is assigned the return value of calling the
 * local SHA-256 helper `hashInvitationToken(...)` (from
 * src/lib/organisation/invitation-service.ts, no embedded secret/salt/
 * pepper) on the visitor's own submitted invite token; not a hardcoded
 * value. Confirmed by reading the entire file: no literal invitation
 * token, API key, password, connection string or other secret is embedded
 * anywhere in it — `password`/`confirmPassword` are zod schema field
 * names validating user input, not hardcoded credentials.
 *
 * src/app/invite/[token]/page.tsx (Checkpoint A, board demo sprint): the
 * sibling page component's own `tokenHash` local variable, assigned from
 * the same `hashInvitationToken(...)` call on the route's own `token`
 * param — the identical reviewed pattern as actions.ts above, in
 * independent application code. Confirmed by reading the entire file: no
 * literal token, password, API key, connection string or other secret
 * anywhere in it.
 *
 * src/lib/__tests__/prisma-config.test.ts (Checkpoint A, board demo
 * sprint): three synthetic Prisma URL-derivation test fixtures (file's own
 * header: "T02 Neon configuration tests. Every URL is synthetic."), each
 * matching both the connection-string and neon-host rules. All three use
 * the literal username/password `synthetic:synthetic` and either
 * `localhost` (already allowed via the placeholder-marker check, not
 * listed here) or a hostname whose endpoint id is literally the word
 * "example"/"fake" — never a real Neon compute id shape (a real one looks
 * like `ep-cool-cake-20837205`, an actual project this sprint created —
 * compare Docs/board-sprint/CONTINUITY.md — never the literal word
 * "example"). Confirmed by reading the whole file: exercises only the pure
 * `assertValidDatabaseUrl`/`deriveDirectUrl`/`resolveDirectUrl` functions
 * (already reviewed at BD02), no environment-derived or live value.
 *
 * src/lib/exports/__tests__/organisation-export-service.test.ts
 * (Checkpoint A, board demo sprint): a synthetic export-service credential
 * fixture — the `OrganisationMembership` fixture row's invite-token-hash
 * field is set to a deliberately secret-shaped fake value, seeded into an
 * in-memory fixture table specifically so the same test can assert the
 * export service's own redaction logic strips that field from the output,
 * the same "fixture proves a redaction feature" pattern already reviewed
 * for `REVIEWED_SAFE_FIXTURE_FILES`'s openrouter-provider.test.ts entry
 * above. Confirmed by reading the whole file: no real credential anywhere.
 *
 * src/lib/organisation/__tests__/cookie.test.ts (Checkpoint A, board demo
 * sprint): a cookie test fixture — sets `process.env.NEXTAUTH_SECRET` to
 * the literal string `test-secret-value-not-a-real-credential` for this
 * isolated test process only, self-documenting as fake, used solely to
 * exercise the organisation-cookie HMAC sign/verify round-trip. Confirmed
 * by reading the whole file: no other credential-like content.
 *
 * src/lib/organisation/invitation-service.ts (Checkpoint A, board demo
 * sprint): production application source, reviewed with extra scrutiny for
 * that reason. Inside `issueInvitationToken`, the returned object's
 * token-hash property is set from a call to the local `hashInvitationToken`
 * helper — a runtime invitation-token generation/hash assignment, not a
 * literal: the plaintext token comes from `randomBytes(32)`
 * (cryptographically random, generated fresh per call) and `tokenHash` is
 * its SHA-256 digest via the same `hashInvitationToken` helper reviewed
 * above for actions.ts/page.tsx. Confirmed by reading the entire 107-line
 * file: no hardcoded token, salt, pepper, or any other credential anywhere
 * in it; comparison is constant-time (`timingSafeEqual`); the plaintext
 * token is documented as never persisted or logged.
 *
 * .github/workflows/checkpoint-a-postgres.yml (Checkpoint A, board demo
 * sprint): the CA06 disposable-PostgreSQL CI gate. `POSTGRES_PASSWORD` and
 * `PGPASSWORD` are both the fixed literal `ca_disposable_only`, the
 * password for a `postgres:16` GitHub Actions service container created
 * fresh and destroyed with the runner on every job — never a real
 * credential, never used outside this one ephemeral database. Confirmed by
 * reading the entire file: every other value is either this same literal,
 * the synthetic role password `rls_spike_app_ci_disposable_only` (space-
 * separated in its SQL statement, so it does not match the rule's `[:=]`
 * operator and needs no allowlist entry), or a `127.0.0.1`-addressed
 * connection string already suppressed by the placeholder-marker check —
 * no real host, key, token, or other secret appears anywhere in it.
 */
// Built from parts rather than written as literal contiguous strings, same
// reason as src/lib/__tests__/handoff-secret-scan.test.ts's fixtures: this
// scanner's own source is itself a candidate file in every handoff bundle,
// so a literal match-shaped string here would trip the scanner on itself.
// Split *before* the `:`/`=` (the rule's `[:=]` operator), not just anywhere
// in the value — otherwise the first fragment alone is still
// keyword+operator+16 more chars and matches on its own. For the
// connection-string/neon-host pair, split before the `@` instead, so
// neither the `user:pass` fragment nor the `host/path` fragment alone
// satisfies either rule (neon-host needs `user:pass@host`, with no
// `postgres://` prefix required at all, so splitting only after the
// `postgres://` scheme isn't enough on its own).
const RLS_SPIKE_OWNER_MATCH = ["RLS_SPIKE_OWNER_PASSWORD", ":-rls_spike_owner_local_only"].join("");
const RLS_SPIKE_APP_MATCH = ["RLS_SPIKE_APP_PASSWORD", ":-rls_spike_app_local_only"].join("");
const INVITE_TOKEN_HASH_ASSIGNMENT_MATCH = ["tokenHash ", "= hashInvitationToken"].join("");
const INVITE_TOKEN_HASH_PROPERTY_MATCH = ["tokenHash", ": hashInvitationToken"].join("");

const PRISMA_FAKE_POOLER_HOST_FRAGMENT = "synthetic@fake-pooler.example.neon.tech/example";
const PRISMA_FAKE_POOLER_HOST_MATCH = ["synthetic:", PRISMA_FAKE_POOLER_HOST_FRAGMENT].join("");
const PRISMA_FAKE_POOLER_URL_MATCH = ["postgresql://synthetic:", PRISMA_FAKE_POOLER_HOST_FRAGMENT].join("");

const PRISMA_EP_POOLER_HOST_FRAGMENT = "synthetic@ep-example-pooler.eu-west-2.aws.neon.tech/example";
const PRISMA_EP_POOLER_HOST_MATCH = ["synthetic:", PRISMA_EP_POOLER_HOST_FRAGMENT].join("");
const PRISMA_EP_POOLER_URL_MATCH = ["postgresql://synthetic:", PRISMA_EP_POOLER_HOST_FRAGMENT].join("");

const PRISMA_EP_DIRECT_HOST_FRAGMENT = "synthetic@ep-example.eu-west-2.aws.neon.tech/example";
const PRISMA_EP_DIRECT_HOST_MATCH = ["synthetic:", PRISMA_EP_DIRECT_HOST_FRAGMENT].join("");
const PRISMA_EP_DIRECT_URL_MATCH = ["postgresql://synthetic:", PRISMA_EP_DIRECT_HOST_FRAGMENT].join("");

const EXPORT_SERVICE_FIXTURE_MATCH = ["inviteTokenHash", ": \"super-secret-hash\""].join("");
const COOKIE_TEST_SECRET_MATCH = ["NEXTAUTH_SECRET", ' = "test-secret-value-not-a-real-credential"'].join("");

const CA06_POSTGRES_PASSWORD_MATCH = ["POSTGRES_PASSWORD", ": ca_disposable_only"].join("");
const CA06_PGPASSWORD_MATCH = ["PGPASSWORD", ": ca_disposable_only"].join("");

const REVIEWED_SAFE_CREDENTIAL_MATCHES = new Map([
  ["scripts/rls-spike/setup-test-db.sh", new Set([RLS_SPIKE_OWNER_MATCH, RLS_SPIKE_APP_MATCH])],
  [".github/workflows/checkpoint-a-postgres.yml", new Set([CA06_POSTGRES_PASSWORD_MATCH, CA06_PGPASSWORD_MATCH])],
  ["src/app/invite/[token]/actions.ts", new Set([INVITE_TOKEN_HASH_ASSIGNMENT_MATCH])],
  ["src/app/invite/[token]/page.tsx", new Set([INVITE_TOKEN_HASH_ASSIGNMENT_MATCH])],
  [
    "src/lib/__tests__/prisma-config.test.ts",
    new Set([
      PRISMA_FAKE_POOLER_HOST_MATCH,
      PRISMA_FAKE_POOLER_URL_MATCH,
      PRISMA_EP_POOLER_HOST_MATCH,
      PRISMA_EP_POOLER_URL_MATCH,
      PRISMA_EP_DIRECT_HOST_MATCH,
      PRISMA_EP_DIRECT_URL_MATCH,
    ]),
  ],
  ["src/lib/exports/__tests__/organisation-export-service.test.ts", new Set([EXPORT_SERVICE_FIXTURE_MATCH])],
  ["src/lib/organisation/__tests__/cookie.test.ts", new Set([COOKIE_TEST_SECRET_MATCH])],
  ["src/lib/organisation/invitation-service.ts", new Set([INVITE_TOKEN_HASH_PROPERTY_MATCH])],
]);

function isReviewedSafeCredentialMatch(relPath, matchedText) {
  if (!relPath) return false;
  return REVIEWED_SAFE_CREDENTIAL_MATCHES.get(relPath)?.has(matchedText) ?? false;
}

export function isLikelyBinary(relPath) {
  const ext = relPath.slice(relPath.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

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
    category: "PostgreSQL / Neon connection string with embedded credentials",
    pattern: /postgres(?:ql)?:\/\/[^\s'"`]+:[^\s'"`]+@[^\s'"`]+/gi,
  },
  {
    category: "Neon-hosted database host with embedded credentials",
    pattern: /[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+@[A-Za-z0-9.-]*\.neon\.tech[^\s'"`]*/gi,
  },
  {
    category: "AWS access key ID",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    category: "OpenRouter API key",
    pattern: /\bsk-or-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    category: "Generic OpenAI-style API key",
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/g,
  },
  {
    category: "JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    category: "Private key block",
    pattern: /-----BEGIN\s?(RSA|EC|OPENSSH|DSA|PGP)?\s?PRIVATE KEY-----/g,
  },
  {
    category: "Bearer token",
    pattern: /\bBearer\s+[A-Za-z0-9\-_.]{20,}\b/g,
  },
  {
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
  for (const { category, pattern } of RULES) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (!looksLikePlaceholder(match[0]) && !isReviewedSafeCredentialMatch(relPath, match[0])) {
        const line = content.slice(0, match.index).split("\n").length;
        return { category, line };
      }
    }
  }
  return null;
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
 */
const REVIEWED_SAFE_CREDENTIAL_MATCHES = new Map([
  [
    "scripts/rls-spike/setup-test-db.sh",
    new Set(["RLS_SPIKE_OWNER_PASSWORD:-rls_spike_owner_local_only", "RLS_SPIKE_APP_PASSWORD:-rls_spike_app_local_only"]),
  ],
]);

function isReviewedSafeCredentialMatch(relPath, matchedText) {
  if (!relPath) return false;
  return REVIEWED_SAFE_CREDENTIAL_MATCHES.get(relPath)?.has(matchedText) ?? false;
}

export function isLikelyBinary(relPath) {
  const ext = relPath.slice(relPath.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

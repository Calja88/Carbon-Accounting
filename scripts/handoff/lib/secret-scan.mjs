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
 */
export function scanContentForSecrets(content) {
  for (const { category, pattern } of RULES) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (!looksLikePlaceholder(match[0])) {
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

export function isLikelyBinary(relPath) {
  const ext = relPath.slice(relPath.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

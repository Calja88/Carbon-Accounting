/**
 * Explicit security exclusions applied on top of git's own file selection.
 * These run even against *tracked* files, so a credential accidentally
 * committed to the repository is still kept out of a handoff bundle.
 */

const EXCLUDE_REGEXPS = [
  // env / secret files (placeholder .env.example is explicitly allowed)
  /(^|\/)\.env(\..*)?$/i,
  // never traverse into these regardless of how they got tracked
  /(^|\/)\.git(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)out(\/|$)/,
  /(^|\/)build(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)dist(\/|$)/,
  // this tool's own output must never end up inside its own input
  /(^|\/)artifacts\/ai-handoff(\/|$)/,
  // keys, certs, credential bundles
  /\.pem$/i,
  /\.key$/i,
  /\.crt$/i,
  /\.cer$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /(^|\/)id_rsa(\.pub)?$/,
  /(^|\/)id_ed25519(\.pub)?$/,
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.aws(\/|$)/,
  // logs (may carry customer/environmental data), local db dumps
  /\.log$/i,
  /\.sqlite3?$/i,
  /\.dump$/i,
  /\.sql\.gz$/i,
];

const ALLOW_EXACT = new Set([".env.example"]);

/** True if `relPath` (posix-style, relative to repo root) must be excluded. */
export function isExcluded(relPath) {
  if (ALLOW_EXACT.has(relPath)) return false;
  return EXCLUDE_REGEXPS.some((pattern) => pattern.test(relPath));
}

export const EXCLUSION_SUMMARY = [
  ".env* (except the placeholder .env.example)",
  ".git/, node_modules/, .next/, out/, build/, coverage/, dist/",
  "artifacts/ai-handoff/ (handoff output itself)",
  "key/cert/credential files: *.pem, *.key, *.crt, *.cer, *.pfx, *.p12, id_rsa*, id_ed25519*, .ssh/, .npmrc, .aws/",
  "*.log, *.sqlite/.sqlite3, *.dump, *.sql.gz",
];

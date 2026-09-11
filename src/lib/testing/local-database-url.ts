/**
 * Both live integration tests (T81 immutability triggers, T83 outbox
 * resume) create and delete real rows. Their own headers already say they
 * must run "against a real, local, synthetic PostgreSQL instance — never
 * Neon, never real data", but their only guard was `DATABASE_URL` being set
 * *at all* — so on any machine whose shell exports a hosted DATABASE_URL,
 * `pnpm test` wrote into that database. That happened: a "Synthetic T81
 * trigger org" row was created in a hosted Neon database by an ordinary
 * test run on 2026-09-11.
 *
 * This is the one place that rule now lives. A hosted host is treated the
 * same as no database at all — the suite skips rather than writing to it.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "host.docker.internal", "db", "postgres"]);

/** The configured database URL, but only when it points at a local instance. Undefined otherwise, so the caller skips. */
export function localDatabaseUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const url = env.DIRECT_URL ?? env.DATABASE_URL;
  if (!url) return undefined;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return undefined; // unparseable: never assume it is safe to write to
  }
  return LOCAL_HOSTS.has(hostname) ? url : undefined;
}

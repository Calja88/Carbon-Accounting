/**
 * Shared DB-availability guard for T83 load-test scripts
 * (Docs/PHASE8_HARDENING_READINESS_SPEC.md §6). Every script in
 * `scripts/load-test/` connects to a local/synthetic Postgres only — never
 * Neon, never a database holding real data — and skips cleanly (exit 0,
 * printed reason) when neither `DIRECT_URL` nor `DATABASE_URL` is set,
 * matching the convention already used by
 * `src/lib/retention/__tests__/immutability-trigger.integration.test.ts`
 * and `src/lib/rls-spike/__tests__/rls-spike.integration.test.ts`.
 */

export function resolveLoadTestDbUrl(): string | null {
  return process.env.DATABASE_URL ?? process.env.DIRECT_URL ?? null;
}

/**
 * Call at the top of every load-test script's `main()`, before importing
 * any module that reaches `@/lib/prisma` (that singleton reads
 * `process.env.DATABASE_URL` at import time — see `prisma/schema.prisma`'s
 * `env("DATABASE_URL")` datasource — so a script whose own connection
 * differs from the singleton's would silently operate on two different
 * databases). If only `DIRECT_URL` is set, this copies it into
 * `DATABASE_URL` so every Prisma client in the process — the script's own
 * and the app's singleton alike — connects to the same instance.
 *
 * Exits the process (code 0) if no local database is configured at all.
 */
export function requireLoadTestDb(scriptName: string): string {
  const url = resolveLoadTestDbUrl();
  if (!url) {
    console.log(
      `[${scriptName}] Skipping: no DATABASE_URL/DIRECT_URL configured. ` +
        `Set one to a local, synthetic Postgres instance (never Neon, never real data) to run this load test.`,
    );
    process.exit(0);
  }
  if (/neon\.tech/i.test(url)) {
    console.error(
      `[${scriptName}] Refusing to run: the configured database URL looks like a Neon host. ` +
        `Load tests must run against a local/synthetic Postgres instance only.`,
    );
    process.exit(1);
  }
  process.env.DATABASE_URL = url;
  return url;
}

export function percentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const index = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(0, index)];
}

export function summarise(samplesMs: number[]) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

export function reportSloLine(label: string, summary: ReturnType<typeof summarise>, targetP95Ms: number) {
  const pass = summary.p95 <= targetP95Ms;
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${label}: p50=${summary.p50}ms p95=${summary.p95}ms p99=${summary.p99}ms ` +
      `max=${summary.max}ms n=${summary.count}  (target p95 <= ${targetP95Ms}ms)`,
  );
  return pass;
}

# Job resume, retry and dead-letter recovery (T83)

Covers the T21 outbox/job framework's operational behaviour under crash and
poison-message conditions, and the T83 dead-letter requeue path added to
close the gap this document's drill found. No real environmental data or
production database is used anywhere in this document or its scripts.

## How the framework behaves (T21, pre-existing)

- **Enqueue is idempotent.** `enqueueTenantJob`/`enqueuePlatformJob`
  (`src/lib/jobs/outbox-service.ts`) key on `(topic, idempotencyKey)`;
  re-enqueueing the same pair returns the existing row instead of creating
  a duplicate. `idempotencyKey` uniqueness is per-topic across the whole
  platform, not per tenant — a caller enqueueing per-tenant work must
  include the tenant id in its own `idempotencyKey` (see the note in
  `scripts/load-test/outbox-throughput.ts`).
- **Leasing is exclusive.** `leaseNextBatch` uses one
  `SELECT ... FOR UPDATE SKIP LOCKED` folded into an `UPDATE`, so two
  concurrent workers can never claim the same row.
- **Retry moves a message to `RETRY`** with a delayed `availableAt`;
  **exhausting `maxAttempts` moves it to `DEAD_LETTER`** instead of
  retrying forever.

## The gap this task found and fixed

`leaseNextBatch`'s candidate query only matched
`status IN ('PENDING', 'RETRY')` — **not** `LEASED`. A worker that crashed
after claiming a message (never reaching `completeJob`/`failJob`) left that
message `LEASED` forever: once its `leaseUntil` passed, nothing ever
re-claimed it, silently contradicting the function's own documented
guarantee ("a crashed worker's lease expires and the message becomes
claimable again without any recovery step").

**Fix**: `src/lib/jobs/outbox-service.ts`'s `leaseNextBatch` candidate query
now includes `'LEASED'` in the status list, so a stale lease (`leaseUntil <
now()`) is reclaimed regardless of which status left it there.

Found by `scripts/load-test/outbox-throughput.ts`'s resume-after-crash
scenario (simulates a dangling lease with `leaseUntil` in the past and
asserts a fresh worker recovers it). Regression-guarded by
`src/lib/jobs/__tests__/outbox-resume.integration.test.ts`, which runs
against a real local Postgres instance (raw `FOR UPDATE SKIP LOCKED` SQL
can't be meaningfully exercised by the fake in-memory `prisma` the rest of
`outbox-service.test.ts` uses) and skips cleanly when no database is
configured.

## Dead-letter recovery (new in T83)

`requeueDeadLetterMessage(ctx, id)` (tenant-scoped) and
`requeuePlatformDeadLetterMessage(id)` (for platform jobs like
`legal.sync`) move a `DEAD_LETTER` message back to `PENDING` with:

- `attempts` reset to `0` — a fresh `maxAttempts` budget, not a continuation
  of the old one, since a message is normally only requeued after an
  operator has fixed whatever made it poison;
- `lastErrorCode`/`lastErrorMessage`/`deadLetteredAt` cleared;
- idempotent scoping (`WHERE status = 'DEAD_LETTER'`) — calling it twice on
  the same message is safe: the second call finds nothing and returns
  `false`.

No UI/route exposes these yet — they are the service-layer primitive Phase
8 asks for ("outbox backlog/retry/dead-letter/recovery" test coverage); an
operator console or admin endpoint over them is a separate, later change if
the owner wants one before pilot.

## Verifying it

- Unit tests (fake db, no network): `src/lib/jobs/__tests__/outbox-service.test.ts`
  — `describe("requeueDeadLetterMessage / requeuePlatformDeadLetterMessage (T83)")`.
- Integration test (real local Postgres, skips without one):
  `src/lib/jobs/__tests__/outbox-resume.integration.test.ts`.
- Load-test script (synthetic scale, real local Postgres, skips without
  one): `scripts/load-test/outbox-throughput.ts` — seeds 2,000 jobs across
  5 synthetic tenants, drives a worker loop with a 10% synthetic transient
  failure rate, then separately exercises the resume-after-crash and
  dead-letter-requeue scenarios above. Run:

  ```bash
  DATABASE_URL=postgresql://... npx tsx scripts/load-test/outbox-throughput.ts
  ```

## Residual risk / owner decision

- No alert exists yet for a growing dead-letter backlog or a stuck worker
  (`getPlatformWorkerHealth`/`getOrganisationWorkerHealth` in
  `src/lib/jobs/health.ts` expose the counts; wiring them to an alert is
  outside T83's scope — see `docs/operations/slo-sli.md`'s "Not yet
  enforced" section).
- Requeueing a dead-lettered message is currently a service-layer call with
  no audit-event side effect and no permission check beyond tenant
  ownership. Before exposing it through any UI/route, add a permission
  check and an audit event, matching the pattern
  `organisation-export-service.ts` uses for `organisation.export.generate`.

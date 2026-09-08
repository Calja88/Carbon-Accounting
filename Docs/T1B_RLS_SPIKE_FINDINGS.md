# T1B — PostgreSQL RLS defence-in-depth spike: findings

Status: spike complete, passed on a minimal vertical slice. This is not a
rollout and does not change any existing application authorisation path —
see "What this spike does not prove" below before treating RLS as a decided
Phase 1+ direction.

## What was built

One isolated table, `RlsSpikeRecord` (`prisma/schema.prisma`), with no
relation to `Organisation` or any other model and no application code path
reading or writing it outside `src/lib/rls-spike/`. Its migration
(`prisma/migrations/20260811112221_t1b_rls_spike_slice/`) is the only schema
change in this spike:

- `ENABLE ROW LEVEL SECURITY` on `RlsSpikeRecord`.
- One policy, `rls_spike_org_isolation`, using and checking
  `"organisationId" = current_setting('app.organisation_id', true)`.
- Grants `SELECT/INSERT/UPDATE/DELETE` on that one table to a dedicated
  non-owner role (`rls_spike_app`); `PUBLIC` has no access.
- A `DO` block that fails the migration loudly if `rls_spike_app` doesn't
  already exist, making the owner/runtime role split an explicit
  precondition rather than an assumption.

Runtime code (`src/lib/rls-spike/`) opens a Prisma `$transaction` and sets
the organisation context with `set_config('app.organisation_id', $1, true)`
(the parameterised equivalent of `SET LOCAL`, since `SET LOCAL` itself
doesn't accept a bind parameter) as the first statement — `is_local = true`
means it is cleared automatically at commit or rollback, never persisting
on the underlying connection.

`scripts/rls-spike/setup-test-db.sh` provisions a throwaway local
PostgreSQL 16 database (`paragon_rls_spike_test`) and the two roles below.
It never touches Neon and is not part of `npm run build`/deploy.

| Role | Used for | Privileges |
|---|---|---|
| `rls_spike_owner` | Runs migrations (stands in for `DIRECT_URL`) | Owns `RlsSpikeRecord`; bypasses RLS as owner; never used at runtime |
| `rls_spike_app` | Runtime queries (stands in for pooled `DATABASE_URL`) | `NOSUPERUSER NOBYPASSRLS`, not the owner; only the four DML grants above |

## Tests run and results

`src/lib/rls-spike/__tests__/rls-spike.integration.test.ts`, run against the
local synthetic database above — **7/7 passed**:

1. Missing `app.organisation_id` denies both reads (0 rows) and writes
   (insert throws).
2. A transaction scoped to organisation A sees only A's rows; scoped to B,
   only B's.
3. A transaction cannot insert a row into an organisation other than its
   own context (`WITH CHECK` rejects it).
4. **Connection reuse cannot leak context**: with `connection_limit=1`
   forcing every transaction through one physical backend connection (the
   same hazard Neon's PgBouncer transaction-mode pooling creates), a
   transaction scoped to A followed immediately by one scoped to B on the
   same connection sees only B; a third transaction with no context set at
   all sees nothing — proving the setting doesn't survive a commit even
   when the socket is reused.
5. A rolled-back transaction leaves no row behind (verified via the owner
   connection, which bypasses RLS) and leaks no context to the next
   transaction on the same client.
6. The runtime role cannot disable RLS (`ALTER TABLE ... DISABLE ROW LEVEL
   SECURITY` fails with Postgres `42501 — must be owner of table`).
7. `RlsSpikeRecord` is owned by `rls_spike_owner`, not `rls_spike_app`; the
   owner connection is shown to bypass RLS entirely (by design — this is
   exactly why it must never serve runtime traffic).

When `RLS_SPIKE_OWNER_DATABASE_URL`/`RLS_SPIKE_APP_DATABASE_URL` are unset
(the default for `npm test` and CI, which have no local Postgres), the
whole suite skips rather than failing — this spike is not wired into the
regular test gate.

## Operational limitations and rollout blockers

- **Role provisioning is out-of-band and Neon-specific work this spike
  doesn't cover.** The synthetic spike setup creates `rls_spike_app`
  manually. The checked-in migration activates its isolated RLS policy only
  when that role exists; ordinary application environments leave RLS disabled
  on the unused spike table so this experiment cannot block later migrations.
  Neon supports
  additional Postgres roles, but creating and rotating credentials for a
  non-owner runtime role per environment (dev/preview/prod) needs its own
  infra automation (Neon API or console) before any real table adopts this
  pattern — that automation does not exist yet.
- **The Prisma connection pool, not PgBouncer, was the pooling hazard
  actually exercised.** `connection_limit=1` forces Prisma's own pool to
  reuse one physical connection, which reproduces the specific hazard the
  spec is worried about (a stale `SET LOCAL`/`set_config` value surviving
  onto someone else's transaction), but it is not a substitute for testing
  against Neon's actual PgBouncer transaction-mode pooler, which has its
  own connection-handoff timing. That should happen against a real Neon
  branch before rollout, still with synthetic data only.
- **Every tenant-scoped query must move onto `runInOrganisationScope`
  (or equivalent) for RLS to add anything.** A query issued outside that
  helper — including through the existing `prisma` singleton in
  `src/lib/prisma.ts` — has no organisation context set and would either
  break (denied) or, if a future policy is looser, silently rely on RLS
  alone. RLS is additive defence-in-depth on top of the tenant
  repositories (`src/lib/repositories/`), not a replacement for them; nothing
  about T15's `tenantWhere`/`assertOwned` guards changes as a result of
  this spike.
- **Not tested: the background/platform-job path** named in
  `Docs/PHASE1_ADVERSARIAL_TEST_MATRIX.md` §9 ("background platform job
  uses an explicit privileged path with separate credentials and audit").
  No job/outbox framework exists yet (that's T21, Phase 2), so there is
  nothing to exercise this against; it stays an open acceptance item for
  whichever task first adds a privileged background path onto an
  RLS-protected table.
- **Prisma's interactive-transaction default timeout (5s) and pool size
  now matter for RLS correctness, not just latency.** Any future write path
  that spans a slow external call inside `runInOrganisationScope` risks the
  transaction (and its context) being torn down mid-flight; that's a
  correctness constraint on top of the existing performance one.
- **The spike migration is not production RLS rollout.** It deliberately does
  not fail an application release when `rls_spike_app` is absent. Any future
  migration that enables RLS on a real customer-owned table must be a separate
  owner-approved change with an explicit release preflight for role and
  credential provisioning.

## Deployment-history repair

The original migration failed in an application database because it required
the local spike role even though T1B documented that Neon provisioning was not
implemented. Its historical SQL remains unchanged. The release helper marks
that migration applied when failed or pending because it affects only the
isolated spike table; the immediately following repair migration uses idempotent table/index
creation and an optional-role branch to establish the same safe end state from
any partial run. Generic application builds never run recovery or migration
deployment.

## Decisions for the programme owner

1. **Whether to proceed past the spike at all.** The spec is explicit:
   "Do not expand RLS until the spike passes." It has passed on this one
   table; deciding to apply RLS to any real domain table is a separate,
   explicit decision this spike does not make for you.
2. **If proceeding, which table(s) get RLS first**, and whether that's
   framed as defence-in-depth alongside the existing tenant-repository
   guards (recommended by the spec, §1 decision 12) or as a replacement for
   any of them (not recommended — no finding here supports removing the
   application-layer checks).
3. **Who owns Neon role/credential provisioning automation** before any
   real migration can depend on a pre-existing non-owner runtime role, and
   on what cadence those credentials rotate.
4. **Whether to validate against a real Neon branch** (synthetic data only)
   before the "PgBouncer transaction-mode pooling" limitation above is
   closed, or accept the local-pool simulation as sufficient evidence.

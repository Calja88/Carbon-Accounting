# Checkpoint A remediation — evidence record

Astra decision: **APPROVE AFTER REQUIRED FIXES**. This document records the integration of Astra's pre-authored Checkpoint A remediation pack (`carbon-ledger-checkpoint-a-remediation-pack.zip`) into PR #63, the checks run, and the deviations made.

## Identity

- **Starting HEAD (last reviewed Checkpoint A HEAD):** `b7262edd66316a496a29b76cd6f5f2b2837d8962`
- **Final HEAD (this commit's parent):** `5215a23aefb9d161f69e0a9bcdca403b96e69f7c`
- **Branch:** `board/foundations-2026-09-22`
- **PR:** [#63](https://github.com/Calja88/Carbon-Accounting/pull/63) (draft, unmerged)
- **Astra pack identity:** `carbon-ledger-checkpoint-a-remediation-pack.zip`, `reviewed_head: b7262edd66316a496a29b76cd6f5f2b2837d8962`, `reconstructed_from_base: c9487554b058087736e031b06a672f2f61fcfbcb`, 67 repository files per `FILE_MANIFEST.json`.

## Pre-integration verification

Before applying anything, all 52 `FILE_MANIFEST.json` entries carrying a `baseline_sha256` were hashed against the live repository at `b7262ed`: **52/52 matched exactly**, confirming the pack was built against the actual PR #63 head with zero drift. `git apply --check` against the cumulative patch (`PATCHES/checkpoint-a-remediation.patch`) succeeded with no conflicts.

## Remediation commits

| Commit | Description |
|---|---|
| `b7c1f56` | Astra remediation pack applied in full (CA01–CA06), 67 files, zero deviations required for the patch itself |
| `7e4fa06` | CI deviation: provision the pre-existing `rls_spike_app` role in the disposable Postgres service before migration deploy |
| `5215a23` | CI deviation: remove a pre-existing placeholder `DATABASE_URL`/`DIRECT_URL` from `ci.yml`'s typecheck/lint/test job |

## Astra pack groups applied

- **CA01** — `FOR UPDATE` row lock on the tenant `ActivityEntry` inside the primary calculation transaction (`src/lib/entries-service.ts`, `src/lib/calculation-integrity.ts`, `src/lib/repositories/row-locks.ts`); exact valid-replay vs. partial/duplicate integrity handling; Scope 2 pair atomicity.
- **CA02** — shared parent-nonconformity lock for action/containment/root-cause/review/closure prerequisites (`src/lib/ems/nonconformity/*`, `src/lib/ems/nonconformity/locked-transaction.ts`); explicit `reviewCycle` field on `Nonconformity`/`EffectivenessReview` plus DB uniqueness (`EffectivenessReview_nc_cycle_key`); adverse outcomes reopen the original even when a follow-up is created.
- **CA03** — `carbon.view` guards on Carbon/calculation/report reads and actions, `carbon.report.export` for CSV, whole-report denial (no filtered fragment) for restricted memberships, restricted-aspect denial, server-side AI chat disablement (`src/lib/rbac/carbon-access.ts`, `src/lib/rbac/ems-access.ts`, `reports/*`, `api/ai/*`).
- **CA04** — evidence/document classification authorization on metadata, lists, counts, links and bytes, honoring the higher of object/controlling revision/document classification with no hidden-relation leakage (`src/lib/documents/classification-access.ts` and call-site updates).
- **CA05** — removed unconditional synthetic-data claims from programme, evidence, documents, notifications and dashboard screens; no environment variable substituted as demo proof.
- **CA06** — disposable PostgreSQL 16 GitHub Actions gate (`.github/workflows/checkpoint-a-postgres.yml`, `tests/checkpoint-a/*`).

No accounting methodology changed. Location-based Scope 2 remains the corporate headline; market-based stays a separate companion figure. `pnpm@10.28.0`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` `allowBuilds`, and H00 handoff tooling are unchanged. No BD05 or BD08 work performed. No production data, migration or seed touched.

## Deviations

| File | Baseline mismatch / reason | Exact adaptation | Protected behaviour preserved | Verification |
|---|---|---|---|---|
| `.github/workflows/checkpoint-a-postgres.yml` (commit `7e4fa06`) | Astra's CA06 workflow didn't account for a pre-existing baseline migration, `20260811112221_t1b_rls_spike_slice` (T1B RLS spike, predates Checkpoint A, unrelated to CA01–CA06), which deliberately raises unless the `rls_spike_app` role already exists — role/credential provisioning is intentionally kept out of Prisma's migration history (`scripts/rls-spike/setup-test-db.sh`, `Docs/T1B_RLS_SPIKE_FINDINGS.md`). First CI run failed with Prisma error P3018 on this migration. | Added one CI step that creates `rls_spike_app` (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, matching the local spike script's role attributes exactly) in the disposable service database before `prisma migrate deploy` runs. | No migration content changed, no history invented/deleted/backfilled, no Checkpoint A control touched. The role has no elevated privilege — it cannot bypass RLS or disable the policy. | Re-run of `checkpoint-a-postgres` on commit `5215a23` (workflow run [34349349842](https://github.com/Calja88/Carbon-Accounting/actions/runs/34349349842)) passed, including the migration step: `PASS: cumulative migrations applied to an empty database; second deployment left history identical.` |
| `.github/workflows/ci.yml` (commit `5215a23`) | Pre-existing bug, unrelated to the Astra pack and to Checkpoint A: this job set a placeholder `DATABASE_URL`/`DIRECT_URL` (`postgresql://ci:ci@localhost:5432/ci_placeholder`) with no actual Postgres service present. Two integration tests (`src/lib/jobs/__tests__/outbox-resume.integration.test.ts`, `src/lib/retention/__tests__/immutability-trigger.integration.test.ts`) gate on `process.env.DIRECT_URL ?? process.env.DATABASE_URL` to decide whether to skip; the placeholder made them believe a real database was configured, so their `beforeAll` tried to connect to nothing and failed. This predates the board sprint (`ci.yml` and both test files originate in the EMS lineage merged in BD01) and would have failed identically on any prior push to this PR. | Removed the two placeholder env vars from the job. Nothing else in that job (typecheck, lint, the mocked-Prisma test suite) requires `DATABASE_URL` to be set — confirmed locally: `prisma generate` succeeds without it, and `src/lib/prisma.ts`'s `assertValidDatabaseUrl` tolerates it being unset. | No test skipped, disabled, or weakened. The real-Postgres Checkpoint A gate is unaffected — it has its own working database and these same two tests run for real there instead of skipping. | Reproduced the failure and the fix locally byte-for-byte (`pnpm test` with/without the placeholder vars: 127 files / 1984 tests passed either way once the vars are absent, matching CI's own `129 passed / 1 skipped` — the two integration tests now run for real inside the CA06 job's own Postgres service instead of skipping under `ci.yml`). CI re-run on `5215a23` (`Typecheck, lint, test`, run [34349349856](https://github.com/Calja88/Carbon-Accounting/actions/runs/34349349856)) passed: 129 files / 1988 tests passed, 1 file / 7 tests skipped, 0 failed. |

No deviation was required in the Astra-supplied CA01–CA06 source/test files themselves — the cumulative patch applied cleanly against the verified baseline.

## Schema / migration result

`prisma/migrations/20260909120000_checkpoint_a_review_cycles/migration.sql` adds only `Nonconformity.reviewCycle` (nonnegative, default 0) and `EffectivenessReview.reviewCycle` (positive), plus the `EffectivenessReview_nc_cycle_key` unique index and SQL checks, per `PRISMA/migration-notes.md`. No calculation-level uniqueness constraint, no table deletion, no history deletion. The seed change binds only the synthetic EMS seed's own review to cycle 1 — not a live backfill. No production migration or seed was run at any point.

**Verified on the disposable CI database (empty at job start):** all 45 cumulative migrations (44 pre-existing + this one) applied cleanly; a second `prisma migrate deploy` against the same database left the migration history byte-identical (`PASS: cumulative migrations applied to an empty database; second deployment left history identical.`).

## CA01–CA06 results (real PostgreSQL CI, workflow run [34349349842](https://github.com/Calja88/Carbon-Accounting/actions/runs/34349349842), commit `5215a23`)

`tests/checkpoint-a/postgres.test.ts` — **14/14 passed** against a real disposable `postgres:16` service, using fault-injection triggers (removed after the run, never entering application code) and genuine concurrent connections observed waiting in `pg_stat_activity`, not mocks:

- **CA01:** two genuinely concurrent first calculations commit exactly one Scope 2 pair; a fault-injected second Scope 2 insert failure rolls back the first insert and entry state.
- **CA02:** two first `EFFECTIVE` reviews racing yield one decision with concurrent closes yielding one closure/audit; a close racing action-reopening cannot close over an incomplete action; an adverse review racing closure never closes a pending/ineffective optional-review cycle; a fault-injected audit-write failure rolls back the review, parent state and all audit writes; DB uniqueness (`EffectivenessReview_nc_cycle_key`) rejects a second decision for the same NC/cycle (confirmed via a real constraint-violation error in the Postgres log); a new cycle rejects old submissions and never reuses the old `EFFECTIVE` result; a revoked permission is re-resolved inside the NC transaction (not read stale from before the lock).
- **CA03/CA04:** denies foreign tenant, restricted site/entity, and missing permission; protects metadata, bytes, links, counts and mixed revision parents on real rows.
- **BD03/CA05 interaction:** issued `ReportSnapshot` payload and links remain frozen after source/factor changes and recalculation.

The Postgres server log independently confirms real trigger enforcement during the run: `AuditEvent` rows rejected `UPDATE`/`DELETE` as append-only, `LegalHold` rows rejected mutation outside the release transition, and real lock-wait/deadlock-detected events occurred between the two concurrent test connections (expected under genuine row-lock contention, handled by the test's retry/ordering logic — the suite passed).

Static/logic-level authorization coverage (`tests/checkpoint-a/{classification,guards,read-boundaries}.test.ts`) ran as part of the mocked-Prisma suite and passed.

## Local checks (commit `5215a23`, before the CI-only deviations were needed for CA06 itself)

- `pnpm install --frozen-lockfile` — PASS
- `pnpm exec prisma generate` / `pnpm exec prisma validate` — PASS
- `pnpm exec tsc --noEmit` — PASS, 0 errors
- `pnpm run lint` — PASS, 0 errors, 4 pre-existing warnings (unrelated files)
- `pnpm test --maxWorkers=2` — PASS, 127 files / 1984 tests passed, 3 files / 11 tests skipped (no DB), 0 failed
- `git diff --check` — PASS

## Real PostgreSQL CI

- **Workflow:** `.github/workflows/checkpoint-a-postgres.yml` (`checkpoint-a-postgres` check)
- **Final passing run:** [34349349842](https://github.com/Calja88/Carbon-Accounting/actions/runs/34349349842), commit `5215a23aefb9d161f69e0a9bcdca403b96e69f7c` — **SUCCESS**
- **Companion check:** `Typecheck, lint, test` (`.github/workflows/ci.yml`), run [34349349856](https://github.com/Calja88/Carbon-Accounting/actions/runs/34349349856) — **SUCCESS**, 129 files / 1988 tests passed, 1 file / 7 tests skipped, 0 failed (the two real-Postgres integration tests ran for real here too, using the CA06 job's own disposable database, and passed)
- Migration and JUnit evidence uploaded as the `checkpoint-a-postgres-evidence` artifact on that run.
- No `continue-on-error`, no skipped gate, no mocked DB substitution, no `db push`, no resolve-as-applied, no external/paid database used.

## Deferred (Astra-approved, unchanged from prior Checkpoint A scope)

BD05 Executive Overview; full honest-metrics UI integration; Category 3 report-preparation separation; BD08 management-pack issuance race; general EMS redesign; universal RLS; AI polish; further visual redesign. The 9 other EMS services with the same pre-transaction-check/`fourEyesEnabled` pattern outside the BD02-demonstrated chain (flagged in `CONTINUITY.md`) remain deliberately unfixed, out of this remediation's scope.

## Not merged

PR #63 remains draft/unmerged. This remediation does not merge it and does not begin BD05.

# Backup/restore drill and migration rollback/forward plan (T83)

Docs/PHASE8_HARDENING_READINESS_SPEC.md §6: "backup/PITR and full restore
to isolated environment"; "migration expand/backfill/contract with
rollback/roll-forward." Everything on this page was exercised against a
local, disposable, synthetic PostgreSQL 16 instance — **never Neon, never a
database holding real environmental or customer data**.

## Restore drill (executed for this task)

This drill was actually run, not just described, as part of T83:

```bash
# 1. Dump a local synthetic database.
pg_dump -h localhost -U postgres -Fc -f backup-drill.dump paragon_carbon_loadtest

# 2. Restore into a freshly created, isolated database — never the source.
createdb -h localhost -U postgres paragon_carbon_restore_drill
pg_restore -h localhost -U postgres -d paragon_carbon_restore_drill \
  --no-owner --role=postgres backup-drill.dump

# 3. Reconcile: schema migration history and record counts for a known
#    synthetic organisation must match the source exactly.
psql -d paragon_carbon_restore_drill -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;"
psql -d paragon_carbon_restore_drill -c "SELECT count(*) FROM \"Organisation\" WHERE id='drill-org-1';"
psql -d paragon_carbon_restore_drill -c "SELECT count(*) FROM \"ComplianceObligation\" WHERE \"organisationId\"='drill-org-1';"
```

**Result (this run):** 41/41 migrations reconciled; `Organisation` count
1/1; `ComplianceObligation` count 25/25. Drill succeeded — schema and data
counts for the synthetic dataset matched exactly between source and
restored, isolated database. The restore database was dropped immediately
afterwards.

### Production shape (Neon)

The commands above are the local-Postgres stand-in for Neon's actual
mechanism. Neon provides point-in-time recovery (PITR) and branch-based
restore natively — the equivalent production drill is:

1. Create a new Neon branch from a specific timestamp/LSN (PITR) or from
   the latest snapshot, isolated from the production branch.
2. Point a throwaway application instance at the new branch's connection
   string (never reuse the production `DATABASE_URL`).
3. Run the same reconciliation queries as above (migration count, and a
   handful of known record counts/checksums for a canary organisation kept
   specifically for this purpose) against the restored branch.
4. Discard the branch once reconciliation passes.

**Owner decision needed:** this repository has no automated Neon-branch
restore-drill script yet (it would need Neon API credentials this session
does not have and should not be given). The mechanism (dump/restore,
reconciliation) is proven above against a local instance; wiring it to the
Neon API for a scheduled production drill is follow-up work, not attempted
here. RTO/RPO numeric targets are likewise an owner decision — see
`docs/operations/slo-sli.md`.

## Migration expand/backfill/contract with rollback/roll-forward

This repository already follows the expand/backfill/contract pattern for
schema changes that can't be a single safe migration (e.g. T1A's tenant
`organisationId` backfill). The existing tooling:

- `scripts/contract-migration-preflight.ts` (`npm run migrate:contract-preflight`)
  — **read-only** preflight that reports the same diagnostic counts the
  contract migration's own guard checks, so an operator can see whether a
  contract-phase migration (the one that finally makes a backfilled column
  `NOT NULL`/adds the real constraint) is safe to run *before* deploying it,
  rather than finding out from a failed-and-rolled-back deploy.
- `scripts/resolve-failed-migration.mjs` (wrapped into `npm run db:migrate:deploy`)
  — applies only explicitly audited migration-history resolutions
  (`--rolled-back`/`--applied` for two specific, reviewed migrations) before
  `prisma migrate deploy` runs. It deliberately never auto-resolves an
  *unknown* failure — an unaudited P3009 blocker stays a blocker until a
  human inspects `_prisma_migrations.logs` and the actual schema.

### Roll-forward (the primary, tested path)

Prisma's migration model has no auto-generated "down" migration — the
project's practice, consistent with `resolve-failed-migration.mjs`'s own
doc comment, is **roll-forward**: a broken migration is fixed by a new,
corrected migration (or a reviewed `prisma migrate resolve` entry plus an
idempotent repair migration), never by hand-editing history. This is the
same pattern already used for the two entries in
`MIGRATION_RESOLUTIONS`: one superseded migration resolved
`--rolled-back` (its replacement is the roll-forward), one partial-failure
migration resolved `--applied` (its designed-idempotent-repair follow-up
migration is the roll-forward).

**Verified as part of this task**: `npx prisma migrate deploy` was run
end-to-end against a fresh local database, including the audited
`--applied` resolution for `20260811112221_t1b_rls_spike_slice` (which
requires the `rls_spike_app` role — see
`scripts/rls-spike/setup-test-db.sh` — to exist first); all 41 migrations
applied cleanly.

### Rollback (destructive migrations only)

For an expand/backfill/contract sequence specifically, each phase is
designed to be individually safe to stop after:

- **Expand** (add the new nullable column/table): safe to leave applied
  indefinitely; no rollback needed — old code paths ignore the new column.
- **Backfill** (populate the new column from existing data, via a script or
  migration `DO` block): re-runnable/idempotent by construction (see
  `contract-migration-preflight.ts`'s comment: "every count here simulates
  what the migration's own mechanical backfill ... would resolve"); if a
  backfill produces wrong values, the fix is another backfill migration
  (roll-forward), not a schema rollback.
- **Contract** (drop the old column, add `NOT NULL`/the real constraint):
  the only genuinely destructive phase. Rollback here means: restore from
  the pre-contract backup/PITR point (see the restore drill above), *not*
  attempting to reverse a dropped column's migration in place. This is why
  the preflight script exists — to make the contract phase something you
  only run once you already know it will succeed.

**Owner decision needed:** no automated "abort a specific migration and
restore data from the same point" script beyond the manual restore drill
above exists. For a pilot-scale deployment this is an acceptable manual
procedure; a fully automated rollback pipeline is out of scope for T83.

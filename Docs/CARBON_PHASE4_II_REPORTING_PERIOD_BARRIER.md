# Carbon Phase 4-ii — reporting period and mutation barrier

Implemented on `board/product-2026-09-22`, based on `68c7c5257dc27e5cdc37f1ed742695a120181d5a` (includes Phase 3-iii, Carbon 4-i and Phase 3-vi schema contracts). Scope stops at the backend accounting boundary.

## Model and authoritative rule

- `ReportingPeriod`: unique `(organisationId, siteId, monthStart)`, `OPEN | CLOSED`. UTC calendar months; the **activity's `periodStart`** assigns its month, matching existing factor selection. A straddling entry is not reassigned using `periodEnd`.
- Missing period rows mean **OPEN**. Historical data is not backfilled or inferred closed from issued reports. Reads never materialise periods.
- Migration `20260915170000_carbon_reporting_period_barrier` adds this model, its month constraint, and accounting triggers. No existing data is rewritten.
- **Authoritative guard:** SQL `carbon_assert_period_allows_mutation` in that migration. Service adapter: `src/lib/carbon/reporting-period-guard.ts`, `assertPeriodAllowsMutation(tx, ctx, siteId, accountingDate)`. Always call inside the writing transaction. The triggers call the **same SQL function**, including for direct Prisma/raw SQL/bulk writes.
- `carbon_lock_accounting_site` serializes writes and close/reopen at the site row, even before a period row exists. Its no-value-change update also forces stale RepeatableRead/Serializable transactions to abort after a concurrent close. Concurrent close/write ordering is tested in both directions.
- SQL rejects with `REPORTING_PERIOD_CLOSED`; the adapter throws `ReportingPeriodClosedError` with `.code = "REPORTING_PERIOD_CLOSED"` and message: “This reporting period is closed. Reopen the period before changing accounting data.” `isReportingPeriodClosedError` also recognises Prisma trigger errors. Other database failures propagate.

## Protected paths

| Path | Control |
| --- | --- |
| Ordinary entry creation; ExpenseIn bulk import; accepted document extraction | Shared entry service guard plus `ActivityEntry` INSERT trigger |
| Entry edits/status/rejection/provenance and destructive deletion | UPDATE/DELETE triggers; **both old and new** date/site/organisation checked; document provenance service also guards explicitly |
| First calculation and awaiting-factor recovery | Guard before factor resolution/status or calculation writes; existing stored-calculation replay stays read-only |
| Factor-import backfill | Closed entries remain `AWAITING_FACTOR`; other open entries continue. Return includes `skippedClosedPeriod`; existing `calculation.backfilled` SYSTEM audit includes this count. `stillAwaitingFactor` includes closed skips. Existing export name retained |
| Category 3 derivation/report preparation | Guard in each derived-row transaction plus `Calculation` triggers, including parent/source resolution |
| Direct calculation create/update/delete/reparenting | Triggers inspect persisted parent ownership and accounting month |
| Commuting survey headers, responses and generated entries | Service guard plus triggers on headers, responses, entries and calculations; response parent changes check both parents |
| Energy contract create/update/delete | Same guard across **all effective months**; open-ended contracts cannot rewrite inputs applicable to a closed month |
| Future ordinary update/delete/createMany/upsert paths | Existing triggers apply without needing a UI-route check |

Stored entries, evidence, calculations, dashboards, live reports and frozen report snapshots remain readable. Factor import/preview and factor publication contracts are unchanged. No system-actor bypass exists.

## Phase 4-iii integration boundary

- `getReportingPeriod(context, siteId, accountingDate)`: `carbon.view`, tenant/site scope, read only.
- `setReportingPeriodState(context, { siteId, accountingDate, state, reason })`: **`carbon.entry.approve`**, tenant/site scope, mandatory reason, runtime state validation. Pass a freshly resolved server-side `OrganisationContext`; never accept actor, membership, organisation or permissions from the browser.
- State and hash-chained audit commit together. Events: `reporting_period.closed`, `reporting_period.opened`; resource: `reporting_period`. Actor comes from context; membership and reason are recorded. Reopening checks active organisation-wide or period-specific legal holds. Repeating an existing state is a no-op.
- Period identities cannot move and period rows cannot be deleted. Route all application transitions through the service so permissions, hold checks and audit are preserved.
- Phase 4-iii adds the UI, confirmation/disclosure and action error serialization. There is no close/reopen route or UI in 4-ii. The primitive does **not** certify collection completeness or implement four-eyes approval, fingerprints or report issue policy.

## Phase 4-iv and limitations

- No value-edit/void service or Activity Data Register was introduced; direct database edit/delete attempts are nevertheless guarded. Phase 4-iv owns recalculation/supersession/restatement semantics; entry corrections must wait for those controls. Closed periods get no bypass.
- `runCalculationsForEntry` still returns existing primary rows unchanged. `recalculatePendingEntries` remains first-calculation backfill, despite its compatibility-preserved name.
- Existing multi-transaction workflow boundaries remain: creation can commit before calculation/provenance, surveys commit in steps, and Category 3 preparation can retain earlier open-row progress before a later closed row fails. No write can commit into an already closed month; workflows are not newly made all-or-nothing.
- Site-wide serialization is intentionally simple; different sites remain independent for the period barrier (auditing already serializes per organisation). Measure contention before narrowing to month locks. Transaction serialization/deadlock failures must roll back, never bypass the guard.
- State authorization is the service boundary; database administration is not an application close/reopen API. No new elevated-role mechanism exists.
- Apply the migration in an explicitly approved environment **before running this code**. Only disposable local PostgreSQL was migrated/tested; no hosted database or deployment was touched.

## Validation

- Prisma client generation; `tsc --noEmit`; focused ESLint on changed TypeScript.
- Relevant mocked Vitest suites: **667 passed** (entries, numeric audit, reports/analytics, tenant isolation, documents, factor preview/import/publication contracts and guard tests). Local integration suite skips when hosted/unconfigured, using the existing `localDatabaseUrl` safeguard.
- **20 new tests passed** (3 guard unit tests + 17 real PostgreSQL integration tests): open/closed service behavior, direct CRUD/raw SQL/bulk rollback, date/site/organisation boundaries, stored results/report reads, backfill SYSTEM skips, Category 3, survey/contract paths, permissions/legal holds, audit rollback and close/write races including stale snapshots.
- Full **54-migration chain applied successfully** to a fresh local PostgreSQL 18 database after provisioning the pre-existing `rls_spike_app` role required by the historical RLS migration. Synthetic rows only; no real factor ingestion. Integration setup retains audit/period rows intentionally; dispose of the test database instead of disabling history controls.
- Run integration tests with both `DATABASE_URL` and `DIRECT_URL` explicitly pointing to the same migrated local test database: `pnpm exec vitest run src/lib/carbon/__tests__ --maxWorkers=1`.

GitNexus impact flagged entry creation/calculation as CRITICAL and Category 3 as HIGH; checked callers include imports, surveys, document acceptance, reporting and demo seeds. Existing user/other-task changes are excluded from the Phase 4-ii commit.

## Changed files

- `prisma/schema.prisma`; `prisma/migrations/20260915170000_carbon_reporting_period_barrier/migration.sql`
- `src/lib/carbon/reporting-period-guard.ts`; `src/lib/carbon/reporting-period-service.ts`
- `src/lib/entries-service.ts`; `src/lib/documents-service.ts`; `src/lib/audit/types.ts`
- `src/lib/carbon/__tests__/reporting-period-guard.test.ts`; `src/lib/carbon/__tests__/reporting-period.integration.test.ts`; `src/lib/__tests__/carbon-numeric-audit.test.ts`
- This handoff; `Docs/PHASE4_PREFLIGHT.md`; `Docs/board-sprint/CONTINUITY.md`

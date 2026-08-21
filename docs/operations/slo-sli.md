# Service level objectives and indicators (T83)

Docs/PHASE8_HARDENING_READINESS_SPEC.md §6: "Define SLOs before load
testing." These are **starting, owner-approvable** targets measured at the
synthetic scale exercised by `scripts/load-test/`, not production-proven
numbers — nothing here has been measured against real traffic or a Neon
production instance. An owner (the platform/EMS lead) must sign off on
these before they are treated as commitments; until then, treat them as
working targets that the load-test scripts hold the codebase to.

No SLO in this document was measured against real environmental data or a
production database. All figures below come from `scripts/load-test/*.ts`
run against a local, disposable, synthetic PostgreSQL 16 instance.

## How to read this document

Each row is one SLI (service level indicator — a measured thing) with a
target SLO (the objective). "Measured by" names the concrete test/script
that currently checks it; a row with no script is a target only, not yet
enforced in CI, and is called out under "Not yet enforced" below.

## Latency

| SLI | Target (p95, synthetic scale) | Measured by |
|---|---|---|
| Tenant dashboard aggregate/list read | <= 300ms | `scripts/load-test/tenant-dashboard-scale.ts` |
| Outbox worker batch round (100 messages) | <= 2,000ms | `scripts/load-test/outbox-throughput.ts` |
| Full organisation export generation (~8k records, 145 sections) | <= 15,000ms | `scripts/load-test/organisation-export-scale.ts` |
| Full legal sync cycle (3,000 synthetic items, 60 pages) | <= 30,000ms | `scripts/load-test/legal-sync-synthetic-scale.ts` |

Owner decision needed: these targets were picked to be comfortably above
what the current implementation achieves at this synthetic scale (see
"Measured results" below), not derived from a real usage profile or an
agreed contract with pilot customers. Before Phase 8 sign-off, an owner
should confirm the scale assumptions (tenant count, records per tenant)
match the intended pilot cohort.

### Measured results (most recent local run, synthetic data only)

```text
outbox-throughput.ts:            worker round p50=329ms p95=380ms p99=440ms  (2,000 jobs, 5 tenants)
tenant-dashboard-scale.ts:       recent-items feed p50=5ms p95=6ms  (10 tenants x 2,000 rows)
                                   obligation count p50=2ms p95=3ms
organisation-export-scale.ts:    export generation p50=703ms p95=733ms      (8,002 records, 145 sections)
legal-sync-synthetic-scale.ts:   full sync cycle ~21.5s                     (3,000 items, 60 pages)
```

## Freshness / staleness

| SLI | Target | Measured by |
|---|---|---|
| Legal sync cursor staleness (time since last successful cycle) | Owner-approved cadence; alert if `LegalSyncCursor.lastSuccessAt` older than 2x the configured poll interval | `getLegalSyncHealth` (`src/lib/ems/legal/legal-sync-health.ts`, pre-existing T42 module) — no automated alert wired yet, see "Not yet enforced" |
| Reminder/notification delivery delay (due date -> notification raised) | Owner-approved; no numeric target set yet | Not yet enforced — see below |
| Scheduled-job freshness (outbox backlog depth, oldest PENDING/RETRY message age) | Backlog depth and stale-lease count visible via `getPlatformWorkerHealth`/`getOrganisationWorkerHealth` (`src/lib/jobs/health.ts`, pre-existing T21 module) | Not yet enforced as an alert |

## Reliability / correctness

| SLI | Target | Measured by |
|---|---|---|
| Job resume-after-crash (dangling lease reclaimed) | 100% — every stale-leased message becomes claimable again | `scripts/load-test/outbox-throughput.ts` ("resume-after-crash"); regression-guarded by `src/lib/jobs/__tests__/outbox-resume.integration.test.ts` |
| Dead-letter recovery (requeue then process exactly once more) | 100% | `scripts/load-test/outbox-throughput.ts` ("dead-letter recovery"); unit-tested in `src/lib/jobs/__tests__/outbox-service.test.ts` |
| Legal sync cursor safety under rate limiting | Cursor never advances/marks success on a page that failed with a retryable error | `scripts/load-test/legal-sync-synthetic-scale.ts` ("rate-limit safety") |
| Organisation export completeness | Every organisation-scoped Prisma model (schema-derived, currently 145 sections) present with an accurate record count, zero foreign-tenant rows | `scripts/load-test/organisation-export-scale.ts`; unit-tested in `src/lib/exports/__tests__/organisation-export-service.test.ts` (pre-existing T81) |
| Error rate (5xx / job permanent-failure rate) | Owner-approved target; no numeric SLO set yet | Not yet enforced — see below |

## Restore / recovery objectives

| SLI | Target | Reference |
|---|---|---|
| Recovery Point Objective (RPO) | Owner-approved; Neon PITR window is the practical ceiling (see Neon project retention setting) | `docs/operations/backup-restore.md` |
| Recovery Time Objective (RTO) | Owner-approved; no numeric target set yet — restore drill in `docs/operations/backup-restore.md` measures actual time taken on the next drill run | `docs/operations/backup-restore.md` |

## Not yet enforced (owner decisions / follow-up work)

These SLIs have no numeric target or no automated check yet. They are
listed rather than silently omitted, per the Phase 8 spec's "targets require
owner approval" instruction:

- **Notification/reminder delivery delay**: `reminder-service.ts` (T24) has
  no delivery-latency metric wired to `src/lib/observability/metrics.ts`
  yet. Adding `METRIC_NAMES` entries and instrumenting the reminder
  dispatch path is in scope for a follow-up task, not this one (T83 is
  scoped to the load-test/observability *framework*, not instrumenting
  every call site retroactively).
- **Error rate**: no HTTP-layer metrics collection exists yet (no
  middleware calls `incrementCounter`/`observeDuration` from
  `src/lib/observability/metrics.ts`). The registry and API are in place;
  wiring every route is a larger, separate change.
- **Numeric RTO/RPO**: depend on the production Neon plan's PITR window and
  an owner-approved acceptable data-loss window — a business decision, not
  a code decision. `docs/operations/backup-restore.md` documents the
  procedure and measures actual restore time on each drill; an owner should
  set the numeric target once a drill has been run against a
  production-shaped (still synthetic) dataset.

## Observability

`src/lib/observability/logger.ts` and `src/lib/observability/metrics.ts`
(new in T83) provide the structured-logging and in-process-metrics
primitives Docs/PHASE8_HARDENING_READINESS_SPEC.md §6 asks for:

- `logEvent()` writes one JSON line per call, always through `redact()`
  first — field names in `REDACTED_FIELD_NAMES` (tokens, secrets,
  passwords, prompts, evidence text, environmental values) are replaced
  with `"[REDACTED]"` regardless of nesting depth, satisfying "no
  environmental values, evidence text, personal certificate data, tokens or
  prompts in logs."
- `incrementCounter`/`observeDuration` record counters and latency
  histograms in `METRIC_NAMES` (HTTP, DB, job, dead-letter, requeue,
  outbox backlog, legal cursor staleness, export duration, storage
  failure, auth denial) with `getMetricsSnapshot()` for read-back.

This is deliberately an in-process registry, not a Prometheus/Datadog/etc.
integration — picking an external metrics backend is an infrastructure
decision outside T83's scope. Every call site goes through this module, so
swapping backends later touches one file, not every caller.

Owner decision needed: which external metrics/log backend (if any) this
wires into for the pilot deployment, and the alerting/runbook wiring
Docs/PHASE8_HARDENING_READINESS_SPEC.md §6 calls for ("alerts with runbook
links"). Not attempted here — no alerting infrastructure exists in this
repository yet.

# 0005 — Database-backed transactional outbox for jobs

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The EMS expansion requires reliable background work: legal-register sync,
reminders/notifications, and overdue-action escalation. None of this exists
today. The platform is a modular monolith with one PostgreSQL database and no
external queue infrastructure, and the immediate priority is correctness
(no duplicate processing, no lost jobs) over throughput.

## Decision

Implement a database-backed transactional outbox and job framework as the
initial job infrastructure: jobs carry a lease, attempt count, scheduled
time, idempotency key, and an explicit status progression through
completion, failure, and dead-letter. Two workers must not be able to process
the same lease concurrently. Tenant-scoped jobs carry explicit organisation
context rather than relying on ambient state. State-changing writes that must
also enqueue a job (e.g. a membership change emitting an audit event, or an
obligation change scheduling a reminder) use the outbox pattern so the
business write and the job enqueue commit atomically in the same transaction.

## Alternatives considered

- **Adopt an external queue (e.g. a managed message broker) immediately.**
  Rejected for this phase: it adds an operational dependency disproportionate
  to current scale, and does not solve the atomicity problem between a
  domain write and a job enqueue as directly as a same-database outbox does.
- **Fire-and-forget in-process async calls without persistence.** Rejected:
  jobs would not survive a process restart, cannot be retried reliably, and
  provide no dead-letter visibility for a poison job.
- **Cron-only polling scripts with no lease/idempotency model.** Rejected:
  without leasing, concurrent workers (or overlapping deploys) could double-
  process a job; without idempotency keys, retries could duplicate side
  effects such as duplicate reminder notifications.

## Consequences

- Legal sync, reminders, and future EMS scheduled work all depend on this
  framework existing first (it is a dependency of later legal-sync and
  notification tasks).
- Job health/observability (attempts, dead-letter, worker health) must be
  visible enough to detect a stalled or poisoned job in operation.
- This decision does not preclude moving to an external queue later if scale
  requires it; the job data model is designed to be replaceable behind a
  stable enqueue/consume interface.

## Rollback / migration note

The outbox/job tables are additive and unrelated to existing carbon/LCA
schema. Rollback before any job producer exists is a plain schema revert;
after producers exist, rollback requires draining or explicitly discarding
pending jobs rather than a blind table drop, since pending jobs may represent
outstanding reminders or sync work.

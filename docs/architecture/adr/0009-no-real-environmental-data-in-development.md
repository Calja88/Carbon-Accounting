# 0009 — No real environmental data in development, seeds, or tests

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The EMS expansion is being developed and reviewed by agents and engineers
working from static source inspection, without a connected production
database. Environmental data (activity data, monitoring/calibration results,
incident details, legal-compliance evaluations) is sensitive both
commercially and, in some cases, from a regulatory-disclosure perspective.
The expansion plan and every implementation task packet require synthetic
fixtures only, and this constraint needs to be a recorded, durable decision
rather than an instruction repeated informally per task.

## Decision

No real environmental data may be added, copied, uploaded, logged, or used in
tests, seeds, or fixtures anywhere in the EMS expansion. All fixtures,
seed data, and test inputs are wholly synthetic: fabricated organisations,
entities, sites, measurements, incidents, and legal scenarios that do not
represent actual customer operations or actual regulatory findings. This
applies equally to structural backfill commands (which must not print or
inspect real environmental record values even when operating against
existing group data) and to any recorded fixtures used for legal-source
connector tests, which are limited to small, non-sensitive official published
text.

## Alternatives considered

- **Allow anonymised real data for realism.** Rejected: anonymisation of
  operational environmental data is error-prone and provides no material
  benefit over well-constructed synthetic fixtures for the purposes of
  schema, workflow, and permission testing.
- **Permit real data only in a separate, access-restricted environment.**
  Rejected for this phase: the expansion explicitly targets a state where no
  production database connection or real data ingestion is required to
  develop or review any task; introducing a restricted-but-real-data
  environment would undermine that guarantee and complicate review.
- **Allow real data in manual/exploratory testing only, not automated
  tests.** Rejected: the risk (accidental commit, log leakage, fixture
  reuse) is the same regardless of whether the test is manual or automated;
  the simplest durable rule is a blanket prohibition.

## Consequences

- Every task's acceptance criteria that mention fixtures must be checked
  against this rule, not re-derived per task.
- Backfill and migration tooling that touches existing group data must report
  counts only, never values, when environmental records are involved.
- Recorded HTTP fixtures for legal-source clients are limited to small,
  reuse-permitted official publication text, not customer data.

## Rollback / migration note

This is a process/governance decision with no code or schema attached, so
there is nothing to migrate or roll back. Any future exception would require
a superseding ADR, not an ad hoc task-level override.

# Tenant isolation register (T80)

Implements Docs/PHASE8_HARDENING_READINESS_SPEC.md §3 ("T80 cross-tenant
adversarial suite"). This is a register of the CI gate itself, not a claim
of certification — see the "residual risks" section below for what this
gate does and does not cover.

## What's gated

`src/lib/security/resource-endpoint-registry.ts` lists every customer-owned
resource root reachable through a tenant repository accessor
(`findTenant*`, `require*InScope`, `getAuditEvent`,
`findActiveTenantMembership`) across:

- `src/lib/repositories/ems-repository.ts` (T23-T73, 60 resources)
- `src/lib/repositories/carbon-repository.ts` (T16, 7 resources)
- `src/lib/repositories/lca-repository.ts` (T17, 11 resources)
- `src/lib/repositories/documents-repository.ts` (T22, 4 resources)
- `src/lib/repositories/notifications-repository.ts` (T24, 3 resources)
- `src/lib/repositories/audit-repository.ts` (T20, 1 resource)
- T34 environmental monitoring/calibration (4 resources, service-shaped —
  see the registry file's comment for why these don't have a separate
  `findTenant*` wrapper)

`src/lib/security/__tests__/resource-endpoint-registry.test.ts` is the CI
gate:

1. It parses each repository module's source for exported resource-accessor
   functions and fails if any of them is missing from the registry — adding
   a new customer-owned resource without registering it breaks the build.
2. It fails if a registered entry's function name never appears in its
   declared test file — registering a resource without giving it a real
   cross-tenant negative test also breaks the build.

## Where the tests live

- `src/lib/repositories/__tests__/*.test.ts` — one file per repository
  module, following the existing per-module convention. `ems-repository.test.ts`
  contains a table-driven generator (`GENERIC_RESOURCES`) that proves, for
  every one of the ~60 uniform EMS resource accessors: same-tenant read
  allowed; foreign-tenant id denied (identically to a missing id, so a
  denial reveals no existence metadata); and, for every parent-guarded
  child resource, a same-tenant record attached to the wrong parent is
  denied too (nested-parent substitution).
- `src/lib/ems/monitoring/__tests__/monitoring-tenant-isolation.test.ts` —
  T34's four service-shaped resources (MonitoringPlan, MonitoringResult,
  MonitoringEquipment, EquipmentCalibration), tested through their real
  public service functions rather than a repository wrapper.
- `src/lib/__tests__/tenant-adversarial/aggregate-invariance.test.ts` — the
  dashboard aggregate engine (`buildAnalyticsSnapshot`): Organisation A's
  totals, site breakdown, and awaiting-factor/flagged counts are identical
  whether or not Organisation B data exists.
- Exports/downloads, notifications, jobs, and AI-context isolation for the
  carbon/LCA/documents/EMS domains were already covered by existing
  per-module test files (`evidence-service.test.ts`, `incident-service.test.ts`,
  `checklist-finding-report.test.ts`, `outbox-service.test.ts`,
  `ai-tenant-isolation.test.ts`, etc.) before this task; T80 added
  `notifications-repository.test.ts` (previously the only repository module
  without one) and closed a gap in `lca-repository.test.ts`
  (`findTenantEvidenceBlob` had no cross-tenant test).

## Two synthetic tenants

Every test in this register uses the same fixtures
(`src/lib/__tests__/tenant-fixtures.ts`): Organisation A ("Aster Demo") and
Organisation B ("Birch Demo"), per
Docs/PHASE1_ADVERSARIAL_TEST_MATRIX.md. No real environmental, customer, or
personal data appears anywhere in this suite.

## CI

`.github/workflows/ci.yml` runs typecheck, lint, and the full test suite
(which includes every file above) on every push/PR — making this suite
mandatory, per the T80 acceptance criterion.

## Residual risks / owner decisions

- This is a unit-level suite against a mocked Prisma client, not a live
  Neon/Postgres integration suite. The Phase 8 spec's "optional RLS
  integration suite against disposable Neon branch/local Postgres" is not
  implemented here — `T1B_RLS_SPIKE_FINDINGS.md` covers RLS separately.
  Owner decision: whether a live-database run of this same registry is
  required before a real pilot.
- Search functionality does not currently exist in the EMS surface (no
  `searchParams`-driven search routes were found), so "search" isolation is
  covered only where carbon/LCA already implement it (pre-existing tests).
- AI context isolation for EMS is currently limited to narrative storage
  (`ManagementReviewAiNarrative`, covered by the registry sweep) — there is
  no EMS-specific AI generation/actor-scoping module yet comparable to
  `src/lib/ai/authorization.ts`'s carbon/LCA scoping.
- The "is referenced by its declared test file" CI check is a text-presence
  check (the function name appears in the file), not a coverage-instrumented
  guarantee that the reference is inside a passing negative-path assertion.
  It catches the "nobody wrote this a test at all" failure mode; it does
  not by itself prove the assertion's polarity is correct — that still
  depends on code review of new tests.

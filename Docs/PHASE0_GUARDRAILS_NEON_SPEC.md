# Phase 0 Build Specification — Regression Guardrails and Neon Baseline

**Implements:** T00–T03  
**Prerequisite:** none.  
**Outcome:** proven current invariants, architecture decisions, Neon-safe connection/release configuration and a ratcheting rule against new unscoped database access. No production database connection or data migration.

## 1. Fixed decisions

- Phase 0 changes no carbon/LCA calculation behaviour and adds no EMS domain schema.
- Tests use current code fixtures or wholly synthetic fixtures; no seed/database with real environmental data.
- `DATABASE_URL` is pooled runtime traffic; `DIRECT_URL` is Prisma CLI/migrations.
- `next build` is non-mutating. Production migrations run once in an explicit release job.
- Existing direct Prisma calls are recorded in a temporary exact-file allowlist. New direct calls outside approved repository/infrastructure locations fail CI.
- The allowlist is ratcheting: entries may be removed, never broadened without an ADR/review.
- Relevant Next.js 16 bundled documentation must be read before code/config edits, per repository AGENTS.md.

## 2. Regression invariant manifest

Create `docs/architecture/regression-invariants.md` with an owner test for each:

| ID | Invariant | Evidence/test requirement |
|---|---|---|
| C-01 | Factor value/source/vintage/unit snapshot on Calculation | Replacing catalogue factor does not alter existing calculation row |
| C-02 | Scope 2 location/market companion rows not double-counted | Headline/report golden fixture |
| C-03 | Flagged/awaiting-factor treatment remains explicit | Report/data-quality fixture |
| C-04 | Derived Category 3 calculation is idempotent | Re-run fixture creates no duplicate |
| C-05 | ReportSnapshot is immutable and pins calculation links/payload | Attempted regeneration creates successor snapshot |
| L-01 | LCA engine is pure/repeatable | Same snapshot returns identical exact totals/rows |
| L-02 | Dimensional units fail closed | Incompatible unit test |
| L-03 | Placeholder factor blocks verification readiness | Validation fixture |
| L-04 | Issued LCA version is frozen | Live edit does not alter version payload |
| L-05 | Corporate and product totals are never combined | Report/export boundary test |
| A-01 | AI cannot authoritatively calculate/auto-accept | Schema/service test |
| A-02 | Core app works without AI provider key | Availability/config test |

Do not assert implementation claims solely from README; point to executable test names.

## 3. ADR set

Create numbered ADRs:

```text
0001-organisation-above-entity.md
0002-membership-rbac-and-default-compliance-approver.md
0003-tenant-aware-repositories-before-rls.md
0004-neon-pooled-runtime-direct-migrations.md
0005-database-outbox-for-jobs.md
0006-controlled-evidence-storage.md
0007-preserve-carbon-and-lca-domain-boundaries.md
0008-official-legal-detection-human-compliance-decisions.md
0009-no-real-environmental-data-in-development.md
```

Each ADR: status, date, context, decision, alternatives, consequences, rollback/migration note. ADR 0002 explicitly states Organisation Administrator lacks compliance-obligation approval by default.

## 4. Neon configuration contract

Environment:

```text
DATABASE_URL=<pooled Neon runtime connection>
DIRECT_URL=<direct Neon migration/CLI connection>
```

Requirements:

- `prisma.config.ts` reads `DIRECT_URL` for CLI/migrations.
- Runtime Prisma client reads `DATABASE_URL`; use one reusable instance per runtime.
- If adopting `@prisma/adapter-neon`, do it in its own focused PR with current official version-compatible configuration and tests.
- Add `db:migrate:deploy`/release command; remove migration from generic `build`.
- Configuration validation must redact URLs/passwords in errors/logs.
- Document local Postgres option and Neon branch strategy without provisioning or connecting as part of this task.
- Preview environments use synthetic/empty branches only; production branching requires an approved sanitisation policy.

## 5. Unscoped database-access rule

Default allowed direct Prisma locations after the rule is introduced:

```text
src/lib/prisma.ts
src/lib/repositories/**
src/lib/platform-repositories/**
src/lib/jobs/infrastructure/**
```

All current other files form an exact temporary allowlist generated from the inspected baseline. The check compares current matches to the allowlist:

- a new file/match fails;
- a removed match permits/reminds removal from allowlist;
- wildcard directory exceptions outside approved locations fail review;
- route/action/page direct Prisma access is always allowlist debt.

Also detect imports of Prisma client wrapper, not only literal `prisma.` calls.

## 6. Files

```text
docs/architecture/regression-invariants.md
docs/architecture/decisions/0001-*.md ... 0009-*.md
scripts/check-unscoped-prisma.mjs
scripts/unscoped-prisma-allowlist.json
src/lib/__tests__/regression-invariants.test.ts (or focused existing suites)
package.json
.env.example
prisma.config.ts
src/lib/prisma.ts
README.md deployment/config section
CI workflow/config files present in repository
```

Do not edit `prisma/schema.prisma` except a syntax change strictly required by current Prisma configuration; no domain migration belongs in Phase 0.

## 7. Tests and failure cases

- Every manifest invariant points to a passing named test.
- Test count/coverage additions do not weaken/delete existing assertions.
- Build command does not call `prisma migrate deploy` or any DB mutation.
- Release migration command uses direct URL and fails clearly when absent.
- Runtime config uses pooled URL and redacts secret on malformed/missing configuration.
- Static check passes baseline allowlist.
- Adding direct Prisma use to a new action file fails static check.
- Adding an allowed-repository call passes.
- Broad glob exception is rejected by review/test.
- No command connects to/provisions Neon in unit tests.
- No real data appears in fixtures, logs or snapshots.

## 8. PR sequence

```text
P0-01 Regression invariant manifest and missing golden tests (T00)
P0-02 ADR set (T01)
P0-03 Neon pooled/direct config and release migration command (T02)
P0-04 Unscoped-Prisma inventory, allowlist and CI ratchet (T03)
```

## 9. Definition of done

The current carbon/LCA/AI invariants are executable and green; architectural decisions are recorded; builds cannot migrate a database; Neon runtime/migration responsibilities are separated; and CI rejects expansion of tenant-unaware database access.

## 10. Minimal Claude context

| Task | Provide |
|---|---|
| T00 | invariant table + existing test file list and named production modules only |
| T01 | ADR list + decisions from current architecture/EMS plan; documentation only |
| T02 | Neon contract + package/config/prisma client/deployment README; current official Prisma/Neon docs |
| T03 | unscoped-access section + exact current direct-Prisma file inventory; CI/package scripts |


# Regression invariant manifest

**Task:** T00 — Golden regression manifest (Phase 0, `PHASE0_GUARDRAILS_NEON_SPEC.md`).

This is the executable proof of the invariants the carbon accounting engine,
the product LCA engine, and the AI integration must never silently break as
the ISO 14001 EMS expansion (Phases 1–8) is built on top of them. Every row
below points at a named, currently-passing test — not a description. All
tests here run with `npm test` (Vitest), use only synthetic fixtures, and
require no database connection.

Tests added for T00 are marked **new**; everything else already existed and
is listed here so the manifest stays the single source of truth for "is this
invariant proven."

## Carbon accounting (corporate inventory)

| ID | Invariant | Test file | Test name |
|---|---|---|---|
| C-01 | Factor value/source/vintage/unit is snapshotted onto a `Calculation` at calculation time; replacing the catalogue factor afterwards does not alter an already-computed result. | `src/lib/__tests__/calc-engine.test.ts` | `describe("calculateEmission") > it("snapshots the factor value, unit, source and vintage onto the result (audit trail)")` and, **new**, `describe("factor snapshot immutability (invariant C-01)")` (`it("keeps a previously computed result's snapshot unchanged after the source factor is replaced")`, `it("is unaffected even when the caller mutates the same FactorRow object in place after the call")`) |
| C-02 | Scope 2 location-based and market-based companion rows are kept as two separate figures in a report, never summed into one blended total. | **new** `src/lib/__tests__/report-service.test.ts` | `describe("Scope 2 dual-basis non-double-counting (invariant C-02)")` (`it("keeps location-based and market-based totals separate rather than summed")`, `it("excludes the market-based/residual-mix duplicate from the data-quality tier denominator")`) |
| C-03 | Flagged and awaiting-factor entries are excluded from totals but always surfaced explicitly, never silently dropped. | `src/lib/report-service.ts` builds `excludedFlaggedEntries` / `awaitingFactorEntries` from dedicated queries (`report-service.ts:129-136,182-194`); covered structurally by the report payload shape. No dedicated fixture test was added under T00 — out of the five invariant categories in scope for this task (factor snapshotting, Scope 2 non-double-counting, immutable report payloads, pure LCA repeatability, issued-version immutability). Tracked for a future task. |
| C-04 | Cat 3 (WTT/T&D) derivation is idempotent: re-running it for the same period never creates duplicate rows. | `src/lib/__tests__/scope3-derived.test.ts` covers the pure WTT category mapping (`describe("wttMappingFor")`). The persistence-level idempotency itself is enforced by the `Calculation.derivedFromCalculationId` unique constraint (`prisma/schema.prisma`) plus the `derivedCategory3Row: { is: null }` filter in `deriveCategory3Calculations` (`entries-service.ts:361`). Not in the five T00 test categories — tracked for a future task. |
| C-05 | A `ReportSnapshot` is immutable; regenerating a report for the same period creates a successor snapshot rather than mutating the previous one, and the persisted payload is a frozen copy, not a live reference. | **new** `src/lib/__tests__/report-service.test.ts` | `describe("report snapshot immutability and successor versioning (invariant C-05)")` (`it("does not let a later mutation of the live payload object reach an already-persisted snapshot")`, `it("regenerating a report for the same period creates a successor snapshot, never overwrites the prior one")`) |

## Product LCA

| ID | Invariant | Test file | Test name |
|---|---|---|---|
| L-01 | The LCA engine is pure and repeatable: running it twice against the same frozen snapshot returns identical exact totals and rows. | **new** `src/lib/lca/__tests__/lca-engine.test.ts` | `describe("determinism (invariant L-01)") > it("returns identical exact totals and rows across repeated runs of the same snapshot")` |
| L-02 | Dimensional units fail closed — incompatible units are refused rather than silently combined. | `src/lib/lca/__tests__/lca-units.test.ts` | `describe("conversion") > it("refuses to convert between dimensions")`, `it("refuses to convert between currencies rather than inventing a rate")` | 
| | | `src/lib/lca/__tests__/lca-engine.test.ts` | `describe("material emissions") > it("refuses to multiply an energy factor by a mass quantity")` |
| | | `src/lib/__tests__/calc-engine.test.ts` | `describe("calculateEmission") > it("throws when the input unit does not match the factor's unit")` |
| L-03 | A placeholder factor blocks verification readiness. | `src/lib/lca/__tests__/lca-validation.test.ts` | `describe("factor checks") > it("blocks an assessment priced from a placeholder factor")` |
| L-04 | An issued LCA version is frozen: a live edit to the assessment after issuing does not alter the version's payload. | **new** `src/lib/lca/__tests__/assessment-service.test.ts` | `describe("issued version payload is frozen (invariant L-04)")` (`it("deep-clones the assessment into the payload, unaffected by a later live edit to the same record")`, `it("produces independent payloads across two calls, so an earlier issued version cannot be mutated by a later one")`) |
| L-05 | Corporate and product LCA totals are never combined into one figure. | Enforced structurally: corporate totals live in `ReportPayload` (`src/lib/report-service.ts`) and product totals in the LCA assessment/version payload (`src/lib/lca/assessment-service.ts`, `src/lib/lca/report-service.ts`); `LcaCorporateDataLink` is reference-only. Not in the five T00 test categories — tracked for a future task. |

## AI integration

| ID | Invariant | Test file | Test name |
|---|---|---|---|
| A-01 | AI can suggest or summarise but cannot authoritatively calculate a figure or auto-accept an obligation/nonconformity. | `src/lib/__tests__/ai-schemas.test.ts` | `describe("emissionFactorSuggestionSchema") > it("has no field a factor value could be returned in")` |
| | | `src/lib/__tests__/ai-config-and-limits.test.ts` | `it("comes up safe with no AI environment variables set")` (asserts `autoAcceptExtraction` defaults to `false`) |
| A-02 | The core application works without an AI provider key configured. | `src/lib/__tests__/ai-config-and-limits.test.ts` | `it("comes up safe with no AI environment variables set")` |
| | | `src/lib/__tests__/openrouter-provider.test.ts` | `it("refuses to run at all with no key configured")` |

## Scope and what T00 changed

- No production/domain behaviour was changed. All new tests exercise
  existing code as-is.
- New tests only cover the five invariant categories named in the T00 task
  scope: factor snapshotting (C-01), Scope 2 non-double-counting (C-02),
  immutable report payloads (C-05), pure LCA repeatability (L-01), and
  issued-version immutability (L-04).
- New tests for functions that read from Prisma (`buildReportPayload`,
  `buildVersionPayload`) mock `@/lib/prisma` and its collaborators with
  synthetic in-memory fixtures — no database connection is made, per the
  Phase 0 rule that development/tests never touch real environmental data.
- C-03, C-04, and L-05 are documented above against their existing
  (partial or structural) coverage; they were out of scope for the T00
  test additions and are candidates for a future dedicated task.

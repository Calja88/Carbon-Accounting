# Carbon Phase 4-i — audit the corporate carbon numeric path

**Status:** implemented on `board/product-2026-09-22`.
**Track:** Carbon Accounting Phase 4 (`CARBON_PHASE4_*`). Distinct from the ISO 14001 EMS track, whose Phase 4 is `Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md`.
**Precedes:** Phase 4-ii (reporting-period entity and close barrier).
**Reference:** `Docs/PHASE4_PREFLIGHT.md` §8 risk R2, §13, §15.

---

## 1. What this phase closes

Preflight risk **R2**: *"The entire corporate carbon calculation and reporting path emits zero audit events."* `entries-service.ts`, `report-service.ts` and `factor-sets-service.ts` contained no `recordAuditEvent` call, so entry creation, calculation creation, status transitions, Category 3 derivation, the factor-import backfill and report issuance all happened outside the hash-chained `AuditEvent` log. The audit log covered collection decisions and the whole EMS surface but not the numbers themselves.

It is now possible to answer, from the audit chain alone: *who recorded this activity, what figure did it produce, against which factor, when did it change state, why did it produce no figure, and who issued the report that counted it.*

## 2. What this phase deliberately does not do

No `ReportingPeriod`, no period lock, no recalculation, no supersession, no activity versioning, no report restatement. Those are Phases 4-ii to 4-vi. This phase is **observational only**.

## 3. Accounting-integrity position

**No numeric result changed.** Activity quantities, factor resolution, factor precedence, Scope 1/2/3 classification, Scope 2 dual-basis methodology, calculation arithmetic, report totals, report snapshots, factor sets and collection requirements are all untouched. The change adds audit rows alongside the existing writes and alters nothing that produces a figure.

Two properties were treated as non-negotiable while adding it:

1. **Audit must never break a calculation.** An observational change must not add a new failure mode to the numeric path. The audit formatting helpers in `entries-service.ts` (`isoDate`, `periodFields`, `periodLabel`) are total — they record `null`/`"unknown"` rather than throwing on an unexpected value, so a malformed audit field can never roll back a transaction that produced a correct figure.
2. **Audit must commit with the write it describes.** Every event is recorded inside the same transaction as its domain write, using the existing `recordAuditEvent(tx, ctx, …)` contract. A calculation can never exist without its event, and an event can never describe a write that did not happen.

`assertCompletePrimaryCalculations` and the write-once `if (existing.length) return existing;` guard in `runCalculationsForEntry` are unchanged: a replay remains a no-op, and a no-op replay writes no audit row, because nothing accounting-relevant happened.

## 4. Audit event vocabulary

Naming follows the existing `resource.verb` convention already used by `carbon_collection_requirement.reviewed`, `ems_scope_version.approved` and the rest — not a new `carbon.*` family, which would have been inconsistent with the 250 event types already in `AUDIT_EVENT_TYPES`.

`eventType` is a `String` column by design, so none of this required a migration.

| Event type | Resource type | Emitted from | Records |
|---|---|---|---|
| `activity_entry.created` | `activity_entry` | `createActivityEntryWithCalculations` | data point code, site, period, canonical value/unit, factor option, initial status, plausibility flag, DQ tier |
| `activity_entry.updated` | `activity_entry` | `acceptExtractionAsEntry` (`documents-service.ts`) | before/after provenance — `dataOrigin`, `sourceDocumentId`, `acceptedFromExtractionId`, accepting user |
| `activity_entry.status_changed` | `activity_entry` | `runCalculationsForEntry` | before/after status on leaving `AWAITING_FACTOR`, with `reason: "emission_factor_available"` |
| `calculation.created` | `calculation` | `runCalculationsForEntry`, `deriveCategory3Calculations` | entry id, site, period, scope, basis, Scope 3 category, factor id, factor source/vintage snapshot, result, DQ tier; Category 3 rows also carry `derivedFromCalculationId` |
| `calculation.awaiting_factor` | `activity_entry` | `runCalculationsForEntry` | before/after status, factor category, scope, site, period, and the resolver's reason |
| `calculation.backfilled` | `calculation` | `recalculatePendingEntries` | batch summary: trigger, checked, backfilled, still awaiting |
| `report_data.prepared` | `calculation` | `prepareReportingData` | period, Category 3 rows created, rows skipped for want of a factor |
| `report_snapshot.issued` | `report_snapshot` | `generateReportAction` | snapshot version, period, calculation count, Scope 1 / Scope 2 location / Scope 2 market / Scope 3 headline totals, excluded-flagged and awaiting-factor disclosure counts |

New `AuditResourceType` values: `activity_entry`, `calculation`, `report_snapshot`.

### 4.1 What the events deliberately do not carry

No entry or calculation snapshot is copied into the audit JSON. The `Calculation` row already holds the full factor snapshot durably, and a `ReportSnapshot` payload is already immutable — so events **identify** those records rather than duplicating them. The `report_snapshot.issued` event carries headline totals and disclosure counts, not the payload; a regression test asserts the payload's internals never appear in the audit row.

The `calculation.backfilled` batch event carries **counts only**, never a list of affected entry ids, so the row stays O(1) however many entries an import touched. The per-entry `calculation.created` and `calculation.awaiting_factor` events on the same `correlationId` carry every id and figure — the batch-plus-child-trail convention the audit log already uses.

### 4.2 Two events for two different facts

`calculation.awaiting_factor` is kept distinct from `activity_entry.status_changed` on purpose. "This entry produced no figure, and here is why" is an accounting fact in its own right and deserves to be queryable by `eventType` rather than by filtering JSON. It is emitted **even when the status does not move** — a `FLAGGED` entry with no factor is recorded just as visibly as a `SUBMITTED` one, because *missing data is never zero, and never silent*.

## 5. System-triggered versus user-triggered

`systemTenantRepositoryContext` carries the literal `userId: "system"`, which is **not a real User row**. `RecordAuditEventInput.actorUserId` is explicit that a system context marker must never be mistaken for a person.

A new helper, `auditActorFor(ctx)` in `src/lib/repositories/carbon-repository.ts` — placed next to the only function that writes the marker, so its meaning stays in one file — maps a context to its actor fields:

| Context | `actorUserId` | `actorType` | `source` |
|---|---|---|---|
| user (`toTenantRepositoryContext`) | the real user id | `USER` | `web-app` |
| system (`systemTenantRepositoryContext`) | `null` | `SYSTEM` | `system` |

So the factor-import backfill records `actorUserId: null` / `actorType: "SYSTEM"` and never pretends a human acted. A test asserts explicitly that the string `"system"` is never written into `actorUserId`.

### 5.1 Correlation

`recalculatePendingEntries` previously built a **new** system context inside its loop, giving every entry a different `correlationId`. It now builds **one** context for the whole run, so the batch event and every per-entry event it produced share a correlation id and read back as a single operation. This changes no figure — the context carries only `organisationId`, `userId` and `correlationId`, and the organisation id was already identical for every iteration because the query filters on it.

## 6. `recalculatePendingEntries` — treatment and deferred rename

The preflight named this function as the root of risk R1's misreading: it is a **first-calculation backfill**, not a recalculation. `runCalculationsForEntry` returns early for any entry that already has primary calculations, so no existing figure is ever recomputed or replaced here.

**The rename to `backfillAwaitingFactorEntries` was attempted and deliberately not applied.** Impact analysis put the symbol at `LOW` risk with one production caller (`commitFactorImport`), and the call-graph rename covered both production sites cleanly. But five test files mock this export **by name** through `vi.mock("@/lib/entries-service", …)`, and two of them —

- `src/lib/factors/import/__tests__/factor-import-service.test.ts`
- `src/lib/factors/import/__tests__/official-flat-format.test.ts`

— are Phase 3-vi guard tests that assert the new factor-import path never triggers a backfill, and they sit outside this phase's write boundary. Renaming the export while leaving those mock keys stale would silently defuse both guards: the intended loud `throw new Error("Recalculation is forbidden")` would become an `undefined is not a function` TypeError, or nothing at all. That is an external contract depending on the name, which is exactly the case `Docs/PHASE4_PREFLIGHT.md` and this phase's brief said to leave intact and document.

**Terminology debt recorded.** The function keeps its name, its doc comment now states plainly that it is not a recalculation, and a `ponytail:` marker records the deferred rename and its unblocking condition:

> Rename to `backfillAwaitingFactorEntries` once Phase 3-vi lands and `src/lib/factors/import/__tests__/*` can be updated in the same change.

It remains **not period-aware**, as instructed — a closed-period barrier belongs to Phase 4-ii. Until then it stays free to give a historical entry its first figure, and the new `calculation.backfilled` batch event is what makes that visible rather than silent. Risk R1 is therefore now *observable*, but not yet *prevented*.

## 7. Report audit coverage

- **`report_data.prepared`** on `prepareReportingData`. `skippedNoFactor` — source rows that could not be derived for lack of a factor — is an accounting disclosure that is not reconstructible from the per-row events, so the summary is recorded in its own right.
- **`calculation.created`** per derived Category 3 row, carrying `derivedFromCalculationId` so each companion row is traceable to its Scope 1/2 source.
- **`report_snapshot.issued`** on `generateReportAction`, inside the same transaction as the snapshot create. Records the snapshot id and version, period, calculation count, the four headline totals, and the two disclosure counts.

Snapshot payload semantics are unchanged. Scope 2 is recorded on **both** bases in the event — location-based as the corporate headline, market-based as its companion — never conflated, and a test asserts both are present and distinct.

`buildReportPayload` was not modified: it is pure read/compute, performs no write, and so has nothing to audit. Report *generation* is audited at the point it becomes durable, which is issuance.

## 8. Transaction and locking notes

`recordAuditEvent` takes a `SELECT … FOR UPDATE` row lock on the organisation to keep the hash chain from forking. In `runCalculationsForEntry` the lock order is **entry row, then organisation row** — the entry lock via `lockActivityEntry` already came first, and `recordAuditEvent` is the only new lock. No existing path locks an organisation before an activity entry, so no new deadlock class is introduced.

The practical consequence is that calculation writes for one organisation now serialise on that organisation's audit chain for the duration of the transaction. This is the same contention every EMS and collection-plan write already accepts, and it is per-organisation, so it never blocks another tenant.

`deriveCategory3Calculations` wraps **each row** in its own transaction rather than the whole loop, which preserves the existing failure semantics exactly: partial progress is retained, and the unique `derivedFromCalculationId` constraint still makes a re-run idempotent.

`createActivityEntryWithCalculations` keeps its existing two-transaction structure — the entry and its audit event commit together, then `runCalculationsForEntry` opens its own transaction as before.

## 9. Tests

**New — `src/lib/__tests__/carbon-numeric-audit.test.ts` (12 tests):** entry creation event content; calculation event content including factor identifiers and result; one correlation id and an unbroken `previousEventHash` chain across an operation; user actor recorded; `calculation.awaiting_factor` before/after and reason with no calculation event emitted; backfill batch counts; backfill marked `SYSTEM` with `actorUserId: null`, one correlation id, `source: "system"`, and the marker string never written as an actor; the `AWAITING_FACTOR` recovery transition; no batch event when nothing was pending; `report_data.prepared` content.

**Numeric equivalence (same file):** the stored `Calculation` row's `resultKgCo2e`, `inputValue`, `inputUnit`, all four factor snapshot fields, `formulaApplied` and `emissionFactorId` are asserted equal to an independent `calculateEmission()` call on the same inputs — so auditing demonstrably perturbs no arithmetic. A replay test asserts no new calculation row, an unchanged figure, and **no audit row** for a no-op.

**New — `src/lib/__tests__/carbon-report-audit-action.test.ts` (5 tests):** snapshot issuance emits `report_snapshot.issued` pointing at the created snapshot; a real issuing user rather than a system actor; period, calculation count and all four headline totals on the correct bases; disclosure counts; and the frozen payload is **not** copied into the audit row.

**Existing suites:** full run green — **2436 passed, 11 skipped, 158 files**. `tsc --noEmit` clean; `eslint` clean on all changed files.

Two existing test doubles needed an `auditEvent` stub, since the code under test now writes an audit row inside the transaction they fake: `entries-service-idempotency.test.ts` and `tenant-adversarial/supplier-factor-isolation.test.ts`. **No assertion in either file was changed** — only the in-memory Prisma fake was extended to model a table the production path now uses. Factor-resolution, report-snapshot and activity/data-collection assertions are all untouched.

## 10. Files changed

| File | Change |
|---|---|
| `src/lib/audit/types.ts` | 8 new event types, 3 new resource types. No migration. |
| `src/lib/repositories/carbon-repository.ts` | `auditActorFor` helper; `SYSTEM_ACTOR_MARKER` constant. |
| `src/lib/entries-service.ts` | Audit on entry creation, calculation creation, awaiting-factor, status recovery, Category 3 derivation, reporting-data preparation, backfill batch; hoisted backfill context for correlation; total audit formatting helpers; corrected backfill doc comment plus `ponytail:` rename debt marker. |
| `src/lib/documents-service.ts` | Audit on the one `ActivityEntry` update path (AI-extraction provenance). |
| `src/app/(app)/reports/actions.ts` | Audit on report snapshot issuance, in the snapshot's transaction. |
| `src/lib/__tests__/carbon-numeric-audit.test.ts` | New. |
| `src/lib/__tests__/carbon-report-audit-action.test.ts` | New. |
| `src/lib/__tests__/entries-service-idempotency.test.ts` | `auditEvent` stub added to the Prisma fake; assertions unchanged. |
| `src/lib/__tests__/tenant-adversarial/supplier-factor-isolation.test.ts` | `auditEvent` stub added to the Prisma fake; assertions unchanged. |

No schema, no migration, no database, no deployment.

## 11. Residual gaps after 4-i

1. **R1 is visible, not prevented.** A factor import still gives a historical entry its first figure. Phase 4-ii's period barrier is what stops it.
2. **R3 unchanged.** A backdated entry still moves live figures without reconciling against an issued snapshot.
3. **Terminology debt.** `recalculatePendingEntries` keeps a misleading name until Phase 3-vi releases its test files (§6).
4. **`commitFactorImport` itself is not audited.** Factor-set import is Phase 3-vi territory and outside this phase's write boundary; the backfill it triggers *is* audited.
5. **Commuting surveys and energy contracts are not audited.** `createCommutingSurvey` and `upsertSiteEnergyContract` write carbon data but are not on the calculation path — the derived `ActivityEntry` each eventually produces is audited normally. Worth folding into a later sub-phase.
6. **No period, approval or supersession events yet** — deliberately, per §2.
7. **Report generation over an open period is still unmarked.** Until 4-ii there is no period status to record, so `report_snapshot.issued` cannot yet say whether its period was closed.

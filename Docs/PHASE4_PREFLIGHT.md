# Phase 4 preflight — accounting controls (recalculation, supersession, approval, period close)

**Status:** this preflight is analysis/design. Carbon 4-i and **4-ii are now implemented**; see [the 4-ii handoff](CARBON_PHASE4_II_REPORTING_PERIOD_BARRIER.md) for the authoritative current model, guard and remaining phase boundaries. Descriptions below of absent periods/locks record the pre-implementation baseline.
**Branch inspected:** `board/product-2026-09-22` at `9cf9538`.
**Date:** 2026-09-15.

> **Implementation progress.** **4-i** provides numeric-path auditing (`Docs/CARBON_PHASE4_I_NUMERIC_AUDIT.md`); **4-ii** provides the period mutation barrier (`Docs/CARBON_PHASE4_II_REPORTING_PERIOD_BARRIER.md`). R2 is closed; R1 is now prevented by closed-period backfill skips with audited counts. Everything from 4-iii onward remains outside this implementation. The track uses **Carbon Phase 4** / `CARBON_PHASE4_*`, resolving B1 below; the Phase 3-vi schema contracts have landed, releasing 4-ii's schema dependency.
**Scope excluded:** `prisma/schema.prisma` (in-flight), `prisma/migrations/*`, `src/lib/factors/import/*`, `src/lib/factors/publication/*`, factor publication/schema contracts, `EmissionFactor` / `EmissionFactorSet`, Phase 3-v / 3-vi implementation files. These were read for context only and not modified.

> **Naming collision — decide before writing any Phase 4 code.** `Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md` already exists and belongs to the ISO 14001 EMS track (Phases 0–8). The carbon ledger track numbers its work Phase 3-i … 3-vii. "Phase 4" as used in this document is the *carbon ledger accounting-controls* package and is a different thing from EMS Phase 4. Recommended rename: **Phase 3-viii / Carbon Ledger Accounting Controls**, or an explicit `CARBON_PHASE4_` document prefix. See §18 B1.

---

## 1. Current-state architecture

The corporate carbon path is a short, deliberately linear pipeline:

```
ActivityDataPoint (catalogue)
      │
OrganisationSourceConfig ──► CarbonCollectionRequirement   (expectation + review decision)
      │                                    ▲
ActivityEntry  ── runCalculationsForEntry ──┤  (matched by period overlap)
      │                │
      │                └──► Calculation  (append-only, factor snapshotted onto the row)
      │                          │
      │                deriveCategory3Calculations ──► Calculation (Cat 3 companion)
      │                          │
      └──────────► buildReportPayload ──► ReportSnapshot + ReportSnapshotCalculation (immutable)
```

Key architectural facts established by inspection:

| Area | File | Fact |
|---|---|---|
| Calculation engine | `src/lib/calc-engine.ts` | Pure, deterministic. No DB access, no factor substitution. `calculateEmission`, `calculateScope2Dual`, `selectMarketBasis`. |
| Calculation write path | `src/lib/entries-service.ts:259` `runCalculationsForEntry` | Single transaction, row-locks the parent entry, **returns early if primary calculations already exist**. |
| Integrity guard | `src/lib/calculation-integrity.ts` | `assertCompletePrimaryCalculations` — a non-empty primary set must be complete; explicitly *"never repaired by deleting history"*. Scope 2 must have both bases or neither. |
| Reporting read model | `src/lib/report-service.ts:116` `buildReportPayload` | Pure read/compute, no writes. |
| Snapshot issue | `src/app/(app)/reports/actions.ts` `generateReportAction` | Creates `ReportSnapshot` + `ReportSnapshotCalculation` links in one call. Never derives calculations (that was split out to `prepareReportingDataAction`). |
| Collection completeness | `src/lib/carbon/collection-plan-service.ts` | Period-aware expectation matrix with fingerprinted review decisions. |
| Audit log | `src/lib/audit/*`, `AuditEvent` model | Hash-chained (`contentHash` / `previousEventHash` / monotonic `sequence`), `before`/`after`, `correlationId`. |
| Period "lock" | `src/lib/board/calculation-orchestration.ts` | **Interface declaration only — no implementation exists.** See §5. |

Period handling is string/date parsing only. `src/lib/report-period.ts` (`resolveMonthRange`, `MonthRange`) and `src/lib/period.ts` (`resolvePeriod`, `PeriodInputKind`) convert `YYYY-MM` pickers into UTC date ranges. **There is no reporting-period entity anywhere in the schema.**

---

## 2. Existing reusable components

Ranked by how directly Phase 4 can build on them.

### 2.1 Reuse essentially as-is

1. **`AuditEvent` + `src/lib/audit/types.ts` + `src/lib/audit/integrity.ts`** — production grade. Hash-chained, tenant-scoped, `before`/`after` diffs, `correlationId`, indexed by `(organisationId, resourceType, resourceId)`. The vocabulary is a plain TypeScript const array (`AUDIT_EVENT_TYPES`, 250 entries) and `eventType` is a `String` column deliberately, so **new Phase 4 event types need no migration**.
2. **`CarbonCollectionRequirement` + `deriveCollectionStatus` + `computeCollectionFingerprint`** (`src/lib/carbon/collection-plan-service.ts:148–231`) — this is the closest thing in the repository to what Phase 4 needs, already built and tested:
   - `reviewFingerprint` is a sha256 over each matched entry's `id:canonicalValue:canonicalUnit` plus every contributing calculation's `id:basis:resultKgCo2e`, sorted so it never depends on query order.
   - It is **recomputed on read**; the stored decision is never trusted as current truth. A drift yields `changed_since_review`.
   - Exclusion requires a reason; reopen records `reopenedByMembershipId` / `reopenedAt` and **retains** the prior exclusion fields rather than clearing them.
   - `deriveCollectionStatus` is pure and synchronous — exhaustively testable with no database.

   This is exactly the "detect later changes" mechanic Phase 4 needs, one level up (period rather than source-cell). **Generalise it; do not reinvent it.**
3. **EMS approve/supersede services** — `src/lib/ems/aspects/significance-service.ts`, `src/lib/ems/objectives/objective-service.ts`, `src/lib/ems/legal/obligation-service.ts`, `src/lib/ems/audits/programme-service.ts`. Established shape: `DRAFT → APPROVED → SUPERSEDED`, `approvedByMembershipId` + `approvedAt`, a paired approval record, and an audit event on every transition including the supersession of the prior version. Copy this shape for period close and report restatement rather than inventing a new one.
4. **`OutboxMessage` / `JobRun`** (`src/lib/jobs/outbox-service.ts`) — the transactional reliability boundary. A domain write and its outbox row commit together, so a recalculation job is never enqueued for a write that did not happen. Use this for any asynchronous recalculation fan-out.
5. **`LegalHold`** — "holds always win" register with release reason and retained history. A close/reopen design must consult it (§8).
6. **`Calculation` factor-snapshot columns** — `factorValueSnapshot`, `factorUnitSnapshot`, `factorSourceSnapshot`, `factorVintageSnapshot`, `formulaApplied`, `engineVersion`. Historical reproducibility already rests on these and they are sufficient. Keep.
7. **`ReportSnapshot` / `ReportSnapshotCalculation`** — genuinely append-only (verified: no `update`/`upsert` call on `reportSnapshot` exists anywhere in the codebase), pins the exact `Calculation` row ids that produced the figures. This is the correct foundation for historical reproducibility.
8. **`assertCompletePrimaryCalculations`** — already encodes "retain history, never repair by deleting". Extend it, don't replace it.
9. **RBAC catalogue** (`src/lib/rbac/permission-catalogue.ts`) — `carbon.entry.review`, `carbon.entry.approve`, `carbon.report.generate`, `carbon.report.export` already exist and are wired to role templates.

### 2.2 Reuse as design input only (not working code)

10. **`src/lib/board/calculation-orchestration.ts`** — a pre-authored transaction contract (`CalculationRequest`, `CalculationTransaction`, `CalculationPorts`, `executeCalculation`). It names exactly the right ordering — *lock entry and period → authorise and load → find run → save run + audit + outbox in one transaction* — and it explicitly notes "Advisory key alone doesn't guard report issue". **Nothing implements it.** Its only references are its own file and `src/lib/board/__tests__/board.test.ts`. Treat it as an approved design skeleton for Phase 4, not as an existing capability.

---

## 3. Existing data models

### 3.1 Directly in scope

| Model | Relevant fields | Assessment |
|---|---|---|
| `ActivityEntry` | `periodStart`, `periodEnd`, `rawValue/rawUnit`, `canonicalValue/canonicalUnit`, `status` (`EntryStatus`), `plausibilityFlagged`, `dataOrigin`, `sourceDocumentId`, `enteredBy/enteredAt`, `updatedAt` | No version history. `updatedAt` overwrites in place. No `supersededBy`, no correction link. |
| `EntryStatus` (enum) | `SUBMITTED`, `FLAGGED`, `APPROVED`, `REJECTED`, `AWAITING_FACTOR` | **`APPROVED` and `REJECTED` are never written by any code path.** Dead enum members. |
| `Calculation` | full factor snapshot set, `engineVersion` (default `"calc-engine-v1"`), `calculatedByUserId`, `calculatedAt`, `derivedFromCalculationId` (unique — idempotent Cat 3), `supersededById` | **`supersededById` is a dead column**: declared as a bare `String?` with no `@relation`, no index, and zero code references anywhere in the repository. No reason, actor or timestamp accompanies it. |
| `ReportSnapshot` | `version` (autoincrement), `periodStart/periodEnd`, `payload Json`, `generatedBy/generatedAt` | Immutable and correct. No approval state, no period FK, no payload hash, no supersession/restatement link. |
| `ReportSnapshotCalculation` | `(reportSnapshotId, calculationId)` unique | Correct. This is the reproducibility anchor. |
| `CarbonCollectionRequirement` | `periodStart/periodEnd/periodKey/periodKind`, `decision`, `reviewFingerprint`, `reviewedBy/At`, `excludedBy/At/Reason`, `reopenedBy/At` | The reference pattern. Note it already has exclude-with-reason and reopen-with-actor. |
| `CarbonSourcePeriodObligation` | `month`, `status` (free-text String), `reviewFingerprint`, `submittedActivityEntryId` | Earlier, coarser generation of the same idea (monthly, string status). Superseded in practice by `CarbonCollectionRequirement`. Candidate for consolidation, not extension. |
| `AuditEvent` | hash chain, `before`/`after`, `correlationId`, `sequence` | Production grade. Reuse unchanged. |
| `LegalHold` | resource-or-org scope, `ACTIVE`/`RELEASED`, release reason | Production grade. Must be consulted by close/reopen. |

### 3.2 Absent entirely

There is **no** `ReportingPeriod`, no `PeriodClose`, no `RecalculationEvent`, no `CalculationRun`, no `ActivityEntryVersion`, no `Restatement`, and no lock/close status of any kind on any carbon model.

---

## 4. Existing recalculation behaviour

**There is no recalculation.** This is the single most important finding, and it is currently a *safety property*, not a bug.

`runCalculationsForEntry` (`src/lib/entries-service.ts:259`) locks the parent `ActivityEntry`, loads existing primary calculations (`derivedFromCalculationId: null`), asserts they form a complete set, and then:

```ts
if (existing.length) return existing;
```

Once an entry has calculations, it never recalculates. Confirmed by search: there is **no `prisma.calculation.update`, `.updateMany`, `.delete`, `.deleteMany` or `.upsert` call anywhere in `src/` or `scripts/`.** Calculations are append-only in practice.

`recalculatePendingEntries` (`src/lib/entries-service.ts:415`) is **misleadingly named**. It is a first-calculation backfill, not a recalculation:

- it selects only `status: AWAITING_FACTOR` entries,
- scoped to one organisation (no cross-tenant fan-out — deliberate, tested in `src/lib/__tests__/tenant-adversarial/supplier-factor-isolation.test.ts`),
- and calls `runCalculationsForEntry`, which for an already-calculated entry is a no-op.

Its only production caller is `src/lib/factor-sets-service.ts:120`, immediately after a factor-set import. The newer Phase 3-i/3-ii import paths deliberately mock it as forbidden in tests (`recalculatePendingEntries: () => { throw new Error("Recalculation is forbidden"); }` — `src/lib/factors/import/__tests__/factor-import-service.test.ts`, `official-flat-format.test.ts`, `src/lib/__tests__/factor-import-preview-action.test.ts`).

### 4.1 What happens when activity data changes after calculation

Nothing — because it cannot change. The only writes to `ActivityEntry` in the entire codebase are:

- `src/lib/entries-service.ts:357` — `SUBMITTED → AWAITING_FACTOR` when no factor is found;
- `src/lib/entries-service.ts:394` — `AWAITING_FACTOR → SUBMITTED|FLAGGED` when a factor arrives;
- `src/lib/documents-service.ts:255` — linking a `sourceDocumentId`;
- two demo-seed `sourceDocumentId` writes in `scripts/board-demo/live-seed-port.ts`.

**There is no user-facing path to edit an activity value after entry.** Historical figures are therefore safe today — and correcting a genuine data error is impossible today. Phase 4 must supply the correction path, and supplying it is what creates the risk this phase exists to control.

### 4.2 What happens when a factor changes

A new factor set is imported as a new versioned set; existing `Calculation` rows are untouched, and each already carries its own factor value/unit/source/vintage snapshot. Historical figures do not move. The one exception is §4 above: entries sitting at `AWAITING_FACTOR` get calculated for the first time at import, **in whatever period they belong to, including periods already reported**. See risk R1.

### 4.3 Are calculations immutable or recomputed dynamically?

Immutable, stored, and read back. Reports read `Calculation` rows; they never re-resolve factors. Phase 3-v §13 restates this as the intended permanent contract: *"Reports based on stored calculations reproduce those snapshots and factor IDs; they do not resolve today's active factors again."*

---

## 5. Existing period-lock behaviour

**None exists.**

`src/lib/board/calculation-orchestration.ts` declares:

```ts
/** Lock the owning entry/period BEFORE policy/read checks. Advisory key alone doesn't guard report issue. */
lockEntryAndPeriod(request: CalculationRequest): Promise<void>;
```

and `authorizeAndLoad` is documented as reading *"current membership, scope, locked-period rule and input revision within transaction"*. Neither the implementation nor the "locked-period rule" exists. The only references to this file are itself and `src/lib/board/__tests__/board.test.ts`, which supplies inline stubs.

What *does* exist is entry-level row locking inside `runCalculationsForEntry` (`lockActivityEntry(tx, ctx, entryId)` under `ReadCommitted`, 30s timeout) — correct for calculation idempotency, unrelated to period close.

The nearest existing analogue at period granularity is `CarbonCollectionRequirement`'s exclude/reopen on a single source-cell (`reopenCollectionRequirement`, `src/lib/carbon/collection-plan-service.ts:592`) — a decision lifecycle, not a mutation barrier. Nothing anywhere rejects a write because of the period it falls in.

### 5.1 What happens when a locked period needs correction

Undefined — there are no locked periods. Today the behaviour is: a new backdated `ActivityEntry` for an already-reported month is accepted without objection, is calculated normally, and immediately changes every live dashboard figure for that month. The previously issued `ReportSnapshot` remains correct and unchanged (its `calculationIds` pin the old set), so the two silently diverge with **no surface anywhere that reconciles or even reports the divergence**. See risk R3.

---

## 6. Existing approval/review behaviour

Three distinct, unconnected things exist; none of them approves an accounting figure.

1. **Entry status** — `EntryStatus.APPROVED` / `REJECTED` exist in the enum and **are never written**. `SUBMITTED`, `FLAGGED`, `AWAITING_FACTOR` are the only live values. There is no entry approval workflow, no approver, no approval timestamp.
2. **Collection review** — `reviewCollectionRequirement` / `excludeCollectionRequirement` / `reopenCollectionRequirement`. This approves *that data was collected or justifiably not collected*, per source per period. It does not approve the emission figure. Guarded by `carbon.entry.review` (manage) and `carbon.entry.approve` (exclude) — note `carbon.entry.approve` is currently repurposed for collection exclusion, not for approving entries.
3. **EMS approvals** — mature and production-grade, but on the EMS side of the product (objectives, obligations, significance methods, audit programmes, controlled documents). They are the pattern to copy, not a capability the carbon ledger currently has.

`src/app/(app)/attention/page.tsx` renders a management queue of critical items from the board overview model, and `/sources` renders the collection matrix. Neither is an approval workflow.

---

## 7. Existing report-snapshot behaviour

Strong, and the best-formed part of the current system.

- Issue is via `generateReportAction` → `prisma.reportSnapshot.create` with nested `calculationLinks`. Permission-gated on `carbon.report.generate` plus `requireFrozenReportAccess`.
- `buildReportPayload` is pure read/compute — verified no writes.
- Category 3 derivation was deliberately split out into `prepareReportingDataAction` so that issuing a report no longer mutates the organisation's live Scope 3 total as an undisclosed side effect (BD08 / Checkpoint A carried-forward fix, recorded in `Docs/board-sprint/CONTINUITY.md`).
- `ReportPayload` discloses rather than drops: `excludedFlaggedEntries` and `awaitingFactorEntries` are explicit payload sections — *"Disclosed, never silently dropped."*
- Headline totals use Scope 2 **location-based**; market-based is carried as a separate companion field (`analytics-service.ts` `totalsFor`: `total = scope1 + scope2Location + scope3`). Correct per the methodology.
- Corporate and LCA totals are structurally separate; reuse of a corporate record by a product assessment is recorded as a reference-only `LcaCorporateDataLink`, never a transfer.

Gaps on the snapshot itself:

- No payload hash. `ManagementReviewPack` and `BoardManagementPack` both carry `payloadSha256`; `ReportSnapshot` does not, so the payload is immutable by convention and absence-of-code rather than by verifiable digest.
- No approval/issue state — every snapshot is equally "issued" the moment it is created; there is no draft, no reviewer, no issuer distinct from generator.
- No supersession link between snapshots. A corrected report is simply a new `version` with no recorded relationship to the one it restates.
- No record of engine version, factor-set ids, methodology version or collection completeness in the payload. `factorSources` records publisher+vintage strings only.
- **Collection gaps are not disclosed.** A report can be issued for a period in which `CarbonCollectionRequirement` rows sit at `missing`, and the payload says nothing about it. `excludedFlaggedEntries` and `awaitingFactorEntries` cover data that *arrived*; nothing covers data that never arrived.

---

## 8. Identified accounting-integrity risks

Ordered by severity.

| # | Risk | Why it matters | Evidence |
|---|---|---|---|
| **R1** ⚠️ **VISIBLE after 4-i, not prevented** | **A factor import silently adds emissions to an already-reported period.** `recalculatePendingEntries` backfills every `AWAITING_FACTOR` entry in the organisation regardless of period. An entry from a reported January that was awaiting a Scope 3 factor gains a figure the moment that factor is imported in, say, June. | Directly violates *"a changed factor must not silently rewrite historical calculations"* — technically it writes a first calculation rather than rewriting one, but the effect on the period total is identical and entirely unannounced. Org-scoped (good) but not period-scoped. | `entries-service.ts:415`, `factor-sets-service.ts:120` |
| **R2** ✅ **CLOSED in 4-i** | **The entire corporate carbon calculation and reporting path emits zero audit events.** `entries-service.ts`, `report-service.ts` and `factor-sets-service.ts` contain no `recordAuditEvent` call. Entry creation, calculation creation, status transitions, Cat 3 derivation, factor-import backfill and report issue are all outside the hash-chained log. | Violates *"recalculation must be explicit and auditable"* and *"prior calculation results must remain traceable"* at the most basic level. The audit log covers collection decisions and the whole EMS surface but not the numbers themselves. | grep: 0 matches in all three files |
| **R3** | **No period barrier: a backdated entry silently diverges live figures from the issued report.** The snapshot stays correct; the dashboard changes; nothing reconciles them or flags the drift. | Violates *"a changed activity record must not silently rewrite an approved/closed period"* in spirit — the report is safe but the organisation's stated current position for that month moves without notice. | §5.1 |
| **R4** | **`Calculation.supersededById` is a live, writable column with no semantics.** Bare `String?`, no `@relation`, no index, no `supersededAt`, no reason, no actor, zero code references. Any future implementer can write it and produce supersession with no audit trail and no referential integrity. | Violates *"recalculation must identify why it occurred"*. This is a trap, not a feature. | schema `Calculation`; grep: 0 code references |
| **R5** | **`deriveCategory3Calculations` writes new `Calculation` rows into arbitrary historical periods on demand** via `prepareReportingDataAction`, with no period check. Idempotent per source row (unique `derivedFromCalculationId`), so it cannot duplicate — but the first run for an old period adds real Scope 3 emissions to it. | Same class as R1. The BD08 split made the write *disclosed and explicit* rather than a side effect, which was the right fix; it did not make it period-aware. | `entries-service.ts:456`, `reports/actions.ts:42` |
| **R6** | **Phase 3-vi provenance split within a single historical period.** Phase 3-v §13 requires new calculation snapshots to use the item's `originalSourceName`/`originalVintageYear` rather than the containing set's. Combined with R1, an old `AWAITING_FACTOR` entry calculated after 3-vi lands in a historical period alongside siblings carrying the old provenance strings. | Two rows in one reported month cite the same underlying factor differently. Reproducible, but not explainable to an auditor without a recalculation record. | `Docs/PHASE3_V_FACTOR_PUBLICATION_SCHEMA.md` §13 |
| **R7** | **No entry version history.** `ActivityEntry.updatedAt` overwrites in place. The moment Phase 4 adds a correction path, prior values are lost unless versioning lands in the same change. | Violates *"prior calculation results must remain traceable"* the moment corrections become possible. | schema `ActivityEntry` |
| **R8** | **No restatement concept.** A corrected report is a new `ReportSnapshot.version` with no link to what it replaces and no reason. | Violates *"report snapshots must remain immutable"* only technically — they do stay immutable — but leaves no way to express *why* the number changed between v3 and v4. | schema `ReportSnapshot` |
| **R9** | **`ReportSnapshot.payload` has no digest.** Immutability rests on the absence of an update call rather than on a verifiable hash, unlike `ManagementReviewPack.payloadSha256`. | A future bug or direct DB write is undetectable. | schema comparison |
| **R10** | **Reports do not disclose collection gaps.** A period with `missing` collection cells issues a clean-looking report. | Violates *"missing data is never zero"* for the class of data that never arrived — the one class currently undisclosed. | §7 |
| **R11** | **Dead `EntryStatus.APPROVED`/`REJECTED` invite a half-built workflow.** Present in the enum, absent from all code. An implementer may wire one of them without the surrounding controls. | Approval without approver, timestamp or audit is worse than no approval. | §6 |
| **R12** | **`CarbonSourcePeriodObligation.status` is a free-text `String` with a default of `"REVIEW_REQUIRED"`**, parallel to the newer enum-backed `CarbonCollectionRequirement.decision`. Two overlapping period-review mechanisms. | Divergent state is a reporting-integrity hazard and doubles the Phase 4 surface. | schema, both models |

**Not risks — verified sound and worth protecting:** calculations are append-only in practice; report snapshots are genuinely immutable; factor detail is snapshotted onto the calculation row; Scope 2 location-based is the headline basis with market-based as a companion field; Scope 2 is all-or-nothing across both bases; corporate and LCA totals are structurally separate; `assertCompletePrimaryCalculations` refuses to repair history by deletion; the collection fingerprint never trusts a stored decision as current truth.

---

## 9. Missing capabilities

1. A **reporting-period entity** with an explicit lifecycle (`OPEN → PENDING_REVIEW → CLOSED → REOPENED`), a period key, an owner and a close/reopen audit trail.
2. A **mutation barrier** that rejects ordinary writes into a closed period — entry creation, entry edit, calculation creation, Cat 3 derivation and factor-import backfill alike.
3. A **recalculation event**: an explicit, authorised, reasoned record of *why* figures were recomputed, linking the trigger (factor change, data correction, methodology change, error correction) to the calculations it superseded and the ones it produced.
4. **Calculation supersession with semantics** — a real FK, a timestamp, an actor, a reason code, and a link to the recalculation event.
5. **Activity entry versioning** — an append-only prior-value record so a correction retains what it corrected.
6. **An approval workflow for the figures themselves** — distinct from collection review, with a reviewer/approver split and `carbon.period.close` / `carbon.period.reopen` permissions.
7. **Report restatement** — a supersession link and reason between `ReportSnapshot` versions, plus a payload digest.
8. **Period-level change detection** — the collection fingerprint generalised from a source-cell to a whole period, so "this closed period no longer matches what was approved" is a first-class, queryable state.
9. **Audit vocabulary for the carbon numeric path** — entry, calculation, period and report events.
10. **UI** for close, reopen, restate, and for surfacing changed-since-close and pending-recalculation states.

---

## 10. Recommended Phase 4 target architecture

The guiding constraint: **almost all of this already exists one level down.** Phase 4 should generalise `CarbonCollectionRequirement`'s proven mechanics to period granularity and copy the EMS approve/supersede shape, rather than introduce a new workflow framework.

```
                       ┌──────────────────────────────────────────┐
                       │ ReportingPeriod  (NEW — the only new     │
                       │ aggregate; one row per org per period)   │
                       │  status: OPEN|PENDING_REVIEW|CLOSED      │
                       │  closureFingerprint  (period-level sha)  │
                       │  closedBy/At, reopenedBy/At/Reason       │
                       └───────────────┬──────────────────────────┘
                                       │ guards
      ┌────────────────────────────────┼─────────────────────────────────┐
      │                                │                                 │
ActivityEntry write            Calculation write               ReportSnapshot issue
      │                                │                                 │
      └──────────── assertPeriodOpen(orgId, periodStart) ────────────────┘
                                       │
                        blocked in CLOSED unless carrying a
                                       │
                       ┌───────────────▼──────────────────────────┐
                       │ RecalculationEvent (NEW)                 │
                       │  reason (enum) + narrative (required)    │
                       │  authorisedBy, periodId, scope           │
                       └───────────────┬──────────────────────────┘
                                       │ supersedes
                              Calculation.supersededByCalculationId
                                       + supersededAt + recalculationEventId
```

**Design rules:**

- **One barrier function, one place.** `assertPeriodOpen(ctx, periodStart)` called inside `runCalculationsForEntry`, `createActivityEntryWithCalculations`, `deriveCategory3Calculations` and `recalculatePendingEntries` — not re-implemented at each action. The existing `lockEntryAndPeriod` contract in `calculation-orchestration.ts` is where the intended ordering is already written down; implement that, don't design a new one.
- **Closure fingerprint, not a snapshot copy.** Reuse `computeCollectionFingerprint`'s exact shape, widened to every entry and calculation in the period. A closed period whose recomputed fingerprint no longer matches is `CHANGED_SINCE_CLOSE` — the same "decision is never trusted as current truth" rule that already governs collection cells.
- **Supersession never deletes.** New calculation rows; old rows gain `supersededAt` + `supersededByCalculationId` + `recalculationEventId`. `assertCompletePrimaryCalculations` extends to require that the *unsuperseded* set is complete. Reports reading historical snapshots continue to resolve their pinned `calculationIds` regardless of supersession.
- **`AWAITING_FACTOR` backfill becomes period-aware.** `recalculatePendingEntries` must skip closed periods and instead raise a pending-recalculation signal for review. This is the single highest-value change in the phase.
- **Report restatement is a new snapshot plus a link**, never an edit. Add `supersedesSnapshotId` + `restatementReason` + `payloadSha256`.
- **Audit everything on the numeric path.** Every event below goes through the existing `recordAuditEvent` + hash chain; no new audit infrastructure.
- **No generic workflow engine, no state-machine library, no event-sourcing rewrite.** Two enums, three new models, three additive column groups.

---

## 11. Recommended workflow

| Step | Behaviour | Reuses |
|---|---|---|
| **Draft activity** | Entry created into an `OPEN` period. `assertPeriodOpen` rejects a closed period with a typed error naming the period and how to request reopening. Emit `activity_entry.created`. | existing create path + new barrier |
| **Calculate** | Unchanged: first calculation only, entry row-locked, Scope 2 all-or-nothing, factor snapshotted. Emit `calculation.created`. Missing factor still yields `AWAITING_FACTOR` — never zero. | `runCalculationsForEntry` unchanged |
| **Review** | Collection review per source-cell as today (`reviewCollectionRequirement`), *plus* a period-level readiness check: every requirement `reviewed` or `excluded`, no `changed_since_review`, no unexplained `awaiting_factor`. Period moves `OPEN → PENDING_REVIEW`. | `deriveCollectionStatus` + `getCollectionMatrix` |
| **Approve** | `carbon.period.close` holder approves. Closure fingerprint computed and stored. Emit `reporting_period.approved`. Reviewer and approver must differ where the role template allows separation. | EMS approve pattern |
| **Close period** | `status = CLOSED`. From here `assertPeriodOpen` rejects entry creation, entry edit, calculation creation, Cat 3 derivation and `AWAITING_FACTOR` backfill. Emit `reporting_period.closed`. Check `LegalHold` — a held period may be closed but never reopened without release. | new barrier + `LegalHold` |
| **Detect later changes** | On every read of a closed period, recompute the fingerprint. Drift ⇒ `CHANGED_SINCE_CLOSE`, surfaced in `/attention` and on the period view. A factor import that *would* have backfilled an entry in a closed period records a `PendingRecalculation` signal instead of writing. | `computeCollectionFingerprint` generalised |
| **Controlled recalculation** | Requires an explicit `RecalculationEvent`: reason enum (`FACTOR_CORRECTION`, `ACTIVITY_DATA_CORRECTION`, `METHODOLOGY_CHANGE`, `ERROR_CORRECTION`, `LATE_DATA`), required narrative, authorising user, and target period. New calculation rows are written; superseded rows are marked, never deleted. Emit `recalculation.requested` / `recalculation.applied`. | new model + `OutboxMessage` for fan-out |
| **Reopen period** | `carbon.period.reopen` + required reason + no active `LegalHold`. `status = REOPENED` (distinct from `OPEN` — it records that this period was once closed). Prior close fields retained, exactly as `CarbonCollectionRequirement` retains exclusion fields after reopen. Emit `reporting_period.reopened`. | `reopenCollectionRequirement` pattern |
| **Restatement** | A new `ReportSnapshot` with `supersedesSnapshotId` + `restatementReason` + `payloadSha256`. The prior snapshot is never touched. The report view shows both, labelled. Emit `report_snapshot.restated`. | append-only snapshot + EMS supersede pattern |

---

## 12. Required schema changes — DESIGN ONLY

**Not to be implemented in this phase, and not while Phase 3-vi holds `prisma/schema.prisma`.** All changes below are purely additive; none alters an existing column's type or nullability, and none requires backfilling an existing row with a guessed value.

### 12.1 New models

```
model ReportingPeriod
  id, organisationId, periodStart, periodEnd
  periodKey            // "2026-03" | "2026-Q1" | "2026" — same convention as CarbonCollectionRequirement
  status               ReportingPeriodStatus @default(OPEN)
  closureFingerprint   String?   // sha256, same construction as computeCollectionFingerprint
  approvedByMembershipId?, approvedAt?
  closedByMembershipId?,   closedAt?
  reopenedByMembershipId?, reopenedAt?, reopenReason?   // retained across re-close, never cleared
  @@unique([organisationId, periodKey])

model RecalculationEvent
  id, organisationId, reportingPeriodId
  reason               RecalculationReason
  narrative            String     // required, not nullable — "must identify why it occurred"
  authorisedByMembershipId, authorisedAt
  appliedAt?, calculationsSuperseded Int, calculationsCreated Int

model ActivityEntryVersion          // append-only prior values
  id, activityEntryId, versionNo
  rawValue, rawUnit, canonicalValue, canonicalUnit, dataQualityTier, status
  supersededAt, supersededByMembershipId, recalculationEventId?
  @@unique([activityEntryId, versionNo])
```

### 12.2 New enums

```
enum ReportingPeriodStatus { OPEN  PENDING_REVIEW  CLOSED  REOPENED }
enum RecalculationReason   { FACTOR_CORRECTION  ACTIVITY_DATA_CORRECTION
                             METHODOLOGY_CHANGE  ERROR_CORRECTION  LATE_DATA }
```

### 12.3 Additive columns on existing models

| Model | Addition | Note |
|---|---|---|
| `Calculation` | `supersededByCalculationId String?` + `@relation` + `supersededAt DateTime?` + `recalculationEventId String?` | **Retire the existing bare `supersededById`.** It is unused (zero code references), so it can be dropped or renamed without data migration — but that decision belongs to whoever owns `schema.prisma`, and must not be taken while Phase 3-vi is in flight. Leaving both is the worst outcome. |
| `ActivityEntry` | `reportingPeriodId String?` | Denormalised for the barrier query, same rationale as the existing `organisationId` denormalisation on `Calculation`. |
| `ReportSnapshot` | `supersedesSnapshotId String?` + `restatementReason String?` + `payloadSha256 String?` + `reportingPeriodId String?` | `payloadSha256` nullable so pre-existing snapshots still render — matching the existing "All optional — snapshots predating these fields still render" convention in `ReportPayload`. |

### 12.4 Explicitly not proposed

- No change to `EmissionFactor` / `EmissionFactorSet` / any `Official*` model — Phase 3-vi territory.
- No change to `Calculation`'s factor-snapshot columns. They are correct.
- No new audit table. `AuditEvent.eventType` is a `String` precisely so new vocabulary needs no migration.
- No consolidation of `CarbonSourcePeriodObligation` into `CarbonCollectionRequirement` in this phase (R12 is real but is its own package).

---

## 13. Required service changes — DESIGN ONLY

| Service | Change |
|---|---|
| **New** `src/lib/carbon/reporting-period-service.ts` | `ensurePeriod`, `assertPeriodOpen`, `computePeriodFingerprint`, `approvePeriod`, `closePeriod`, `reopenPeriod`, `getPeriodState`. `assertPeriodOpen` is the single barrier; everything else calls it. |
| **New** `src/lib/carbon/recalculation-service.ts` | `requestRecalculation`, `applyRecalculation`. Writes new `Calculation` rows, marks superseded rows, emits audit + outbox. Never deletes. |
| `src/lib/entries-service.ts` | `createActivityEntryWithCalculations`, `runCalculationsForEntry`, `deriveCategory3Calculations` each call `assertPeriodOpen` inside their existing transaction. `runCalculationsForEntry` gains an explicit recalculation branch gated on a `RecalculationEvent` id — the early `if (existing.length) return existing;` stays the default. Add `recordAuditEvent` for entry creation, calculation creation and status transitions. |
| `src/lib/entries-service.ts` | **Rename `recalculatePendingEntries` → `backfillAwaitingFactorEntries`** and make it period-aware: skip closed periods, record a pending-recalculation signal for each skipped entry. The current name is the root of risk R1's misreading. |
| `src/lib/report-service.ts` | `buildReportPayload` gains a `collectionCompleteness` section (counts of `missing` / `excluded` / `changed_since_review` cells for the period) and a `basis` section recording engine version and period status at issue. Stays pure/read-only. |
| `src/app/(app)/reports/actions.ts` | `generateReportAction` computes and stores `payloadSha256`; refuses to issue over an `OPEN` period unless explicitly flagged as a draft/interim report; records `supersedesSnapshotId` when restating. Emit `report_snapshot.issued` / `.restated`. |
| `src/lib/factor-sets-service.ts` | Call the renamed period-aware backfill; surface skipped-because-closed counts to the importer UI. |
| `src/lib/calculation-integrity.ts` | `assertCompletePrimaryCalculations` filters to unsuperseded rows before asserting completeness. |
| `src/lib/audit/types.ts` | Additive vocabulary (no migration): `activity_entry.created`, `activity_entry.corrected`, `activity_entry.status_changed`, `calculation.created`, `calculation.superseded`, `recalculation.requested`, `recalculation.applied`, `reporting_period.opened`, `.submitted_for_review`, `.approved`, `.closed`, `.reopened`, `report_snapshot.issued`, `report_snapshot.restated`. Plus `AuditResourceType` additions. |
| `src/lib/rbac/permission-catalogue.ts` | Add `carbon.period.close`, `carbon.period.reopen`, `carbon.recalculation.authorise`. Wire into `role-templates.ts` — `carbon.period.reopen` should be narrower than `close`. |
| `src/lib/board/calculation-orchestration.ts` | Implement the declared contract, or delete it. Leaving an unimplemented lock contract in the tree is itself a hazard. |

---

## 14. Required UI changes — DESIGN ONLY

1. **Period view** (new, under `/sources` or a new `/periods`) — per-period status badge, collection matrix readiness summary, close/reopen controls with mandatory reason, and a prominent `CHANGED_SINCE_CLOSE` banner. Reuse the existing collection-matrix components.
2. **Close/reopen dialogs** — reason required; reopen shows the prior close record and any active `LegalHold`, and refuses while held.
3. **Recalculation request flow** — reason enum + narrative, a preview of exactly which calculations would be superseded and the net effect on the period total, and an explicit confirm. No silent apply.
4. **Entry form** — disabled with an explanatory message when the target period is closed, naming the period and pointing to the reopen request.
5. **Calculation detail** (`/calculations/[id]`) — show superseded state, the superseding calculation, and the recalculation event and its reason. The existing `explain-panel.tsx` is the right home.
6. **Report view** (`/reports/[id]`) — restatement banner linking prior and superseding snapshots, payload digest, and the new collection-completeness disclosure section.
7. **`/attention`** — add `CHANGED_SINCE_CLOSE` periods and pending recalculations to the management queue. It already renders the authorised critical-item set, so this is a new item type, not a new page.
8. **Factor import result** — disclose entries skipped because their period is closed, with a link to raise a recalculation.

---

## 15. Recommended Phase 4 implementation split

| Sub-phase | Content | Depends on |
|---|---|---|
| **4-i — Audit the numeric path** ✅ **DONE** | Added audit events for entry creation, entry provenance update, status transitions, calculation creation, awaiting-factor, Cat 3 derivation, factor backfill, reporting-data preparation and report issue. No schema change. Closed R2. See `Docs/CARBON_PHASE4_I_NUMERIC_AUDIT.md`. | — |
| **4-ii — Period entity and barrier** | `ReportingPeriod` model + enum, `reporting-period-service.ts`, `assertPeriodOpen` wired into all four write paths, period-aware rename of `recalculatePendingEntries`. Closes R1, R3, R5. | 4-i; Phase 3-vi schema freeze released. |
| **4-iii — Close, approve, reopen** | Approval + close + reopen with reason, closure fingerprint, `CHANGED_SINCE_CLOSE` detection, new permissions, period UI. | 4-ii |
| **4-iv — Controlled recalculation and supersession** | `RecalculationEvent`, `Calculation` supersession columns, retire the dead `supersededById`, recalculation service and preview UI, `assertCompletePrimaryCalculations` update. Closes R4. | 4-iii |
| **4-v — Entry correction and versioning** | `ActivityEntryVersion`, the entry edit path, correction-triggered recalculation. Closes R7. **Must not land before 4-iv** — a correction path without supersession is the exact failure mode this phase exists to prevent. | 4-iv |
| **4-vi — Report restatement and disclosure** | `payloadSha256`, `supersedesSnapshotId`, restatement reason, collection-completeness disclosure in the payload, report UI. Closes R8, R9, R10. | 4-iv |

Sequencing rule: **the barrier must exist before the correction path.** 4-v before 4-ii/4-iv would open the ability to rewrite history before the controls that make it auditable.

### 15.1 Phase 4 backlog — not scheduled, not implemented

Two items raised during 4-i. Neither is built, and neither should be built before the controls above exist.

#### B-A. Activity Data Register

There is currently **no way to see, search or correct activity data** once entered (§4.1: the only `ActivityEntry` writes are status transitions and a provenance link). A register would provide:

- view all activity data across sites, periods and data points;
- search and filter (site, entity, data point, period, status, data origin, DQ tier);
- edit an entry;
- safe delete / void;
- dependency awareness — an entry's calculations, its collection-requirement matches, its report-snapshot links, and any `LcaCorporateDataLink` citing it, shown **before** any destructive action is offered;
- the entry's own audit trail, which 4-i now makes possible to render.

**Depends on 4-ii (period barrier), 4-iv (supersession) and 4-v (entry versioning).** Edit and void are precisely the correction path those sub-phases exist to control; shipping the register's write half first would reintroduce every risk in §8. The read-only half (view, search, filter, audit trail) has no such dependency and could ship earlier.

#### B-B. Cross-cutting deletion policy

The repository has no single stated rule for what may be deleted. `LegalHold` states "holds always win", `assertCompletePrimaryCalculations` says history is "never repaired by deleting", and `BoardManagementPack` was retired by annotation rather than removal — three instances of the same instinct, never written down as one policy. Proposed rule, to be applied uniformly:

- **Unused / draft objects may be hard-deleted** — never referenced by a calculation, a report snapshot, an approved record or an audited decision.
- **Historically referenced objects must be archived, voided or superseded, never hard-deleted** — anything a figure, an issued report, an approval or an audit event points at.
- **Scope:** activity entries, calculations, factor datasets and factor sets, report snapshots, collection requirements, evidence and source documents, and any other user-created record.
- Deletion and voiding are themselves audited, with an actor and a reason.
- An active `LegalHold` blocks every one of these, including the hard-delete case.

**Depends on the supersession semantics from 4-iv**, which is where "archived / voided / superseded" first acquires a real meaning in the carbon schema. Writing the policy down can happen sooner; enforcing it cannot.

---

## 16. Tests required

**Unit (pure, no DB) — extend the existing `deriveCollectionStatus` style:**
- Period fingerprint: stable across query order; changes on any entry value, unit, calculation id, basis or result; unchanged by unrelated periods.
- `assertPeriodOpen` decision table across all four `ReportingPeriodStatus` values × all four write paths.
- `assertCompletePrimaryCalculations` with superseded rows present — complete set of unsuperseded rows passes, incomplete fails, superseded rows never count toward completeness.

**Service (mocked Prisma — the suite's existing default):**
- Factor import with an entry in a closed period: entry is **not** calculated, a pending signal is recorded, and the importer result discloses the skip. *(This is the R1 regression test — the single most important test in the phase.)*
- Entry creation rejected in a closed period; accepted in `REOPENED`.
- `deriveCategory3Calculations` rejected in a closed period.
- Close → modify an entry → fingerprint drift is detected on read, status reports `CHANGED_SINCE_CLOSE`.
- Reopen retains prior close fields; repeated close/reopen cycles preserve the full sequence in the audit chain.
- Reopen refused while an `ACTIVE` `LegalHold` covers the organisation or the period.
- Recalculation writes new rows and marks old ones superseded; **asserts zero `calculation.delete` / `deleteMany` calls**.
- A historical `ReportSnapshot` resolves identical figures before and after a recalculation of its period.
- Audit chain integrity across a full close → recalculate → reopen → restate sequence.
- Permission matrix: close, reopen and recalculation-authorise each independently denied without their permission.

**Tenant-adversarial (extend `src/lib/__tests__/tenant-adversarial/`):**
- Closing org A's period never affects org B's entries or backfill.
- Recalculation authorised in org A cannot supersede an org B calculation.

**Real-Postgres (the `checkpoint-a-postgres` workflow):**
- Concurrent close and entry creation — exactly one wins, no partial period state.
- Concurrent recalculation of the same period — no duplicate supersession, no orphaned superseding row.
- Unique constraint on `(organisationId, periodKey)` holds under concurrent `ensurePeriod`.

---

## 17. Dependencies on Phase 3

1. **Phase 3-v §13 explicitly defers this work to Phase 4**, and the wording is the specification Phase 4 must satisfy: *"Backdated correction use or intentional recalculation of old entries requires a separate, explicitly approved workflow/versioned result; neither publication nor activation triggers it."* Phase 4 builds that workflow. It must also preserve 3-v's companion rule: *"Do not change old calculation/report snapshot contents."*
2. **Factor activation must not trigger recalculation.** Phase 3-vi's activation/supersession/rollback (§11) and Phase 4's recalculation are deliberately separate triggers. Phase 4 must not wire an activation event to an automatic recalculation; activation may only *raise a pending-recalculation signal* for human authorisation.
3. **Provenance fields.** Phase 3-vi changes new calculation snapshots to use item-level `originalSourceName` / `originalVintageYear`. Phase 4's `RecalculationEvent` is what makes the resulting within-period provenance difference (R6) explainable. The two must land in a known order; 4-iv should not ship before 3-vi's adapter change is settled.
4. **`prisma/schema.prisma` is held by Phase 3-vi.** Sub-phase 4-i is deliberately schema-free so it can proceed in parallel; 4-ii onward cannot start until the schema freeze is released.
5. **Activity-period selection stays as-is.** 3-v §13: applicability is selected on the entry's `periodStart`, and multi-year/straddling periods keep current behaviour. Phase 4's period keying must use the same `periodStart` basis so a period barrier and a factor lookup never disagree about which period an entry belongs to.
6. **Phase 3-vi's `EmissionFactor.officialManifestFactorId` lineage chain** is what lets a recalculation state precisely which factor lineage replaced which. 4-iv's supersession reason should reference it where present and degrade gracefully to the legacy `factorSourceSnapshot` strings where not.

---

## 18. Blockers and open decisions

### Blockers

| # | Blocker |
|---|---|
| **B1** ✅ **RESOLVED** | **Phase numbering collision.** `Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md` is EMS Phase 4. Settled at 4-i: the carbon track is **Carbon Phase 4** with a `CARBON_PHASE4_*` document prefix (`Docs/CARBON_PHASE4_I_NUMERIC_AUDIT.md`). This preflight keeps its original filename for continuity. |
| **B2** | **`prisma/schema.prisma` freeze.** Sub-phases 4-ii onward need schema access. 4-i does not — start there. |
| **B3** | **PR #64 is draft/unmerged** and awaiting Astra's Checkpoint B re-review; BD09 is explicitly not authorised to start. Phase 4 must not be branched off unmerged work without a decision on base branch. |
| **B4** | **Real-Postgres testing.** The persistent Neon target (`cool-cake-20837205`) has been unreachable over raw Postgres TCP from every sandbox this sprint. The concurrency tests in §16 need the disposable `checkpoint-a-postgres` CI path, which does work. Plan for CI, not local. |

### Open decisions

| # | Decision |
|---|---|
| **D1** | **Period granularity.** Monthly, quarterly or annual close? `CarbonCollectionRequirement.periodKey` already supports all three (`"2026-03"`, `"2026-Q1"`, `"2026"`). Recommendation: **monthly close, annual report** — it matches the existing collection cadence and the dashboard's month pickers. |
| **D2** | **Retire or keep `Calculation.supersededById`?** It is unused, so dropping it costs nothing technically, but the call belongs to the schema owner. Keeping it *alongside* a new properly-related column is the one unacceptable outcome. |
| **D3** | **Can a report be issued over an open period?** Recommendation: yes, but stamped as interim/draft in the payload and on screen, so an issued report always says whether its period was closed. |
| **D4** | **Reviewer/approver separation.** Must the person who closes a period differ from the one who reviewed its collection cells? Recommendation: enforce where the role template grants both, matching the EMS approval pattern. |
| **D5** | **Consolidate `CarbonSourcePeriodObligation` into `CarbonCollectionRequirement`?** (R12) Recommendation: out of scope for Phase 4, flagged as its own package — but Phase 4 must not add new dependencies on the older model. |
| **D6** | **Retroactive period creation.** Existing organisations have entries and snapshots predating any `ReportingPeriod` row. Recommendation: lazy `ensurePeriod` on first touch, defaulting to `OPEN`; never retroactively mark a historical period `CLOSED` on the basis of a report having been issued — that would be inferring an authority decision that nobody made. |
| **D7** | **What happens to an `AWAITING_FACTOR` entry in a period closed forever?** It can never gain a figure without a reopen. Recommendation: it stays disclosed in `awaitingFactorEntries` indefinitely — correct under "missing data is never zero" — and the pending-recalculation signal makes the choice visible rather than silent. |

---

*Preflight only. Nothing in this document has been implemented.*

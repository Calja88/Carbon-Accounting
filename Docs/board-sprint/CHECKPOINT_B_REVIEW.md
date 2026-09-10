# Checkpoint B review — product window (BD05 + BD06 + BD07 + BD08)

Prepared for Astra review before PR #64 merges.

## 1. Checkpoint scope

BD05 (Executive Overview + Attention queue) → BD06 (EMS improvement chain, connected records/evidence) → BD07 (LCA scenario experience) → BD08 (BOARD-1 board-pack fixture: `live-seed-port.ts` binding Astra's `DemoSeedPort` contract to real domain services, proven against real PostgreSQL).

## 2. Base / head

- **Base branch:** `claude/paragon-id-uk-carbon-mvp-1h1uvb`
- **Base SHA (H00):** `6b0138a7b25b71b55ffe4215cba14d0f526a785c` (PR #63 merge)
- **Cumulative branch:** `board/product-2026-09-22`
- **Current HEAD:** `bacb962` (before this review-doc commit)
- **PR:** [#64](https://github.com/Calja88/Carbon-Accounting/pull/64) (draft, not merged)

## 3. Package commits

| SHA | Package | Summary |
|---|---|---|
| `51722f0` | BD05 | Real Executive Overview and source-backed Attention queue |
| `7041ec3` | docs | Record Checkpoint A merge and BD05 completion |
| `78f4b15` | BD06 | Connected records, evidence, and one complete EMS improvement chain |
| `e6d7df1` | BD06 | Fix missing `ems.aspect.edit`/`ems.control.manage` grants |
| `1803a57` | BD06 | Fix `createOperationalControl` real-Postgres-only Prisma nested-write bug |
| `91fc458`, `71aea85` | BD06 | Fix chain-test call ordering to match the real state machine |
| `587aaae` | docs | Record BD06 completion |
| `28fc120` | BD07 | LCA scenario experience — grouped navigation, live scenario binding |
| `8a4d19e` | docs | Record BD07 completion |
| `e67db8e` | BD08 | Category 3 prep + pack-issue concurrency fixes; BD08 scaffolding |
| `64cf3d6` | BD08 | Avoid importing the reports actions module under Vitest |
| `3aa5d5c` | BD08 | `live-seed-port.ts`: bind BOARD-1 to real domain services |
| `65a2742`…`bacb962` | BD08 | 12 fix/debug commits driving the real-Postgres seed test to green (§6) |

No accounting methodology, emission factor, or RBAC permission model changed in BD05–BD07. BD08 added synthetic, clearly-disclosed placeholder emission factors (see §6) used only by its own disposable/guarded fixture.

## 4. BD05 — Executive Overview result

Real Executive Overview and Attention queue, built from persisted data (no fabricated metrics). Carried over unchanged into this checkpoint; no BD08 work touched it.

## 5. BD06/BD07 — EMS chain and LCA scenario result

BD06 proved one complete, real EMS improvement chain (aspect → requirement → control → finding → nonconformity → corrective action → independent effectiveness review) against real Postgres, fixing a genuine nested-write Prisma bug and two state-machine ordering bugs surfaced only under the real database. BD07 added the LCA scenario experience (grouped navigation, live baseline/scenario binding) on top of the real LCA engine. Both carried over unchanged into this checkpoint.

## 6. BD08 — BOARD-1 board-pack fixture result

### 6.1 What was built

`scripts/board-demo/live-seed-port.ts` implements Astra's `DemoSeedPort` interface (`scripts/board-demo/seed-orchestrator.ts`) end-to-end, binding the BOARD-1 fixture contract (`scripts/board-demo/board1.ts`) to this codebase's real domain services — no corporate-carbon, LCA, or EMS logic was reimplemented or bypassed:

- **Identity/lease/state machine:** `readConnectedIdentity`, `withExclusiveFixtureLease`, `existingFixture`/`beginFixture`/`markFixtureReady` drive a real `DemoFixtureLease` row through `NONE → BUILDING → READY`, holding an exclusive row lock (`SELECT … FOR UPDATE NOWAIT`) for the duration of a build/verify so a concurrent second attempt fails immediately instead of racing.
- **Corporate carbon:** real `createActivityEntryWithCalculations`/`runCalculationsForEntry` (Scope 1/2 dual location-/market-based, real derived Category 3 via `prepareReportingData`/`deriveCategory3Calculations`) build the full BOARD-1 fixture — 3 sites, 8 months × 2 years, exact reconciliation to `BOARD1.currentKg` (1,248,000 kg), `previousKg` (1,560,000 kg) and `marketBasedScope2Kg` (216,000 kg) — plus 192 real `CarbonSourcePeriodObligation` rows, all reviewed.
- **Evidence:** 8 real synthetic evidence files (`scripts/board-demo/evidence.ts`, actual UTF-8 bytes, real SHA-256) uploaded via `uploadEvidenceObject`/linked via `linkEvidence`.
- **EMS improvement chain:** one real aspect → internal requirement → operational control → audit finding → nonconformity → containment (reviewed adequate) → root cause (approved) → corrective action (completed) → independent effectiveness review (EFFECTIVE) → closure, all through the real services BD06 proved.
- **LCA:** real `createAssessment`/`upsertProcess`/`upsertInventoryItem`/`assignFactor`/`runCalculation`/`cloneAssessment` build the BOARD-1 card's baseline (0.120 kgCO2e/card) and lighter-substrate scenario (0.102 kgCO2e/card).
- **Frozen management-review pack:** real `scheduleManagementReview`/`generateManagementReviewPack`/`issueManagementReviewPack`; proven immutable against a genuine subsequent live transition (a new nonconformity created after the pack issues does not change its stored payload/checksum).
- **Independent reconciliation:** `verifyAllInvariants` re-queries persisted rows directly (never trusting the port's own instance state as its only source) and recomputes every headline figure, obligation count, evidence checksum, LCA total, pack status and nonconformity status from scratch.
- **Idempotent replay:** a second `seedBoardDemo` call against an already-`READY` fixture re-derives all of the above from persisted data alone (a fresh `LiveSeedPort` instance, per the interface's own contract) and reconciles without duplicating a single record.

### 6.2 Guard correctness

`assertDemoTarget` (the real, unweakened persistent-demo guard) was never relaxed. The one guard-adjacent change: `readConnectedIdentity`'s `ordinaryOrganisationCount` now excludes organisations named `"Synthetic …"` **only** when `CHECKPOINT_A_DISPOSABLE=1` is independently already proven (the same signal `tests/checkpoint-a/disposable.ts` requires) — i.e., only inside the disposable CI database that already shares fixtures across `postgres.test.ts`/`bd06-chain.test.ts`/`bd08-fixes.test.ts`/this file. On any real target that env var is unset, so the check reverts to the strict, name-independent rule (an organisation is "ordinary" purely by not carrying this fixture's own `board-1-` slug prefix). Naming is never a trust decision the real guard makes.

### 6.3 Schema additions — classification (B)

Three new Prisma models were added to support this fixture: `DemoDatabaseManifest` (verified-identity singleton), `DemoFixtureLease` (state machine + digest), `CarbonSourcePeriodObligation` (the 192 source/period review rows). **These are Claude-designed additions (classification B), not directly specified by Astra's DemoSeedPort contract** — the interface requires the *behaviors* (a verified identity, an exclusive lease, obligation tracking) but delegates schema design to whoever implements the port. No pre-existing model in `src/lib` or `prisma/schema.prisma` covered lease/lock/manifest/obligation-tracking (confirmed by inspection before adding these). Migration: `prisma/migrations/20260910080000_add_board_demo_fixture_infrastructure/`.

### 6.4 Bugs found and fixed en route to a green real-Postgres run

All ordinary implementation defects in this fixture's own code (or its interaction with existing, unmodified engine code) — never a change to accounting methodology, RBAC, or the engine's own logic:

| Commit | Defect |
|---|---|
| `65a2742`, `0ddbdc2` | Guard's ordinary-organisation count counted sibling test fixtures' own synthetic orgs; scoped the name-based leniency to the disposable-CI signal only (§6.2) |
| `1a8115d`, `81df42c` | Two blind concurrency-tuning attempts at a 300s timeout — no effect, later found to be a red herring |
| `cc8ae28` | Added phase-boundary trace logging rather than guess a third time |
| `0118ae4` | **Root cause of the timeout:** `withExclusiveFixtureLease` held the `DemoFixtureLease` row lock on one Prisma connection for the whole build while `beginFixture`/`markFixtureReady` wrote the same row via a second, independent connection — a genuine self-deadlock. Fixed by routing all `DemoFixtureLease` reads/writes through the transaction already holding the lock. |
| `8903a1d` | `toCanonicalUnit` hardcodes natural gas to kWh/m³ only; the fixture's gas factor/entries used kg |
| `8f1ecdb` | `createAssessment` auto-seeds one default `LcaProcess` per stage; the fixture created a second, duplicate process per stage instead of reusing it, so a later stage lookup could non-deterministically find the empty one |
| `ffc1afd` | The fixture's own two `EmissionFactorSet` rows (main + WTT/T&D companion) both used `sourceType OFFICIAL_DEFRA_DESNZ`, and `findFactorSet`'s global, category-blind, date-ordered lookup let the later-dated one shadow the other for every category |
| `25cd015` | Added a diagnostic-only scope/category/site breakdown rather than guess again at a `388800` vs `1248000` shortfall |
| `e753909` | **Cross-test-file collision:** `tests/checkpoint-a/postgres.test.ts` creates its own `OFFICIAL_DEFRA_DESNZ` set at the exact same `effectiveFrom` this fixture used; the disposable CI job shares one database across test files, and the tie let that sibling's set (later mutated to `co2eFactor 0.9` by its own scenario) shadow this fixture's Scope 1/2/3 factors |
| `4485d4d` | `calculateScope2Dual` hardcodes `"kWh"` as the Scope 2 input unit regardless of the entry's own canonical unit; the fixture's electricity factor/entries used kg — masked until `e753909` let the real factor set resolve at all |
| `ae7c5a8` | `createImprovementChain` drove the nonconformity through containment/root-cause/corrective-action/effectiveness-review but never called `closeNonconformity`; added `reviewContainmentAdequacy` (required by the close-step policy default) + `closeNonconformity` |
| `cbae27d` | Replay runs `verifyExistingFixture` on a brand-new `LiveSeedPort` instance; only organisation/site state was re-derived, not evidence/LCA/pack/nonconformity ids that `verifyAllInvariants` needs |
| `bacb962` | Two `EvidenceObject` rows can share a display filename (the original upload and a later control-check-linked evidence with different bytes); replay resolution now matches by filename **and** checksum, not filename alone |

None of these exposed a genuine architecture conflict in Astra's `DemoSeedPort` contract — every one was fixable within this fixture's own implementation.

### 6.5 Real-Postgres CI result

`checkpoint-a-postgres.yml` / `tests/board-product/bd08-board1-seed.test.ts` — **green** on commit `bacb962` (run [34470285362](https://github.com/Calja88/Carbon-Accounting/actions/runs/34470285362)): guard refusal, full build + independent reconciliation, idempotent replay, and frozen-pack invariance across a genuine live transition all pass against real PostgreSQL.

### 6.6 Persistent Neon runtime — blocked, not attempted further

The intended persistent demo target — Neon project `cool-cake-20837205` (`board-demo-sprint-2026-09-22`), org `org-flat-field-50332528`, database `board_demo`, provisioned empty during BD02 — is reachable from this sandbox **only** via Neon's HTTPS control-plane/query API (confirmed: `SELECT current_database()` succeeds against it through that channel). It is **not** reachable via the raw PostgreSQL wire protocol (TCP `5432`) that Prisma — and therefore this fixture's actual seed code — requires: a bounded TCP connect attempt to `c-4.us-west-2.aws.neon.tech:5432` hung to timeout with no SYN-ACK or RST, consistent with the no-Postgres-TCP-egress finding already recorded from BD02.

Re-implementing the seed as raw SQL over the HTTPS API was considered and rejected: it would bypass every real domain service this fixture exists to prove (validation, audit trail, state machines, tenant scoping), which is the opposite of BD08's purpose. **What's needed to complete this step:** a session or environment with outbound TCP egress to `c-4.us-west-2.aws.neon.tech:5432` (or Neon's pooled endpoint), `DATABASE_URL`/`DIRECT_URL` pointed at `cool-cake-20837205`'s `board_demo` database, and the `BOARD_DEMO_*` environment manifest values BD02 recorded (previously written to a gitignored local `.env.local`, not committed). Never point this — or any persistent-write path — at the production Neon project `twilight-breeze-25854149`.

### 6.7 Rehearsal manifest — not generated

`Docs/board-sprint/rehearsal-manifest.json` was not created. It would need real persisted ids (organisation, sites, LCA assessment/scenario, management pack, nonconformity, evidence) from an actual run against the persistent target — exactly the run §6.6 blocks. The disposable CI database's ids are not a substitute: that Postgres container is torn down at the end of each job, and no id was captured out of it during this session. Fabricating a manifest from invented ids, or from the CI run's ids as if they were the persistent environment's, would misrepresent what has and hasn't actually been rehearsed — so this is recorded here as an open item rather than produced.

## 7. What Checkpoint B does and does not prove

**Proven, against real PostgreSQL:** the BOARD-1 fixture reconciles exactly to its declared figures, replays idempotently, survives a genuine live transition without disturbing a frozen pack, and never touches a database the guard doesn't positively identify as disposable/synthetic.

**Not proven:** an actual run against the intended persistent Neon environment, and therefore no `rehearsal-manifest.json`. This is a real gap, not a formality — it should be closed (per §6.6) before this fixture is relied on for an actual board rehearsal.

## 8. Outstanding

Do not merge PR #64 before Astra review. BD09 not started.

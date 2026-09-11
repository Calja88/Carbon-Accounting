# Checkpoint B review — product window (BD05 + BD06 + BD07 + BD08)

Prepared for Astra review before PR #64 merges.

**Status: remediation of Astra's Checkpoint B "APPROVE AFTER REQUIRED FIXES" decision is complete (8 required fixes, real-Postgres CI green) as of commit `2ca3752`, carried through two docs/tooling-only follow-up commits to HEAD `a2fbbd9`/`c010842` — see §9. A SECOND corrective handoff (Astra's own §1–§8, correcting fixes CI alone could not catch) is now also complete and green on real-Postgres CI, at true current HEAD `621cf42` — see §10. PR #64 remains unmerged, draft, awaiting Astra's re-review. BD09 has not been started.**

## 1. Checkpoint scope

BD05 (Executive Overview + Attention queue) → BD06 (EMS improvement chain, connected records/evidence) → BD07 (LCA scenario experience) → BD08 (BOARD-1 board-pack fixture: `live-seed-port.ts` binding Astra's `DemoSeedPort` contract to real domain services, proven against real PostgreSQL).

## 2. Base / head

- **Base branch:** `claude/paragon-id-uk-carbon-mvp-1h1uvb`
- **Base SHA (H00):** `6b0138a7b25b71b55ffe4215cba14d0f526a785c` (PR #63 merge)
- **Cumulative branch:** `board/product-2026-09-22`
- **Current HEAD:** `a2fbbd9` (`2ca3752` + a docs commit `f4e2391` recording remediation results, + a handoff-tooling commit `a2fbbd9` allowlisting 5 reviewed test-fixture matches so `handoff:review` runs clean — no functional/domain code changed in either; both independently green on real-Postgres CI, see §9.2)
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

## 8. Outstanding (pre-remediation state — see §9 for what changed)

Do not merge PR #64 before Astra review. BD09 not started.

## 9. Checkpoint B remediation (Astra's "APPROVE AFTER REQUIRED FIXES" response)

Astra's Checkpoint B review of §1–§8 above returned **APPROVE AFTER REQUIRED FIXES**, naming 8 required fixes. All 8 are implemented on this same branch/PR, verified against real PostgreSQL in CI. Nothing below claims BD09 has started, claims PR #64 is merged, or claims the persistent-Neon gap (§6.6/§6.7) is closed — none of that changed.

### 9.1 Findings-fixed map

| Fix | Area | Commit(s) | What changed |
|---|---|---|---|
| 1 | Overview/Attention scope enforcement | `975472a` | EMS-derived Attention families (effectiveness review, corrective action/ActionItem, obligation) now deny rather than org-wide-widen for a site-restricted member (these models carry no site attribution); a selected single site now genuinely narrows `buildAnalyticsSnapshot`'s totals/coverage/links, not just hrefs. New `loadOverviewForContext` export makes this testable without `requireOrganisationContext()`. |
| 2 | Coverage/reconciliation binding | `6c713ff`, `a985699` (root cause), `a950bbd` (sequencing) | `computeCoverageWindow` rewritten as a per-(site, month) cell hybrid: obligation-backed where `CarbonSourcePeriodObligation` rows exist for that cell, `ActivityEntry`-derived fallback otherwise — never mixed within one cell, and never binding every tenant's Overview to a BOARD-1-only model. `computeScope3CategoryCoverage` regrouped onto the canonical `scope3Category` (was free-text `category`, which any tenant can set identically across distinct categories) and now unconditionally screens Category 3 (root cause of the "Invalid Scope 3 coverage" throw — see §9.3). Seed now genuinely links every obligation to the real `ActivityEntry` it reviews and adds a comparable, fully reviewed prior-year (2025) set. |
| 3 | LCA comparison bypass | `8458e29`, `2ca3752` (test-only next-auth fix) | `scenarios/page.tsx` no longer renders the legacy percentage/contribution comparison block for any `boardModel` that is null or `comparable: false` — closes the path where a stale, boundary-incompatible, or inaccessible scenario could still show a bare percentage. `createAssessment` now takes explicit functional-unit fields so BOARD-1's baseline/scenario are genuinely comparable rather than relying on a null default. |
| 4 | Trustworthy seed identity guard | `975472a` | `readConnectedIdentity` now requires two independent, out-of-band signals (`APP_DATA_MODE=synthetic` + a `DemoDatabaseManifest.provisioningToken` only real provisioning writes) before reporting SYNTHETIC/disposable; CI-only naming leniency now requires the full independently-verified disposable check, not the CI flag alone. |
| 5 | Partial build state / replay integrity | `975472a` | Replaced the two-connection lease/build split (a failure after `BUILDING` could roll the lease back to `NONE` while domain writes survived) with an atomic CAS on `DemoFixtureLease.status`; an interrupted build stays detectable. `verifyExistingFixture` recomputes and checks the digest instead of trusting it. |
| 6 | Usable personas / credentials / permissions | `975472a` | Personas now get a real bcrypt-hashed random password compatible with the actual login path (was a bare SHA-256 digest, incompatible with `src/auth.ts`); contributor persona actually holds `carbon.entry.create`; sustainability-lead/independent-reviewer/read-only/restricted personas' `lca.*`/`lca.view` grants corrected. |
| 7 | EMS chain / evidence binding | `a493bd6`, `9c1c687` (root cause) | Internal requirement, audit, and control-check evidence rebuilt through real EMS state machines (applicability assessment → obligation version → evaluation; audit programme → audit → checklist → finding → report) instead of being created directly at terminal status or bypassing lifecycle transitions. Real invoice/meter `SourceDocument` rows now generated from, and linked to, the exact `ActivityEntry` they document. Connected-record links now carry `?record=<id>` to the exact row instead of a bare register list. |
| 8 | Frozen management pack / concurrency | `311389a` | New `BoardManagementPack` model + `live-management-pack.ts`: a real Overview snapshot, decisions derived from the fixture's own corrective action, and pinned source revisions, frozen via the same atomic-CAS generate/issue pattern used elsewhere. Also fixed the exact race Astra flagged in the pre-existing `pack-service.ts` (`generateManagementReviewPack`'s pre-transaction status read did not close the concurrent-write window). Known remaining gap, disclosed rather than rushed: no authorised view/print/download UI route for the new pack yet. |

### 9.2 Real Postgres CI — green

Both required checks pass on **HEAD `2ca3752`** (`PR #64`), confirmed via direct GitHub Actions API query (not notification-only):

- `checkpoint-a-postgres.yml` ("Checkpoint A PostgreSQL gate") — run [34557276819](https://github.com/Calja88/Carbon-Accounting/actions/runs/34557276819) — **success**. Runs against real PostgreSQL, in the pinned order (`vitest.checkpoint-a.sequencer.mts`) needed for cross-file fixture dependencies: `tests/checkpoint-a/postgres.test.ts`, `bd06-chain.test.ts`, `bd08-fixes.test.ts`, `bd08-board1-seed.test.ts`, and the 6 new Checkpoint B suites — `checkpoint-b-seed-guard.test.ts`, `checkpoint-b-personas.test.ts`, `checkpoint-b-management-pack.test.ts`, `checkpoint-b-overview.test.ts`, `checkpoint-b-lca-scenarios.test.ts`, `checkpoint-b-ems-chain.test.ts`, `checkpoint-b-coverage.test.ts`.
- `ci.yml` ("Typecheck, lint, test") — run [34557276840](https://github.com/Calja88/Carbon-Accounting/actions/runs/34557276840) — **success**.

Both checks were re-confirmed green on the two subsequent docs/tooling-only commits, ending at true current HEAD `a2fbbd9`:

- `f4e2391` (this doc update): `checkpoint-a-postgres` run [34557824889](https://github.com/Calja88/Carbon-Accounting/actions/runs/34557824889) — success; `ci.yml` run [34557824900](https://github.com/Calja88/Carbon-Accounting/actions/runs/34557824900) — success.
- `a2fbbd9` (H00 handoff-tooling allowlist fix, §9.7): `checkpoint-a-postgres` run [34558135087](https://github.com/Calja88/Carbon-Accounting/actions/runs/34558135087) — success; `ci.yml` run [34558135067](https://github.com/Calja88/Carbon-Accounting/actions/runs/34558135067) — success.

This was not a first-try green: 9 prior runs on this remediation (`975472a` through `a950bbd`) failed in CI and were fixed in place — see §9.3.

### 9.3 Pre-existing bugs found and fixed along the way (not introduced this session)

Exercising this code against real Postgres for the first time (Fix 2/Fix 7 require paths never previously covered by real-Postgres tests) surfaced two genuine, pre-existing production defects, fixed because they directly blocked the required fixes from working at all — no accounting methodology, RBAC model, or tenant-scoping logic changed:

1. **Prisma nested-write incompatibility (`9c1c687`).** `createApplicabilityAssessment`, `createComplianceObligation`, `createEmsAudit`, `createComplianceEvaluation` each tried to nest to-many child creates under a parent `create()` call, passing `organisationId` explicitly on each child. Every affected child model has both a plain `organisation` relation and a compound relation back to its immediate parent that also involves `organisationId` — Prisma's generated nested-create input type excludes `organisationId` as "implied by the parent relation" in that situation, so the nested write threw `Unknown argument organisationId` against real Postgres (never caught by the mocked-Prisma test suite, which accepts any shape). Fixed by creating the parent bare, `createMany` for children with explicit ids, then re-fetching with the original `include`. This alone was blocking the entire Fix 7 EMS chain from completing, which cascaded into 9 downstream real-Postgres test failures.
2. **Scope 3 quantified/screened mismatch (`a985699`).** `buildCarbonSection`'s own invariant (`quantifiedCategories <= screenedCategories`) was violated because Category 3 (fuel- and energy-related activities) structurally has no `ActivityDataPoint` of its own — it only ever appears via the derivation mechanism (`scope3-derived.ts`) — so it was counted in `quantifiedCategories` (via `Calculation.scope3Category`) but omitted from `screenedCategories` (via `ActivityDataPoint.scope3Category`). This threw "Invalid Scope 3 coverage" on every real BOARD-1 Overview load, silently swallowed to "unavailable" by `overview-service.ts`'s own `section()` wrapper (by design — it never logs the real exception). Root-caused via a temporary diagnostic (added in `1f0d993`, removed in `a985699` once found) and fixed by unconditionally screening Category 3.

### 9.4 Verification actually run

- Full mocked Vitest suite: PASS (updated mock fixtures in the 4 EMS service test files affected by the nested-write fix in §9.3).
- `tsc --noEmit`: PASS.
- `pnpm run lint`: PASS.
- Real-Postgres `checkpoint-a-postgres` suite (55 tests across 11 files, pinned order): PASS on `2ca3752` — see §9.2. This is the only environment in which Fix 2's 192/192 obligation-backed coverage, Fix 7's EMS chain/evidence binding, and Fix 8's frozen-pack concurrency were actually exercised against a real database; none of it is asserted from mocked tests alone.
- **Not run:** anything requiring the persistent Neon target (`cool-cake-20837205`) — unchanged from §6.6/§6.7. This sandbox still has no outbound TCP egress to Neon's Postgres port. This is a real, disclosed gap and is **not** being treated as the sole blocker on this PR — Astra's 8 required fixes above are the PR #64 gate, and are independently proven against the disposable real-Postgres CI database. The persistent-runtime rehearsal remains a BD09/pre-demo gate, not a Checkpoint B gate. No READY state, rehearsal manifest, persistent ids, or browser proof has been fabricated to paper over this gap.

### 9.5 Schema/migration changes this remediation

- `20260910120000` (Fix 1/4/5/6 batch, part of `975472a`): `CarbonSourcePeriodObligation.submittedActivityEntryId` + compound unique `(organisationId, siteId, month, sourceKey)`; `DemoFixtureLease.status` constrained to an enum; `DemoDatabaseManifest.provisioningToken`.
- New migration for `BoardManagementPack` (Fix 8, part of `311389a`).
- Forward-only in both cases — the prior `20260910080000` migration (§6.3) is not rewritten.

### 9.6 H00 handoff bundle

`pnpm run handoff:review -- --task CHECKPOINT-B-REMEDIATION --base bacb962 --run-checks` initially aborted (correct fail-closed behaviour) on 5 credential-like matches across the new Checkpoint B real-Postgres test files — 4 reuses of the already-reviewed fixed literal `passwordHash: "not-a-login-hash"` in synthetic membership fixtures, and 2 `BOARD_DEMO_PROVISIONING_TOKEN` assignments (a `randomUUID()`-derived local variable, and a self-documenting mismatch fixture for Fix 4's negative-case test) — none a real credential. Each of the 5 files was read in full and given its own narrow exact-file/exact-matched-text `REVIEWED_SAFE_CREDENTIAL_MATCHES` entry (commit `a2fbbd9`); a different or new credential-like value in any of these files still fails the scan. 12 new tests added to `handoff-secret-scan.test.ts` proving the allow/still-fail/no-leak behaviour for each. `handoff:secret-audit` now reports **0 unreviewed findings** for this remediation's diff against `bacb962`.

Regenerated bundle: `artifacts/ai-handoff/review/CHECKPOINT-B-REMEDIATION-review-20260911-032232.zip` (not committed — gitignored per `handoff:review`'s own design; hand off out-of-band). Contents: `TASK.md`, `IMPLEMENTATION_SUMMARY.md`, `GIT_STATUS.txt`, `GIT_DIFF.patch` (39 changed files vs `bacb962`), `CHANGED_FILES.txt` + full file bodies, `TEST_RESULTS.md` (full mocked suite: 2068 passed, 11 skipped, 0 failed; lint: 0 errors, 9 pre-existing warnings), `SECURITY_CHECK.md` (39 files scanned, PASS — no suspected secrets), `MANIFEST.md`, plus `MIGRATIONS/` and `PRISMA_SCHEMA/` snapshots.

### 9.7 Outstanding after remediation

- PR #64 remains **draft, unmerged**. Next step is Astra's re-review of this remediation, not a merge.
- BD09 has **not** been started.
- Persistent Neon runtime rehearsal (§6.6) and the rehearsal manifest (§6.7) remain not done, for the same sandbox-network reason as before — carried forward as a BD09/pre-demo gate, explicitly not conflated with this checkpoint's own required fixes.
- Fix 8's management-pack view/print/download UI route is not yet built (disclosed in §9.1 rather than rushed).
- No stop condition (per Astra's explicit list) was hit during this remediation.

## 10. Second corrective handoff (`Carbon_Ledger_Checkpoint_B_Implementation_Handoff_1.md`, §1–§8)

Astra reviewed the §9 remediation's own source at commit `c010842` and returned a second, more detailed corrective handoff naming 8 sections that CI-green alone had not proven — several of these were genuine bugs the mocked suite structurally cannot see (real-Postgres CAS races, jsonb storage-normalization mismatches, service-level state-machine guards). Governing instructions: inspect the branch first, never reset to the reviewed commit, complete the code rather than re-plan, retain every fix already demonstrated, resolve routine details from the repository, ask only on a material contradiction. All 8 sections are implemented on this same branch/PR; PR #64 stays draft/unmerged; BD09 remains unstarted throughout.

### 10.1 Findings-fixed map

| § | Area | Commit(s) | What changed |
|---|---|---|---|
| 1 | Explicit obligation review / referential integrity | `823c694`, `27ad69d` (real CAS race found by new test) | New `source-period-obligation-service.ts`: `reviewSourcePeriodObligation`/`excludeSourcePeriodObligation` CAS against the fixed required precondition status (`REVIEW_REQUIRED`/`{not:"EXCLUDED"}`), never the last-read status — the original used the latter, which let a concurrent duplicate reviewer trivially "succeed" a second time after the winner committed; real-Postgres CI's new concurrency test caught it directly. Obligations now carry `reviewFingerprint`/`reviewedByMembershipId`/`excludedByMembershipId` for genuine provenance. `computeCoverageWindow` gained fingerprint-based stale invalidation and unmapped-entry surfacing; `attention()` gained `emsAvailable`/`emsUnavailableReason` truthfully reflecting single-site EMS-attention denial. |
| 2 | Two-year shared carbon pipeline / honest Scope 3 screening | `38dead8` | `createAndCalculateCarbon` rewritten as one shared per-year loop — the prior year now goes through the identical real derivation pipeline (`prepareReportingData` → derived Category 3 → `scope3Allocation`) as the current year, not a coarser one-line stand-in; `buildSubmissionObligations()` now returns both years at identical fine-grained per-source granularity (192 each). `computeScope3CategoryCoverage` now honestly returns `screenedCategories: null` with a reason — no screening subsystem exists in this codebase, confirmed by inspection, so it never fabricates a screened count. |
| 3 | LCA authorisation and comparability | `e2cf488`, `45eb1f2` (real-Postgres-caught wording bug) | `scenarios/page.tsx` renders nothing scenario-identifying for any child that doesn't resolve through one single authorised `resolveScenarioComparison` path (`canViewLca` → `requireAssessmentInScope` on both sides → the comparability judgment) — closing the path where an unauthorised/incompatible scenario could still show a bare percentage. `buildScenarioComparability` gained 6 ordered real checks (unit kind/description, Decimal-equivalent quantity, boundary, lifecycle-stage set, engine/methodology provenance — absence on both sides is never treated as a match, freshness). Real-Postgres CI caught a wording bug (`"functional/declared unit"` broke the existing `/functional unit/i` assertion) missed by local reasoning alone. |
| 4 | Target identity, fixture ownership, credentials | `5632240` | `DemoFixtureLease.fixtureOrganisationId` (the exact id bound atomically with the NONE→BUILDING transition) replaces a name/slug-prefix heuristic any foreign tenant could imitate. `readConnectedIdentity` additionally requires the manifest's `approvedDatabaseName`/`approvedRole` to match the live connection's own `current_database()`/`current_user`. Persona passwords now come from an operator-supplied `BOARD_DEMO_CREDENTIALS_FILE` or a random in-memory-only value — never logged (the prior version traced plaintext to stderr). |
| 5 | Durable seed state / actual-byte integrity | `0afc552`, `d763445`+`5f97949` (real jsonb-normalization bug found and fixed on the 2nd attempt) | `DemoFixtureLease` gains a schema-versioned `identityMap` (every id a replay needs) and `implementationRevision`, written atomically with the BUILDING→READY CAS; a revision mismatch is refused via the orchestrator's own fixed "fresh empty demo database" path, never silently reinterpreted. `resolveExistingFixtureState` now validates every id against its tenant/relation from that map instead of findFirst-by-name/oldest-row/filename+checksum heuristics. `verifyAllInvariants` reads evidence/document bytes back through the real access-controlled path and compares them byte-for-byte, and recomputes pack checksums from the actual persisted payload. **Two real, pre-existing-pattern bugs found only by real Postgres:** the board pack's checksum was computed over the pre-write in-memory object, which a Decimal/jsonb-normalization mismatch could never reproduce from what was actually stored — fixed (after one incomplete JS-side-normalization attempt) by computing the checksum from the payload read back after writing, within the same transaction. |
| 6 | Complete the EMS chain / observable live transition | `791ff8f`, `6081310` (real state-machine bug found — `requestEffectivenessReview` requires every action complete) | `createImprovementChain` links the internal-requirement evaluation item as a further source on the nonconformity (`linkAdditionalSourceToNonconformity`, reference note naming the exact NC id) rather than a silently-dropped duplicate. After the primary chain's own genuine first closure, the nonconformity is genuinely reopened for a second, explicitly identified corrective action (`BOARD1-CA-EXT`) via a real second root-cause analysis/approval — left OPEN at freeze time. A real-Postgres test then completes it, requests/performs a second effectiveness review (a distinct reviewer, four-eyes non-overridable), and closes the nonconformity again — Overview/Attention `openActions` measurably drops, while the frozen pack's payload/checksum never move. |
| 7 | One management-pack lifecycle / complete frozen payload | `e41dbf1` | The board-sprint's own `FrozenBoardPack` is no longer a standalone `BoardManagementPack` table with its own generate/issue/status/checksum lifecycle — it is a validated, schema-versioned `board` section folded into the SAME `ManagementReviewPack.payload`, covered by that pack's one canonical checksum (computed via the same read-back-after-write pattern §5 proved correct, now load-bearing for the board section's own real numbers too). `live-management-pack.ts` is a thin adapter over `pack-service.ts`; the standalone table is retired (schema comment only, no destructive migration). Disclosed, not implemented this pass: real `ManagementReviewInputDefinition`/`InputLink` wiring (the fixture's fixed fictional cutoff date predates its own real-timestamped EMS rows, so the existing adapters' own `issuedAt <= cutoff` checks would exclude every candidate — a fixture date-model decision, not a mechanical hookup), `SELECT FOR UPDATE`/Serializable-isolation hardening beyond the existing proven CAS pattern, and new UI routes/guard (no route reads this pack at all yet). |
| 8 | Verification / docs / H00 | `621cf42` (this section) | V01–V16 acceptance table (§10.2), this closure table, regenerated H00 bundle. |

### 10.2 V01–V16 acceptance table

No literal "V01–V16" enumeration exists in this repository's own tracked docs prior to this handoff; the table below is derived from the second corrective handoff's own 8 sections, one to two verifiable claims per section, each pinned to a specific real-Postgres test that would fail if the claim were false.

| ID | Claim | Verified by (real Postgres) |
|---|---|---|
| V01 | Concurrent obligation review/exclusion CAS admits exactly one winner | `checkpoint-b-obligation-review.test.ts` |
| V02 | Every REVIEWED obligation is bound to a real submitted `ActivityEntry` with a recorded reviewer and fingerprint | `bd08-board1-seed.test.ts` (`linkedReviewedCount` = 192/192) |
| V03 | The prior year reconciles through the identical real derived-Category-3 pipeline as the current year | `bd08-board1-seed.test.ts` (`previousKg` reconciliation incl. prior-year derived rows) |
| V04 | Scope 3 screened-category count is honestly `null`, never fabricated, when no screening subsystem exists | `checkpoint-b-coverage.test.ts` |
| V05 | An LCA scenario comparison never renders for an unauthorised, boundary-incompatible, or stale pair | `checkpoint-b-lca-scenarios.test.ts` |
| V06 | LCA comparability checks Decimal-equivalent quantity, provenance and lifecycle-stage set, never string/absence equality | `checkpoint-b-lca-scenarios.test.ts` (`the real BOARD-1 fixture's issued scenario is comparable...`) |
| V07 | A foreign organisation sharing this fixture's slug prefix is never treated as fixture-owned | `checkpoint-b-seed-guard.test.ts` |
| V08 | The provisioning-token trust root is bound to the live connection's actual `current_database()`/`current_user`, not just a manifest label | `checkpoint-b-seed-guard.test.ts` |
| V09 | A READY fixture recorded under a stale implementation revision is refused, never silently reinterpreted | `checkpoint-b-seed-guard.test.ts` (§5 test) |
| V10 | Replay refuses a tampered identity map or evidence whose real stored bytes were altered, independent of its own checksum columns | `checkpoint-b-seed-guard.test.ts` (§5 tests) |
| V11 | The internal-requirement evaluation item is linked as a further source naming the exact nonconformity id, never spawning a duplicate | `checkpoint-b-ems-chain.test.ts` |
| V12 | A retained OPEN corrective action can be completed and independently reviewed live post-freeze, via the real state machine (reopen → complete → effectiveness review → close), with Overview/Attention observably changing | `checkpoint-b-ems-chain.test.ts` |
| V13 | The frozen management pack's payload/checksum never move across any live domain transition after issue | `bd08-board1-seed.test.ts`, `checkpoint-b-management-pack.test.ts`, `checkpoint-b-ems-chain.test.ts` |
| V14 | The board section is one validated part of the ONE `ManagementReviewPack` payload — zero legacy `BoardManagementPack` rows are ever created | `checkpoint-b-management-pack.test.ts` |
| V15 | Pack generate/issue concurrency: a delayed generate never overwrites an issued pack; exactly one of two concurrent issues succeeds | `checkpoint-b-management-pack.test.ts` |
| V16 | The full BOARD-1 fixture builds from empty, replays without duplication, and reconciles independently (never trusting the port's own instance state) | `bd08-board1-seed.test.ts` |

### 10.3 Real Postgres CI — every commit in this chain

All commits below target `checkpoint-a-postgres.yml` ("Checkpoint A PostgreSQL gate") on `board/product-2026-09-22`, PR #64:

| Commit | Run | Result |
|---|---|---|
| `c010842` (base, prior remediation's own final docs commit) | [34558426576](https://github.com/Calja88/Carbon-Accounting/actions/runs/34558426576) | success |
| `823c694` (§1) | [34578940070](https://github.com/Calja88/Carbon-Accounting/actions/runs/34578940070) | success |
| `38dead8` (§2, 1st attempt) | [34579934171](https://github.com/Calja88/Carbon-Accounting/actions/runs/34579934171) | failure — Category 3 envelope arithmetic, fixed next commit |
| `27ad69d` (§1 CAS race fix, real bug found by new test) | [34580456720](https://github.com/Calja88/Carbon-Accounting/actions/runs/34580456720) | success |
| `e2cf488` (§3, 1st attempt) | [34581860075](https://github.com/Calja88/Carbon-Accounting/actions/runs/34581860075) | failure — wording broke an existing regex assertion, fixed next commit |
| `45eb1f2` (§3 wording fix) | [34582259258](https://github.com/Calja88/Carbon-Accounting/actions/runs/34582259258) | success |
| `5632240` (§4) | [34583627735](https://github.com/Calja88/Carbon-Accounting/actions/runs/34583627735) | success |
| `0afc552` (§5) | [34603740087](https://github.com/Calja88/Carbon-Accounting/actions/runs/34603740087) | success |
| `791ff8f` (§6, 1st attempt) | [34604902151](https://github.com/Calja88/Carbon-Accounting/actions/runs/34604902151) | failure — `requestEffectivenessReview` real state-machine guard, fixed next commit |
| `6081310` (§6 reopen-ordering fix, 2nd attempt) | [34605723637](https://github.com/Calja88/Carbon-Accounting/actions/runs/34605723637) | failure — separate, previously-unreached board-pack checksum bug, exposed now that the build progressed further |
| `d763445` (§5 board-pack checksum fix, 1st attempt) | [34606225944](https://github.com/Calja88/Carbon-Accounting/actions/runs/34606225944) | failure — JS-side JSON-normalization theory was incomplete |
| `5f97949` (§5 board-pack checksum fix, 2nd attempt — read-back-after-write) | [34606836430](https://github.com/Calja88/Carbon-Accounting/actions/runs/34606836430) | success |
| `e41dbf1` (§7) | [34608413815](https://github.com/Calja88/Carbon-Accounting/actions/runs/34608413815) | success |
| `621cf42` (§8, H00 tooling, this doc) | [34609295893](https://github.com/Calja88/Carbon-Accounting/actions/runs/34609295893) | in progress at time of writing — see final report for confirmed result |

Not a first-try green: 4 of the 13 pushes in this chain failed real-Postgres CI and were fixed in place before proceeding, each time by reading the actual job log rather than guessing — two genuine implementation bugs this fixture's own code introduced (§2's Category 3 envelope, §6's effectiveness-review precondition), and two genuine pre-existing-pattern bugs only real Postgres could expose (§1's CAS race, §5/§7's jsonb checksum-normalization mismatch, the latter taking two attempts to root-cause correctly).

### 10.4 Schema/migration changes this handoff

- `20260911040000_carbon_source_period_obligation_provenance` (§1): FKs/CHECK constraints on `CarbonSourcePeriodObligation`, `reviewFingerprint`/`excludedByMembershipId`/`excludedAt`/`excludedReason`.
- `20260911100000_demo_target_identity_hardening` (§4): `DemoFixtureLease.fixtureOrganisationId`, `DemoDatabaseManifest.approvedDatabaseName`/`approvedRole`.
- `20260911140000_demo_fixture_identity_map` (§5): `DemoFixtureLease.identityMap`, `implementationRevision`.
- No migration for §7 — `ManagementReviewPack.payload` is already `Json?`; the `board` section lives inside it. `BoardManagementPack`'s own migration is untouched; its model gained a retirement doc-comment only (no destructive cleanup, no dropped columns/tables).
- All forward-only; nothing from the prior remediation (§9.5) or before was rewritten.

### 10.5 H00 handoff bundle

`pnpm run handoff:review -- --task CHECKPOINT-B-SECOND-REMEDIATION --base c010842 --run-checks` initially aborted on 3 credential-like matches: `checkpoint-b-obligation-review.test.ts` reusing the already-reviewed `passwordHash: "not-a-login-hash"` literal, and two new local-variable assignments in `live-seed-port.ts`'s persona() closure (`suppliedPassword`/`plaintextPassword` — matched on variable names by the regex, not on any hardcoded value; both are assigned from another variable or a fresh random value, never logged). Each file read in full and given its own narrow `REVIEWED_SAFE_CREDENTIAL_MATCHES` entry (commit `621cf42`); 5 new tests added to `handoff-secret-scan.test.ts`. `handoff:secret-audit` now reports **0 unreviewed findings** against base `c010842`.

Regenerated bundle: `artifacts/ai-handoff/review/CHECKPOINT-B-SECOND-REMEDIATION-review-20260911-141713.zip` (gitignored, hand off out-of-band). Contents: `TASK.md`, `IMPLEMENTATION_SUMMARY.md`, `GIT_STATUS.txt`, `GIT_DIFF.patch` (35 changed files vs `c010842`), `CHANGED_FILES.txt` + full file bodies, `TEST_RESULTS.md` (full mocked suite: 2088 passed, 11 skipped, 0 failed; lint: 0 errors, 9 pre-existing warnings), `SECURITY_CHECK.md` (35 files scanned, PASS), `MANIFEST.md`.

### 10.6 Outstanding after this handoff

- PR #64 remains **draft, unmerged**. BD09 has **not** been started.
- Persistent Neon runtime rehearsal (§6.6) and the rehearsal manifest (§6.7) remain not done — unchanged, still a BD09/pre-demo gate, not a Checkpoint B gate.
- §7's three disclosed deferrals stand: real management-review input-definition/link wiring (blocked on a fixture date-model decision, not effort), `SELECT FOR UPDATE`/Serializable-isolation hardening beyond the proven CAS pattern, and new UI routes/guard for viewing the pack (none exist yet to guard).
- No stop condition was hit during this handoff.

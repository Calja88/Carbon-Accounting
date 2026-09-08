# Checkpoint A review — foundations (BD01 + BD04 + BD02 + BD03)

Prepared for Astra review before PR #63 merges. Review preparation only — no product code changed in this pass.

## 1. Checkpoint scope

BD01 (EMS/tenancy integration) → BD04 (visual shell/navigation) → BD02 (demo isolation + security) → BD03 (honest metrics + calculation/report reliability).

## 2. Base / head

- **Base branch:** `claude/paragon-id-uk-carbon-mvp-1h1uvb`
- **Base SHA (H00):** `c9487554b058087736e031b06a672f2f61fcfbcb`
- **Cumulative branch:** `board/foundations-2026-09-22`
- **Current HEAD:** `d056b67` (before this review-doc commit)
- **PR:** [#63](https://github.com/Calja88/Carbon-Accounting/pull/63) (draft, not merged)

## 3. Package commits

Board-sprint package commits, in order, on `board/foundations-2026-09-22`:

| SHA | Package | Summary |
|---|---|---|
| `7dba8a6` | BD01 | Merge cumulative EMS/tenancy lineage (`claude/ems-lifecycle-coverage-completion-uyk1ph` @ `18cbf08b`) into H00 baseline |
| `a343203` | BD01 | Add `Docs/board-sprint/BASELINE_MAP.md` and `CONTINUITY.md` |
| `292355b` | BD01 | Close-out: record pnpm as authoritative package manager (see §5) |
| `559cc48` | BD04 | Premium visual language, connected shell and coherent navigation |
| `9835e2d` | BD02 | Isolate the demo and protect live decision paths (guard/schemas, four-eyes/CAS fixes) |
| `0cd84e8` | BD02 | Provision disposable Neon environment; record network blocker |
| `37f043f` | BD03 | Honest metrics and reliable calculation/report preparation |
| `d056b67` | BD03 | Continuity update |

`7dba8a6` is a merge commit bringing in the full EMS/tenancy lineage (T10–T84, UI01–UI14, the paragon-iso-ems T00–T18 and SharePoint sp00–sp08 ancestors) — that content is Astra-identified prior work being recovered onto this baseline, not new board-sprint authorship; its integration decisions are recorded in `BASELINE_MAP.md`.

## 4. Material behaviour changes

- **Navigation/shell:** `/` now redirects to `/carbon` (the existing emissions dashboard, moved); the old top-nav dropdown (`nav-links.tsx`) replaced by `ConnectedShell`'s sidebar, built from a server-filtered `BOARD_NAV`.
- **Security:** `verifyCorrectiveAction` and `performEffectivenessReview` no longer accept a caller-supplied `fourEyesEnabled` override (was always defaulted `true` by every live caller; the override itself is now removed). Four write paths (`completeCorrectiveAction`, `verifyCorrectiveAction`, `requestEffectivenessReview`, `performEffectivenessReview`) now re-check status (and, where relevant, four-eyes) via a conditional `updateMany`/CAS inside their transaction rather than only before it.
- **Calculation engine:** `runCalculationsForEntry` (Scope 1/2/3 write path) is now transactional and idempotent — see §9.
- **Synthetic banner:** wired to a real (currently always-false, since no verified environment is reachable) `isVerifiedDemoEnvironment` check rather than a hardcoded value.
- No accounting methodology, emission factor, or RBAC permission model changed.

## 5. Package-manager decision

**pnpm@10.28.0 is authoritative for the entire board sprint.** `pnpm-workspace.yaml`'s `allowBuilds` block (`@prisma/client`, `@prisma/engines`, `esbuild`, `prisma`, `unrs-resolver`) is preserved unchanged. This intentionally supersedes the original Astra Build Pack/dossier's "existing npm lockfile" wording — that guidance predates the live discovery below.

Reason: the integrated EMS lineage's own commit `070a9a8` ("Repair T02 deployment guardrails and T1B migration recovery") deliberately pinned pnpm specifically to get `allowBuilds`' script-execution allow-listing — a real, tested supply-chain control with no npm equivalent (npm has no per-package install-script allow-list mechanism). Reverting to npm would remove a tested control, not restore one. This is asserted by a live test: `src/lib/__tests__/deployment-guardrails.test.ts`. `package-lock.json` was removed; `pnpm-lock.yaml` is the single lockfile.

## 6. BD01 — integration result

Merged `claude/ems-lifecycle-coverage-completion-uyk1ph` @ `18cbf08b` into the H00 baseline. Verified (via `git merge-base --is-ancestor`, not inferred from branch names) to already be the single cumulative EMS/tenancy line — contains T10–T84, `paragon-iso-ems-t00`–`t18`, `sp00`–`sp08`, and the later UI/nav polish commits. Only 3 merge conflicts, all build tooling (`package.json`, `.gitignore`, `package-lock.json`); zero domain-code conflicts. Carbon/LCA/AI/H00 code untouched (disjoint file sets). Full source map in `Docs/board-sprint/BASELINE_MAP.md`.

## 7. BD04 — UI/shell result

Installed Astra's supplied shell/CSS/nav components verbatim (`src/styles/board.css`, `src/components/board/*`, `src/lib/board/{contracts,metrics,navigation}.ts`). Live wiring: `src/lib/board/live-nav.ts` filters `BOARD_NAV` by real permission grants and redirects two not-yet-built candidate routes (`evidence`, `packs`) to their real current equivalents. `(app)/layout.tsx` wraps content in `ConnectedShell`; existing auth/organisation-context logic preserved verbatim. Carbon dashboard moved from `/` to `/carbon`; `/` is a genuine redirect, not fabricated Overview data (Overview is BD05's).

## 8. BD02 — security result

- **Four-eyes fixes:** removed the caller-overridable `fourEyesEnabled?: boolean` parameter from `verifyCorrectiveAction` and `performEffectivenessReview` (`src/lib/ems/nonconformity/{corrective-action,effectiveness}-service.ts`) — four-eyes is now always enforced, server-side, non-overridable. No live caller ever supplied the field before removal (verified by inspection of every call site).
- **CAS/optimistic-concurrency fixes:** `completeCorrectiveAction`, `verifyCorrectiveAction`, `requestEffectivenessReview`, `performEffectivenessReview` previously read+checked status before opening their transaction, then wrote unconditionally by primary key inside it — a race window where two concurrent requests could both pass the check. Each now re-proves its status guard (and, where relevant, the four-eyes exclusion) via a conditional `updateMany`/no-op-lock-update inside the transaction; a stale caller gets a conflict and a full rollback (no audit event, no state change), never a silent duplicate.
- **Tenant/security evidence:** inspected and confirmed already proven, not rebuilt — `tenant-scope.ts`'s `assertOwned`/`assertSiteOwnership`/`assertChildOwnership` (with nested-parent-substitution guards), `resolveOrganisationContext`'s fresh-per-request read (a suspended/removed membership takes effect on the very next request, no re-login needed), the CI-enforced `resource-endpoint-registry` test, the mandatory T80 cross-tenant adversarial suite, and all 3 evidence-download routes (`ems/evidence/[id]`, `ems/documents/[id]/revisions/[revisionId]`, `lca/evidence/[id]`) returning an identical 404 for missing/foreign/restricted/malware/missing-bytes cases with no metadata leak.
- **Safe build separation:** already satisfied by the BD01 merge (the EMS branch's own T02 fix) — `"build": "next build"` (no migration), `db:migrate:deploy` explicit and separate. `PATCHES/BD02-build-separation.PROPOSAL.patch` confirmed via `git apply --check` to no longer apply, for that reason — not applied (would conflict with, not add to, the existing fix).
- **Synthetic guard implementation:** `scripts/board-demo/guard.ts` (`assertDemoTarget`) and `src/lib/board/schemas.ts` copied verbatim. `src/lib/board/live-environment.ts` (`isVerifiedDemoEnvironment`) is the live adapter — reads only the `BOARD_DEMO_*` env manifest, fails closed without a database identity to check against. Wired into `(app)/layout.tsx`; currently evaluates `false` (see §11).

## 9. BD03 — accounting result

- **Honest comparison/metric contracts:** Astra's `carbon-adapter.ts`, `calculation-orchestration.ts`, `attention.ts`, `overview-service.ts` installed verbatim; their own supplied tests (59 cases) all pass, including the BOARD-1 −20% comparison and the missing-current-data counterexample.
- **Scope 2 LB/MB treatment:** verified already correct in the live engine, not rebuilt — `analytics-service.ts`'s `totalsFor`: `total = scope1 + scope2Location + scope3`; market-based kept as a separate `scope2Market` field, never added into the headline. `buildCarbonSection`'s own test explicitly asserts a market companion added into the headline throws.
- **Calculation write atomicity:** genuine gap found and fixed — `runCalculationsForEntry`'s dual Scope 2 basis-row writes were two independent `prisma.calculation.create` calls raced via `Promise.all`, outside any transaction (a mid-write failure could leave exactly one of the two committed). Now sequential inside one `prisma.$transaction`.
- **Idempotency behaviour:** genuine gap found and fixed — no guard existed against calling `runCalculationsForEntry` twice for the same entry (retry, double submit, two concurrent `recalculatePendingEntries` passes); duplicate `Calculation` rows would have been silently double-counted by every downstream total (no unique constraint exists on `(activityEntryId, basis)`; the schema's `supersededById` field is unused everywhere). Fixed: checks for existing rows inside the transaction, returns them unchanged instead of creating duplicates. Verified safe for all 3 live callers — none intends to replace an entry's existing calculations.
- **ReportSnapshot immutability:** confirmed — no `update`/`upsert` call on `reportSnapshot` exists anywhere in the codebase; `buildReportPayload` is pure read/compute with no write side effect.
- **Supplied Astra board tests:** all pass (§10).

## 10. Exact test evidence

| Suite | Result |
|---|---|
| `tsc --noEmit` (final, cumulative) | PASS — 0 errors |
| `pnpm run lint` (final, cumulative) | PASS — 0 errors, 4 pre-existing warnings (unrelated files) |
| `pnpm test` (final, cumulative, full mocked-Prisma suite) | PASS — 122 files, **1887 passed**, 11 skipped, 0 failed |
| Focused board suite (`vitest run src/lib/board/__tests__ scripts/board-demo`) | PASS — 4 files, **59 passed** |
| New BD02 regression tests (four-eyes/CAS, in the 1887 total) | PASS — double-submit on `completeCorrectiveAction`, double-verify, stale double-review, owner-bypass-impossible |
| New BD03 regression tests (in the 1887 total) | PASS — `src/lib/__tests__/entries-service-idempotency.test.ts`: first call creates one row, second call is a no-op returning the same result, simulated-concurrent duplicate calls still leave exactly one row |
| `git diff --check` | PASS, every package |

All of the above are mocked-Prisma / pure-function tests. **None constitute a real-database transaction, concurrency, or migration test** — see §11.

## 11. Blocked runtime evidence

- A disposable Neon project was created and verified empty: **project `cool-cake-20837205`, name `board-demo-sprint-2026-09-22`, org `org-flat-field-50332528`, branch `main`, database `board_demo`**. `get_database_tables` confirmed 0 tables immediately after creation. (Connection details intentionally not recorded in this document or committed anywhere — see §"Security" note below.)
- The current cloud sandbox this session runs in has **no normal PostgreSQL TCP egress** — confirmed by direct probe: raw TCP to Neon's Postgres port (5432) times out on both pooled and direct endpoints, and even a plain HTTPS request to `console.neon.tech` is rejected by the sandbox's own egress policy. Only a small allowlist of hosts (npm registry, GitHub, Anthropic's API, and the Neon/GitHub MCP tool servers, proxied on the harness side) are reachable from inside this shell.
- **Therefore, real Postgres-backed verification remains NOT RUN:** `prisma migrate deploy` against the disposable database; a migration-free `next build` proving no schema mutation; concurrent/duplicate-submit transaction tests against real Postgres; any browser/runtime session.
- **The mocked-Prisma Vitest suite (§10) is not equivalent to a real-database transaction test** and is not represented as such anywhere in this document or the package completion reports. It proves the application code's logic is correct against the mock's semantics; it cannot prove Postgres's actual lock/isolation/constraint behaviour under real concurrency.
- The disposable project is ready for immediate use by any session with normal network access — no further provisioning needed.

## 12. Known open risks

**A.** `runCalculationsForEntry`'s idempotency currently relies on checking for existing calculations before writing (inside a transaction), not a database-level uniqueness or run-identity constraint. Astra should assess whether this is sufficient under real concurrent requests, or whether a schema-level guarantee (e.g., a unique constraint or an explicit run/idempotency-key model, as `calculation-orchestration.ts`'s contract anticipates) is required before merge.

**B.** Dual Scope 2 writes are now inside one Prisma transaction, but real Postgres rollback/concurrency behaviour for this has not been executed (blocked per §11).

**C.** Report generation (`reports/actions.ts`) still has a hidden Category 3 derivation/write side effect before snapshot issue — generating a report also permanently mutates the organisation's live Scope 3 total, not just that report's snapshot. Not a correctness bug (the derived rows are accurate; skipping them would understate Scope 3, and a DB unique constraint prevents duplicate derived rows even under a race). Deliberately not restructured during BD03 — would need new UI/schema state, out of minimal-adaptation scope.

**D.** Analytics does not yet have the full expected-submission/obligation model required to distinguish "missing" from "reviewed zero" at the live Overview level — `analytics-service.ts` has no concept of expected obligations today, only what `Calculation` rows exist. The Astra-authored Overview/metric adapters (`carbon-adapter.ts`, `overview-service.ts`) already correctly model this distinction in their contract (`Coverage.expected: number | null`); BD05 is expected to complete the live board-facing integration that feeds them real coverage data.

**E.** The broader EMS codebase contains the same caller-overridable `fourEyesEnabled?: boolean` pattern in 9 other services (objectives, legal obligations, documents, metrics, foundation context) outside the BD02-demonstrated corrective-action/effectiveness chain — deliberately not expanded during the board sprint package, to avoid scope creep into general production hardening.

**F.** Integrated runtime/browser verification has not occurred because the sandbox cannot reach the disposable Neon database (§11).

## 13. Questions for Astra

1. Is PR #63 safe to merge into the approved baseline before BD05?
2. Does the current calculation idempotency approach (existing-row check inside a transaction, §9 / risk A) require a DB-level uniqueness/run model before merge, or is it acceptable as implemented?
3. Must the Category 3 report-generation side effect (risk C) be fixed before merge, or may it be deferred to a later board package / post-demo task?
4. Are the unexecuted real-Postgres checks (§11, risks B/F) a merge blocker, or can they be a mandatory pre-BD08/demo-runtime gate instead?
5. Does Astra identify any tenant/RBAC/accounting regression anywhere in the cumulative diff (H00 baseline → current HEAD)?
6. Is the pnpm-over-npm package-manager override (§5) accepted as the correct live-repository adaptation?

## Security note

This document and its commit contain no connection strings, passwords, API keys, `.env.local` contents, or real environmental/customer data. The disposable Neon project id/name/org id above are non-secret identifiers, safe to reference.

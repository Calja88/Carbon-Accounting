# Board demo sprint — continuity record

Keep this to ~1-2 pages. Update at the end of every package.

## Current state

- **Package completed:** BD03 (honest metrics / calculation & report reliability). BD01, BD04, BD02 also complete. **Checkpoint A is next** (BD01+BD04+BD02+BD03 cumulative Astra review) — do not merge PR #63 before it.
- **Branch:** `board/foundations-2026-09-22` (created from `origin/claude/paragon-id-uk-carbon-mvp-1h1uvb` @ `c9487554b058087736e031b06a672f2f61fcfbcb`)
- **Head:** see PR #63 for current head; BD01 merge commit `7dba8a6`, docs `a343203`, package-manager decision `292355b`, BD04 `559cc48`, BD02 `9835e2d` + `0cd84e8`, BD03 `37f043f`.
- **PR:** [#63](https://github.com/Calja88/Carbon-Accounting/pull/63) (draft), branch `board/foundations-2026-09-22` against `claude/paragon-id-uk-carbon-mvp-1h1uvb`.
- Build pack extracted (outside the repo) at `/home/user/carbon-overhaul/build-pack`; dossier at `/home/user/carbon-overhaul/Carbon_Ledger_Product_Transformation_Implementation_Dossier.docx`. Both are on ephemeral container storage — not guaranteed to survive to a future session; re-upload if a future session can't find them.

## Integration decisions (BD01)

1. Integration source for the whole EMS/tenancy build-out is a single branch: `origin/claude/ems-lifecycle-coverage-completion-uyk1ph` @ `18cbf08b`. Verified (not assumed) to already be cumulative: it contains T10–T84, `paragon-iso-ems-t00`–`t18`, `sp00`–`sp08`, and the two later UI/nav commits (`fd6a8ca`, `958157e`) Astra flagged, all as real ancestors (`git merge-base --is-ancestor` checked, not inferred from branch names). The ~90 other `claude/t*`, `claude/ui*`, `claude/sp*` branches on origin are earlier, superseded per-task branches for the same work (different SHAs, same logical content) — not a separate integration source.
2. Merge conflicts: 3 files, all build tooling — `package.json`, `.gitignore`, `package-lock.json`. Zero domain-code conflicts. `pnpm` adopted as the sole package-manager authority (matches the EMS branch's `.github/workflows/ci.yml`, which the baseline lacked); `package-lock.json` deleted, `pnpm-lock.yaml` regenerated lockfile-only.
3. Carbon/LCA/AI/H00 code is entirely untouched by this merge (disjoint file sets from the EMS branch's changes).
4. Sign-out / no-active-membership flow (BD01 step 5) was already correct — `AppLayout` catches `OrganisationAccessError` and renders gracefully. No repair needed.
5. Full domain service map recorded in `Docs/board-sprint/BASELINE_MAP.md` — do not re-derive it.

## Package-manager authority (decided, do not revisit without explicit review)

**pnpm@10.28.0 is the authoritative package manager for the entire Board Demo Sprint.** `package-lock.json` is intentionally not authoritative and stays deleted.

This supersedes the Board Demo Build Pack's BD01/`BASELINE_AND_MERGE.md` instruction to reconcile on "one npm/package-lock authority" — that guidance predates the live discovery below and is overridden by it for the sprint.

Reason: `pnpm-workspace.yaml`'s `allowBuilds:` block is a deliberate, tested supply-chain/deployment guardrail introduced by the integrated EMS lineage at commit `070a9a8` ("Repair T02 deployment guardrails and T1B migration recovery") — it allow-lists exactly which dependencies (`@prisma/client`, `@prisma/engines`, `esbuild`, `prisma`, `unrs-resolver`) may run install/postinstall lifecycle scripts; every other package's scripts are blocked by default. npm has no equivalent per-package script allow-list mechanism — reverting to npm would either silently drop this tested control or require building an unproven npm-native replacement, neither of which is a safe "small correction." The control is also directly asserted by `src/lib/__tests__/deployment-guardrails.test.ts` (`packageManager` and `pnpm-workspace.yaml` contents).

Do not switch package-manager authority again during this sprint without explicit review.

## H00 handoff scripts (confirmed present, unaffected by package-manager choice)

`package.json` still exposes both, unchanged by the pnpm decision:
```
"handoff:full": "node scripts/handoff/full-handoff.mjs",
"handoff:review": "node scripts/handoff/review-handoff.mjs"
```
Confirmed runnable in the current pnpm-installed environment: `node scripts/handoff/review-handoff.mjs --help` (no `--task`) correctly prints `Usage: npm run handoff:review -- --task T00` and exits without side effects — the scripts are plain Node and never depended on npm as the invoking package manager.

## Commands used (safe, no DB/migration)

```
pnpm install --lockfile-only --ignore-scripts   # regenerate pnpm-lock.yaml after merge
pnpm install                                    # full install for typecheck/lint/test (postinstall = `prisma generate` only, no DB)
./node_modules/.bin/tsc --noEmit                # PASS
pnpm run lint                                   # PASS (0 errors, 4 pre-existing warnings)
pnpm test                                       # PASS — 118 files, 1826 tests passed, 11 skipped, 0 failed
```
No `prisma migrate`, no seed, no build (`next build`) run — not yet safe/scoped per BD02.

## BD04 — premium shell, navigation (complete)

Copied verbatim from the Build Pack (`FILES/src/styles/board.css`, `src/components/board/{primitives,data-table,app-shell,connected-shell,scope-bar}.tsx`, `src/lib/board/{contracts,metrics,navigation}.ts`) and applied `PATCHES/BD04-css-import.patch` to `src/app/layout.tsx`. No Astra file was rewritten.

Live wiring (new, not Astra-supplied — this is Claude's integration responsibility per `INTEGRATION/LIVE_BINDINGS.md` §1):
- **`src/lib/board/live-nav.ts`** — server-side `resolveBoardNav(context)`. Filters `BOARD_NAV` by real permission grants (`carbon.view`/`lca.view`/`ems.view`/the existing platform-admin gate), matching the granularity the old `nav-links.tsx` used. Drops `overview`/`attention` entirely (BD05-owned, routes don't exist — no disabled placeholder). Overrides two candidate hrefs that don't exist yet to the real route already in that item's own `matches` list: `evidence` → `/ems/evidence` (not `/evidence`, BD06-owned), `packs` → `/ems/management-reviews` (not `/management-packs`, BD08-owned).
- **`src/app/(app)/layout.tsx`** rewritten to wrap children in `ConnectedShell`, unchanged auth/organisation-context/AI-availability logic preserved verbatim. `account` slot reuses the existing avatar/role/`SignOutButton`. `scopeBar` renders `ScopeBar` in `periodMode="operational"` (org name only, no date/site form) — layouts can't reliably read a page's searchParams (`LIVE_BINDINGS.md` §1's documented gap), so the real carbon-period picker stays exactly where it already lived, on `/carbon` itself, rather than fabricating a stale shell-level date. `synthetic` left `false` — BD02 hasn't built the guarded/verified synthetic-environment check yet, so the demo banner isn't shown rather than shown falsely. One new read-only query (`prisma.organisation.findUnique` for `name`) — `OrganisationContext` only carries the slug.
- **Home route**: `src/app/(app)/page.tsx` (the working emissions dashboard) moved to `src/app/(app)/carbon/page.tsx` (its own `PeriodSelector` action and relative import updated); `/` is now a genuine `redirect("/carbon")` — no fabricated Overview data at `/`, per the explicit instruction. BD05 owns building the real Overview there.
- **Removed** `src/app/(app)/nav-links.tsx` and its test — fully superseded by `ConnectedShell`'s sidebar, not unrelated work.
- Added `src/lib/board/__tests__/live-nav.test.ts` (7 cases: permission filtering per item, overview/attention exclusion, href overrides, no-context → empty nav).

Genuine compatibility fix: dropped `import "server-only"` from `live-nav.ts` — that package isn't a dependency of this repo (not in `package.json`/lockfile/`node_modules`), so it broke Vitest module resolution. Documented in-file why it's safe without the guard (pure permission-Set check, no Prisma/auth import, only ever called from a server component).

Deferred / not done in BD04 (by design, not oversight):
- No organisation-switcher UI — none existed before BD04 either; `ScopeBar`'s optional `organisationSwitcher` slot is left unset (shows the org name only).
- `/documents` (carbon's own evidence store), `/methodologies`, `/help/lca` have no direct sidebar entry — reachable only contextually (as before this package, they weren't in the old top nav's EMS-routes-only reshuffle either); BOARD_NAV is a curated top-level set by design.
- No live/browser/visual verification (1366×768, 1440×900, 375px, 200% zoom) — no guarded runtime exists yet (BD02 dependency); running `next dev` needs a real database connection this session doesn't have and BD02 hasn't yet separated. **NOT RUN — deferred until BD02 establishes the guarded build/runtime path.**

## BD02 — isolate the demo, protect live decision paths (complete, with one environment-dependent blocker)

**Build safety — already satisfied, no patch applied.** `PATCHES/BD02-build-separation.PROPOSAL.patch` no longer applies (`git apply --check` fails cleanly against `package.json:4`) because the BD01 merge already carries this exact fix from the EMS branch's own T02 commit: `"build": "next build"` (no migration), with `db:migrate:deploy` as the explicit, separate release command (`node scripts/resolve-failed-migration.mjs && prisma migrate deploy`), and `prisma.config.ts` already supports `DIRECT_URL`/`DATABASE_URL_UNPOOLED`/`DIRECT_DATABASE_URL`. Verified by inspection, not re-patched — applying the proposal on top would conflict with, not add to, this.

**Demo environment — BLOCKED, environment-dependent.** No `DATABASE_URL` (or any Neon credential) is configured in this session. The Neon MCP tools are available but `list_projects`/`create_project` require an `org_id` this session has no way to discover or safely infer — guessing one risks operating in the wrong (possibly production) Neon organisation, which BD02's own rules forbid ("never infer identity," "do not touch production data"). No disposable synthetic database was provisioned. Everything database-dependent (migration-free build run, browser sessions, live tenant/approval proof against real rows) is therefore **NOT RUN — deferred until a disposable Neon project/org_id is supplied**, per the package's own instruction to report this honestly rather than weaken the guard.

**Guard/schema wiring (code-complete):** copied `scripts/board-demo/guard.ts` (`assertDemoTarget`) and `src/lib/board/schemas.ts` (`boardPeriodSchema`, `boardTransitionSchema` — the latter explicitly accepts no actor/tenant/permission/fourEyes field from the browser) verbatim. Added `src/lib/board/live-environment.ts` (`isVerifiedDemoEnvironment`), the live adapter around `assertDemoTarget`: reads only the `BOARD_DEMO_*` env manifest (never a URL/branch-name guess) and fails closed without a database identity to check it against. Wired into `(app)/layout.tsx` as `synthetic={isVerifiedDemoEnvironment(null)}` — correctly evaluates `false` today (no DB identity available); will correctly turn on once BD08 or a future BD02 pass provisions a real disposable database and supplies its identity here. 6 new tests in `src/lib/board/__tests__/live-environment.test.ts`.

**Tenant/site/evidence boundaries — inspected, already proven, not rebuilt.** `src/lib/repositories/tenant-scope.ts` already has `assertOwned`/`assertSiteOwnership`/`assertChildOwnership` with nested-parent-substitution guards; `src/lib/organisation/context.ts`'s `resolveOrganisationContext` already reads fresh every request (a suspended/removed membership takes effect on the very next request, no re-login needed); the CI-enforced `src/lib/security/resource-endpoint-registry.ts` + its test already fail the build if a new tenant-scoped resource accessor ships without an isolation test; the T80 cross-tenant adversarial suite (`src/lib/__tests__/tenant-adversarial/**`) is already a mandatory CI gate (see `.github/workflows/ci.yml`). All three evidence-download routes inspected (`ems/evidence/[id]`, `ems/documents/[id]/revisions/[revisionId]`, `lca/evidence/[id]`) already return an identical 404 for missing/foreign-tenant/classification-denied/malware-flagged/byte-missing cases via `readEvidenceObjectBytes`/`readEvidenceBytes`, with no metadata leak and no fabricated bytes for missing source. No changes were needed or made to any of this — it already meets BD02's acceptance bar.

**Approval / four-eyes — genuine gaps found and fixed** in the demonstrated corrective-action/effectiveness chain (`src/lib/ems/nonconformity/{corrective-action,effectiveness}-service.ts`):
1. **Removed the caller-overridable `fourEyesEnabled?: boolean` parameter** from `verifyCorrectiveAction` and `performEffectivenessReview` — four-eyes is now always enforced, server-side, non-overridable. No live caller ever supplied this field (confirmed by inspection of every call site before removing it), so this changes no real behaviour, only closes the unused override. The identical pattern exists in 9 other EMS services (objectives, legal obligations, documents, metrics, foundation context) outside this package's demonstrated chain — deliberately left alone, flagged here rather than silently expanding BD02's scope.
2. **Pre-transaction-only checks → CAS inside the transaction.** `completeCorrectiveAction`, `verifyCorrectiveAction`, `requestEffectivenessReview`, `performEffectivenessReview` all previously read+checked state before opening the transaction, then wrote unconditionally by primary key inside it — a race window where two concurrent requests (a duplicate submit, or a second reviewer) could both pass the check. Each now re-proves its status guard (and, for `verifyCorrectiveAction`/`performEffectivenessReview`, the four-eyes self-review exclusion) via a conditional `updateMany`/no-op-update-as-lock at write time inside the transaction; a stale caller gets a conflict error and the transaction rolls back with no audit event or state change, never a silent duplicate. 3 new regression tests (double-submit on `completeCorrectiveAction`, double-verify, stale double-review) plus 1 rewritten test (owner can no longer bypass four-eyes at all, not just by default).

**Not touched:** `closeNonconformity`, `reopenCorrectiveAction`, and the same `fourEyesEnabled` pattern in other EMS domains carry the identical pre-transaction-check gap — out of BD02's demonstrated-chain scope, flagged for awareness, not fixed here to avoid scope creep into "general production hardening."

## Blockers / risks

- **Disposable Neon database not provisioned** — `org_id` unknown/undiscoverable this session; genuinely environment-dependent, not a code gap. Needed before: migration-free build verification, any browser/runtime check, live tenant-boundary proof against real rows, and turning the synthetic banner on.
- `src/app/(app)/carbon/page.tsx` still queries Prisma directly, unscoped by organisation/site — flagged since BD01/BD04, now BD03's to fix (its own metrics/adapter package).
- Same pre-transaction-check-only pattern and `fourEyesEnabled` override exist in `closeNonconformity`, `reopenCorrectiveAction`, and 9 other EMS services outside the demonstrated chain — not fixed in BD02, noted for future hardening.

## BD02 follow-up — disposable Neon environment provisioned; verification blocked by sandbox network capability, not by cost or code

**Neon org `org-flat-field-50332528` inspected (read-only) before any creation.** Two existing projects: `twilight-breeze-25854149` has a branch literally named `production`, actively used minutes before this inspection — confirmed live, never touched or queried. `falling-hall-18424294` ("t30-migration-scratch") has a stale partial schema (8 tables, missing 30+ current EMS tables) and unverified-origin `Organisation`/`Site` rows — not current-schema-compatible and not provably empty, so not reused. Owner `calja88@gmail.com` is on `subscription_type: "free_v3"` (free plan, no overage billing) on both existing projects, so a new small project is covered by the existing free allowance — no known additional paid cost.

**Provisioned a brand-new, verified-empty project:** id `cool-cake-20837205`, name `board-demo-sprint-2026-09-22`, org `org-flat-field-50332528`, branch `main`, database `board_demo`, region `aws-us-west-2`, pg18, autoscaling capped at the cheapest tier (0.25 CU). `get_database_tables` confirmed 0 tables immediately after creation. This is the positively-identified disposable environment for the rest of the sprint — record its project id (`cool-cake-20837205`) and env-manifest values below in any future session; do not create another one without reason.

Env manifest for `isVerifiedDemoEnvironment` (`src/lib/board/live-environment.ts`), written to local `.env.local` (gitignored, not committed — a future session needs to recreate it or pull the real connection string from Neon):
```
BOARD_DEMO_DATA_MODE=synthetic
BOARD_DEMO_DEPLOYMENT_CLASS=private-demo
BOARD_DEMO_DATABASE_ID=cool-cake-20837205
BOARD_DEMO_ALLOWED_DATABASE_ID=cool-cake-20837205
BOARD_DEMO_ENVIRONMENT_ID=board-demo-sprint-2026-09-22
```

**Blocked: this sandbox cannot reach the database at all, over any protocol.** Confirmed by direct probe: raw TCP to Neon's Postgres port (5432) times out on both the pooled and direct endpoints, and even a plain HTTPS request to `console.neon.tech` is rejected by the sandbox's egress proxy ("organization policy," 403) — only the small allowlist of hosts the harness proxies (npm registry, GitHub, Anthropic's own API, and the Neon/GitHub *MCP tool servers*, which run outside this sandbox and proxy on the harness side) are reachable. Prisma's classic engine (`prisma.config.ts` sets `engine: "classic"`) makes a native TCP connection for every operation that touches a live database — `migrate deploy`, `db pull`, `migrate status`, and the Next.js app's own runtime Prisma client alike. None of them can run from this shell, regardless of which database is targeted. This is a capability of *this execution environment*, not a code, schema, or cost problem — a session with normal outbound network access (a developer's machine, CI, or a future Claude Code session with different network policy) can use this same project immediately with no further setup.

Considered and rejected as workarounds: (1) hand-applying the 43 migration files (8,184 lines of SQL) via the Neon MCP `run_sql` tool, bypassing Prisma's CLI — rejected because it would still leave the actual app runtime unable to reach the database (same TCP block), so it couldn't unblock the build/browser checks anyway, while adding real risk of getting Prisma's `_prisma_migrations` bookkeeping subtly wrong for whoever connects next; (2) switching the app to Neon's HTTP/serverless driver — rejected as an architecture change outside BD02's scope, not a "smallest safe adaptation."

**Consequently still NOT RUN, for a network-capability reason rather than a database-identity reason:**
- migration-free build run / proof the build doesn't mutate schema — needs a reachable database to run `prisma migrate deploy` then `next build` against it and confirm no writes
- DB-backed tenant/site/approval tests (the ones needing real Prisma, not the mocked-Prisma Vitest suite — that suite already passed, see the original BD02 commit)
- synthetic banner / runtime verification, browser checks — needs a running app with database access

## BD03 — honest metrics, reliable calculation/report preparation (complete)

**Astra files installed verbatim:** `src/lib/board/{carbon-adapter,calculation-orchestration,attention,overview-service}.ts` + their tests (`__tests__/{board,carbon-adapter}.test.ts`). `contracts.ts`/`metrics.ts`/`navigation.ts`/`schemas.ts` were already installed byte-identical by BD01/BD02, reused not overwritten. All 59 focused board tests pass — includes BOARD-1's -20% comparison, the missing-current-data counterexample, and `buildCarbonSection`'s own "rejects a market companion added into headline" guard.

**Two genuine live-engine gaps found and fixed** in `src/lib/entries-service.ts`'s `runCalculationsForEntry` (the actual Scope 1/2/3 calculation write path, found by inspection against `PRISMA_PROPOSALS/BD02-BD03-INVARIANTS.md`, not by assumption):
1. **Dual Scope 2 atomicity.** Location-based and market-based basis rows were written by two independent `prisma.calculation.create` calls raced via `Promise.all`, outside any transaction — a mid-write failure could leave exactly one committed. Now both writes for one call happen sequentially inside a single `prisma.$transaction` (sequential, not `Promise.all`, inside the tx — concurrent queries against one Prisma interactive transaction are not safe).
2. **Calculation idempotency.** No guard existed at all: calling the function twice for the same entry (retry, double submit, two concurrent `recalculatePendingEntries` passes) created duplicate `Calculation` rows that every downstream total (dashboard, reports) would silently double-count — there is no unique constraint on `(activityEntryId, basis)` and the schema's own `supersededById` field, seemingly meant for this, is unused everywhere. Fixed by checking for existing rows inside the transaction and returning them unchanged instead of creating duplicates. Verified safe for all three live callers (`createActivityEntryWithCalculations`, `recalculatePendingEntries`, `createCommutingSurvey`) — none ever intends to replace an entry's existing calculations; a contract change deliberately does not retroactively touch already-calculated periods (factor values are snapshotted for the audit trail).

New tests: `src/lib/__tests__/entries-service-idempotency.test.ts` (first call creates one row; second call is a no-op with the same result; simulated-concurrent duplicate calls still leave exactly one row).

**Verified already correct, not touched:** headline total already excludes market-based Scope 2 (`analytics-service.ts`'s `totalsFor`: `total = scope1 + scope2Location + scope3`, MB kept as a separate `scope2Market` field); issued `ReportSnapshot` rows are genuinely append-only (no `update`/`upsert` call exists anywhere in the codebase); `buildReportPayload` is pure read/compute, no write side effect; `resolveMonthRange` only falls back to today's period on genuinely missing/malformed input, never silently overriding a valid selection.

**Identified, deliberately not restructured:** `reports/actions.ts`'s `generateReportAction` calls `deriveCategory3Calculations` (a real write — new Scope 3 Cat 3 `Calculation` rows, DB-idempotent via the `derivedFromCalculationId` unique constraint) and then immediately builds and issues the `ReportSnapshot`, all in one action with no separate prepare/preview step. Not a correctness bug (the derived rows are accurate and necessary — skipping them would understate Scope 3, and the constraint prevents duplicates even under a race, just surfaces as an unhandled error rather than a graceful retry) but an undisclosed side effect: generating a report also permanently mutates the organisation's live Scope 3 total, not just this report's snapshot. Restructuring into an explicit two-step "prepare then issue" workflow would need new UI/schema state and is out of BD03's minimal-adaptation scope — flagged for a future package, not fixed here.

**Schema/migration impact:** none. The engine fix reuses the existing `Calculation` model unchanged — no new migration authored or needed.

**DB-backed tests:** BLOCKED — disposable Neon (`cool-cake-20837205`) exists (see BD02 above) but this sandbox still has no Postgres network egress. Concurrent/duplicate-run and dual-basis-atomicity proof against real Postgres, and browser drilldown checks, remain deferred to a session with network access — not weakened, not faked. The equivalent logic is proven by the new mocked-Prisma regression tests above instead.

## Checkpoint A handoff generation — three narrow H00 tooling exceptions

`pnpm run handoff:review` initially aborted (correct fail-closed behaviour) on `scripts/rls-spike/setup-test-db.sh`'s two hardcoded local-only synthetic default passwords (`rls_spike_owner_local_only`, `rls_spike_app_local_only`, pre-existing content from the BD01 EMS merge). Verified genuinely synthetic (targets `localhost:5432` only, script's own header says "never be pointed at a production connection string", full file re-read, no other credential-like content) and fixed with the narrowest possible exception: `scripts/handoff/lib/secret-scan.mjs` gained `REVIEWED_SAFE_CREDENTIAL_MATCHES`, an exact-file/exact-matched-text allowlist (not a whole-file or directory exclusion) — only those specific matched strings in their reviewed file are suppressed; any other or new credential-like value in the same file, or the same value in a different file, still fails the scan.

Regenerating afterward surfaced a second, unrelated false positive: `src/app/invite/[token]/actions.ts`'s invitation-token hash assignment, which stores the return value of the local SHA-256 `hashInvitationToken` helper (no embedded secret) in a variable whose name contains "token" — flagged for that reason alone. Verified benign by reading the whole file and the hashing helper; fixed with the same exact-match-allowlist mechanism, one more entry in `REVIEWED_SAFE_CREDENTIAL_MATCHES`.

Regenerating again surfaced the equivalent invitation-token hashing assignment in the sibling page component, `src/app/invite/[token]/page.tsx` — the identical reviewed pattern, in independent application code. Verified benign the same way; added as a third entry in `REVIEWED_SAFE_CREDENTIAL_MATCHES`, scoped to that exact file. A hardcoded literal value assigned to that same variable, or to a plain `token`/`password` variable, in any of the three reviewed files still fails the scan. 18 new tests total (all three exceptions) in `src/lib/__tests__/handoff-secret-scan.test.ts` prove the allow/still-fail/no-leak behaviour for each.

## Next package

**Checkpoint A** (BD01 + BD04 + BD02 + BD03 cumulative Astra review) — do not contact Astra or generate the H00 review bundle automatically; wait for explicit instruction. Do not merge PR #63 before Checkpoint A. Whoever next has real network access to Neon (a local machine, CI, or a differently-configured session) can run `pnpm run db:migrate:deploy` against `cool-cake-20837205` immediately — no further provisioning needed.

# Board demo sprint — continuity record

Keep this to ~1-2 pages. Update at the end of every package.

## Current state

- **Package completed:** BD04 (shell/navigation). BD01 also complete.
- **Branch:** `board/foundations-2026-09-22` (created from `origin/claude/paragon-id-uk-carbon-mvp-1h1uvb` @ `c9487554b058087736e031b06a672f2f61fcfbcb`)
- **Head:** see PR #63 for current head; BD01 merge commit is `7dba8a6` (EMS/tenancy lineage merged into H00 baseline), docs commit `a343203`, package-manager decision record commit `292355b`, BD04 commit below.
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

## Blockers / risks

- No live/browser check run (BD02 dependency, see above).
- `src/app/(app)/carbon/page.tsx` still queries Prisma directly, unscoped by organisation/site — flagged for BD02/BD03, not fixed here (out of BD04 scope).

## Next package

**BD02** — do not start automatically; wait for explicit instruction.

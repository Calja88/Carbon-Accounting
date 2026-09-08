# Board demo sprint — continuity record

Keep this to ~1-2 pages. Update at the end of every package.

## Current state

- **Package completed:** BD01 (foundations)
- **Branch:** `board/foundations-2026-09-22` (created from `origin/claude/paragon-id-uk-carbon-mvp-1h1uvb` @ `c9487554b058087736e031b06a672f2f61fcfbcb`)
- **Head:** `7dba8a6` — BD01 merge commit (EMS/tenancy lineage merged into H00 baseline)
- **PR:** none yet — push/PR access not exercised this session; see BLOCKED note below.
- Build pack extracted (outside the repo) at `/home/user/carbon-overhaul/build-pack`; dossier at `/home/user/carbon-overhaul/Carbon_Ledger_Product_Transformation_Implementation_Dossier.docx`. Both are on ephemeral container storage — not guaranteed to survive to a future session; re-upload if a future session can't find them.

## Integration decisions (BD01)

1. Integration source for the whole EMS/tenancy build-out is a single branch: `origin/claude/ems-lifecycle-coverage-completion-uyk1ph` @ `18cbf08b`. Verified (not assumed) to already be cumulative: it contains T10–T84, `paragon-iso-ems-t00`–`t18`, `sp00`–`sp08`, and the two later UI/nav commits (`fd6a8ca`, `958157e`) Astra flagged, all as real ancestors (`git merge-base --is-ancestor` checked, not inferred from branch names). The ~90 other `claude/t*`, `claude/ui*`, `claude/sp*` branches on origin are earlier, superseded per-task branches for the same work (different SHAs, same logical content) — not a separate integration source.
2. Merge conflicts: 3 files, all build tooling — `package.json`, `.gitignore`, `package-lock.json`. Zero domain-code conflicts. `pnpm` adopted as the sole package-manager authority (matches the EMS branch's `.github/workflows/ci.yml`, which the baseline lacked); `package-lock.json` deleted, `pnpm-lock.yaml` regenerated lockfile-only.
3. Carbon/LCA/AI/H00 code is entirely untouched by this merge (disjoint file sets from the EMS branch's changes).
4. Sign-out / no-active-membership flow (BD01 step 5) was already correct — `AppLayout` catches `OrganisationAccessError` and renders gracefully. No repair needed.
5. Full domain service map recorded in `Docs/board-sprint/BASELINE_MAP.md` — do not re-derive it.

## Commands used (safe, no DB/migration)

```
pnpm install --lockfile-only --ignore-scripts   # regenerate pnpm-lock.yaml after merge
pnpm install                                    # full install for typecheck/lint/test (postinstall = `prisma generate` only, no DB)
./node_modules/.bin/tsc --noEmit                # PASS
pnpm run lint                                   # PASS (0 errors, 4 pre-existing warnings)
pnpm test                                       # PASS — 118 files, 1826 tests passed, 11 skipped, 0 failed
```
No `prisma migrate`, no seed, no build (`next build`) run — not yet safe/scoped per BD02.

## Blockers / risks

- **Push/PR not attempted.** This session has GitHub MCP tools scoped to `calja88/carbon-accounting`; a `git push` to `origin` from this sandbox was not exercised in this pass — do this next (or confirm it needs to happen from a session with push credentials) before Checkpoint A. Nothing here blocks BD04 starting on top of this local branch.
- No live/browser check run (no guarded runtime exists yet — correct per BD01 scope; BD02 provisions it).
- `src/app/(app)/page.tsx` (current carbon homepage) still queries Prisma directly, unscoped by organisation/site — flagged for BD02/BD03, not fixed in BD01 (out of BD01 scope).

## Next package

**BD04** (shell/navigation) — do not start automatically; wait for explicit instruction.

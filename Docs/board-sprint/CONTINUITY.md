# Board demo sprint — continuity record

Keep this to ~1-2 pages. Update at the end of every package.

## Current state

- **Package completed:** BD01 (foundations)
- **Branch:** `board/foundations-2026-09-22` (created from `origin/claude/paragon-id-uk-carbon-mvp-1h1uvb` @ `c9487554b058087736e031b06a672f2f61fcfbcb`)
- **Head:** see PR #63 for current head; BD01 merge commit is `7dba8a6` (EMS/tenancy lineage merged into H00 baseline), docs commit `a343203`, package-manager decision record commit below.
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

## Blockers / risks

- No live/browser check run (no guarded runtime exists yet — correct per BD01 scope; BD02 provisions it).
- `src/app/(app)/page.tsx` (current carbon homepage) still queries Prisma directly, unscoped by organisation/site — flagged for BD02/BD03, not fixed in BD01 (out of BD01 scope).

## Next package

**BD04** (shell/navigation) — do not start automatically; wait for explicit instruction.

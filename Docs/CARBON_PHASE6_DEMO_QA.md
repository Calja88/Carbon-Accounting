# Phase 6 — end-to-end demo QA and remediation

Feature freeze. This phase audited the BOARD-1 demo end to end against the real
non-production demo database and fixed only what the audit found. No new
functionality, no migration, no production change.

Branch: `demo/phase6-qa-remediation`, based on the integrated shared HEAD
`667e3d1` (`board/product-2026-09-22`).

## Integration first

`board/product-2026-09-22` was at `83b64ec`, which was the merge base of
`demo/runtime-safety-and-collection-plan` (`667e3d1`), so the branch
fast-forwarded. No merge commit, no conflict, no history rewritten, and the
main worktree's untracked `AGENTS.md` / `CLAUDE.md` / `.claude/` were left
alone. Pushed normally: `83b64ec..667e3d1`.

The integrated branch carries Phase 4-ii, the LCA sprint, Phase 4-iii, the
Activity Data Register, Phase 5A, Phase 5B, the demo DB target hardening and
the collection-plan demo configuration.

## Environment

| | |
|---|---|
| Database | Neon `cool-cake-20837205`, database `board_demo`, role `board_demo_owner` |
| Environment id | `board-demo-local-2026-09-11` |
| Runtime | `next start` on `127.0.0.1:3210`, production build, spawned through `scripts/board-demo/with-demo-env.ts` |
| Personas | `sustainability-lead` (primary), `contributor`, `read-only`, `independent-reviewer`, `restricted`, `suspended` |
| Browser | real browser QA against that runtime |

This machine's shell still exports a **production** `DATABASE_URL` / `DIRECT_URL`
(project `twilight-breeze-25854149`, database `neondb`). Every database command
in this phase went through the hardened wrapper, which reported
`Ambient DATABASE_URL, DIRECT_URL ignored` and then named the verified target
before opening a connection. No raw Prisma command was run.

Sessions for browser QA were minted server-side from `AUTH_SECRET` rather than
by typing persona passwords into the login form.

## Journey results

| # | Journey | Result |
|---|---|---|
| 1 | Executive / dashboard | PASS |
| 2 | Data collection | PASS after fixes |
| 3 | Activity Data Register | PASS after fixes |
| 4 | Reporting period close / reopen | PASS after fixes |
| 5 | Management carbon report | PASS after fixes |
| 6 | XLSX export | PASS after fixes |
| 7 | Factor management | FAIL, now PASS after fixes |
| 8 | LCA | PASS after fixes |
| 9 | Admin / organisation / site | PASS WITH CAVEAT |
| 10 | Global UX | PASS WITH CAVEAT |
| 11 | Permissions | PASS |
| 12 | Error / safety paths | PASS |

Figures reconcile. Default demo window (Jan–Sept 2026): 1,248 tCO₂e =
216 + 432 + 600, market-based 216 shown as a companion and never added; the
site table, monthly table, source ranking and Scope 3 categories each sum to
the headline. Full window (Jan 2025 – Sept 2026): 2,808 / 486 / 972 / 486 /
1,350, matching the pre-agreed values. Collection plan: 66 required, 59
received, 7 missing, 89.4%, the seven being September 2026 and labelled as
still running rather than late.

## Issues found

### P1 — fixed

1. **Close/reopen confirmation dialog rendered in the top-left corner,
   clipped.** Tailwind preflight zeroes `margin` on every element, which
   overrides the user agent's `dialog:modal { margin: auto }`, so `showModal()`
   produced an off-centre, partly cut-off modal on the Phase 4-iii demo path.
2. **Activity register detail stated the emission factor as a quantity.**
   "Factor applied: 1 kWh" — `factorUnitSnapshot` is the unit the factor is
   expressed *per*, and the calculation page one click away already said
   "1 kgCO₂e per kWh".
3. **`/sources` badged the placeholder factor set as "Official factor".**
   Factor availability was derived from `sourceType` alone. The BOARD-1 set
   carries `OFFICIAL_DEFRA_DESNZ` because the calculation engine resolves
   factors by that tag — plumbing, not provenance — while the management report
   correctly calls the same set a placeholder dataset.
4. **Management report claimed a year-on-year change on a window longer than a
   year.** "The same window one year earlier" then overlaps the current window.
   The full demo window reported **+80% above last year** on every scope and
   every site, while the true year-on-year movement was −20% and the dashboard,
   on the same data, said "Not comparable".
5. **Factor management was unreachable for every demo persona.** No BOARD-1
   role held `carbon.factor.view`, which the product's own `SUSTAINABILITY_LEAD`
   template grants, so `/admin/factors*` silently redirected to the dashboard
   and no nav entry appeared. Journey 7 could not be demonstrated at all.
6. **Every BOARD-1 source declared `unitOptions: ["kg"]`,** including grid
   electricity and natural gas, whose entries and factors are both in kWh. The
   entry form offers exactly what is in `unitOptions`, so filling the demo's
   missing September electricity would have recorded kilowatt-hours as
   kilograms against a per-kWh factor. Also surfaced as "Expected unit: kg" on
   the collection-plan detail and "Usually reported in kg" on `/sources`.

### P2 — fixed

7. LCA "Lifecycle contribution" cards labelled emissions as a mass: `0.084 kg`
   instead of `0.084 kgCO2e`.
8. The workbook's Data quality sheet wrote the raw enum `TIER_1/2/3`; the page
   and the export now share one `DATA_QUALITY_TIER_LABEL`.
9. Entry form and `/sources` showed the fixture's placeholder prompt,
   "Synthetic BOARD-1 fixture input."
10. Page `<title>` still read "Paragon ID UK — Carbon Reporting" while the
    product is branded Carbon Ledger and the demo organisation is Northstar.
11. "1 sources in the catalogue".
12. A quarterly collection cell said "month still running"; now "period still
    running", which is true of every cadence in that column.
13. "Import factors" on `/admin/factors` led to a page that redirects to the
    dashboard without the manage grant — a dead control. The button is now
    hidden when the grant is absent; the server-side redirect is unchanged.
14. The shared comparison note was repeated on all five comparison rows as well
    as above the table.

### P2/P3 — deferred, not fixed

- `/activity` tells a user with no site scope "No activity data entered yet"
  and offers "Enter activity data". The cause is access, not absence. Only
  reachable as the `restricted` contract persona, which is not a demo path.
- Three different wordings of the same data-quality tier across
  `/reports/management`, `/reports/[id]` and `/activity/[id]`.
- `/calculations/[id]` shows raw `TIER_3` and `OFFICIAL_DEFRA_DESNZ` in its
  provenance block, beside an explicit placeholder warning.
- Scope 3 category links on the management report open all of Scope 3; the
  register has no per-category filter to land on.
- Quarterly columns in the collection matrix sort by period start, so `2026-Q1`
  sits between January and February. Each column is labelled.
- `kgCO2e` on LCA pages versus `kgCO₂e` on carbon pages.
- BOARD-1 fixture naming ("BOARD1 BUSINESS TRAVEL") in source headings.

## Changes

Application:

- `src/app/(app)/data/reporting-period-panel.tsx` — `m-auto` on the modal.
- `src/app/(app)/activity/[id]/page.tsx` — factor shown as a rate.
- `src/lib/carbon/source-config-service.ts` — `PLACEHOLDER` factor kind.
- `src/lib/carbon/management-report.ts` — overlapping-window comparison guard;
  shared tier labels; site delta nullable.
- `src/lib/carbon/management-report-export.ts` and
  `src/app/(app)/reports/management/page.tsx` — consume both.
- `src/components/lca/lifecycle-flow.tsx`, `src/app/(app)/sources/page.tsx`,
  `src/app/(app)/data/page.tsx`, `src/app/(app)/admin/factors/page.tsx`,
  `src/app/layout.tsx` — the label and control fixes above.

Demo fixture:

- `scripts/board-demo/live-seed-port.ts` — correct `unitOptions` per source, a
  real prompt template, and `carbon.factor.view` in the lead grants, so a fresh
  seed produces the corrected environment.
- `scripts/board-demo/align-demo-catalogue.ts` (new,
  `pnpm run db:board-demo:align-catalogue`) — applies the same three
  corrections to an already-seeded demo database. Idempotent; touches no
  activity entry, calculation, reporting period or requirement. Applied.

Tests: new cases for the overlapping-window comparison (and that exactly twelve
months still compares), the placeholder factor kind, the workbook tier label,
the modal centring class and the factor rate; the activity-register fixture's
`factorUnit` corrected to what the column actually stores.

## Validation

- Full suite: **2681 passed, 28 skipped, 0 failed** (2676 before, plus 5 new).
- `tsc --noEmit`: clean.
- ESLint over the changed areas: clean (one pre-existing unused-variable
  warning in an unrelated tenant-adversarial test).
- `next build`: succeeds.
- `pnpm run db:board-demo:verify-collection-plan`: **ALL CHECKS PASSED** —
  66/59/7 at 89.4%, 384 activity entries, 576 calculations, both reporting
  periods OPEN, LCA product/assessments/items/results intact.

Runtime re-checks after the fixes: dashboard, collection plan and its detail
panel, activity register and record detail, close → reason → CLOSED → refused
mutation → reopen → OPEN, management report on both windows, XLSX export,
factor dataset and import-preview pages, LCA results, and the permission matrix
across all six personas.

The close/reopen rehearsal used Central Digital, August 2026, and ended OPEN.
A September 2026 electricity entry was created through the real "Enter data"
journey to prove the corrected unit end to end — it produced 800 kWh × 1 =
800 kgCO₂e location-based and × 0.5 = 400 kgCO₂e market-based — and was then
removed, with the verification script confirming 384/576 and 66/59/7 restored.

## Deployment

- Vercel project `carbon-accounting-tnal` (team `callum-carbon`, Hobby),
  linked to `Calja88/Carbon-Accounting`, `live: false`.
- The Ignored Build Step `scripts/vercel/ignore-build.mjs` cancels every
  routine commit; only `[vercel deploy]` in the commit message or
  `BOARD_DEMO_FORCE_DEPLOY=1` permits a build. The builds for `114f286` and
  `667e3d1` are therefore CANCELED **by design**, not failed. The most recent
  READY deployment is `871282b`, several phases behind.
- Deployment protection: Vercel Authentication on for all deployments except
  custom domains; password protection and trusted IPs off. Previews are
  private.
- A local shell variable cannot reach a Vercel build: Vercel builds from GitHub
  with project-level environment variables only.
- **The intended board runtime is local**, per
  `Docs/deployment/VERCEL_USAGE_CONTROLS.md`: `pnpm build` then
  `scripts/board-demo/start.ps1`, optionally `-Tunnel` for an HTTPS quick
  tunnel. That path is hardened — the launcher clears the ambient database
  variables from its own environment and verifies the target before opening a
  port.
- Nothing was deployed in this phase.

**If a cloud demo is wanted instead**, it needs an explicit decision outside
this task: push a commit whose message contains `[vercel deploy]` (or set
`BOARD_DEMO_FORCE_DEPLOY=1`), and first set the project's environment variables
to the `board_demo` database — they are not currently proven to point there,
and a preview would otherwise inherit whatever is configured.

## Caveats for the presenter

1. Run the demo from the **local launcher**, not from a Vercel URL.
2. Keep the default reporting window (year to date). The multi-year window is
   correct but now says "Not comparable" for the year-on-year column, because
   the comparison window overlaps it.
3. Every figure comes from a **placeholder** factor set. The product says so on
   the report, the export, the factor page, `/sources` and each calculation —
   that honesty is part of the story, not a defect.
4. The dashboard's "192/192 expected returns reviewed" (Jan–Aug) and the
   report's "89.4%" (Jan–Sept) are different denominators over different
   windows, not a contradiction: the seven gaps are all September.
5. Filling the September gap live works and is a good beat, but it moves
   completeness to 60/66. Re-run
   `pnpm run db:board-demo:verify-collection-plan` afterwards, and restore the
   fixture if 89.4% is wanted again.
6. A newly entered electricity record produces two calculations, not three; the
   Category 3 transmission-and-distribution row comes from "Prepare reporting
   data" on `/reports`.
7. `/admin/organisation/members` and `/roles` need `organisation.*.manage`,
   which no demo persona holds — by design, matching the product's own role
   templates. Direct navigation there bounces silently to the dashboard.
8. This machine's shell carries production database credentials. Only use the
   `db:board-demo:*` scripts, and do not run implicit Neon or Prisma commands
   from the main worktree, where `.neon` still points at production.

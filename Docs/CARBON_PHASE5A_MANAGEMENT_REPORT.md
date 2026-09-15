# Phase 5A — Management Carbon Report

One live management report for a selected period, built entirely on top of the
existing calculation and reporting architecture. No new emissions engine, no
parallel reporting calculation, no report builder.

## Route

`/reports/management` — `src/app/(app)/reports/management/page.tsx`.

Reachable from the **Reports** nav item (its `matches: ["/reports"]` prefix
already covers this sub-route, so `BOARD_NAV` is unchanged) and from a card at
the top of `/reports`. That page is unchanged otherwise: the frozen
`ReportSnapshot` disclosure reports and this live management view sit side by
side and answer different questions — *what did we state for that period* vs
*what is the position now*.

Period selection is a page-local `GET` form (`period-controls.tsx`) posting to
`/reports/management` with `from` / `to` / `siteId`. The app shell's scope bar
posts to `/`, so reusing it would navigate the reader off the report; the URL is
still the scope, so a selection bookmarks and shares like the dashboard's.

Access is `carbon.view` (site-scoped), not `requireFrozenReportAccess` — a
restricted site lead sees a truthful report for their own sites. An explicitly
selected site is re-checked with `requireSiteInScope`, so a foreign id is
rejected rather than silently widened.

## Existing architecture reused

| Concern | Source of truth | Reused, not rebuilt |
| --- | --- | --- |
| Emissions totals, scopes, sites, monthly, data quality | `buildAnalyticsSnapshot` (`src/lib/analytics-service.ts`) | Yes — the same aggregation the dashboard and `buildReportPayload` use |
| Prior-period window | `previousYearPeriod` | Yes |
| Change / direction / improvement | `buildDelta` | Yes |
| Period parsing | `resolveMonthRange`, `formatRangeLabel` | Yes |
| Completeness and outstanding data | `getCollectionMatrix` (`collection-plan-service.ts`) | Yes |
| Reporting-period OPEN/CLOSED | `ReportingPeriod` rows (Phase 4-ii) | Yes |
| Factor provenance | `Calculation.factorSourceSnapshot` / `factorVintageSnapshot` + `EmissionFactorSet.isPlaceholder` | Yes |
| Charts, cards, badges, formatting | `components/charts/*`, `components/ui/*`, `lib/format.ts` | Yes |

New files, following the board sprint's pure-adapter / live-loader split:

- `src/lib/carbon/management-report.ts` — pure read model. No Prisma, no clock.
  Every rule is unit-testable without a database.
- `src/lib/carbon/live-management-report.ts` — the one read path. Authorization,
  tenant scoping and queries live here.
- `src/app/(app)/reports/management/page.tsx` + `period-controls.tsx` — presentation.

## KPI definitions

| KPI | Definition |
| --- | --- |
| Total emissions | `Scope 1 + Scope 2 (location-based) + Scope 3`, taken from `AnalyticsSnapshot.group.total`. The basis is printed under the figure. |
| Scope 1 | `group.scope1` — all `Calculation.scope = SCOPE_1` in the window. |
| Scope 2 — location-based | `group.scope2Location` — `basis = LOCATION_BASED`. In the headline. |
| Scope 2 — market-based | `group.scope2Market` — `basis = MARKET_BASED` or `RESIDUAL_MIX`. **Companion, never added.** |
| Scope 3 | `group.scope3`. |

`FLAGGED` entries are excluded throughout (the existing inclusion rule).
Every KPI is `null`, rendered as an em dash, when no activity data was received
for the period — never `0`.

## Scope 2 handling

Location-based and market-based are companion views of the same purchased
electricity. The report:

- puts location-based in the headline and says so on the page;
- shows market-based as its own card, flagged "Companion — not in the total",
  with a dimmed swatch;
- shows market-based as its own comparison row, labelled "(companion)";
- returns `null` for market-based when no `MARKET_BASED`/`RESIDUAL_MIX` rows
  exist in the window, rather than implying a zero;
- excludes market-based from the site table, the ranked sources, the trend and
  the data-quality weighting, so all four reconcile with the headline.

An assertion (`assertHeadlineReconciles`) refuses to render a headline that does
not equal its own scope split.

## Comparison behaviour

The comparison window is the same calendar window one year earlier
(`previousYearPeriod`); both ranges are printed in the section heading.
Comparability is decided once and every row honours it:

| Situation | Behaviour |
| --- | --- |
| Both periods reported | Absolute change + signed percentage via `buildDelta`. |
| Comparison period has no data | No change stated at all; note names the period. |
| **Current period has no data** | No change stated; note says the difference "would reflect missing data, not a reduction". This is the "emissions reduced by 100%" failure, prevented explicitly. |
| Comparison period partly reported | Change shown **plus** a note: "only partly reported (N of M months)". |
| Zero prior figure for a line | `buildDelta` returns a null percentage; the row says no percentage change can be stated. |

## Site breakdown

Stacked bar plus a table: Scope 1 / Scope 2 LB / Scope 3 / total / share /
change vs last year / that site's own reporting-period state. Sorted largest
first. Share is `null` (em dash) when the total is absent or zero.

Results whose site is not in the active site list are **not** spread across the
listed sites and **not** dropped: they get their own `Not attributed to an active
site` row, so the table always adds up to the headline.

## Scope 3 breakdown

Rows are the canonical GHG Protocol categories this platform actually models
(from `ActivityDataPoint.scope3Category` plus the categories the Cat 3
derivation writes straight onto a `Calculation`) — in the BOARD demo, Cat 1, 3,
6 and 7. Each row carries tCO₂e, share of the inventory and a state:

- **Quantified** — a calculation exists with a non-zero result;
- **Genuine zero** — calculations exist and sum to zero;
- **No data this period** — the platform models the category but this period
  produced no calculation. Shown as an em dash, never `0`.

The remaining categories are reported as **not assessed**, with the existing
truthful reason: no Scope 3 screening decision is recorded anywhere in this
codebase, so they are not claimed to be zero and are not in the totals.

## Largest sources

Top 5 by `Calculation` rows grouped by site × scope × category (location-based
Scope 2 only), with site, scope, tCO₂e, share and a drill-down link.

This is a second *grouping* of the same authoritative rows, not a second
calculation — and `assertSourcesReconcile` refuses to render the report if the
ranked rows do not add back up to the headline total, so it cannot drift.

## Trend behaviour

Monthly totals come from `AnalyticsSnapshot.monthly`. `analytics-service` seeds
every month in the window with zeros so the axis does not collapse; this report
therefore carries a separate `monthsWithData` set, derived from `ActivityEntry`
rows (**not** calculations, so a month awaiting a factor still counts as
reported).

- A month with no entries at all → `totalKg: null`, `reported: false`. It is
  left out of the line and the table row reads "Not reported".
- A month with entries whose emissions sum to zero → a genuine `0`, plotted.
- A banner names every unreported month and how many there are.

## Completeness

From the collection plan's own states (`CollectionStatus`), never invented:

- **required** = every cell that is not `not_required`;
- **excluded** = authorised exclusions, removed from the denominator (never
  counted as received);
- **received** = `reviewed + submitted + awaiting_factor + changed_since_review`;
- **counted in totals** = `reviewed + submitted + changed_since_review`
  (`awaiting_factor` is received but contributes nothing yet);
- **received %** = received ÷ (required − excluded), and **`null`** when nothing
  is required — an honest blank, not a 0% or 100% invented from an empty plan.

The basis sentence is printed under the heading.

## Outstanding items

Counts of genuinely actionable domain states only — `missing`,
`awaiting_factor`, `changed_since_review` from the collection matrix, plus
`flaggedCount` from the analytics snapshot. Nothing is fabricated: an empty list
renders as "Nothing outstanding for this period in your scope."

## Drill-down

Every link is built by one exported helper, `activityDrilldownHref`, so the
Activity Data Register has exactly one place to repoint. Today it resolves to
`/data` (the period-aware collection plan over the same site/source/period cells
these figures come from), carrying `from`, `to`, `siteId` and — where the reader
clicked one — `scope` or `status`. Trend months link to the dashboard for that
single month.

## Methodology and provenance

Reporting boundary, Scope 2 basis, headline basis, period, calculation engine
version(s), and every factor dataset used in the window (scope, source, vintage)
with an **Imported dataset / Placeholder dataset** badge read from
`EmissionFactorSet.isPlaceholder`.

Assurance language is deliberately constrained. The platform records no
verification, approval or assurance decision for an inventory, and Phase 3-vii
factor publication is deferred, so the report never claims one:

- placeholder factors in use → "Management information. Some figures use
  placeholder emission factors … not suitable for formal or assured disclosure."
- otherwise → "Management information. No independent verification or assurance
  decision is recorded for this inventory."

## Reporting-period state

One `ReportingPeriod` per site per month. The range summary is truthful:

- **Open** — no site-month closed;
- **Closed** — every site-month closed;
- **Partly closed — N of M site-months closed** — anything in between. A mixed
  range is never labelled CLOSED.

Each site row carries its own summary. Phase 4-ii controls are untouched; closed
periods remain fully readable and every figure is unchanged by closing.

## Tests

`src/lib/carbon/__tests__/management-report.test.ts` — 36 tests, no database,
following the `carbon-adapter.test.ts` pattern. Covers: authoritative totals;
per-scope totals; Scope 2 dual reporting and no double counting; absent
market-based; equivalent-period comparison; zero denominator; comparison period
with no data; current period with no data (no false reduction); partly reported
comparison; site reconciliation and shares; unattributed remainder; Scope 3
reconciliation and zero-vs-no-data-vs-not-assessed; ranked sources and the
reconciliation guard; monthly aggregation; missing month never a genuine zero;
genuine zero month still distinguishable; reporting-period summaries including
mixed; closed period still fully readable; completeness counts and the null
percentage; outstanding states and no fabricated alerts; drill-down link
resolution and filters; assurance language in both directions; empty period.

Validation run: targeted tests → `tsc --noEmit` (clean) → `eslint` on the changed
files (clean) → full `vitest run`: **2547 passed, 28 skipped, 0 failed** →
`next build` succeeds with `/reports/management` registered. No existing test was
changed, so Activity Data Register / collection-plan and LCA behaviour is
unregressed.

## Runtime verification

Verified read-only against the explicitly configured private demo database
(`board_demo`, `APP_DATA_MODE=synthetic`, `BOARD_DEMO_DEPLOYMENT_CLASS=
private-demo`) using the BOARD-1 sustainability-lead persona. No writes, and the
throwaway script was deleted. Jan–Aug 2026:

- Total **1248.00 tCO₂e**; S1 216.00 + S2 LB 432.00 + S3 600.00 reconciles exactly;
- S2 market-based **216.00 tCO₂e** shown separately, excluded from the total;
- −20.0% against Jan–Aug 2025 on every line;
- 3 sites (960.00 / 264.00 / 24.00) summing exactly to the total, shares 76.9 / 21.2 / 1.9%;
- Scope 3: Cat 1 447.60, Cat 6 90.00, Cat 3 32.40, Cat 7 30.00 — 11 of 15 not assessed;
- Top 5 sources ranked correctly, each link carrying period, site and scope;
- Jan–Dec 2026 window: Sep–Dec correctly "Not reported" (not zero), and the
  comparison note correctly reads "only partly reported (8 of 12 months)";
- Single-site selection narrows every section (East Cards 264.00 tCO₂e, 100%);
- Factor sets correctly detected as **placeholder**, and the assurance sentence
  correctly states the figures are not suitable for formal or assured disclosure.

## Known limitations

1. **The private demo database is behind this branch's schema.** `ReportingPeriod`
   (Phase 4-ii) and `CarbonCollectionRequirement` (Phase 2B collection plan) do
   not exist in `board_demo`, so the report's OPEN/CLOSED banner and its
   completeness/outstanding sections could not be verified there — they were
   stubbed in the throwaway script only. **Migrating that demo database is a
   prerequisite for demoing those two sections.** Both are covered by unit tests.
   The code needs no change; those sections degrade honestly (`received % —`,
   "Nothing outstanding") rather than inventing figures.
2. Demo factor sets are placeholders, so the report correctly presents itself as
   management information not suitable for formal disclosure. That is the truthful
   state, not a defect.
3. The trend line chart draws only reported months and cannot itself render a
   gap; the gap banner and the month table carry that truth. A gap-aware chart
   was not built — out of proportion for this phase.
4. Scope 3 screening is still not recorded anywhere in the platform, so
   "not assessed" is a statement about the absence of a screening record, not a
   screening result.
5. No export from this page (Phase 5B). The browser print view is styled via the
   existing `no-print` / `break-inside-avoid` classes; permanent figures still come
   from a frozen `ReportSnapshot` on `/reports`.
6. Drill-down stops at `/data` (site, source, period, submission and status).
   Repointing it at the Activity Data Register is a one-function change
   (`activityDrilldownHref`).

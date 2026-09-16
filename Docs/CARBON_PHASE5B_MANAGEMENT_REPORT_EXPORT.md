# Phase 5B — Management Carbon Report export

One export for the Phase 5A management report, built as a serialisation of that
report rather than as a second reporting path. No new aggregation, no second
calculation, no reporting redesign.

## Format chosen: Excel (.xlsx)

`exceljs` is already a **production** dependency (`package.json` → `dependencies`),
used by `factor-import.ts`, `parse-uk-gov-factors.ts`, `expensein-import.ts` and
`inventory-import.ts` for reading workbooks, and by the factor-import tests for
writing them (`workbook.xlsx.writeBuffer()`). So XLSX costs no new dependency and
no new architecture.

It was preferred over the alternatives because:

- **CSV** cannot carry six differently-shaped sections in one file. Representing
  this report as CSV would mean either a flattened single table that loses the
  section structure, or a new multi-CSV/ZIP path — more new architecture than the
  workbook, not less. (`archiver` exists but only as a devDependency.)
- **PDF** has no existing generation path in this codebase at all. The brief and
  the ladder both rule out building a renderer, and `/reports/management` already
  has a browser print-to-PDF route via `PrintButton`.

The workbook also gives the reader real numeric cells they can total and pivot,
which a rendered document cannot.

## Route

`GET /reports/management/export.xlsx` —
`src/app/(app)/reports/management/export.xlsx/route.ts`.

Follows the existing download convention in this codebase: a literal-extension
route segment holding a `route.ts` GET handler, exactly like
`/reports/[id]/audit-trail.csv/route.ts`.

It is a sibling of the report route and takes the same `from` / `to` / `siteId`
query the page reads, so the URL that produced the screen produces the file.

## The export control

An **Export Excel** button sits in the report's own action row, next to
*Print / export PDF* — no separate admin screen. It is a plain `<a download>`,
so it needs no client state and carries the reader's current selection in its
href.

The href is built from the **resolved** window (`report.trend[0].month` …
`report.trend[last].month`), not the raw query string, so a missing or malformed
`from`/`to` — which the page silently falls back to a default range for —
exports the period actually on screen rather than a different one.

## Shared read model reused

```
authoritative carbon results (Calculation rows)
        ↓
buildAnalyticsSnapshot + getCollectionMatrix   (unchanged)
        ↓
loadManagementReport  →  ManagementReport      (Phase 5A, unchanged)
        ↓
 ┌──────────────┬──────────────────┬──────────────┐
 screen          export             drill-down
 page.tsx        export.xlsx        /activity
```

The route calls **`loadManagementReport`** — the same function, with the same
arguments, that the page calls. `management-report-export.ts` then reads fields
off the resulting `ManagementReport` object.

The exporter contains exactly one arithmetic operation: `kg / 1000`, in a single
`tonnes()` helper. Everything else is a field read. There is no second
aggregation to drift.

## Exported sections

| Sheet | Contents |
| --- | --- |
| **Summary** | Organisation, reporting period, comparison period, site filter, reporting-period status, generated timestamp, headline basis, basis of preparation; headline accounting with an **In headline total** column; comparison table with absolute and percentage change |
| **Sites** | Site, entity, Scope 1, Scope 2 location-based, Scope 3, total, share, change vs comparison, that site's reporting-period status |
| **Scope 3** | Category, tCO₂e, share, state (Quantified / Genuine zero / No data this period), plus the count of categories not assessed |
| **Sources** | Ranked largest sources: rank, source, scope, site, tCO₂e, share |
| **Monthly trend** | Month, Scope 1, Scope 2 location-based, Scope 3, total, Reported / Not reported, plus a named list of unreported months |
| **Data quality & methodology** | Data-quality tiers; completeness counts and basis; outstanding items; reporting boundary, headline basis, Scope 2 basis, Scope 3 note, calculation engine, basis of preparation; every factor dataset used with an Imported / Placeholder state |

Frozen header rows, column widths, tonne and signed-percentage number formats,
landscape fit-to-width page setup. Nothing decorative beyond that, and no raw
data dump — the audit trail already has its own CSV export.

## Scope 2 treatment

Unchanged from Phase 5A, and made explicit in the file:

- the headline total is **Scope 1 + Scope 2 (location-based) + Scope 3**, printed
  as a context row and repeated as the total line's note;
- every headline line carries an **In headline total** column, and
  *Scope 2 — market-based* is the one that reads `No — companion view`;
- the **Sites** sheet deliberately has no market-based column: every numeric
  column there adds up to the headline, and a companion column in the same grid
  would invite a wrong sum;
- market-based appears in the comparison table labelled `(companion)`;
- an absent market-based figure writes `Not reported`, never `0`.

A test asserts that the in-headline lines sum to the headline and that adding
market-based would change it.

## Missing data behaviour

`Not reported` is written wherever the read model holds `null`. Never `0`,
never an empty cell. This covers:

- a month that received no activity data — the Status column says
  `Not reported`, and a note names every such month;
- a Scope 3 category the platform models but that produced no calculation;
- the categories that are **not assessed** at all — named in a note rather than
  omitted, because an absent row reads as a zero to anyone totalling the column;
- an absent market-based Scope 2 figure;
- a share of an absent or zero total;
- `Received %` when the collection plan requires nothing —
  `Not applicable — nothing required`.

A month that genuinely emitted zero still writes `0` with status `Reported`, so
zero and missing stay distinguishable in the file.

## Comparison behaviour

Phase 5A's semantics are reused wholesale; the exporter computes no delta of its
own. Where `ComparisonRow.delta` is `null` — the comparison period has no data,
the *current* period has no data, or the market-based companion is absent — the
change and percentage cells read `No change stated`, and the row's note explains
why. The partly-reported caveat and the zero-denominator note are carried
through as written.

The failure this prevents is a missing current period being exported as a 100%
reduction. It is covered by a test.

## Placeholder / provisional factors

Phase 3-vii publication is not implemented, and the export does not pretend
otherwise. Each factor dataset is listed with an **Imported dataset** or
**Placeholder dataset** state, and when any placeholder set is in use the
methodology sheet carries a bold warning that the figures are provisional and
"not verified, assured or suitable for formal disclosure". The Summary sheet's
*Basis of preparation* row is `methodology.assurance` verbatim, so the file never
claims a verification or assurance decision the domain does not record.

## Permissions

The architecture already distinguishes report export — `carbon.report.export`
exists in the permission catalogue and gates the frozen-report CSV — so no new
role system was invented. A new `requireManagementReportExport` in
`carbon-access.ts` requires `carbon.view` **and** `carbon.report.export`.

It deliberately does *not* reuse `requireFrozenReportAccess`: that insists on
ORGANISATION_WIDE access because a frozen report describes the whole
organisation, whereas the management report is site-scoped by design. Reusing it
would have regressed Phase 5A's restricted-site-lead access.

The check runs in the route **before any work is done**, and
`loadManagementReport` re-checks `carbon.view`, tenant scope and
`requireSiteInScope` itself. Hiding the button is presentation only; a reader
without the permission gets a 404 from the URL.

## Reporting-period state

Exporting is a read. A CLOSED period exports exactly like an open one, no figure
changes on closing, and nothing needs reopening to be exported. The Phase 4-ii
mutation barrier is untouched — no mutation path was added.

## Error handling

| Situation | Response |
| --- | --- |
| Not signed in | 401 `Sign in first.` |
| Lacks `carbon.report.export` or `carbon.view` | 404 `Report not found` |
| Site outside the reader's scope | 400 `That site is not available in this report.` — refused, never widened to all sites |
| Unexpected failure | 500 with one sentence; the real exception goes to `logEvent` server-side. No stack, no internals |

`Cache-Control: no-store` — a management position at a moment is not a cacheable
asset.

## File name

`carbon-management-report-<from>-to-<to>.xlsx`, with the site slug inserted when
a site filter is active:

```
carbon-management-report-2025-01-to-2025-04.xlsx
carbon-management-report-hull-site-2025-02-to-2025-02.xlsx
```

Deterministic for a given selection. Anything outside `[a-z0-9-]` is stripped, so
path separators and other unsafe characters cannot reach the name.

## Reconciliation strategy

Three layers, deliberately:

1. **Structural** — the export consumes the same `ManagementReport` object the
   page renders, obtained from the same loader with the same parameters. There is
   no second query and no second aggregation.
2. **Unit** — the export tests read the *built workbook* (not an intermediate
   model) and compare every figure against the report model's own fields, so a
   regression that introduced independent arithmetic would fail.
3. **Runtime** — a throwaway read-only script compared screen values against
   workbook cells for every section against the live demo database.

## Tests

`src/lib/carbon/__tests__/management-report-export.test.ts` — 38 tests:
sheet structure; a real workbook that survives a file round-trip; report context;
site filter recorded; every KPI reconciled; Scope 2 LB and MB reconciled
independently; the companion marking; the in-headline lines summing to the
headline and market-based not; absent market-based as words; site rows and their
sum; no market column in the site grid; Scope 3 quantified / genuine zero / no
data / not assessed; ranked sources in order; monthly trend reconciled; a missing
month never zero; a genuine zero month still zero; valid comparison delta;
comparison with no prior data; current period missing and no false reduction;
partly-reported caveat; zero-denominator note; factor datasets; engine and
boundary; placeholder warning preserved; no unrecorded assurance claim;
completeness counts and the null percentage; outstanding items; a CLOSED period
still exporting; four file-name tests; an empty period.

`src/app/(app)/reports/management/export.xlsx/__tests__/route.test.ts` —
14 tests: a real xlsx body and content type; download disposition and name;
`no-store`; the selected period and site filter reaching the loader unchanged;
the workbook coming from the loader's report; a reader with `carbon.view` but not
`carbon.report.export` refused **before** any work; no carbon access refused;
unauthenticated 401; loader-level denial 404; out-of-scope site 400; a clean 500
that leaks no internals; the real fault logged server-side; a refusal not logged
as a fault.

`src/lib/carbon/__tests__/management-report-fixture.ts` — Phase 5A's own fixture,
extracted so both suites assert against the same figures rather than against two
fixtures that could drift. The Phase 5A test file now imports it; its 37 tests are
unchanged and still pass.

### Validation run

| Check | Result |
| --- | --- |
| Export + Phase 5A read-model tests | 75 passed |
| Export route tests | 14 passed |
| Carbon + reports suites | 122 passed, 17 skipped |
| `tsc --noEmit` | clean |
| `eslint` on every changed file | clean |
| Full `vitest run` | **2643 passed, 28 skipped, 0 failed** (baseline 2591 + the 52 added) |
| `next build` | succeeds; `/reports/management/export.xlsx` registered as a dynamic route |

No existing test was modified other than the fixture import, so Activity Data
Register, collection-plan and LCA behaviour are unregressed.

## Runtime verification

Read-only against the explicitly configured private demo database
(`board_demo`, `APP_DATA_MODE=synthetic`,
`BOARD_DEMO_DEPLOYMENT_CLASS=private-demo`). SELECTs only; no writes, no
migrations; the throwaway script was deleted.

Screen values were compared against workbook cells for every section:

- **Feb 2025** (Paragon Group, the populated window): total **27.958658723 t**;
  Scope 1 0 + Scope 2 LB 25.3090707 + Scope 3 2.649588023 reconciles exactly;
  Scope 2 market-based shown separately and excluded from the total; Hull Site
  100% of the inventory with Milton Keynes and Rayleigh at genuine zero; Cat 3
  quantified and Cats 1/6/7 correctly `Not reported`; both ranked sources
  reconciled; comparison against Feb 2024 correctly `No change stated`.
- **Jan–Apr 2025**: Jan, Mar and Apr correctly `Not reported` rather than zero,
  and named in the gap note.
- **Site filter (Hull Site)**: the file records the filter, narrows to one site
  row, and the headline is unchanged at 27.958658723 t.
- An organisation with no data at all: every figure `Not reported`, nothing
  fabricated.

**71/71 reconciliation checks passed** on the populated window, plus 95/95 on the
empty organisation. Four real workbooks were produced and reopened successfully.

The export button appearing for the persona was confirmed from its own
permissions (`carbon.report.export: true`).

## Known demo-DB limitation

`board_demo` still predates the Phase 4-ii `ReportingPeriod` and Phase 2B
`CarbonCollectionRequirement` migrations. Those two reads were stubbed for the
verification run exactly as Phase 5A stubbed them, so the export's
reporting-period status and completeness/outstanding sections could not be
exercised against real rows there. Both are covered by unit tests, and the code
degrades honestly rather than inventing figures. **No migration was applied** —
that belongs to the separate runtime-readiness task.

Note also that `board_demo` has been reseeded since the Phase 5A run: it now
holds one Feb 2025 activity entry for Paragon Group rather than the Jan–Aug 2026
BOARD dataset that handoff describes. The verification above used what is
actually there.

## Other known limitations

1. The workbook contains no charts. The trend and site charts are on screen; the
   file carries their underlying tables. Charting via exceljs would be
   disproportionate here.
2. Drill-down links are not embedded as cell hyperlinks. The export is the
   figures and their provenance; navigation belongs to the screen.
3. The export always contains all six sheets, including ones a given period
   leaves sparse. Suppressing sheets would make files harder to compare.
4. No scheduled, emailed or subscribed export — explicitly out of scope.

## Explicitly out of scope (not done)

Phase 4-iv controlled recalculation/restatement; Phase 3-vii factor publication;
custom report builder; scheduled/emailed reporting or subscriptions; Power BI or
Tableau integration; any new emissions calculation or Scope 3 method; LCA
changes; a PDF renderer; Activity Data Register redesign; demo-database
migration; production deployment; global UI work.

## Activity Data Register integration

Unchanged and unregressed. `activityDrilldownHref` was not touched; its 37 Phase
5A tests still pass. Site / Scope 3 category / ranked source still resolve to
`/activity` with period, site and scope filters; `awaiting factor` and
`held back` still resolve to `/activity?status=AWAITING_FACTOR` and
`?status=FLAGGED`; `missing` and `changed_since_review` still resolve to `/data`,
since they are collection-plan facts about a requirement rather than
`EntryStatus` values.

## Small finish items included

- `SCOPE3_STATE_LABEL` was lifted out of an inline ternary in `page.tsx` into
  `management-report.ts`, so the page and the export cannot label a category's
  state differently.

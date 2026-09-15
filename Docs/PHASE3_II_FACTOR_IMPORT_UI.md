# Phase 3-ii: UK factor import preview UI

## Scope

This phase adds the **preview-only** UI over the Phase 3-i engine described in
`PHASE3_I_FACTOR_IMPORT.md`. It adds one route, one Server Action and one client
component. It adds no schema change, no migration, no dependency, no database
write, no approval flow and no new permission. `commitAllowed` remains `false`
for every file, and there is no code path in this phase that could make it true.

Delivered on `board/product-2026-09-22` in commit `208ed86`, on top of Phase 3-i
(`8850211`). PR #64 remains unmerged; Production was not touched and still lacks
the Phase 2B-i migration `20260914160000_add_carbon_collection_requirement`, so
this branch must not be promoted.

| File | |
| --- | --- |
| `src/app/(app)/admin/factors/import/page.tsx` | Server component: RBAC gate, header, preview-only notice |
| `src/app/(app)/admin/factors/import/import-preview.tsx` | Client component: upload form, summary, row groups, disabled commit panel |
| `src/app/(app)/admin/factors/import/actions.ts` | Server Action and the trimmed preview DTO sent to the client |
| `src/app/(app)/admin/factors/page.tsx` | Entry-point button (+8/−1); no new nav item |
| `src/lib/__tests__/factor-import-preview-action.test.ts` | 11 action tests |
| `src/lib/__tests__/factor-import-preview-page.test.tsx` | 14 page/UI tests |
| `src/lib/factors/import/__tests__/preview-sample-fixture.test.ts` | Keeps the checked-in sample honest |
| `scripts/factors/synthetic-preview-sample.csv` | Sample upload for signed-in visual checks |
| `scripts/factors/check-preview-routes.mjs` | Unauthenticated route smoke check |

## Route and placement

`/admin/factors/import`, inside the existing Factor Datasets area rather than a
disconnected route. The existing `/admin/factors/upload` is the **platform
template importer and it genuinely persists** — the two are deliberately separate
so that a preview can never be mistaken for, or routed into, a real import. Do
not merge them until Phase 3 persistence is designed.

Opening the page requires `carbon.factor.view`; without it the page redirects to
`/`. The upload form renders only for `carbon.factor.manage`. A viewer without
that grant sees an explanatory panel, no file input, no submit control and no
dataset names — `listFactorSets` is not called at all on that path.

## Server Action contract

`previewFactorImportAction(prevState, formData)` is a `useActionState` action,
matching the convention already used by `/admin/factors/upload` and `/data`.
File upload through a Server Action is an established, working pattern in this
repository; no route handler was needed.

It resolves `OrganisationContext` from the session — never from upload input —
then rejects, in order and before any parsing:

| Condition | Result |
| --- | --- |
| No session | "You must be signed in." |
| Missing or empty file | "Choose a .csv, .xlsx or .xlsm file to preview." |
| Extension not `.csv`/`.xlsx`/`.xlsm` | "Unsupported file type…" |
| Over 10 MiB | "That file is larger than the 10 MiB preview limit." |
| `carbon.factor.manage` missing | "You don't have permission to manage emission factors." |

The size ceiling matches the parser's own 10 MiB limit, so the action refuses
before reading rather than relying on the engine to refuse afterwards. Permission
is enforced by the Phase 3-i service itself (`requirePermission` before any parse
or read), so the UI check is defence in depth, not the boundary.

On success it returns a **trimmed** DTO, not the engine's full preview. Row
groups are capped at 100 rows each while still reporting the true total, and only
presentation fields are forwarded. `source.cells` and `source.fields` — the raw
spreadsheet content — never reach the client; a test asserts this.

The action never calls persistence. The test suite mocks `prisma`,
`commitFactorImport` and `recalculatePendingEntries` to throw, so any future
commit path added here fails the suite rather than shipping quietly.

## What the UI shows

- **Preview-only notice**, before any result: no factors will be created or
  changed; commit is disabled pending the official workbook and the persistence
  design.
- **Upload form**: file input, optional publisher / dataset year / release (used
  only when the file does not state its own), and an optional existing dataset to
  compare against. Metadata found in the file is reported as detected.
- **What was read**: source file name, detected publisher/year/release, rows
  scanned, and every sheet with whether it was processed or skipped. An
  unrecognised sheet is named and labelled skipped, never silently dropped.
- **What it found**: scanned / accepted / warning / rejected / duplicate counts,
  plus file-level messages with severity and code. Selecting no existing dataset
  is stated as "database duplicate checks were not run", so an unchecked file is
  never mistaken for a checked one. A file yielding no recognisable factor rows
  says so rather than rendering as an empty success.
- **Row review**: four groups, each showing sheet, source row number, category
  path and activity, raw unit → canonical unit, factor value and factor unit,
  gas/kind, and that row's own messages with codes. Groups truncate at 100 rows
  and say "Showing the first N of M".
- **Import factors — disabled**: a `disabled` button plus the engine's
  `commitBlockedReasons`, and a statement that full official validation still
  needs `2026-full-set.xlsx` with its release metadata.

Built on the Phase 1A primitives (`PageHeader`, `Surface`, `bd-table`,
`bd-notice`) and the shared `components/ui` controls. No data-grid dependency was
added.

## File handling

Uploaded files are read in memory via `file.arrayBuffer()` and discarded. Nothing
is written to disk, nothing is added to the repository, and no file contents are
logged. An unexpected parser failure logs `factor_import_preview_failed` with the
error reason only — not the filename, not the contents — and returns a generic
user-safe message. Both are asserted.

## Tenant safety

The optional existing-dataset comparison goes through the Phase 3-i service,
which applies `visibleFactorSetFilter`: platform datasets, or the caller's own
organisation's. A foreign, private or missing dataset returns the same generic
error, so the control cannot be used to probe for other organisations' datasets.
No existing factor rows, names or IDs are copied into the returned preview. The
dataset dropdown is populated only for a user who already holds
`carbon.factor.manage`.

## The checked-in sample

There is still **no official workbook in the repository**, so
`scripts/factors/synthetic-preview-sample.csv` exists purely to exercise the UI
in a browser. Its values are synthetic and are not official conversion factors.
It previews as 3 accepted, 1 warning, 2 rejected and 1 duplicate across 8 scanned
rows, demonstrating every group in one upload;
`preview-sample-fixture.test.ts` asserts that so the sample cannot drift away
from what this document claims.

## Verification

Focused Vitest: 11 action tests, 14 page/UI tests, 1 fixture test. Regression:
the Phase 3-i import suite, `factor-import`, `factor-visibility`, supplier-factor
tenant isolation, `data-page`, `collection-plan-service`, `sources-page`,
`source-config-service`, the board dashboard/overview components and
`live-overview` — all pass. `tsc --noEmit` clean, ESLint clean on changed files,
`next build` succeeds with `/admin/factors/import` registered dynamic. No test
touches a database.

A Preview deployment was built from the empty trigger commit `b87c359`
(`dpl_9NK8Mk1T1njq1KFTW1t8F3raf4TB`, READY, target `null`):
<https://carbon-accounting-tnal-rfm09po9g-callum-carbon.vercel.app>.
`node scripts/factors/check-preview-routes.mjs <url>` reports no 5xx on
`/admin/factors/import`, `/admin/factors`, `/data` and `/sources`. Those routes
redirect to Vercel deployment protection, so that check proves only that nothing
errors at the edge — **signed-in visual verification of the rendered page, a real
upload round-trip and the row tables remains outstanding.**

## Phase 3-iii handoff

Persistence remains blocked, for the reasons Phase 3-i set out and this phase did
not change: gas/kind representation, durable per-row provenance and dataset
identity, concurrent-import idempotency, and the platform publication/approval
authority for the shared official factor library. Before any commit path is
built:

- supply `2026-full-set.xlsx` with its exact release metadata, so the adapter can
  be validated against the real layout rather than synthetic fixtures;
- decide the approval authority for writes to platform-visible official sets;
- design the schema for provenance and idempotency, and revalidate server-side at
  approval rather than trusting a returned preview — the DTO is not a signed
  approval token;
- keep `commitFactorImport` out of this path. Do not route a preview into the
  legacy manual importer as a workaround.

# Phase 3-i: UK factor import backend

## Design gate and scope

This phase provides a **read-only, preview-only** import engine. It adds no UI,
routes, Server Actions, dependencies, migrations, or database writes. Existing
manual imports and curated CSVs continue through their unchanged code paths.

The existing `EmissionFactorSet` and `EmissionFactor` models can represent a
reviewed subset of corporate CO2e factors. They cannot safely represent an
arbitrary official dataset:

- Gas is implicitly CO2e; there is no general direct/WTT/total discriminator.
  Known `wtt_*` categories encode specific WTT mappings, not general gas/kind
  provenance. LCA boundary fields do not solve this corporate import problem.
- The unique factor key is `(factorSetId, category, subtypeKey, basis)`, omitting
  unit and region. PostgreSQL also allows repeated NULL subtypes in this key.
- Dataset release, per-row source provenance and deterministic import identity
  have no dedicated durable fields. There is no factor import job model.
- The existing `commitFactorImport` recalculates pending entries and may end a
  previous set's validity period. This engine never calls that commit function.
- Official sets are platform-visible. The existing organisation factor-manage
  permission is sufficient for previews, but a platform publication/approval
  decision is still needed for writes to the shared official library.

Accordingly, the brief's parser + validator + preview fallback applies. No schema
change was attempted. `commitAllowed` is always false, even for a valid file.

## Supported source contract

`parseUkGovFactors(buffer, filename, metadata?)` accepts UTF-8 CSV and XLSX/XLSM
buffers using the existing ExcelJS dependency and shared CSV decoding. XLSM
macros are not executed. File size is limited to 10 MiB and 50,000 records/rows.
The XLSX row limit is checked after ExcelJS loads the workbook; compressed-file
expansion limits/isolated upload processing remain work for a public upload API.

There is **no official workbook in the repository**; the `data/defra-*-import*.csv`
files are already manually mapped extracts. The new adapter supports an explicit
tabular contract tested with synthetic fixtures, not an unverified claim of
compatibility with an official annual workbook. To implement and validate that
adapter, supply the original DESNZ **`2026-full-set.xlsx`** referenced in the
curated 2026 CSVs, with its exact release/version metadata. Other annual formats
need their corresponding source workbooks. No real factors were imported.

Headers may move across columns or appear below preambles, and may repeat for
multiple tables. All sheets are scanned. Required source dimensions are an
activity, category/path, denominator unit and factor value. Recognised headers:

| Meaning | Headers (case, spaces and hyphens normalised) |
| --- | --- |
| Source path | `category_path`, `source_category`, `category` |
| Activity | `activity`, `fuel`, `material`, `travel_mode` |
| Denominator | `unit`, `units`, `uom` |
| Value | `factor_value`, `co2e_factor`, `kgco2e` |
| Gas/kind | `gas`, `gas_basis`, `factor_kind`, `factor_type` |
| Numerator/ratio | `factor_unit` |
| Dataset | `publisher`/`source`, `dataset_year`/`year`, `release`/`version` |
| Explicit application mapping | `factor_category`, `subtype_key`, `scope`, `basis`, `region`/`geography` |
| Notes | `notes` |

`co2e_factor` and `kgco2e` explicitly imply CO2e with a kgCO2e numerator;
generic `factor_value` requires those declarations separately. Factor kind must
always be explicit. `subtype_key` may supply an activity label if `activity` is
absent; display labels are never automatically made into application subtype keys.

Metadata may be supplied by the caller, in table columns, or in explicit
two-cell preamble rows (`Publisher,value`, `Year,value`, `Release,value`).
Missing/conflicting metadata blocks validation. Filenames do not imply metadata;
publisher text is a declaration, not proof that a dataset is official.

Blank rows and repeated headers never become candidates. Notes/totals under a
table are explicitly rejected as non-factor rows with provenance. Unknown sheets
and preamble rows produce import warnings. Duplicate header mappings, malformed
files, formulas (including cached results), merged data cells and Excel errors
fail safely. Merged title rows do not crash the parser. Populated unknown columns
produce row warnings: their meaning cannot safely be discarded. Raw cells and
source fields remain in the DTO, including original units, values and metadata.
CSV source positions are physical start-line numbers, including blank and quoted
multiline records; XLSX positions are worksheet row numbers.

## Normalisation and validation

`normaliseUnit` maps only textual aliases: kWh, kg, tonne, km, mile, m3, litre,
night, passenger.km and tonne.km. It never multiplies values, converts scales,
or strips qualifiers such as Gross/Net CV. Unknown units block validation.
Factor values remain decimal strings: no JavaScript-number rounding and no
silent rounding to the existing `Decimal(18,8)` database field. Explicit zero is
valid; missing, negative, nonnumeric, nonfinite, excessive precision and out-of-range
values are rejected. Negative removal factors are currently unsupported.

Candidates preserve raw category paths, activities, gas and kind. Only explicitly
mapped corporate categories are eligible; unknown mappings and missing regions
remain warnings requiring review. Scope may be derived from an exact known
category, never a guessed source label. Scope 2 requires an explicit compatible
basis. Only CO2e and explicitly mapped direct/WTT kinds can pass; separate gases,
total/lifecycle kinds and contradictory mappings are rejected. A kgCO2e ratio must
match the denominator after textual normalisation. No EMS, LCA, Scope 2,
arithmetic, coverage, report snapshot or obligation logic was changed.

## Duplicate and preview contract

`validateFactorImport(parsed, existingFactors?)` is pure and database-free.
It returns all source rows and candidates plus disjoint `acceptedRows`,
`warningRows`, `rejectedRows`, `duplicateRows`, counts by status/sheet/category/unit,
file hash/name, metadata, scanned sheets/row counts, row/import messages and
`proposedFactorSet`. `validationPassed` means at least one new accepted row with
no blocking errors or row warnings; it does not imply permission to commit or
that all source formats were understood. Import warnings remain visible.

SHA-256 identities use publisher/year/release, source sheet/path/activity,
canonical unit, gas/kind and application mapping dimensions. Position and value
are excluded from the logical identity to detect repeated or conflicting rows.
A separate source hash includes position, cells, fields and value. Repeated
parses are deterministic; equivalent duplicate rows are retained for diagnostics
but excluded from the accepted list. Value/unit/region/activity collisions at
the existing lookup key reject **all** conflicting proposals. A selected existing
dataset is compared using that same lookup key and exact value/unit/scope/region;
legacy gas/kind provenance cannot be reconstructed and this limitation is stated
on equivalent-match messages. No existing factor is overwritten.

The preview DTO is not a signed approval token. `commitAllowed: false` and
`commitBlockedReasons` explain persistence and validation blockers. Database-level
idempotency is not claimed: there is no commit operation in this engine.

## RBAC, tenant boundaries and audit

`previewUkGovFactorImport(context, input)` requires the existing
`carbon.factor.manage` permission **before** any parsing or read. The server must
resolve `OrganisationContext` from the current session. An optional
`existingFactorSetId` is looked up using the existing `visibleFactorSetFilter`:
platform datasets or the caller's own organisation datasets. Foreign/private and
missing datasets return the same generic error. No existing dataset rows, names,
IDs or database internals are copied into the returned preview.

With no selected dataset, previewing performs no database access and explicitly
reports that existing-factor duplicate checking was not performed. Tests mock
Prisma and have no live database access.

Previews are ephemeral, so no `factor_import.previewed` event is written.
Source/file hashes and full row provenance support review but are not durable
audit records. A future persistence design should store provenance and identities,
enforce concurrent import idempotency, revalidate server-side at approval, and use
the existing transactional audit repository for `factor_import.committed`.

## Phase 3-ii handoff

The upload/preview UI can consume this service and DTO. Full official workbook
adaptation requires the source file above. Approve/commit UI must remain disabled
until the gas/kind schema, provenance/idempotency and platform publication
authority decisions are implemented. Do not pass these previews to the legacy
manual importer as a workaround.

## Verification

Focused Vitest checks cover synthetic CSV/XLSX parsing, physical provenance,
malformed/ambiguous input, exact decimal validation, unit aliases, gas/kind/scope
validation, preview counts, deterministic hashes, conflicting duplicates,
existing-factor comparisons, RBAC and scoped dataset reads. The existing factor
import/visibility/resolution, entry idempotency, calculation engine, dashboard,
collection plan and `/data`/`/sources` tests also run without a database.
TypeScript and changed-file ESLint are required before commit.

The existing report-snapshot regression in `tests/board-product/bd08-fixes.test.ts`
requires a disposable PostgreSQL database and performs writes. It was not run;
no live database was needed or accessed for this isolated preview backend.

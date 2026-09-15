# Phase 3-iii: official 2026 flat workbook calibration

## Scope and input

Calibrated locally on 2026-09-15, starting at safety checkpoint `e00f167`, on
`board/product-2026-09-22` for PR #64. This is parser/preview calibration only.
No factor or factor set was persisted, no recalculation ran, and no database,
migration, seed, deployment, alias or production configuration was touched.
`commitAllowed` remains the literal `false`; the Import factors button stays disabled.

Input supplied by the user:
`C:\Users\callum.jackson\Downloads\ghg-conversion-factors-2026-flat-format-revised.xlsx`
(515,426 bytes). SHA-256:
`a9a455ab396dae226d510c7be6233748416d490c41a5d20f3dc7a0c45feecd5e`.
The workbook stays outside the repository. No real factor rows were copied into
fixtures or this document. This validates the **flat format**, not the differently
laid-out full-set workbook or every annual workbook. Local declarations establish
metadata, not independent authentication of the download's provenance.

## Release metadata

| Field | Observed value / handling |
| --- | --- |
| Publisher | `UK Government`, detected from the exact front-page publication title |
| Dataset year | `2026`, independently present on the front page and value header |
| Release/version | `1.2`, detected from the front-page Version labels |
| Format | `Flat file` / `Flat File Data Format`, observed locally |
| Status | `Final`, observed locally |
| Updated date | `2026-07-10`, observed locally; not a substitute for a verified publication date |
| Next publication | June 2027; deliberately not used as this dataset's year |
| Metadata supplied to calibration CLI | None; publisher, year and release were detected |

The revision note says that some unavailable WTT vehicle and hotel factors had
incorrectly been zero and were corrected to blank. The parser retains blanks and
rejects them as `MISSING_VALUE`; it never substitutes zero. Explicit numeric zero
remains valid under the existing rules.

The preview metadata DTO captures publisher/year/release. The file name/hash and
sheet/row/raw fields provide ephemeral provenance. Before persistence, the release
record should also capture the verified source URL, publisher attribution,
format, version, release status, updated date, publication date if verified,
file hash and retrieval timestamp. Format/status/date observations above are
documented calibration evidence, not newly added persistent schema fields.

## Workbook structure and parser changes

| Sheet | Rows scanned | Factor-table support |
| --- | ---: | --- |
| Front page | 24 | No factor table; metadata read separately, structured `UNSUPPORTED_SHEET` warning |
| Factors by Category | 8,748 | Flat table detected at row 6; 8,740 candidate rows |

Headers, in source order: `ID`, `Scope`, `Level 1`, `Level 2`, `Level 3`,
`Level 4`, `Column Text`, `UOM`, `GHG/Unit`, `GHG Conversion Factor 2026`.
Detection uses the complete header signature and a four-digit value-header year,
not a fixed row or column position. That signature's compatibility with other
years has not been calibrated. Ambiguous duplicate headers still block parsing.
Detected header text and row positions are now included in the sheet preview DTO.

The baseline engine returned `PARSE_FAILED` before reading any sheets: ExcelJS
throws on `.text` for an empty merged master on this workbook's front page.
The parser now checks null cell values first. Merged factor-data cells, formulas
(even with cached values), and errors still reject rows. Front-page metadata reads
merged masters once; formula/error metadata is blocked. The adapted parser also
recognises the official headers, which the baseline tabular adapter did not.

Blank rows and repeated headers are skipped; the single-cell `END` marker is
ignored. Notes/headings/totals are skipped before a header or rejected under the
existing non-factor/validation checks. Unrecognised sheets and rows produce
structured messages. The original explicit CSV/XLSX contract remains supported.

Each candidate retains sheet, physical source row, original cell text, source ID,
all four hierarchy levels, Column Text, unit, gas expression and value. Activity
display combines Levels 2–4 and Column Text; category-path display combines
Levels 1–4. These are **source descriptions**, not corporate category mappings.
No application subtype key is generated from a display label.

Identities include the ordered hierarchy positions and Column Text, so fuel,
vehicle load, RF choice, cabin class and other dimensions cannot disappear into
an identical joined label. Source ID remains provenance, not a way to bypass
duplicate checks. Position/value remain outside the logical identity; source
hashes include position, raw cells and values. Conflicts reject all colliding
proposals. Unresolved warnings cannot be hidden by a duplicate status.

The action still caps each group at 100 rows and excludes full `source.cells`
and `source.fields`. Its row DTO additionally carries `rawFactorValue`, `rawGas`
and `rawKind` (the official Level 1 source label, or the explicit tabular kind).
Those fields preserve rejected values and kind evidence without forwarding whole
source rows. The current UI is otherwise unchanged.

## Supported subset and unreviewed tables

The flat **layout** is parsed for every category below. Representation support is
deliberately narrower: only `Fuels` in Scope 1 is classified as direct, and explicit
`WTT-` source categories as WTT. Other boundaries are `UNREVIEWED_FACTOR_KIND` /
`UNSUPPORTED_KIND`; they are not guessed as direct, total or lifecycle.
No corporate category, subtype, region or Scope 2 basis is inferred.

| Source Level 1 | Warning | Rejected |
| --- | ---: | ---: |
| Fuels | 117 | 355 |
| Bioenergy | 0 | 51 |
| Refrigerant & other | 0 | 498 |
| Passenger vehicles | 0 | 864 |
| Delivery vehicles | 0 | 736 |
| SECR kWh pass & delivery vehs | 0 | 438 |
| UK electricity | 0 | 4 |
| UK electricity for EVs | 0 | 304 |
| SECR kWh UK electricity for EVs | 0 | 76 |
| Heat and steam | 0 | 8 |
| WTT- fuels | 114 | 4 |
| WTT- bioenergy | 49 | 2 |
| Transmission and distribution | 0 | 8 |
| UK electricity T&D for EVs | 0 | 304 |
| WTT- UK electricity | 2 | 0 |
| WTT- heat and steam | 3 | 0 |
| Water supply | 0 | 2 |
| Water treatment | 0 | 2 |
| Material use | 0 | 168 |
| Waste disposal | 0 | 294 |
| Business travel- air | 0 | 112 |
| WTT- business travel- air | 28 | 0 |
| Business travel- sea | 0 | 12 |
| WTT- business travel- sea | 3 | 0 |
| Business travel- land | 0 | 912 |
| WTT- pass vehs & travel- land | 168 | 60 |
| Freighting goods | 0 | 1,352 |
| WTT- delivery vehs & freight | 289 | 49 |
| Hotel stay | 0 | 55 |
| Managed assets- electricity | 0 | 4 |
| Managed assets- vehicles | 0 | 1,232 |
| Homeworking | 0 | 3 |
| Outside of scopes | 0 | 58 |

Zero accepted is intentional: even structurally valid CO2e/direct or WTT rows
need reviewed mappings and regions. Warning rows are reviewable source candidates,
not approved factors. Other tables require a reviewed boundary/mapping decision;
SECR tables are energy conversions, and Outside of Scopes is not silently mapped
to Scope 1/2/3. Full-set multi-sheet/wide-gas layouts remain uncalibrated.

## Gas and unit decisions

The `GHG/Unit` column has 3,425 `kg CO2e` entries; 1,639 CO2, 1,581 CH4 and 1,581
N2O contributions expressed as **kg CO2e of that gas per unit**; and 514 kWh
energy-conversion entries. Contributions are already CO2e expressions, not gas
mass. Only exact whole-gas `kg CO2e` is normalised to `CO2e`. Contributions and
energy conversions preserve their raw labels and are rejected. No gas conversion,
summation or selection of a supposedly equivalent column is performed.

The existing factor schema stores one `co2eFactor` and has no corporate gas/kind
discriminator. Known `wtt_*` application categories do not provide general source
provenance. Total/lifecycle rows remain blocked; existing LCA boundary fields are
not repurposed. No schema or migration was created.

All 15 denominator spellings in this file are now recognised. New aliases:

| Raw unit | Canonical preview unit |
| --- | --- |
| kWh (Net CV) | kWh (Net CV) |
| kWh (Gross CV) | kWh (Gross CV) |
| GJ | GJ |
| million litres | million litres |
| Room per night | room.night |
| per FTE Working Hour | FTE.hour |

These are textual aliases only. Net/Gross CV never become plain kWh; million
litres never become litres; room-nights never become unqualified nights. No
mass/volume/energy/distance conversion or factor rescaling is performed. Raw
units remain intact. Unknown spellings still fail. The SECR numerator spelling
`kWh (net)` is not added as a denominator alias. These preview units must not be
passed into factor resolution without a reviewed matching denominator contract.

## Calibration result

| Metric | Count |
| --- | ---: |
| Sheets scanned | 2 |
| Physical rows scanned, including headers/blanks/preambles | 8,772 |
| Candidate rows | 8,740 |
| Accepted | 0 |
| Warning | 773 |
| Rejected | 7,967 |
| Duplicate | 0 |
| Conflicting rows | 0 |

Top row-level reasons (overlap; do not sum these as rows):

| Code | Rows |
| --- | ---: |
| MAPPING_REQUIRED | 8,740 |
| MISSING_REGION | 8,740 |
| UNREVIEWED_FACTOR_KIND / UNSUPPORTED_KIND | 7,497 each |
| UNSUPPORTED_GAS / UNSUPPORTED_FACTOR_UNIT | 5,315 each |
| MISSING_VALUE | 1,705 |
| NOT_EMISSION_FACTOR | 514 |
| AMBIGUOUS_BASIS | 392 |
| INVALID_VALUE | 70 |
| INVALID_SCOPE | 58 |

The 70 invalid nonblank values exceed eight decimal places (42 with 10 places,
4 with 17, 12 with 21, 12 with 22 as read by ExcelJS). They remain rejected;
the `Decimal(18,8)` rule was not relaxed and no rounding was introduced.
Workbook numeric text here means ExcelJS's cell text; it is not a claim to preserve
the underlying OOXML numeric lexeme or Excel's formatted display string. Exact
numeric ingestion/storage needs an explicit decision before persistence.

File-level messages now summarise unsupported gas/kind, missing values, unknown
units and mapping counts where present, alongside sheet/preamble messages and
`EXISTING_DATASET_NOT_CHECKED`. Existing-factor comparisons were not run against
any database. `validationPassed: false`; `commitAllowed: false`.

## Reproduction and verification

Files changed in this phase:

- `src/lib/factors/import/parse-uk-gov-factors.ts`
- `src/lib/factors/import/normalise-factor-row.ts`
- `src/lib/factors/import/validate-factor-import.ts`
- `src/lib/factors/import/types.ts`
- `src/app/(app)/admin/factors/import/actions.ts`
- `src/lib/factors/import/__tests__/official-flat-format.test.ts`
- `src/lib/factors/import/__tests__/uk-gov-import.test.ts`
- `scripts/factors/calibrate-uk-gov-workbook.ts`
- `Docs/PHASE3_III_OFFICIAL_WORKBOOK_CALIBRATION.md`
- `Docs/PHASE3_I_FACTOR_IMPORT.md`
- `Docs/PHASE3_II_FACTOR_IMPORT_UI.md`

Run the database-free CLI with a local path (output is metadata/counts only):

```powershell
node node_modules/tsx/dist/cli.mjs scripts/factors/calibrate-uk-gov-workbook.ts 'C:\path\ghg-conversion-factors-2026-flat-format-revised.xlsx'
```

Synthetic tests cover moved/reordered/repeated official headers, empty merged
front-page cells, metadata conflicts, physical provenance, notes/totals, formulas,
every added unit alias, distinct CV/scale units, blanks and invalid decimals,
CO2/CH4/N2O contributions, WTT/direct/unreviewed boundaries, energy conversions,
hierarchy/Column Text identities, duplicates/conflicts, and the real preview action
with database/persistence/recalculation access mocked to throw.

Focused parser/service/fixture and Phase 3-ii action/UI regression: **122 tests
passed across 6 files**. TypeScript `tsc --noEmit` and ESLint on changed TypeScript
files passed. Local `next build` passed, including the dynamic import route. It
emitted two NextAuth `UntrustedHost` diagnostics for `https://null/api/auth/session`
during static generation; these did not fail the build. No deployment was made.
All test/build database URL variants are set to an unreachable local endpoint.
The full suite and database-dependent tests are unnecessary for this scope.

## Persistence remains blocked

- Review exact corporate category/subtype, activity-unit and region mappings.
- Define corporate gas and emissions-boundary storage, including CO2e contributions,
  total/lifecycle and WTT; do not borrow LCA semantics or change Scope 2 methodology.
- Resolve all unavailable values, unsupported rows and precision decisions; absence
  remains absence, never zero. Complete Scope 2 basis and RF/boundary review.
- Add durable release identity and per-row provenance, including source dimensions,
  file/row hashes and raw values. The current factor key omits unit/region/gas/kind;
  nullable subtype uniqueness is also insufficient for concurrent idempotency.
- Design transactional duplicate protection and server-side approval revalidation.
- Decide platform publication authority and the missing production role-template
  grant for `carbon.factor.manage` noted in Phase 3-ii.
- Keep preview separate from the legacy importer and its recalculation side effects.

Production still lacks migration `20260914160000_add_carbon_collection_requirement`.
Do not promote this branch or merge PR #64 as part of this phase.

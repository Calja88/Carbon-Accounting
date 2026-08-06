# Paragon ID UK — Carbon Reporting Platform

A web platform for Paragon ID UK (Paragon ID, RFID Discovery, Thames Technology) to enter
Scope 1, Scope 2 and (as of v2) part of Scope 3 activity data through plain-English guided
forms, have emissions calculated automatically against the Group's carbon methodology, and
generate a combined GHG report — without the user needing to know what a "scope" or
"emission factor" is.

Built against `Paragon_ID_UK_Carbon_Methodology_v0.1.docx` (the rule set) and
`Paragon_ID_UK_Data_Requirements_Map.xlsx` (the literal data-entry spec), per
`CLAUDE_CODE_BRIEF.md`.

- **MVP**: Scope 1 + Scope 2 data entry, calculation, and a single combined report.
- **v2** (this build): Scope 3 Categories 1 (purchased goods & services, spend-based), 3
  (fuel/energy-related, auto-derived), 6 (business travel) and 7 (employee commuting,
  survey-based) — the four categories the data map tags "Phase 1 build" — plus a real
  emission-factor import mechanism (Part B, below) to replace the MVP's placeholder
  factors. Scope 3 Categories 2/4/5/8/9 and base-year comparison and multi-entity report
  splitting are deliberately not built yet (see "What's not built" below).

## Tech stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (TypeScript, App Router), single deployable |
| Database | PostgreSQL |
| ORM | Prisma |
| Auth | NextAuth (Credentials provider), JWT sessions, roles modelled on methodology Section 15 |
| Validation | Zod |
| UI | Tailwind CSS, hand-rolled primitives in `src/components/ui` |
| Spreadsheet parsing | ExcelJS (`.xlsx`/`.xlsm` factor imports), a small hand-rolled CSV parser |
| Tests | Vitest, covering the calculation engine, unit conversion, plausibility, commuting-survey math, Cat 3 well-to-tank/T&D mapping and factor-import validation |

## Schema

`entities → sites → activity data points (catalog) → activity entries → calculations → report snapshots`

- **Entity / Site** — Paragon ID, RFID Discovery, Thames Technology, each with sites, consolidated under operational control.
- **ActivityDataPoint** — one row per Data Requirements Map row (`S1-01`…`S1-05`, `S2-01`…`S2-04`, `S3-01`, `S3-06`, `S3-07`). Forms are *rendered from this table*, including the verbatim "Plain-English Prompt" — adding more Scope 3 categories later is a data change, not a rebuild. `scope3Category` labels which GHG Protocol category a row belongs to. `S3-03` (Cat 3) has no row here — it's a calculation, not a form (see below).
- **FactorOption** — the fuel/vehicle/refrigerant/travel-mode/commuting-mode choices for data points that need one. `unit` optionally overrides the data point's unit per-option (business travel: miles for rail/flights, nights for hotel).
- **EmissionFactorSet / EmissionFactor** — versioned, never edited in place. A new year's DEFRA/DESNZ factors are a new set, not an overwrite, so historical reports stay reproducible. `sourceType` (`OFFICIAL_DEFRA_DESNZ` / `EEIO_SPEND_BASED` / `SUPPLIER_SPECIFIC`) lets more than one live source exist per category — see "Emission factor import" below.
- **SiteEnergyContract** — supplier/tariff/REGO info per site (Data Map rows `S2-02`/`S2-03`), feeding the Scope 2 market-based calculation.
- **ActivityEntry** — one user submission: raw + canonical value/unit, data-quality tier, plausibility flag, `enteredBy`/`enteredAt`. `supplierName` (Cat 1 only) is matched against a `SUPPLIER_SPECIFIC` factor set.
- **CommutingSurvey / CommutingSurveyResponse** — Cat 7's survey header (headcount, commuting days) and per-mode responses (% of headcount, average one-way distance). Each response becomes a normal `ActivityEntry` + `Calculation`, so it goes through the same pipeline as everything else.
- **Calculation** — one row per emission figure (Scope 2 electricity produces two: location-based and market-based). The factor value, unit, source and vintage are **snapshotted onto the row itself**, not just referenced by foreign key, so the audit trail is self-contained even if the factor catalog changes later. `scope3Category` groups Scope 3 totals by category. `derivedFromCalculationId` links a Cat 3 (well-to-tank/T&D-losses) row back to the Scope 1/2 calculation it was derived from — unique, so re-running the derivation is idempotent.
- **ReportSnapshot / ReportSnapshotCalculation** — append-only. Every "Generate report" click creates a new immutable snapshot with its own frozen payload and its own link to the exact calculations included.

## Getting started

```bash
cp .env.example .env        # point DATABASE_URL at your Postgres instance
npm install
npx prisma migrate dev      # creates the schema
npm run db:seed             # loads entities/sites/users/data-point catalog/Scope 1-2 placeholder factors
npm run dev                 # http://localhost:3000
```

`db:seed` seeds the full Scope 1/2/3 activity data point catalog, but **no Scope 3 emission
factors** — Cat 1, 6 and 7 entries will save fine but show "awaiting emission factor" until
a real factor set is imported (see "Emission factor import" below). This is deliberate, not
a bug — see Assumption 20.

Other commands: `npm test` (Vitest), `npm run build`, `npm run lint`.

`postinstall` runs `prisma generate` automatically after `npm install` — required so `@prisma/client` has typed models. If a build ever complains that `@prisma/client` "has no exported member", that step didn't run; re-check `package.json#scripts.postinstall`.

### Deploying (e.g. Vercel)

1. Provision a reachable Postgres instance (Vercel Postgres, Neon, Supabase, RDS, etc.) — Vercel does not provide one by default.
2. Set environment variables in the project settings: `DATABASE_URL`, `NEXTAUTH_SECRET` (a real random value, not the dev placeholder), `NEXTAUTH_URL` (your deployed URL). These must be available at **build** time, not just runtime — see below.
3. Make sure the Vercel project's **Production Branch** setting actually matches the branch you're deploying (Settings → Git). Vercel serves the production domain from whatever that setting names, defaulting to `main` — if your work is on a differently-named branch and `main` doesn't exist in the repo, the production domain will serve a stale/unrelated deployment instead of your app.
4. Deploy. `npm run build` now runs `prisma migrate deploy` before `next build` (and `postinstall` already runs `prisma generate` after `npm install`), so every deploy applies any pending schema migrations automatically — `DATABASE_URL` must be reachable and set at build time for this to succeed.
5. Seed it once: `npm run db:seed` (idempotent — safe to re-run) from a machine that can reach the database directly. This isn't run automatically on every deploy, since it isn't needed after the first time. Either use the seeded demo accounts below, or copy that pattern to create real accounts and remove/rotate the demo ones before real use.

### Demo accounts

Seeded with password `ChangeMe123!` (change before any real use):

- `admin@paragon-id.example` — Admin
- `sustainability.lead@paragon-id.example` — Sustainability lead
- `data.owner@paragon-id.example` — Data owner
- `finance@paragon-id.example` — Finance

## Emission factor import (v2, Part B)

The MVP seeded placeholder Scope 1/2 factors from code (`prisma/seed/emission-factors.ts`,
still labelled `isPlaceholder: true` and shown as "(PLACEHOLDER — not verified)" in every
report). v2 does **not** extend that pattern to Scope 3 — no Scope 3 factor value is
hardcoded or guessed anywhere in this codebase (see Assumption 20). Instead, an Admin-only
UI at **Emission factors** (`/admin/factors`) lets a real published factor file be loaded
in, following the same "never edit in place, new set per vintage" design as the rest of the
schema.

**How it works:**

1. Download the CSV template from the admin page (or `/api/admin/factor-template.csv`) —
   columns `scope, factor_category, subtype_key, basis, region, unit, co2e_factor, notes`.
2. Fill it in with real figures from an accredited source (or `.xlsx` in the same column
   layout) — see Assumption 22 for why this is a template *we* define rather than a direct
   parser for the DESNZ workbook's own layout.
3. Upload it along with set metadata (name, publisher, source type, vintage year, effective
   dates). Every row is validated before anything is committed — a single bad row blocks
   the whole import, so nothing partial or malformed ever reaches a report.
4. On success, a new `EmissionFactorSet` + its `EmissionFactor` rows are created in one
   transaction, and any activity entries stuck at "awaiting emission factor" are
   automatically recalculated.

**Multi-source resolution** (methodology Section 7), tried in order, per category:

1. `SUPPLIER_SPECIFIC` — if the entry names a supplier (Cat 1 only) and a factor set exists
   for that exact supplier name, it's used, at Tier 1 (highest quality).
2. `OFFICIAL_DEFRA_DESNZ` — the primary source, used for everything by default.
3. `EEIO_SPEND_BASED` — fallback for Cat 1/2 spend-based entries when no official DEFRA
   figure exists for that category (DEFRA's own workbook doesn't publish spend-based EEIO
   factors).

If none of the three has a matching factor, the entry is saved (never lost) with status
`AWAITING_FACTOR` and is disclosed in reports as "awaiting emission factor" rather than
silently excluded or estimated.

## What's not built (by design, per the brief's phased plan)

- Scope 3 Categories 2, 4, 5, 8, 9 (v3) and 10/13/14/15 (screened "not material") — only the
  four "Phase 1 build" categories (1, 3, 6, 7) are built in v2.
- Base year setting, recalculation policy, and year-on-year comparison — a base year can't be set until a first complete inventory exists.
- Multi-entity report splitting — every entry is already tagged by entity and site, but the platform only produces one combined Group report.
- ISO 14064-1 assurance-readiness mapping — methodology Section 12 is itself a placeholder pending Paragon's internal checklist.
- Bulk/CSV import of *activity data* — guided per-entry forms are the only entry path for now, per the brief's "not a spreadsheet upload as the primary path." (Bulk import of *emission factors* is what Part B above adds — a different thing.)
- Automatic parsing of the real DESNZ workbook's native tab/column layout — the import mechanism uses our own canonical template instead; see Assumption 22.
- Supplier product-carbon-footprint data collection (data map row S3-01b, per-unit rather than per-£) — tagged "Later" in the data map.

## Assumptions and open items — flagged, not silently resolved

1. **Emission factor values are placeholders.** No live DEFRA/DESNZ "GHG Conversion Factors for Company Reporting" file was supplied. `prisma/seed/emission-factors.ts` seeds representative, publicly-known UK factor magnitudes so the engine and audit trail work end-to-end — every one is labelled `isPlaceholder: true` and shows "(PLACEHOLDER — not verified)" in every report and audit export it touches. Replace this file's contents (or add a new `EmissionFactorSet`) with an actual official import before any real reporting.
2. **Natural gas m³→kWh conversion** (`src/lib/units.ts`) uses standard UK national-average constants (volume correction factor 1.02264, calorific value 39.5 MJ/m³) — actual values vary by region/supplier and aren't in either source document.
3. **S2-04 (district heat/steam)** is built even though the data map itself tags it "Later" build priority — the task instructions said build every Scope 1/2 data point, so that instruction took precedence over the sheet's own tag. Flagging the conflict rather than silently resolving it either way.
4. **Only electricity gets true dual (location/market) reporting.** Both source documents describe the supplier/REGO mechanism only for electricity; heat/steam (S2-04) is calculated as a single standard figure and rolled into the Scope 2 total, since no market-based instrument mechanism for purchased heat is described anywhere in the methodology or data map.
5. **Zero-rated market-based factor for REGO/green-tariff sites** is a simplification (`src/lib/entries-service.ts` / seed factors) — a real implementation should use the supplier's actual residual/product-specific factor once available, not a flat zero.
6. **Plausibility threshold (300%)** (`src/lib/plausibility.ts`) is the methodology's one illustrative example ("a site's electricity use that jumps 300% month-on-month"), not a confirmed Group policy — kept as a configurable default. Note also that a *decrease* can never exceed -100%, so this default can only ever fire on increases; a smaller threshold is needed to catch sharp drops.
7. **Real per-user authentication** was added — neither source document specifies an auth model, but the audit trail's "entered-by"/"calculated-by" requirement is meaningless without individually attributable logins. Confirmed with the requester before building.
8. ~~The site register is illustrative, not real.~~ **Resolved.** The Group confirmed the real site register: Paragon ID → Hull, RFID Discovery → Milton Keynes, Thames Technology → Rayleigh, one site per entity (`prisma/seed/index.ts`). There's still no admin UI to manage sites — a schema/site-list change is still a database edit, not a self-serve action.
9. **Grey fleet mileage (S1-04)** is still collected per site even though its own prompt sentence doesn't contain a `[site]` token (unlike every other Scope 1/2 row) — per the brief's own design principle ("one guided form per activity data point, per site, per period"), every entry is site-tagged regardless of whether an individual sentence repeats it.
10. **"[Reading fleet]" in the S1-03 prompt** is a worked example baked into the sheet, not a generic token — generalised to "{site name} fleet" for every other site.
11. **Grey fleet per-mile factors and the generic "other/unlisted refrigerant" GWP** are representative approximations, not sourced from a specific current DEFRA table — same placeholder caveat as (1).
12. **Data-quality tier % in reports is weighted against Scope 1 + Scope 2 location-based only** (`src/lib/report-service.ts`), so a Scope 2 entry's market-based duplicate figure isn't counted twice in the data-quality summary. Neither source document specifies this explicitly; it's the reading that avoids double-counting.
13. **Flagged (plausibility-failed) entries are excluded from report totals** until someone resolves them, and listed separately as "excluded pending review" — an interpretation of "flagged for review before it's accepted into a report" (brief 3.1), since neither document says explicitly whether flagged data should be included with a caveat or excluded outright.
14. **No carbon jargon in on-screen section headers**, not just the prompts themselves — e.g. the site page groups forms under "Facilities, vehicles & refrigerants" / "Electricity & purchased energy" rather than "Scope 1" / "Scope 2". The technical framing is still available via each item's "Why are we asking this?" tooltip.
15. **Operational control boundary, Scope 3 materiality screening, and base year** are all explicitly unconfirmed per the methodology's own amber-box flags (Sections 3, 6, 11) — the report page labels the boundary approach "recommended, not yet formally confirmed" rather than presenting it as settled.

### v2 additions

16. **Cat 1 spend categories are illustrative** (components & electronics, packaging, IT & software, professional services, other) — not confirmed against Paragon's actual chart of accounts. Same caveat as the illustrative site register (8).
17. **S3-06 business travel is recorded by distance (km for rail/flights, nights for hotel) or nights, not by "journeys"**, despite the data map's Format/Unit column literally saying "Journeys/nights by mode." DEFRA's published business-travel factors are per passenger-km (or per-night for hotels) — a "journey" alone has no fixed emissions figure without a distance. Distance is recorded in km rather than miles specifically because DEFRA/DESNZ's own 2026 file publishes rail/bus/flight factors natively as `passenger.km` with no miles column, so km avoids a manual unit conversion between the recorded activity and the published factor. This is a deliberate deviation from the sheet's literal unit label to keep the calculation defensible, not a silent reinterpretation.
18. **S3-07 commuting extrapolation formula** — `headcount × (% of headcount using a mode) × average one-way distance × 2 (round trip) × commuting days in the period` — is our interpretation of "survey-based, extrapolated across headcount" (methodology Section 9). Neither source document specifies an extrapolation formula or a default commuting-frequency figure, so `commutingDaysInPeriod` is always entered by whoever runs the survey, never assumed by the platform.
19. **No plausibility check runs on commuting-survey-derived entries** — they're computed, extrapolated figures rather than directly metered/invoiced ones, so a period-on-period jump doesn't carry the same "something's wrong with this bill" signal the check is designed to catch. Unlike (6), this isn't a tunable threshold question — plausibility checking simply doesn't apply to this data type.
20. **No Scope 3 emission factor values are seeded as placeholders**, unlike Scope 1/2 in the MVP (1). The instruction for this build was explicit: don't hardcode or generate factor values from our own knowledge — a wrong figure silently corrupts every report built on it, and that risk is if anything higher for Scope 3's inherently more approximate methods (spend-based, survey-based) than for Scope 1/2's metered ones. Every Scope 3 category — including the auto-derived Cat 3 well-to-tank/T&D-losses figures — shows nothing until a real factor set is imported (see "Emission factor import" above); activity data collected before then is never lost, just held as `AWAITING_FACTOR` and disclosed in reports rather than silently dropped or estimated.
21. **Supplier-specific factor overrides (Cat 1) are £-per-spend intensity figures scoped to a named supplier**, loaded through the same admin import mechanism as any other factor set (`sourceType: SUPPLIER_SPECIFIC`) rather than a bespoke per-supplier UI. An optional "Supplier name" field on the Cat 1 entry form is matched against these at calculation time. Full supplier product-carbon-footprint data collection (data map row S3-01b, priced per-unit rather than per-£) is out of scope for this build — it's tagged "Later" in the data map itself.
22. **The emission factor import mechanism uses a canonical CSV/XLSX template we define**, not a parser for the real DESNZ "GHG Conversion Factors for Company Reporting" workbook's own tab/column layout — that file's precise current-year structure wasn't supplied to build and verify a parser against, and guessing at it risked silently misreading a column, which is exactly the failure mode Part B exists to prevent. Both `.csv` and `.xlsx` are accepted as containers for our template; mapping the real DESNZ file's rows into that template is currently a manual step for whoever uploads it. Auto-detecting the DESNZ file's native layout is a reasonable v3 follow-up once a real copy of the file is available to test against.
23. **Cat 3 (fuel/energy-related activities) only derives a well-to-tank/T&D-losses companion for categories with one** — stationary/mobile combustion fuel and grid electricity (location-based only, so the Scope 2 market-based duplicate doesn't also generate one). Refrigerant top-ups and purchased heat/steam have no WTT/T&D companion in this build, since neither source document describes an upstream-emissions mechanism for either.
24. **Materiality screening (methodology Section 6) still applies** — this build only implements the four categories explicitly tagged "Phase 1 build" (1, 3, 6, 7); Categories 2, 4, 5, 8, 9 remain unbuilt pending v3, and 10/13/14/15 remain excluded as "not material" per the brief, unchanged from the MVP.

### Real DESNZ import — three vintages (post-v2)

The live factor sets now loaded are real imports, not placeholders — no `isPlaceholder: true` set exists in the live database any more:

- **Scope 1, Scope 2, and Cat 3/6/7 (Scope 3)**: the official **"Greenhouse gas reporting: conversion factors"** publication, sourced from the **"full set (for advanced users)"** workbook for each of **2024, 2025 and 2026** ([gov.uk](https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting)) — three separate `OFFICIAL_DEFRA_DESNZ` `EmissionFactorSet`s with non-overlapping `effectiveFrom`/`effectiveTo` windows (2024 covers Jan-Dec 2024, 2025 covers Jan-Dec 2025, 2026 is open-ended/current), so a report generated against any of those years' activity data uses the emission factors that were actually current for that year, not always the latest ones. Every value's exact source location (sheet/Activity/Type/Unit) is recorded in `data/defra-desnz-2024-import.csv`, `-2025-`, and `-2026-import.csv` — nothing hand-typed from memory. (An earlier pass sourced 2026 from DESNZ's alternative "flat format" file instead; re-extracting from the "full set" workbook the Group actually supplied reproduced the exact same 40 values, cross-checked line by line, before the flat-format-derived set was deleted and replaced.)
- **Cat 1 (purchased goods & services)**: Defra/University of Leeds' spend-based multipliers, in `data/defra-spend-based-eeio-2023-import.csv` — see Assumptions #29-30 for source and mapping detail. DESNZ's own file (any year) has no spend-based data at all, confirmed by inspecting its full category list each time.

All were committed via `commitFactorImport` (the same function the admin upload UI calls) run from a script rather than clicked through the browser, since this sandbox can only reach the database over the same HTTPS-only path used for seeding — not because the UI doesn't work. A few further judgment calls surfaced while doing this real import, flagged the same way as everything above:

25. **Hotel stay uses DEFRA's "UK" factor (10.4 kgCO2e/room/night) regardless of actual destination.** The DESNZ file publishes a per-country hotel figure (150+ countries), but our S3-06 form doesn't collect a destination country — it's a single "Hotel stay" line. Using the UK figure for every stay understates the true footprint of international hotel stays; collecting destination country is a reasonable small follow-up, not built here.
26. **No UK residual-mix electricity factor exists in the DESNZ file** — the UK's market-based residual mix is published separately by AIB (Association of Issuing Bodies), not DESNZ, and wasn't sourced for this import. The `RESIDUAL_MIX` basis (used for sites with no REGO/green tariff) currently reuses the same location-based grid-average figure (0.13096 kgCO2e/kWh) as a stated simplification — meaning, until a real residual-mix figure is imported, market-based and location-based Scope 2 will show the same number for any site without a green/REGO instrument. This is disclosed in that factor row's own `notes`, not silent.
27. **"Other / unlisted refrigerant blend" has no factor imported** — DEFRA doesn't publish a generic "other blend" GWP (it can't; GWP is blend-specific), so entries using S1-05's "Other / blend not listed" option will show "awaiting emission factor" until the specific refrigerant is identified and its real GWP imported. This is a genuine data gap, not a bug — the previous MVP placeholder (a made-up "generic average" of 2000) has been retired rather than carried forward, per instruction 6.
28. **Cycling/walking and work-from-home commuting modes are seeded at 0 kgCO2e, but that 0 is a logical fact, not a DEFRA lookup** — a mode with no fuel or grid draw has no emissions to look up. Flagged so it doesn't read as an accidental placeholder.
29. **Cat 1 now uses a real Defra spend-based dataset, sourced separately from the main DESNZ file** — confirmed by inspecting its full category list, the DESNZ 2026 file contains no spend-based/EEIO factors at all (that's a different publication). The real source is Defra/University of Leeds' **"Spend-based emissions multipliers, 1997 to 2023"** (part of the "UK and England's carbon footprint to 2023" publication, [gov.uk](https://www.gov.uk/government/statistics/uks-carbon-footprint)), sheet `GHG_SIC_multipliers`, 2023 column (kgCO2e per £, current prices) — the most recent year Defra has published; this dataset runs 2-3 years behind the annual conversion factors because it's derived from national accounts input-output modelling, and Defra/Leeds note a methodology change is planned from 2027. It's loaded as its own `EEIO_SPEND_BASED` set (`data/defra-spend-based-eeio-2023-import.csv`), separate from the `OFFICIAL_DEFRA_DESNZ` set, exactly matching the fallback-source design in "Emission factor import" above.
30. **Cat 1's five illustrative spend categories are mapped onto specific SIC codes as a judgment call**, since Defra's SIC-based multipliers don't align 1:1 with this platform's buckets: components & electronics → SIC 26 "Computer, electronic and optical products" (0.536 kgCO2e/£); packaging → SIC 17 "Paper and paper products" (0.669 kgCO2e/£) as the closest single-category proxy (there's no dedicated "packaging" SIC code — plastic packaging, SIC 22 at 0.644, is a close alternative); IT & software → SIC 62 "Computer programming, consultancy and related services" (0.100 kgCO2e/£); professional & other services → SIC 74 "Other professional, scientific and technical services" (0.126 kgCO2e/£); "other purchased goods & services" → the unweighted average across all 112 published SIC categories in the same 2023 column (0.496 kgCO2e/£) — a derived catch-all, not itself a single Defra-published line, used only because a genuinely unclassifiable spend line needs *something* rather than silently having no factor at all.

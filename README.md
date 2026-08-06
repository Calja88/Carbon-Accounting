# Paragon ID UK — Carbon Reporting Platform (MVP)

A web platform for Paragon ID UK (Paragon ID, RFID Discovery, Thames Technology) to enter
Scope 1 and Scope 2 activity data through plain-English guided forms, have emissions
calculated automatically against the Group's carbon methodology, and generate a combined
GHG report — without the user needing to know what a "scope" or "emission factor" is.

Built against `Paragon_ID_UK_Carbon_Methodology_v0.1.docx` (the rule set) and
`Paragon_ID_UK_Data_Requirements_Map.xlsx` (the literal data-entry spec), per
`CLAUDE_CODE_BRIEF.md`. This is the **MVP phase only**: Scope 1 + Scope 2 data entry,
calculation, and a single combined report. Scope 3, base-year comparison, and multi-entity
report splitting are deliberately not built yet (see "What's not built" below).

## Tech stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (TypeScript, App Router), single deployable |
| Database | PostgreSQL |
| ORM | Prisma |
| Auth | NextAuth (Credentials provider), JWT sessions, roles modelled on methodology Section 15 |
| Validation | Zod |
| UI | Tailwind CSS, hand-rolled primitives in `src/components/ui` |
| Tests | Vitest, covering the calculation engine, unit conversion and plausibility logic |

## Schema

`entities → sites → activity data points (catalog) → activity entries → calculations → report snapshots`

- **Entity / Site** — Paragon ID, RFID Discovery, Thames Technology, each with sites, consolidated under operational control.
- **ActivityDataPoint** — one row per Data Requirements Map row (`S1-01`…`S1-05`, `S2-01`…`S2-04`). Forms are *rendered from this table*, including the verbatim "Plain-English Prompt" — adding Scope 3 later is a data change, not a rebuild.
- **FactorOption** — the fuel/vehicle/refrigerant type choices for data points that need one.
- **EmissionFactorSet / EmissionFactor** — versioned, never edited in place. A new year's DEFRA/DESNZ factors are a new set, not an overwrite, so historical reports stay reproducible.
- **SiteEnergyContract** — supplier/tariff/REGO info per site (Data Map rows `S2-02`/`S2-03`), feeding the Scope 2 market-based calculation.
- **ActivityEntry** — one user submission: raw + canonical value/unit, data-quality tier, plausibility flag, `enteredBy`/`enteredAt`.
- **Calculation** — one row per emission figure (Scope 2 electricity produces two: location-based and market-based). The factor value, unit, source and vintage are **snapshotted onto the row itself**, not just referenced by foreign key, so the audit trail is self-contained even if the factor catalog changes later.
- **ReportSnapshot / ReportSnapshotCalculation** — append-only. Every "Generate report" click creates a new immutable snapshot with its own frozen payload and its own link to the exact calculations included.

## Getting started

```bash
cp .env.example .env        # point DATABASE_URL at your Postgres instance
npm install
npx prisma migrate dev      # creates the schema
npm run db:seed             # loads entities/sites/users/data-point catalog/placeholder factors
npm run dev                 # http://localhost:3000
```

Other commands: `npm test` (Vitest), `npm run build`, `npm run lint`.

### Demo accounts

Seeded with password `ChangeMe123!` (change before any real use):

- `admin@paragon-id.example` — Admin
- `sustainability.lead@paragon-id.example` — Sustainability lead
- `data.owner@paragon-id.example` — Data owner
- `finance@paragon-id.example` — Finance

## What's not built (by design, per the brief's phased plan)

- Scope 3 (any category, including the auto-derived Category 3) — v2.
- Base year setting, recalculation policy, and year-on-year comparison — a base year can't be set until a first complete inventory exists.
- Multi-entity report splitting — every entry is already tagged by entity and site, but the MVP only produces one combined Group report.
- ISO 14064-1 assurance-readiness mapping — methodology Section 12 is itself a placeholder pending Paragon's internal checklist.
- Bulk/CSV import — guided per-entry forms are the only entry path for now, per the brief's "not a spreadsheet upload as the primary path."

## Assumptions and open items — flagged, not silently resolved

1. **Emission factor values are placeholders.** No live DEFRA/DESNZ "GHG Conversion Factors for Company Reporting" file was supplied. `prisma/seed/emission-factors.ts` seeds representative, publicly-known UK factor magnitudes so the engine and audit trail work end-to-end — every one is labelled `isPlaceholder: true` and shows "(PLACEHOLDER — not verified)" in every report and audit export it touches. Replace this file's contents (or add a new `EmissionFactorSet`) with an actual official import before any real reporting.
2. **Natural gas m³→kWh conversion** (`src/lib/units.ts`) uses standard UK national-average constants (volume correction factor 1.02264, calorific value 39.5 MJ/m³) — actual values vary by region/supplier and aren't in either source document.
3. **S2-04 (district heat/steam)** is built even though the data map itself tags it "Later" build priority — the task instructions said build every Scope 1/2 data point, so that instruction took precedence over the sheet's own tag. Flagging the conflict rather than silently resolving it either way.
4. **Only electricity gets true dual (location/market) reporting.** Both source documents describe the supplier/REGO mechanism only for electricity; heat/steam (S2-04) is calculated as a single standard figure and rolled into the Scope 2 total, since no market-based instrument mechanism for purchased heat is described anywhere in the methodology or data map.
5. **Zero-rated market-based factor for REGO/green-tariff sites** is a simplification (`src/lib/entries-service.ts` / seed factors) — a real implementation should use the supplier's actual residual/product-specific factor once available, not a flat zero.
6. **Plausibility threshold (300%)** (`src/lib/plausibility.ts`) is the methodology's one illustrative example ("a site's electricity use that jumps 300% month-on-month"), not a confirmed Group policy — kept as a configurable default. Note also that a *decrease* can never exceed -100%, so this default can only ever fire on increases; a smaller threshold is needed to catch sharp drops.
7. **Real per-user authentication** was added — neither source document specifies an auth model, but the audit trail's "entered-by"/"calculated-by" requirement is meaningless without individually attributable logins. Confirmed with the requester before building.
8. **The site register is illustrative, not real.** Neither source document lists Paragon ID UK's actual sites — the four seeded sites are drawn from incidental worked examples in the methodology/data map (e.g. "Reading depot", "Thames Technology — Slough site"). Replace via the database before any real use; there's no admin UI to manage sites yet.
9. **Grey fleet mileage (S1-04)** is still collected per site even though its own prompt sentence doesn't contain a `[site]` token (unlike every other Scope 1/2 row) — per the brief's own design principle ("one guided form per activity data point, per site, per period"), every entry is site-tagged regardless of whether an individual sentence repeats it.
10. **"[Reading fleet]" in the S1-03 prompt** is a worked example baked into the sheet, not a generic token — generalised to "{site name} fleet" for every other site.
11. **Grey fleet per-mile factors and the generic "other/unlisted refrigerant" GWP** are representative approximations, not sourced from a specific current DEFRA table — same placeholder caveat as (1).
12. **Data-quality tier % in reports is weighted against Scope 1 + Scope 2 location-based only** (`src/lib/report-service.ts`), so a Scope 2 entry's market-based duplicate figure isn't counted twice in the data-quality summary. Neither source document specifies this explicitly; it's the reading that avoids double-counting.
13. **Flagged (plausibility-failed) entries are excluded from report totals** until someone resolves them, and listed separately as "excluded pending review" — an interpretation of "flagged for review before it's accepted into a report" (brief 3.1), since neither document says explicitly whether flagged data should be included with a caveat or excluded outright.
14. **No carbon jargon in on-screen section headers**, not just the prompts themselves — e.g. the site page groups forms under "Facilities, vehicles & refrigerants" / "Electricity & purchased energy" rather than "Scope 1" / "Scope 2". The technical framing is still available via each item's "Why are we asking this?" tooltip.
15. **Operational control boundary, Scope 3 materiality screening, and base year** are all explicitly unconfirmed per the methodology's own amber-box flags (Sections 3, 6, 11) — the report page labels the boundary approach "recommended, not yet formally confirmed" rather than presenting it as settled.

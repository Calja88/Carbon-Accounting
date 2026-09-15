# LCA demo sprint — product footprint workflow, end to end

Scope: make the **existing** product LCA capability demonstrable as one coherent journey. No new engine, no architecture change, no Brightway/openLCA/ecoinvent work, nothing from Carbon Phase 4-ii.

## What already existed (and was reused, not rebuilt)

The LCA module was substantially complete before this sprint — roughly 6,000 lines of service/engine code and 9,000 lines of UI across 40 route files. Reused as-is:

| Capability | Where |
| --- | --- |
| Decimal engine: activity × factor, unit conversion, allocation, waste/recycled content, biogenic and removals classes, per-functional-unit division | `src/lib/lca/engine/` |
| Product → version → assessment model, deep clone for scenarios and revisions | `src/lib/lca/assessment-service.ts` |
| Processes, inventory lines, factor assignment, transport legs, end-of-life routes | `src/lib/lca/model-service.ts` |
| Contribution analysis: by stage, process, material, supplier, line; hotspots; sensitivity; scenario comparison | `src/lib/lca/analysis.ts` |
| Validation (error/warning/advisory) and verification-readiness by area | `src/lib/lca/validation-service.ts`, `readiness-service.ts` |
| Assumptions, exclusions, verification and corporate-link registers | `src/lib/lca/registers-service.ts` |
| Evidence with real bytes, checksum and download (database storage provider) | `src/lib/lca/evidence-service.ts` |
| Printable report, calculation register CSV, structured JSON export, PACT exchange document | `src/lib/lca/report-service.ts`, `pact/`, `src/app/api/lca/` |
| Staged assessment navigation (Setup → Inventory → Results → Review & issue) | `src/components/board/lca-navigation.tsx` |

What was missing was **data** — nothing exercised the journey — plus a handful of correctness and copy defects that only appear once a realistic model is loaded.

## Demo journey

`/advanced` → **Product footprint** → `/assessments` → **Products** → product → version → assessment:

Setup (Overview, Goal & scope) → Inventory (Lifecycle model, Inventory & BOM, Assumptions & exclusions, Evidence) → Results (Results, Data quality, Scenarios) → Review & issue (Review, Versions, Audit trail, Report).

Product, version, status, boundary, owner and **the functional unit next to the headline figure** are on every page of that journey via the assessment layout.

## Demo data

`pnpm run db:seed:lca-demo` — standalone, idempotent, manual-only; never wired into `db:seed` or `postinstall`. Reuses the `paragon-group` organisation like `ems-demo.ts`; refuses to run with `NODE_ENV=production` unless `LCA_DEMO_SEED_CONFIRM=yes`.

- **Product** Contactless smart card (ID-1), `DEMO-CARD-ID1`, version **Rev A (2026)**, manufacturing location linked to the Hull site.
- **Functional unit** 1,000 finished contactless smart cards. The model is one batch of **50,000 cards**, so it holds **50 functional units** and the engine divides by that.
- **Boundary** `CUSTOM` — cradle to customer gate: raw materials, inbound transport, manufacturing, packaging, distribution (5 stages). `boundaryNotes` describes it, which the validation engine requires for a custom boundary.
- **15 inventory lines** across those 5 stages, 4 demo suppliers, 3 freight lines carrying 4 legs (sea + road multimodal inbound, road outbound).
- **6 assumptions**, **3 exclusions** (use phase, end of life, capital goods), **2 evidence items** — a real 2 kB CSV bill of materials with a SHA-256 checksum and a working download, and a system record naming the factor set.
- **1 baseline + 1 scenario**, both calculated.

### Calculated behaviour

| | Model (50,000 cards) | Per 1,000 cards |
| --- | --- | --- |
| Baseline `PCF-DEMO-CARD-001` | 2,600.03 kgCO2e | **52.001** |
| Scenario `PCF-DEMO-CARD-001-S1` | 1,791.98 kgCO2e | **35.840** |
| Saving | 808.05 kgCO2e | **16.161 (31.1%)** |

Stage split (model kgCO2e, reconciles exactly): raw materials 1,426.16 (54.9%), manufacturing 1,039.62 (40.0%), packaging 89.50 (3.4%), inbound transport 28.03 (1.1%), distribution 16.71 (0.6%).

Top 5 hotspots: PVC card body core 28.0%, site electricity 25.1%, contactless chip module 19.0%, natural gas 8.7%, electricity upstream losses 5.5%.

The scenario changes **two factors only** — recycled PET sheet in place of virgin rigid PVC, and a REGO-backed renewable tariff for site electricity — on identical quantities and the same functional unit. Upstream transmission losses stay on the grid factor.

### Synthetic-data handling

Every factor sits in an organisation-scoped set flagged `isPlaceholder`, so the platform's own controls fire: a placeholder banner on every results surface, a hard validation ERROR per affected line, readiness pinned at **Not ready**, and "Not fit for reporting" on the report. That is intended. **These figures are not a Paragon product footprint and must never be presented as one.**

## Fixed during the sprint

All LCA-only; no carbon accounting service was touched.

1. **Scenario line-by-line drivers were meaningless** (`analysis.ts`). `driversByItem` matched baseline rows to scenario rows on `inventoryItemId`. A scenario is an independent clone with new ids, so *every* line showed as fully removed from the baseline and separately added to the scenario. Now matched on stage + process + line name, which a clone copies verbatim. The demo went from 30 phantom drivers to the 2 lines that actually moved. `contributionsByItem` keeps the id key, which is correct within one run.
2. **Contribution percentages did not reconcile** (`analysis.ts`). `contributionsBySupplier` divided named suppliers by supplier-attributed emissions but the unattributed group by the whole footprint — the demo's supplier shares summed to 140.6%. `contributionsByMaterial` had the same split denominator. Both now take the whole footprint, so "%" means one thing per page.
3. **Functional unit was invisible beside the headline** (assessment layout). The per-functional-unit figure now always carries its denominator, and says so explicitly when no functional unit has been described.
4. **Freight lines read "No factor assigned"** (inventory page) while still showing a figure — a transport line is priced per leg. Now "Priced per freight leg (n)" / "Priced per end-of-life route (n)".
5. **Factor-linked evidence was mislabelled** "The assessment as a whole" — `listEvidence` did not load the relation. Now named. `SYSTEM_RECORD` evidence also showed a "Link" badge; now "System record".
6. **Report copy**: "covers a custom boundary boundary", and "the largest contributions" listed stages in lifecycle order rather than by size.
7. **No route from assessments back to products** — added to the assessments page header.

## Tests

`prisma/seed/lca-demo-fixture.ts` holds the fixture specification with no database dependency, so `prisma/seed/lca-demo-fixture.test.ts` drives the real `calculateAssessment` over the same bill of materials the seed writes. 18 tests covering: inventory-line calculation against independently computed expectations, freight work from mass × distance, aggregation to the model total, functional-unit resolution and division, lifecycle-stage totals reconciling to the overall result, hotspot ordering and contribution percentages, one-meaning-of-% across breakdowns, the placeholder flag reaching every row, scenario change isolation, scenario difference and saving, same-functional-unit comparison, baseline immutability, missing-factor handling (diagnostic raised, line not silently counted as zero), and a missing modelled output blocking the per-unit figure.

Plus one assertion added to `src/lib/lca/__tests__/lca-analysis.test.ts` for the supplier-share denominator.

**Results:** `vitest run src/lib/lca/__tests__ prisma/seed/lca-demo-fixture.test.ts` — 9 files, 214 tests, all passing. `tsc --noEmit` clean for every file in this change.

**Live verification:** seeded and driven end to end against a throwaway Neon branch (`lca-demo-sprint-verify`, child of `br-blue-field-ayetcsyq` on `twilight-breeze-25854149`), signed in as the demo lead, every page in the journey visited. The stored-path figures match the pure-engine test exactly. The seed is idempotent — re-running rebuilds the assessment and scenario and produces the same totals.

## Known limitations

- **Multi-leg freight lines are labelled by their first leg** in the by-item contribution charts. The engine names each leg row `"<line> — leg N (mode)"` and `contributionsByItem` takes the first row's name as the group label, so a two-leg line reads "… — leg 1 (sea)" while carrying both legs' emissions. Correct arithmetic, imprecise label; affects one 0.2% line in the demo. Fixing it properly needs the un-decorated line name persisted on `LcaCalculationResult`, i.e. a schema change — deliberately not taken during a concurrent sprint.
- The report says "50000 item of output" — generic unit symbols are not pluralised or thousands-separated in that sentence.
- Assumptions and exclusions are seeded unapproved, so those two readiness areas read "Internal review recommended". Left that way on purpose: approving synthetic register entries as if reviewed would be dishonest, and the outstanding state demonstrates the approval workflow.
- 11 primary/supplier-specific lines carry no evidence. Real evidence was not invented.
- Placeholder factors keep the assessment permanently out of verification. Replacing them needs a licensed life-cycle inventory dataset imported through Admin → Emission factors, then reassigning the lines.

## Deferred (explicitly out of scope)

Brightway/openLCA/ecoinvent integration, a background LCI database, AI factor matching, multi-impact LCIA, an EPD engine, full ISO 14040/14044 verification workflow, supplier PCF exchange beyond the existing PACT adapter, and any production hardening of the demo fixture (it is a demonstration seed, not a migration path for real product data).

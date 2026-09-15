# Carbon Phase 4-iii-b — Activity Data Register

One screen that answers "what activity data has been entered?". Built on top
of Phase 4-ii (the mutation barrier) and Phase 4-iii (close/reopen UX); it adds
no accounting rule of its own.

## Route and information architecture

`/activity` — "Activity Register", in the workspace nav between Data Collection
and Data Entry.

The three carbon workspace screens now divide cleanly, with no competing
register:

| Route | Question it answers |
| --- | --- |
| `/data` | What data is **required**? (collection plan, close/reopen panel) |
| `/activity` | What data **exists**? (this register) |
| `/entry` | Where do I **enter** data? (site picker → per-source forms) |

The nav item previously labelled "Activity Data" pointed at `/entry`, which is
the entry *form*, not a register. It is now "Data Entry", and "Activity
Register" is the new `/activity` item. Both gate on `carbon.view` through the
existing `resolveBoardNav` default, so a read-only member sees and can use the
register.

`/activity/[id]` is the record detail. No activity-record detail route existed
before (only `/calculations/[id]`, which explains a *figure*), so this is the
first, not a second.

## Architecture reused

Nothing here re-implements an existing control.

- **Period rule** — `assertPeriodAllowsMutation` (Phase 4-ii), called inside the
  same transaction as every write. No second period lock exists in UI code.
- **Period state (read)** — the `ReportingPeriod` row, with the schema's own
  rule that a missing row means OPEN.
- **Tenant/site visibility** — `tenantWhere` + `accessibleActivityEntryFilter` /
  `accessibleSiteFilter`.
- **Permissions** — `hasPermission` against the existing catalogue.
  `carbon.view` to read, `carbon.entry.review` to edit notes,
  `carbon.entry.approve` to delete. No new role model, no new permission code.
- **Audit** — `recordAuditEvent` on the existing hash-chained trail. One new
  event type, `activity_entry.deleted`, added to `AUDIT_EVENT_TYPES` alongside
  the existing `.deleted` events; the notes edit reuses `activity_entry.updated`.
- **Row locking** — `lockActivityEntry`.
- **UI** — `PageHeader`, `Surface`, `SetupState`, `Badge`, `Button`, `Input`,
  `Select`, `Textarea`, `RouteSkeleton`, and the `/data` filter-form pattern
  (GET form → URL search params → server component).
- **Formatting** — `formatKgCO2e`, `resolveMonthRange`, `formatRangeLabel`.

New code is one service (`src/lib/carbon/activity-register-service.ts`), one
actions file, two pages and a loading skeleton.

## Register fields

Default table: activity date (period start → end), source (data point name,
code, scope, Scope 3 category, type option), site (+ entity), quantity + unit,
status badge, closed-period badge, emissions figure + calculation count, last
updated, View link.

Secondary metadata is on the detail view rather than the table: organisation,
canonical quantity/unit, supplier, data-quality tier, data origin, plausibility
flag and reason, entered-by/entered-at, factor value/source/vintage per
calculation, supporting document. Internal ids are never shown as columns.

## Filters, search, pagination

Filters: free-text search, site, from/to month, scope, status, source.
All travel as URL search parameters, so a filtered register is linkable and the
back button works.

Search covers the human-readable fields an entry actually has: notes, supplier
name, raw unit, site name, entity name, factor-option label, and the data
point's name, code and category. Case-insensitive `contains`, run in Postgres —
no separate search index.

Pagination is server-side: `REGISTER_PAGE_SIZE = 25`, `skip`/`take` plus a
`count`, with page links carrying the active filters. The browser never
receives an unbounded organisation-wide dataset.

Reporting-period state is resolved in **one** extra query per page over the
distinct site/month pairs on that page — not once per row.

## Detail behaviour

`/activity/[id]` shows the activity, its emissions figures with the factor
snapshot behind each, evidence/provenance, notes, and a plain statement of
whether the record can be changed. Each calculation links to the existing
`/calculations/[id]` explanation. An out-of-scope or foreign-tenant id returns
`notFound()` — the register never reveals that such a record exists.

## Edit behaviour

**Notes only.** Quantity, unit, factor and supplier are not editable.

This is not a simplification — it is the existing architecture. `ActivityEntry`
has exactly one update path today (`documents-service.ts`, which sets
provenance and, in its own words, "changes provenance, never a quantity").
Changing a quantity that has produced a figure reports already cite is a
restatement, which is **Phase 4-iv**, explicitly out of scope here. The screen
says so in those terms rather than offering a disabled control.

Notes remain editable on a calculated record because a note carries no figure:
it is absent from every `Calculation` and from the
`CarbonSourcePeriodObligation` review fingerprint, so annotating a record
cannot invalidate a review or a report.

In a **closed** period the notes form is replaced by the read-only note plus
the Phase 4-ii sentence. The server re-checks regardless.

## Delete behaviour

Hard delete, permitted only where the record carries no accounting history:

- no `Calculation`
- no `LcaCorporateDataLink` (product assessment citation)
- no `CommutingSurveyResponse`
- no `CarbonSourcePeriodObligation` (source review)
- period OPEN, and the caller holds `carbon.entry.approve`

Those four relations are the complete set of `ActivityEntry` references in the
schema. Two of them (`LcaCorporateDataLink`, `CommutingSurveyResponse`) are
*optional* FKs, so Prisma's default would silently null them on delete — the
service refuses instead, which is the reason the check is explicit rather than
left to the database.

Confirmation is a deliberate second step (`?confirm=1`) that names the record —
source, quantity, unit, site and month — and states that deletion is permanent.
It is server-rendered, so it works without client JavaScript, and the server
action independently requires the confirmation token. No browser
`Are you sure?`.

Deletion is audited **before** the row is removed, so the audit event retains
what the record held.

### Protected records

Anything failing those checks is preserved and explained, naming the specific
dependency ("this activity has produced an emissions figure…", "a product
assessment cites this record as a source", "its figures appear in 3 issued
reports"). No void, archive or supersede is offered, because the platform has
no such mechanism yet — inventing one here would be Phase 4-iv.

## Closed-period integration

A closed record is read-only, never broken. Search, filter, open, inspect the
figure, the factor provenance and the evidence all continue to work. The
closed state is shown as a badge *alongside* the entry's own status, not
instead of it — a closed record is still "Approved" or "Awaiting factor".

## Concurrency

The rendered page is never the authority. `describeMutability` draws the
buttons; the server action re-reads the record, calls the Phase 4-ii SQL
barrier and re-counts every reference **inside the write transaction**. A
register rendered while a period was open, or before a calculation finished,
cannot push a write through afterwards. Both cases are covered by tests.

## Permissions

| Action | Grant |
| --- | --- |
| View the register and any record | `carbon.view` |
| Edit notes | `carbon.entry.review` |
| Delete a safe record | `carbon.entry.approve` |

A read-only member gets the whole register and the whole record, with neither
mutation offered and a plain permission message rather than a dead button.
Server-side checks are authoritative; button visibility is a courtesy.

## Tests

`src/lib/carbon/__tests__/activity-register-service.test.ts` (21) — the safety
decision for every blocker, tenant-scoped and server-side paging, each filter,
search over human-readable fields only, open/closed resolution, calculation
totals, both mutations, permission refusals, and the two concurrency cases
(barrier refuses after render; references appear after render).

`src/lib/__tests__/activity-register-page.test.tsx` (21) — register renders
records, filters reach the service, invalid status/scope ignored, detail
navigation, closed records readable and marked read-only, both empty states,
pagination carrying filters, domain errors surfaced in their own words; detail
shows factor/result and links the explanation, notes editable when open and
blocked when closed, delete only behind the named confirmation, protected
records explained, read-only member sees everything and can change nothing.

Full suite after the change: 2554 passed, 28 skipped (the skips are the
pre-existing Postgres integration tests). `tsc --noEmit` clean, `eslint` clean,
`next build` compiles both routes.

## Runtime verification

**Not performed against a database.** The worktree has no `.env`/`.env.local`
with a usable `DATABASE_URL` (only `.env.example` and board-demo fixtures), and
this task does not guess connection details, seed, or mutate the demo branch.
Everything above is verified by typecheck, lint, unit/route tests and a
production build. A run against the demo database is the one outstanding check
before the demo.

## Known limitations

- Quantity/unit/factor cannot be corrected — Phase 4-iv restatement.
- No void/archive/supersede for protected records; they are preserved and
  explained.
- No bulk actions, and no export from the register.
- Period-state filtering is by month range, not a direct "closed only" filter.
- Free-text search is a Postgres `contains` scan; fine at demo and
  early-production volume, and the place to revisit first if the register
  slows.

## Phase 4-iv boundary — explicitly not done here

No controlled recalculation or restatement, no historical supersession, no
change to migrations, factors, the calculation engine, LCA, or the audit
architecture beyond one event type. No database was seeded or migrated.

# Carbon Phase 4-iii — close / reopen reporting period UX

Implemented on `demo/phase4-iii-close-reopen`, branched from `76d49ef06d9c8a358d2cc4e65331ba30eb08e03d` (the shared HEAD: Phase 4-ii `ac62268` plus the concurrent LCA demo sprint) in the dedicated worktree `C:\Carbon-Accounting-P4III`. This phase is UX and workflow integration only. **No accounting control was redesigned, weakened or reimplemented.**

## What was added

| Surface | Change |
| --- | --- |
| `/data` (Data Collection) | New **Reporting period** panel: OPEN/CLOSED status for one site and one month, the close/reopen action, the confirmation dialog, current-state metadata, and the close/reopen history. No new route and no new navigation entry. |
| `/entry/[siteId]` | Read-only banner when the **current month** is closed for that site, naming the month and linking to `/data` where it is reopened. Every source, status and link still renders. |
| `/entry/[siteId]/[code]`, its survey form, `…/electricity-contract`, `…/business-travel-import` | A write refused by the barrier now shows the barrier's own sentence instead of a raw error or a generic failure. The bulk ExpenseIn import previously had no handler at all and threw to the route error boundary. |

## Reused, not rebuilt

- **Transition service:** `setReportingPeriodState(context, { siteId, accountingDate, state, reason })` — Phase 4-ii, unchanged. It owns the `carbon.entry.approve` check, tenant/site scope, the site lock, the legal-hold check, the state write and the hash-chained audit event. The UI calls it and nothing else.
- **Read:** `getReportingPeriod(context, siteId, accountingDate)` — Phase 4-ii, unchanged. Missing row still means OPEN; nothing is materialised on read.
- **Blocked-write message:** `ReportingPeriodClosedError` / `isReportingPeriodClosedError` — Phase 4-ii. The message string was extracted to `REPORTING_PERIOD_CLOSED_MESSAGE` in the same module so every screen shows the identical sentence; the error's own message is now that constant.
- **Audit:** `listAuditEvents(ctx, { resourceType: "reporting_period", resourceId })`. No second audit system was created. `ReportingPeriod` deliberately stores no actor/reason, so actor, timestamp and reason are read back from the events the transition service already writes.

## Close flow

Open period → the panel states the month is changeable → **Close period** → a modal confirmation that says closing *"prevents activity data and accounting calculations for this month and site from being changed until the period is reopened"* and that reports, stored figures and evidence stay readable → a **required reason** (the service already makes reason mandatory; no new schema was invented) → submit → server transition → the page returns showing **Closed**, a success line, and closed-by / closed-at / reason.

## Reopen flow

Closed period → the panel states the month is read-only and shows who closed it, when and why → **Reopen period** → a modal that says reopening *"allows activity data and accounting calculations … to be changed again"* and that both the close and the reopening stay in the audit record → required reason → server transition → the page returns showing **Open** plus a success line. Nothing is deleted: the close and the reopening both remain in the history list.

## Permissions

- The UI shows the action only when the membership holds `carbon.entry.approve` (`hasPermission`, an affordance only). Without it the panel still shows the status and says plainly that changing it needs the carbon approval grant.
- **The backend remains authoritative.** The action re-resolves the server-side `OrganisationContext` on every submit and passes it straight to the service; nothing about the actor, membership, organisation or permissions is read from the form. A submitted `organisationId`/`membershipId`/`userId` field is ignored — proved by test.
- A refused transition comes back as a named outcome, never a silent success: `?error=denied` (missing grant), `?error=scope` (site not in scope), `?error=hold` (active legal hold), `?error=period_invalid` (missing site, month or reason). Anything unexpected is rethrown to the route error boundary rather than flattened into a fake success.

## Blocked-mutation experience

A write into a closed month shows: *"This reporting period is closed. Reopen the period before changing accounting data."* — identically whether the refusal came from the service guard or straight from the database trigger (the trigger path is recognised by `isReportingPeriodClosedError` and never leaks the SQL text). The ExpenseIn bulk import additionally says which month stopped it and how many earlier months were imported, because Phase 4-ii's workflows commit row by row and are not all-or-nothing.

## Read-only experience

A closed period is presented as **read-only, not broken**. Activity data, statuses, links, calculations, reports, evidence and methodology all stay reachable; the panel and the entry banner both say what is blocked (accounting changes to that month and site) and what is not.

## Concurrency

No client-side "it looked open when the page loaded" assumption exists anywhere. The panel never gates a submit on its rendered state, and the transition action does not pre-read the period. A period closed by somebody else between render and submit is refused by the server; the user sees the closed-period sentence and the page state is revalidated (`/data` and `/entry/[siteId]`) after every successful transition. Repeating an existing state is the service's existing no-op, so a duplicate submit cannot produce a spurious audit event.

## Terminology fix

`/data` already used "Period: Closed" to mean *the calendar month has ended*. Next to an accounting lock that is ambiguous, so those two strings became "Calendar period — Still running / Ended" and "month still running". No behaviour changed.

## Tests

New: `src/lib/carbon/__tests__/reporting-period-view.test.ts`, `src/lib/__tests__/reporting-period-panel.test.tsx`, `src/lib/__tests__/reporting-period-actions.test.ts`, `src/lib/__tests__/entry-site-closed-period.test.tsx`. Extended: `src/lib/__tests__/data-page.test.tsx`.

Covered: OPEN displays; CLOSED displays with actor/date/reason; authorised close and reopen reach the service with a server-resolved context; UI state after each; a membership without the grant gets status and no controls; backend permission and legal-hold errors are reported as themselves; the closed-period message is surfaced from both the service guard and the trigger path; reports/data stay readable when closed; a stale page's write is refused server-side; incomplete transitions never reach the service; an unexpected fault still reaches the error boundary.

## Migration and runtime database status

**The Phase 4-ii migration `20260915170000_carbon_reporting_period_barrier` still needs applying to whichever non-production demo/staging database the demo will run against.** This checkout has no `.env`/`.env.local` and therefore no configured database target; no target was guessed and nothing was applied anywhere. Runtime/browser testing of the close/reopen flow has **not** been performed. To demo: apply that migration to the intended non-production database (`pnpm run db:migrate:deploy` against it), then walk `/data` → select a site → Close period → `/entry/[siteId]` → Reopen period.

## Known limitations

- The `/entry/[siteId]` banner covers the **current** month only — the month its forms default to. An entry deliberately backdated to a different closed month is still refused by the barrier and shown the same sentence, but without an up-front banner.
- Close/reopen is one site and one month at a time, matching the Phase 4-ii key. There is no bulk "close all sites for September".
- History shows the six most recent transitions for that period inline; deeper audit inspection stays on the existing audit surfaces. No new audit architecture was added.
- Legal holds are reported to the user as a refusal; releasing a hold is not part of this surface.

## Phase 4-iv boundary

Phase 4-iii ends here. It does **not** implement: the Activity Data Register; restatement, supersession or recalculation semantics; value-edit/void services; report issue policy tied to period state; four-eyes approval on close; factor publication (Phase 3-vii); or any production rollout. A correction to a closed month still requires an explicit reopen — Phase 4-iv owns everything about correcting closed accounting data.

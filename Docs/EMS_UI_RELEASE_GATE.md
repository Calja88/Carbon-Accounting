# EMS UI Release Gate (UI14)

Final EMS browser smoke, accessibility, and readiness hardening. Documentation of evidence and the synthetic-pilot GO/NO-GO decision for the completed EMS UI (UI00-UI13, on top of the T-series backend through T84).

No real environmental data was used at any point. All personas, records, and fixtures referenced below are synthetic, created by `prisma/seed/index.ts` and the new `prisma/seed/ems-demo.ts` against a local, disposable Postgres instance. No production deployment was performed or attempted.

## 1. Base branch/commit

- Dependency chain verified: `origin/claude/ems-ui13-dashboard-reporting-g4k2ln` @ `95eaa31fd6c7f898e34782344f085d08adf85e4c` ("UI13: EMS dashboard, reporting and leadership overview UI").
- Verified via `git merge-base --is-ancestor` that this commit's history includes T84 (`t84-licensed-review-checklist-tn9k12`) and every UI00-UI12 branch. UI13 itself is present (`95eaa31`), so the UI14 dependency gate is satisfied; UI13 was **not** re-implemented in this session.
- This session's branch (`claude/ui14-ems-smoke-accessibility-6mr71j`) was reset onto that commit before any UI14 work began (it had originally been created from an unrelated base).

## 2. Critical flows tested

Full machine-readable inventory: [`Docs/EMS_UI_CRITICAL_FLOWS.json`](./EMS_UI_CRITICAL_FLOWS.json) — derived from `EMS_MODULES` (`src/lib/ems/navigation/registry.ts`) and `SYSTEM_ROLE_TEMPLATES` (`src/lib/rbac/role-templates.ts`), not a hand-maintained duplicate.

11 critical flows covering every route category in scope: dashboard/home, programme/foundation, documents/evidence, notifications/work-queue, aspects/operations (processes/aspects/controls/monitoring/providers/communications/emergency), legal/compliance, objectives/actions, audit/incident/nonconformity/CAPA, competence (requirements/people/assignments/gaps/expiry), management review (cycle/agenda/pack/minutes/decisions), reporting/export entry points, plus a cross-cutting RBAC/tenancy-boundary flow.

Personas exercised (`prisma/seed/ems-demo.ts`, all synthetic `*.demo.example` accounts, password `Ui14Demo!2026`):

| Persona | Role template | Membership | Access mode |
|---|---|---|---|
| Sustainability Lead | `SUSTAINABILITY_LEAD` | ACTIVE | Organisation-wide |
| Organisation Administrator | `ORGANISATION_ADMINISTRATOR` | ACTIVE | Organisation-wide |
| Contributor | `EMS_CONTRIBUTOR` | ACTIVE | Organisation-wide |
| Read-only | `FINANCE_READ_ONLY` | ACTIVE | Organisation-wide |
| Restricted site manager | `SITE_MANAGER` | ACTIVE | Restricted to Paragon ID / Hull Site |
| Suspended | `EMS_CONTRIBUTOR` | SUSPENDED | Organisation-wide |

Synthetic domain data seeded (one representative record set per domain, `prisma/seed/ems-demo.ts`, idempotent — verified via two consecutive runs with unchanged row counts): competence (1 requirement version, 1 person, 2 assignments — one active, one expiring within 30 days — 2 evidence rows); management review (1 held review with an issued pack, approved minutes, 1 decision); audits (1 audit, 1 finding); incidents (1); nonconformities (1, with root cause/corrective action); aspects & operations, legal & compliance, objectives & actions, documents/evidence hub, notifications — one representative record each.

## 3. Accessibility/browser findings fixed

**Automated (`e2e/`, Playwright + `@axe-core/playwright`, WCAG 2.1/2.2 AA):**

- **Missing label association (WCAG 4.1.2, blocking):** ~19 EMS form files rendered `<Label>` immediately beside an `<Input>`/`<Select>`/`<Textarea>` with no `id`/`htmlFor`, so a screen reader could not associate the two. Fixed by adding `id`/`htmlFor` pairs everywhere, using a per-row-unique id (e.g. `` `outcome-${assessmentId}` ``) wherever the same form repeats in a list, matching the convention already used correctly in `documents/`, `incidents/`, `nonconformities/`, `processes/`, and `competence/`. A few bare fields with no `<Label>` at all (e.g. `emergency/emergency-forms.tsx`'s follow-up action form) got `aria-label` instead.
- **Color contrast (WCAG 1.4.3, serious):** `text-slate-400` on white/`slate-50` backgrounds (~2.6:1) was used for real informative text — permission-denied messages, empty-state captions, timestamps, table-header labels — across the dashboard, evidence hub, legal sync-health, notifications, actions, management-review, and several detail pages. Replaced with `text-slate-500` (~4.6:1, the shade already used compliantly elsewhere in the same files) everywhere it carries text, app-wide across the EMS tree (not only the routes the automated run happened to visit, since the defect is identical everywhere it appears). One additional instance: `text-emerald-600` on the objectives "(active)" version tag (~3.8:1) → `text-emerald-700` (the same shade the shared `Badge` "success" tone already uses).
- **Link distinguishable only by color in body text (WCAG 1.4.1):** two prose links (`competence/assignments` → expiry dashboard, `competence/expiry` → work queue) relied on `hover:underline` only. Changed to a persistent `underline`.
- **Table header scope:** `legal/provider-health` table `<th>` cells had no `scope="col"`, unlike every other data table in the app. Added.
- **Empty-state gaps:** the audits module (`audit-forms.tsx`, `audit-detail-forms.tsx`) was the one module with no "no records" message for zero programmes/planned audits/audits/findings, unlike every sibling module. Added, matching the existing style convention.
- **App-wide error/not-found boundaries:** neither existed anywhere in the app (confirmed via `find` — zero `error.tsx`/`not-found.tsx` files). Any uncaught exception under the signed-in app shell, including every EMS route, fell through to the framework's default overlay/blank page. Added `src/app/(app)/error.tsx` (retry + back-to-dashboard, styled to match the app) and `src/app/not-found.tsx`.

**Manual/structural review (not fully automatable in this environment — see §6):**

- Keyboard reachability + visible focus indicator verified programmatically (`e2e/keyboard-and-responsive.spec.ts`) on 6 critical routes for the Sustainability Lead persona: nav is Tab-reachable, first focusable control always has a computed `outline` or `box-shadow`, Tab does not trap focus.
- Responsive layout verified programmatically at a 375px viewport on the same 6 routes: zero horizontal overflow (`scrollWidth === clientWidth` within 1px), and the collapsed nav "More" menu opens and stays reachable.
- Icon-only buttons: a static audit of every `<button>`/icon-only control under `src/app/(app)/ems/**` found no instances lacking an accessible name — the one icon-bearing page (`/ems`, the module tile grid) already marks its `lucide-react` icons `aria-hidden="true"` and pairs each with a visible text label.

**A genuine blocking bug found via the "restricted/suspended user" check (fixed, not just a hardening polish item):**

- A signed-in user with **no ACTIVE organisation membership** (suspended, removed, or never invited) hit an **infinite redirect loop**: any EMS/carbon page redirected to `/` on `OrganisationAccessError`; `/` unconditionally redirected an authenticated-but-orgless user to `/login`; the app's `proxy.ts` (this Next.js version's `middleware.ts` equivalent — see `AGENTS.md`) unconditionally redirects any *authenticated* visitor away from `/login` back to `/`. The result was `net::ERR_TOO_MANY_REDIRECTS` — the account could not reach any page, including sign-out.
  - **Fix (`src/app/(app)/page.tsx`):** `/` now redirects to `/login` only for `OrganisationAccessError`'s `NOT_AUTHENTICATED` reason (the genuine sign-in case); for `NO_ACTIVE_MEMBERSHIP`/`ORGANISATION_NOT_ACCESSIBLE` it renders a plain "No organisation access" message instead, using the header/nav/sign-out button the `(app)` layout already renders correctly for a null-organisation session. This is the single chokepoint every other page's `redirect("/login")` on the same error flows through (`/login` always bounces a signed-in visitor to `/`), so fixing it here resolves the loop for every route without touching each one individually.
- **Route discoverability (`src/lib/ems/navigation/registry.ts`):** the 5 competence pages (`requirements`/`people`/`assignments`/`gaps`/`expiry`) each `requirePermission(context, "ems.competence.view")` beyond the base `ems.view`, but the nav registry didn't declare that, so a membership holding `ems.view` but not `ems.competence.view` — Organisation Administrator and Finance (read-only) by design, per `role-templates.ts`'s existing "Metadata only"/no-code decision — saw a nav tile that always redirected on click. Declared `permission: "ems.competence.view"` on all 5 registry entries, the same pattern already used for `legal-provider-health`. This changes only nav *visibility*, not any permission grant or enforcement — `registry.test.ts` updated accordingly (one new assertion, one generalized from a hardcoded count).

## 4. Tests/checks/build

All run against this branch after every fix, from a clean state:

- `pnpm exec tsc --noEmit` — clean.
- `pnpm run lint` — clean (4 pre-existing unused-var warnings, unrelated to this task, 0 errors).
- `pnpm test` (vitest) — **1753 passed**, 7 skipped, 0 failed (116 files; up from 1752/1752 at baseline — one new registry test added).
- `pnpm run build` (production Next.js build) — succeeds; every `/ems/**` route compiles.
- `pnpm exec playwright test` (new `e2e/` suite, Chromium, against `pnpm run start` + local synthetic Postgres) — **157 passed, 0 failed**, covering:
  - `critical-flows.spec.ts`: route-discovery + blank-page guard + `@axe-core` scan (wcag2a/wcag2aa/wcag22aa, critical/serious only) for every module each of 5 active personas has permission for, plus an `/ems` hub route-discovery check.
  - `rbac-boundaries.spec.ts`: denied-module direct-URL access for 3 personas (must not 500/blank/render the denied content) + the suspended-membership check.
  - `keyboard-and-responsive.spec.ts`: keyboard focus-visibility and 375px responsive/no-overflow checks on 6 critical routes.
  - `auth.setup.ts`: real credential sign-in for all 6 personas (not a mocked session).

Before this task's fixes, the same suite (once the pre-existing `AUTH_TRUST_HOST` production-mode gap was worked around locally — see §6) surfaced 54 failures resolving to the findings in §3, plus the redirect-loop bug; after fixes, 0 failures.

## 5. Synthetic UI gate result

**GO**, for the synthetic pilot scope defined above, with the residual items in §6 tracked as follow-ups (none are blocking: the redirect loop and the systemic label/contrast defects — the two genuinely blocking classes found — are fixed and verified; everything remaining is either out of this task's explicit scope or a documented, non-blocking observation).

## 6. Residual risks / owner decisions

- **Not testable in this environment:** live Microsoft Graph/SharePoint connectivity (SP01-SP08 are explicitly out of scope for UI14 and were not touched), screen-reader-specific behavior beyond axe's automated ruleset (no AT software available here — recommend a manual NVDA/VoiceOver pass on the competence-evidence and management-review-pack flows before a real pilot), and print/PDF output review (WCAG "print" checks from `PHASE8_HARDENING_READINESS_SPEC.md` §5) were not exercised.
- **`AUTH_TRUST_HOST` / proxy production-mode config (owner decision, infra):** `next start` (production mode) requires `AUTH_TRUST_HOST=true` for NextAuth v5's own host-trust check to pass locally; this repo's `.env.example` doesn't set it. This is very likely already handled by the real hosting platform (Vercel sets `VERCEL=1`, which NextAuth auto-trusts) but is worth an explicit owner confirmation before assuming production auth works — this session could not check the actual deployment's environment variables.
- **Out-of-scope, adjacent finding (not fixed, per this task's explicit scope):** the same `text-slate-400` low-contrast pattern exists on the non-EMS carbon dashboard (`src/app/(app)/page.tsx`, e.g. "tonnes CO2e" captions) — visible in this task only because the redirect-loop investigation passed through that page. Flagged for a future non-EMS hardening pass; not modified here to keep this diff scoped to the EMS UI review list.
- **Manual assistive-technology and print review** (per `PHASE8_HARDENING_READINESS_SPEC.md`'s original T82 scope, which this task's automated pass substantially covers but does not fully replace) is recommended as an owner-scheduled follow-up before the synthetic pilot goes live with real (still non-production) users.
- **T70UI-a integration** (competence requirement admin, noted as unmerged in the original UI00 coverage inventory) — confirmed already integrated on this branch; no action needed, noted here only to close out that earlier open item.

## Files changed

38 modified, 6 added — see the PR diff for the full list. Summary by category:

- **New test infrastructure:** `playwright.config.ts`, `e2e/{personas,auth.setup,critical-flows,rbac-boundaries,keyboard-and-responsive}.ts`, `vitest.config.mts` (excludes `e2e/`), `package.json`/`pnpm-lock.yaml` (`@playwright/test`, `@axe-core/playwright`), `.gitignore` (Playwright artifacts).
- **New synthetic seed:** `prisma/seed/ems-demo.ts` + `package.json` `db:seed:ems-demo` script.
- **New readiness docs:** `Docs/EMS_UI_CRITICAL_FLOWS.json`, `Docs/EMS_UI_RELEASE_GATE.md` (this file).
- **New app-wide boundaries:** `src/app/(app)/error.tsx`, `src/app/not-found.tsx`.
- **Bug fix:** `src/app/(app)/page.tsx` (redirect-loop).
- **Nav accuracy fix + test:** `src/lib/ems/navigation/registry.ts`, `src/lib/ems/navigation/__tests__/registry.test.ts`.
- **Accessibility fixes (label association, contrast, empty states, table headers, link underline):** the remaining ~30 files under `src/app/(app)/ems/**`.

No carbon/LCA calculation logic, schema, issued-report immutability, or compliance-approval configurability was touched. No existing delete/archive action was removed. No new EMS business workflow was added.

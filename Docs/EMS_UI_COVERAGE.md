# EMS UI Coverage Inventory (UI00)

Documentation-only inventory. No UI was built, no branches were merged/cherry-picked, no deployment config was changed, and no real data was used to produce this report.

## 1. Cumulative base branch verified

- **Branch:** `origin/claude/t84-licensed-review-checklist-tn9k12`
- **Commit:** `47a0be6` — "T84: licensed standard and competent review checklist"
- **Verification method:** `git merge-base --is-ancestor <branch> origin/claude/t84-licensed-review-checklist-tn9k12` run against every `origin/claude/t1*`, `t20`-`t24`, `t30`-`t35` (incl. `origin/claude/t34-t73-integration-base`), `t40`-`t46`, `t50`-`t52`, `t60`-`t64`, `t70`-`t73`, `t80`-`t84` branch present on the remote.
- **Result:** all of the above are ancestors of t84 — the T10-T84 dependency chain, including the T34 integration branch, is confirmed complete on this branch.

## 2. T70UI-a integration status

- `origin/claude/t70ui-a-competence-requirement-admin` is **NOT** an ancestor of `origin/claude/t84-licensed-review-checklist-tn9k12` (`merge-base --is-ancestor` returns false).
- That branch contains a real UI commit: `src/app/(app)/ems/competence/requirements/{page.tsx,actions.ts,requirement-forms.tsx}` (competence requirement admin screen).
- **Finding: T70UI-a's UI commit is NOT yet present on the cumulative base and must be integrated later** (e.g. rebased/merged onto the t84 lineage) before competence requirement admin becomes available. It was not merged or cherry-picked as part of this task.

## 3. Deployment-branch finding

- `git remote show origin` reports the repository's **default/HEAD branch is `claude/paragon-id-uk-carbon-mvp-1h1uvb`**, not `main`/`master` — there is no `main` or `master` branch on the remote at all.
- `src/app/(app)/ems/` does not exist on `origin/claude/paragon-id-uk-carbon-mvp-1h1uvb` (0 matches).
- **Conclusion:** none of the T10-T84 EMS work — including everything listed as COMPLETE below — has been merged into the branch that presumably backs the deployed/production app. Every EMS screen that exists today only exists on unmerged feature branches (T-series and t84). This, not a UI or nav defect, is the primary reason EMS screens are not visible in whatever is currently deployed. Confirming which branch Vercel/production actually builds from was out of scope (no deployment config change permitted); this should be verified against the hosting project settings before UI0x work begins.

## 4. Task -> service -> route matrix (T20-T73)

Routes below are as they exist on `origin/claude/t84-licensed-review-checklist-tn9k12`. Nav reachability is checked against `src/app/(app)/nav-links.tsx` `MORE_ITEMS`/`BASE_ITEMS` (the only in-app navigation surface). All pages use `requireOrganisationContext()` + `requirePermission(context, "ems.view"|...)` — permission-aware, membership-scoped access, no legacy `User.role` checks were found in the sampled pages.

| Task | Service (src/lib/ems/...) | Route(s) | In nav? | Status | Notes |
|---|---|---|---|---|---|
| T20 | `src/lib/audit/*` (audit event/integrity log) | none (backend log) | n/a | COMPLETE (backend-only by design) | No dedicated UI expected; audit trail is infrastructure, not a workflow screen. |
| T21 | outbox/job framework (no `src/lib/ems` dir; infra-level) | none | n/a | COMPLETE (backend-only by design) | Infrastructure task, no UI surface expected. |
| T22 | Controlled documents — reuses existing `/documents` pages + `src/app/api/ems/documents/[id]/revisions/[revisionId]` | `/documents`, `/documents/[id]` | Yes (`BASE_ITEMS`) | COMPLETE | Reuses pre-existing carbon/LCA document UI extended with EMS revision API; no separate `/ems/documents` route. |
| T23 | `foundation/programme-service.ts`, `context-service.ts`, `change-service.ts` | **none found** | n/a | **MISSING** | No `src/app/(app)/ems/programme`, `/scope`, `/context`, `/policy`, or `/changes` pages exist anywhere in the tree. Services + tests exist; UI is entirely absent. This is the target of the planned UI02 task. |
| T24 | `src/lib/notifications/*` (notification/reminder service) | **none found** | n/a | **MISSING** (as standalone UI) | No dedicated notifications/reminders inbox page; reminder delivery is backend-only (email adapter). May be intentionally surfaced inline elsewhere, but no such surface was found. |
| T30 | `aspects/process-service.ts` | `/ems/processes` | Yes | COMPLETE | |
| T30/T32 | `aspects/aspect-service.ts`, `significance-engine.ts`, `significance-service.ts` | `/ems/aspects` | Yes | COMPLETE | Includes significance forms. |
| T33 | `controls/control-service.ts` | `/ems/controls` | Yes | COMPLETE | |
| T34 | `monitoring/monitoring-service.ts`, `calibration-service.ts` | `/ems/monitoring` | Yes | COMPLETE | Confirms T34 integration is present and reachable. |
| T35 | `providers/provider-control-service.ts`; `emergency/emergency-service.ts` | `/ems/providers`, `/ems/emergency` | Yes | COMPLETE | |
| T40 | `legal/legal-source-service.ts` (schema) | n/a | n/a | COMPLETE (backend-only by design) | Schema/data-model task. |
| T41/T42 | `legal/provider/*`, `legal-sync-worker.ts`, `legal-sync-health.ts` | `/ems/legal/provider-health` | Yes | COMPLETE | |
| T43 | `legal/applicability-service.ts` | `/ems/legal/applicability` | Yes | COMPLETE | |
| T44 | `legal/obligation-service.ts` (versioning) | n/a (see T46 obligations page) | n/a | PARTIAL | Versioning logic itself has no dedicated screen beyond the obligations list below. |
| T45 | `legal/evaluation-service.ts` | `/ems/legal/evaluations` | Yes | COMPLETE | |
| T46 | `legal/other-requirement-service.ts`; `legal/obligation-service.ts` | `/ems/legal/other-requirements`, `/ems/legal/obligations` | **No** | **UNREACHABLE-IN-NAV** | Both page routes and actions exist and build correctly, but neither is linked from `nav-links.tsx`. Only reachable by typing the URL directly. |
| T50 | `objectives/objective-service.ts`, `metric-service.ts` | `/ems/objectives` | **No** | **UNREACHABLE-IN-NAV** | Full page + forms exist (objective workspace with policy/aspect/obligation/risk cross-links) but is not linked in nav. |
| T51 | `objectives/metric-adapters/{corporate-carbon,product-lca}.ts` | (feeds `/ems/objectives`) | — | PARTIAL | Adapter logic only surfaces through the (unreachable) objectives page. |
| T52 | `actions/action-service.ts`, `reminder-handler.ts` | `/ems/actions` | **No** | **UNREACHABLE-IN-NAV** | Page + action forms exist; not linked in nav. |
| T60 | `audits/programme-service.ts` | `/ems/audits` | Yes | COMPLETE | |
| T61 | `audits/checklist-service.ts`, `finding-service.ts`, `report-service.ts` | `/ems/audits/[id]` | Yes (via `/ems/audits`) | COMPLETE | Detail page has checklist/finding/report tabs. |
| T62 | `incidents/incident-service.ts`, `notification-assessment-service.ts` | `/ems/incidents`, `/ems/incidents/[id]` | Yes | COMPLETE | |
| T63 | `nonconformity/nonconformity-service.ts` | `/ems/nonconformities` | **No** | **UNREACHABLE-IN-NAV** | Page + forms exist; not linked in nav. |
| T64 | `nonconformity/root-cause-service.ts`, `corrective-action-service.ts`, `effectiveness-service.ts` | `/ems/nonconformities/[id]` | **No** (only reachable from the unreachable list page) | **UNREACHABLE-IN-NAV** | Detail page with root-cause/CAPA/effectiveness sections exists but inherits the parent list's nav gap. |
| T70 | `competence/{person,requirement,assignment}-service.ts` | **none on t84** (`ems/competence/requirements/*` exists only on unmerged `origin/claude/t70ui-a-competence-requirement-admin`) | n/a | **MISSING** | Services + full test suite exist; zero UI on the cumulative base. See §2. |
| T71 | `competence/{evidence,assessment,expiry,gap}-service.ts` | **none found** | n/a | **MISSING** | No training-evidence/assessment/expiry/gap UI anywhere in the tree, including on t70ui-a. |
| T72 | (management review — service dir not present under `src/lib/ems/review` for the review workflow itself; see T73) | **none found** | n/a | **MISSING** | No `/ems/review` or `/ems/management-review` pages. |
| T73 | `review/{agenda,minutes,pack,review}-service.ts`, `review/input-adapters/*` | **none found** | n/a | **MISSING** | Deterministic review-pack generation (`pack-service.ts`) has full backend + adapters pulling from actions/audits/competence-gap/compliance-evaluation/corrective-action, but no page renders or triggers it. |

### Summary counts (T20-T73)

- COMPLETE: T20, T21, T22, T30, T32, T33, T34, T35, T40, T41/T42, T43, T45, T60, T61, T62 (15)
- PARTIAL: T44, T51 (2)
- UNREACHABLE-IN-NAV: T46, T50, T52, T63, T64 (5)
- MISSING: T23, T24, T70, T71, T72, T73 (6)

## 5. Missing/partial/unreachable UI detail

**MISSING (no page exists at all):**
- EMS programme/scope/context/policy/change management (T23) — needed before an `/ems` landing page (planned UI01) can meaningfully link to programme setup.
- Notifications/reminders inbox (T24).
- Competence: requirement admin (T70 — exists only on unintegrated `t70ui-a`), person/assignment management (T70), evidence/assessment/expiry/gap workflows (T71).
- Management review workflow screen (T72) and deterministic review pack view/export (T73).

**UNREACHABLE-IN-NAV (page exists, not linked):** `/ems/legal/other-requirements`, `/ems/legal/obligations`, `/ems/objectives`, `/ems/actions`, `/ems/nonconformities` (+ its `[id]` detail). These are fully built, permission-checked pages that a user cannot discover without knowing the exact URL — a nav-registration gap, not a missing-feature gap.

**PARTIAL:** T44 (obligation versioning has no dedicated version-history screen beyond the obligations list itself, which is also unreachable); T51 (carbon/LCA metric adapters only surface through the objectives page, which is itself unreachable).

**Missing detail pages/actions worth flagging for future UI tasks:**
- No `[id]` detail page for objectives, actions, or legal obligations/other-requirements (list-only pages with inline forms, unlike audits/incidents/nonconformities which have dedicated `[id]` pages).
- No management-review or review-pack UI at all, despite complete backend input-adapter wiring to five other EMS domains.

## 6. Permissions pattern observed

Every sampled page (`ems/objectives/page.tsx` and others of the same shape) follows: `requireOrganisationContext()` → `requirePermission(context, "ems.view")` (or a more specific permission) → redirect to `/` on `OrganisationAccessError`/`PermissionDeniedError`. Data queries use `tenantWhere(ctx, {})` for organisation scoping. No legacy `User.role` checks were found in the sampled pages — this matches the RBAC/tenancy rules in `AGENTS.md`/`Docs/PHASE1_TENANCY_RBAC_SPEC.md`.

## 7. Critical browser flows to verify once UI01+ links these routes

1. Aspect register → significance assessment → operational control linkage (`/ems/aspects` → `/ems/controls`).
2. Legal applicability → obligation → compliance evaluation chain (`/ems/legal/applicability` → obligations [unreachable] → `/ems/legal/evaluations`).
3. Audit → finding → nonconformity → corrective action chain (`/ems/audits/[id]` → nonconformities [unreachable] → `/[id]` CAPA).
4. Incident intake → notification assessment → (missing) management review input.
5. Objective → metric adapter (carbon/LCA) → (missing) management review pack input.

These flows are currently broken in the browser wherever they cross into an UNREACHABLE-IN-NAV or MISSING screen, independent of the deployment-branch issue in §3.

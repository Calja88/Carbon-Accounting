# BD01 — Baseline map

Cumulative source map after merging the EMS/tenancy lineage into the H00 baseline. Scope: the demo-critical chain (Overview → Carbon → aspect/control → legal/audit/NC/CAPA → LCA → management pack). Other modules are noted by existence, not audited in depth.

## Merge

- **Base (H00):** `origin/claude/paragon-id-uk-carbon-mvp-1h1uvb` @ `c9487554b058087736e031b06a672f2f61fcfbcb`.
- **Merged in:** `origin/claude/ems-lifecycle-coverage-completion-uyk1ph` @ `18cbf08bae80176d50ec602f23a8c34f0d8dd8c9`.
- **Shared merge-base:** `3190aee482e713fd4a923585439e0b92de9dd5ae` (pre-EMS-plan upload).
- **Result:** `board/foundations-2026-09-22` @ `7dba8a6` (merge commit; see COMMITS in the completion report).
- The EMS branch is itself the head of a linear, fully-cumulative line: T10–T19 (tenancy/RBAC refactor) → T20–T84 (EMS domain: outbox, controlled docs, EMS programme, notifications, aspects/impacts, operational controls, monitoring/calibration, external providers, legal/compliance T40–T46, objectives T50, actions T52, audit T60–T61, nonconformity/CAPA T62–T64, competence T70–T71, management review T72–T73, T34 monitoring-onto-T73, T80 adversarial suite, T81 audit integrity/retention, T83 resilience, T84 licensed review) → later polish (`fd6a8ca` EMS/carbon nav+delete coverage, `958157e` ui14 smoke/accessibility). It also already contains `paragon-iso-ems-t00`–`t18` and `sp00`–`sp08` (SharePoint) as ancestors — confirmed by `git merge-base --is-ancestor`, not assumed from branch names.
- **Conflicts:** 3 files, all build tooling (`package.json`, `.gitignore`, `package-lock.json`) — no domain code conflicted. Resolution: see the merge commit message. `pnpm` is now the sole package-manager authority; `package-lock.json` removed, `pnpm-lock.yaml` regenerated via `pnpm install --lockfile-only --ignore-scripts`.
- Carbon/LCA/AI/H00 code was untouched by the merge (those commits are baseline-only history; the EMS branch's file set doesn't overlap them).

## Schema / migrations

44 migrations, chronologically ordered, no gaps, ending `20260826120000_add_lifecycle_exit_states`. Tenancy (organisation/membership/RBAC) migrations precede all EMS-domain migrations, consistent with the T10-before-T20+ dependency. Not applied to any database this session (no `prisma migrate` command run).

## Route tree (demo-critical + present-but-unshown)

`src/app/(app)/`: `layout.tsx`, `nav-links.tsx`, `sign-out-button.tsx`, `page.tsx` (current carbon homepage, `/`), `admin`, `assessments` (LCA), `calculations`, `documents`, `entry`, `methodologies`, `products`, `reports`, `suppliers`, `help`, plus:
`ems/`: `aspects`, `controls`, `legal`, `objectives`, `actions`, `audits`, `nonconformities`, `evidence`(under `documents`)/`documents`, `management-reviews`, `competence`, `communications`, `emergency`, `incidents`, `monitoring`, `notifications`, `processes`, `programme`, `providers`, `dashboard`, `page.tsx`.

All of these are reachable via existing routing; BD01 made no navigation changes (that's BD04). `requireOrganisationContext()` in `src/lib/organisation/session.ts` remains the single tenant/session entry point used by `layout.tsx`.

## Domain service layer

- `src/lib/organisation/` — `session.ts` (`requireOrganisationContext`, `OrganisationAccessError`), `membership-guard.ts` (last-role-manager protection), `invitation-service.ts`, `cookie.ts`, `actions.ts`.
- `src/lib/rbac/` — `authorize.ts` (`hasPermission`), `permission-catalogue.ts`, `role-templates.ts`.
- `src/lib/repositories/` — `tenant-scope.ts`, `context.ts`, `transaction.ts`, plus per-domain repositories (`carbon-repository.ts`, `ems-repository.ts`, `lca-repository.ts`, `audit-repository.ts`, `documents-repository.ts`, `notifications-repository.ts`).
- `src/lib/ems/` — one directory per domain area (`aspects`, `controls`, `legal`, `objectives`, `actions`, `audits`, `nonconformity`, `competence`, `review` [management-review/pack], `monitoring`, `communications`, `emergency`, `incidents`, `notifications`, `foundation`, `navigation`, `providers`), each with its own `__tests__`.
- `src/lib/ems/review/pack-service.ts` exports `generateManagementReviewPack`, `issueManagementReviewPack`, `getManagementReviewPack` (per `INTEGRATION/LIVE_BINDINGS.md` §7) — present and importable; not exercised live this session.

## Sign-out / no-active-membership flow (step 5 check)

Already correct, no repair needed: `AppLayout` calls `requireOrganisationContext()` and catches `OrganisationAccessError`, rendering with `organisation = null` (assistant unavailable, platform-admin nav hidden) rather than throwing, for both signed-out and mid-onboarding/no-membership visitors. Nav visibility for platform-admin is gated on live permission grants (`carbon.factor.view` / `ai.settings.manage`), not a legacy JWT role.

## Permission/site-scoping gaps for BD02 (inventory only, not fixed here)

- The existing carbon homepage (`src/app/(app)/carbon/page.tsx` per `LIVE_BINDINGS.md` — actual current path is `page.tsx` at app root) still uses direct Prisma queries per `INTEGRATION/LIVE_BINDINGS.md` §1; BD02/BD03 must scope these before the board route activates them.
- `src/lib/board/*` (BD02–BD08 owned) does not exist yet — correctly not created in BD01; `FILE_MANIFEST.json` has no BD01-owned files (BD01 is integration-only, no Astra file copies).
- Synthetic/guarded-environment identity check (BD02/BD03) is not yet wired; no seed, demo guard, or `scripts/board-demo/**` exists yet.

## Checks run (see completion report for full results)

Typecheck, lint, and the full non-e2e Vitest suite (including the T80 cross-tenant adversarial suite) all pass against the merged tree. No database, seed, or migration command was run.

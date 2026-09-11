# Vercel Usage Controls

## Why this exists

- The Vercel Hobby plan's Functions Storage limit (10 GB) has been exceeded
  (23.54 GB observed at the time this was written).
- During active development (Claude sessions pushing frequent commits/PRs),
  Vercel's default Git integration triggers a new preview deployment on
  every push to every branch, which builds fresh serverless functions each
  time.
- Vercel's own dashboard warning states that deployments not actively
  receiving traffic do not generate costs or count towards limits. That
  means **manually deleting old preview deployments is not the priority** —
  the priority is stopping new, unnecessary deployments from being created
  in the first place.
- GitHub Actions (`.github/workflows/ci.yml`) already runs typecheck, lint,
  and the full test suite (including the mandatory T80 cross-tenant
  adversarial suite) on every push/PR. That remains the real correctness
  gate. Vercel previews are only needed when someone explicitly wants a
  live browser preview of a branch.

## What this change does

Adds `scripts/vercel/ignore-build.mjs`, meant to be wired up as Vercel's
"Ignored Build Step". It allows a build to proceed only when one of the
following is true:

- The branch is an approved deploy branch:
  - `main`
  - `production`
  - `claude/paragon-id-uk-carbon-mvp-1h1uvb`
- The commit message contains `[vercel deploy]`
- The environment variable `FORCE_VERCEL_DEPLOY=1` is set (project-wide or
  on a specific deployment)

Otherwise, the build is skipped and a short reason is logged, e.g.:

```
Skipping Vercel build for branch board/product-2026-09-22. Add [vercel deploy] to the commit message to force.
```

or, when a build is allowed:

```
Allowing Vercel build because commit message contains [vercel deploy].
```

The decision logic lives in `scripts/vercel/lib/should-build.mjs` and is
unit tested in `scripts/vercel/__tests__/should-build.test.ts`.

## Exact Vercel dashboard setting to configure

1. Go to: **Vercel Project → Settings → Git → Ignored Build Step**
2. Set the ignored build command to:
   ```
   node scripts/vercel/ignore-build.mjs
   ```
3. Save.

This is a dashboard-only setting; nothing in the repository can turn it on
by itself. Someone with access to the Vercel project needs to apply it.

## How to force a deployment

Either:

- Include `[vercel deploy]` anywhere in the commit message of the commit
  being deployed, or
- Set the `FORCE_VERCEL_DEPLOY=1` environment variable on the Vercel
  project (Settings → Environment Variables) or for a single deployment.

## How to temporarily disable the guard

- Quick, one-off: add `[vercel deploy]` to a commit message, or set
  `FORCE_VERCEL_DEPLOY=1` for that deployment only.
- Broader/longer: set `FORCE_VERCEL_DEPLOY=1` as a persistent Vercel
  project environment variable (all branches/environments), which makes
  every push build again. Remove the variable to re-enable the guard.
- Full rollback: clear the "Ignored Build Step" field in Vercel Project →
  Settings → Git so Vercel goes back to building every push.

## Manual cleanup note

Do not spend time deleting every stale preview deployment. Vercel states
that deployments not receiving traffic do not count towards limits or
generate costs, so bulk-deleting old previews is not expected to move the
Functions Storage number and is not the fix here. Only delete a specific
deployment if there is a concrete reason to (e.g. it is actively serving
traffic and should not be).

## Findings on large/bundled files (Task 5)

The full repository (tracked files, excluding `.git`) is about 12 MB. The
largest tracked files are:

- `data/defra-desnz-2026-import-v2.csv` (~742 KB)
- `data/defra-desnz-2025-import-v2.csv` (~719 KB)
- `data/defra-desnz-2024-import-v2.csv` (~718 KB)
- `prisma/schema.prisma` (~350 KB)
- `pnpm-lock.yaml` (~211 KB)

No committed ZIPs, node_modules copies, `.next/cache` output, screenshots,
or large generated reports were found. `.gitignore` already excludes
`/artifacts/ai-handoff/`, `/.next/`, `/coverage`, `/test-results`,
`/playwright-report`, and other generated/local-only output, so these
never reach git in the first place.

The `data/defra-*.csv` files are reference/import data. They are not read
by any application runtime code path (the seed script
`prisma/seed/emission-factors.ts` uses hard-coded placeholder values, not
these CSVs); they are only mentioned in documentation/comments. They are
small in absolute terms (under 1 MB each) and are very unlikely to be the
cause of a 23 GB Functions Storage figure — that scale points strongly at
**accumulated function output across many preview deployments**, not a
single large file in this ~12 MB repo.

### `.vercelignore`

A `.vercelignore` was added excluding directories that are not needed to
build or run the Next.js app (`next build` / `next start`): documentation,
end-to-end/Playwright config and specs, and one-off operational scripts
(load-test, RLS spike, AI handoff tooling) that are never imported by
application code. `src/`, `public/`, `prisma/` (schema + migrations, used
by `prisma generate` and `db:migrate:deploy`), and root config files
required by the build were deliberately left untouched. This reduces the
amount of source Vercel uploads per build; it is not expected to be a
large effect on its own given the repo's overall size, but it is a safe,
low-risk trim.

## Bundle-size observation (Task 6)

Next.js on Vercel uses per-route file tracing, so unimported files under
`Docs/`, `docs/`, `e2e/`, `tests/`, or `scripts/` were not being pulled
into serverless function bundles regardless of `.vercelignore` — those
directories aren't imported by any route handler. No low-risk bundle-size
issue was found beyond the `.vercelignore` trim above; a deeper bundle
audit was out of scope for this change.

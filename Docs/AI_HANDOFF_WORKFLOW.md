# AI Handoff Workflow (Astra ↔ Claude Code)

This repository is the technical source of truth. Astra (ChatGPT) does not
have direct GitHub/Neon access, so two developer commands generate sanitized
ZIP bundles that can be uploaded to Astra for review without exposing
credentials, live environment data, or the whole repository every time.

```
Astra (spec) → Claude Code (implementation, live repo/DB) → sanitized handoff → Astra (review) → next task
```

Both commands run entirely from the local git working tree. Neither queries
Neon or any live database, and neither exports database records.

## Full architectural handoff

```
npm run handoff:full
```

Writes: `artifacts/ai-handoff/full/carbon-ledger-full-handoff-<timestamp>.zip`

Use it for:
- initial Astra onboarding;
- major architecture milestones;
- whenever Astra's view of the repository is materially stale.

Contains a sanitized copy of the whole repository as git currently sees it
(tracked files, plus untracked files that aren't gitignored), minus the
security exclusions below, plus a generated `MANIFEST.md`.

## Task review handoff

```
npm run handoff:review -- --task T00
```

Optional flags:
- `--base <ref>` — diff base ref (defaults to the merge-base with
  `origin/main`/`origin/master`, or `HEAD` if neither exists, meaning "just
  show uncommitted changes").
- `--run-checks` — actually run `npm test` and `npm run lint` and capture
  their real output into `TEST_RESULTS.md`. Without this flag,
  `TEST_RESULTS.md` says `Not run` rather than fabricating a result.

Writes: `artifacts/ai-handoff/review/<TASK_ID>-review-<timestamp>.zip`

Use it after each Claude implementation task, before Astra reviews it.

Contains only what's needed to review that task's change:

| File/dir | Contents |
|---|---|
| `TASK.md` | The task's own spec section, if found in `Docs/`, else a stub |
| `IMPLEMENTATION_SUMMARY.md` | Deterministic fields (files changed, tests touched) filled in; the rest (objective, decisions, follow-ups) left for a human/Claude to complete honestly |
| `GIT_STATUS.txt` | `git status` output |
| `GIT_DIFF.patch` | Full diff between the base ref and the current working tree |
| `CHANGED_FILES.txt` | Added / modified / deleted / new-untracked file list |
| `CHANGED_FILES/` | Current content of every changed/new file (post-exclusion, post-scan) |
| `MIGRATIONS/` | Any changed files under `prisma/migrations/` |
| `PRISMA_SCHEMA/` | `prisma/schema.prisma`, only if it changed |
| `TEST_RESULTS.md` | Real check output, or `Not run` |
| `SECURITY_CHECK.md` | Result of the secret scan run over this bundle |
| `MANIFEST.md` | Generated inventory and exclusion/scan summary |

## Security model (fail closed)

Every candidate file is first filtered through an explicit exclusion list
(`scripts/handoff/lib/exclude.mjs`) that removes `.env*` (except the
placeholder `.env.example`), `.git/`, `node_modules/`, `.next/`, build/cache
output, key/cert files, logs, local DB dump files, and the handoff output
directory itself — even if such a file were accidentally tracked in git.

Every surviving text file's *content* is then scanned
(`scripts/handoff/lib/secret-scan.mjs`) for likely Postgres/Neon connection
strings, AWS/OpenRouter/OpenAI-style API keys, JWTs, private-key blocks,
bearer tokens, and generic `secret=`/`token=`/`password=` assignments. A
small, explicit allowlist of placeholder markers (`replace-with`,
`localhost`, `example.com`, etc.) lets committed example files like
`.env.example` through without weakening the scan elsewhere.

**If anything matches, ZIP generation aborts immediately** (exit code 2).
The console output names the affected file and the *category* of suspected
secret — never the matched text itself.

This is a conservative, pattern-based check, not a formal guarantee. A
generated `MANIFEST.md` only claims what actually happened: which files were
included, which exclusion rules fired, and that the scan passed — not a
broader security assurance.

## Secret-scan audit mode (diagnostic only, no ZIP)

```
npm run handoff:secret-audit -- --task T00
```

`npm run handoff:review` fails fast: it aborts at the *first* suspected
secret across the candidate file set, so clearing several unrelated false
positives means fix-one/rerun/repeat. `handoff:secret-audit` instead scans
the exact same candidate file set (same base ref, same exclusions, same
rules) but does not stop at the first match and does not package anything
— it collects every finding in one pass and prints a report, tagging each
match as already reviewed-allowlisted or unreviewed. It never creates a
ZIP, never copies a file, and never prints a matched secret value (only
the file path, finding category, rule id, and a line number derived from
counting newlines before the match — never from the matched text). It
exits `0` only when there are zero unreviewed findings, non-zero
otherwise. Use it to see everything that needs attention before running
the real `handoff:review`/`handoff:full`, which remain exactly as
fail-fast/fail-closed as before — this tool changes neither of them and
is not imported by either.

## What is never included

`.env*` (except `.env.example`), Neon/DATABASE_URL/DIRECT_URL credentials,
API keys, tokens, cookies/sessions, SSH keys, certificates/private keys,
real user exports, real environmental activity data, uploaded evidence or
customer documents, database dumps, logs with customer data, `.git`,
`node_modules`, `.next`, build/cache output, and previously generated
handoff packages.

## Out of scope for this tool

This is developer tooling only. It does not implement or touch any Carbon
Ledger, LCA, tenancy, RBAC, or database-domain behavior, and it never runs
`npm run build` (which currently runs `prisma migrate deploy`) or connects
to a live database.

# Preview URLs and database safeguards

Written after the Phase 3-ii staging exercise on 2026-09-15, which lost most of
a session to two environment hazards rather than to any product defect. Both
are recorded here because both will recur otherwise.

## 1. Never let an ambient shell variable choose the migration target

**What happened.** A `prisma migrate status` intended for a staging branch
connected to **production** instead. The inline override was written as
`SP="…" DATABASE_URL="$(cat "$SP/…")" npx prisma …`, but a shell expands every
assignment in a command prefix before any of them enters the environment, so
`$SP` was still empty and `DATABASE_URL` resolved to `""`. `prisma.config.ts`
then fell through to `DIRECT_URL`, which this machine carries ambiently
pointing at production.

`migrate status` only reads, so nothing was written — but the identical
mistake in front of `migrate deploy` would have migrated production.

This is the second incident of this shape. The first is recorded in
`Docs/board-sprint/CONTINUITY.md`: T81/T83 tests guarded only on
`DATABASE_URL` being *set*, so on a machine whose shell exported a hosted
`DATABASE_URL` an ordinary test run wrote into it. That one left rows that
cannot be deleted, because the append-only controls forbid it.

**Where the ambient values come from.** Not from the repository and not from a
shell profile — `~/.bashrc`, `~/.bash_profile`, `~/.profile` and
`~/.bash_login` do not exist on this machine, no `.env` is present, and
neither variable appears in Windows user or machine environment or in Claude's
settings. They are inherited from the environment of whatever process launched
the editor. Nothing in this repository can remove them, which is precisely why
the guard below is in the repository instead.

**The guard.** `assertConsistentMigrationTarget` in `prisma.config.ts` refuses
a *partial* configuration — a `DIRECT_URL` / `DATABASE_URL_UNPOOLED` /
`DIRECT_DATABASE_URL` override with an empty or unset `DATABASE_URL`. That is
exactly the incident above, and it now fails closed with a message that names
variables and never their values:

```
DIRECT_URL is set but DATABASE_URL is empty. Set both explicitly for the
database you intend to migrate — an ambient shell variable must never decide
the target.
```

Deliberately still allowed:

- neither variable set — `prisma generate` never connects, and Vercel's
  `postinstall` runs before project env vars exist;
- `DATABASE_URL` alone — the direct URL is derived by dropping `-pooler`;
- an explicit direct override naming a *different* host — this repository's
  documented escape hatch for a separate migration endpoint. Narrowing that
  would break a supported configuration, so the guard does not.

Covered by `src/lib/__tests__/prisma-config.test.ts`.

**The safe pattern.** Set both variables explicitly, in the command itself,
and assert the target before migrating:

```bash
# Resolve the strings first, in their own step — a command prefix cannot
# reference a variable assigned in the same prefix.
POOLED="$(cat /path/to/pooled)"; DIRECT="$(cat /path/to/direct)"

# Assert the intended endpoint by name, and reject production by name.
case "$DIRECT" in *ep-intended-endpoint*) : ;; *) echo ABORT; exit 1;; esac
case "$DIRECT" in *ep-production-endpoint*) echo ABORT; exit 1;; *) : ;; esac

env DATABASE_URL="$POOLED" DIRECT_URL="$DIRECT" \
    DATABASE_URL_UNPOOLED= DIRECT_DATABASE_URL= \
    npx prisma migrate status
```

Then read the `Datasource "db": … at "<host>"` line that Prisma prints and
confirm it is the host you intended **before** running `migrate deploy`.
Never export these into the shell; never rely on what is already there.

## 2. The branch alias does not track new Preview deployments

**What happened.** The branch alias
`carbon-accounting-tnal-git-board-product-2-254e99-callum-carbon.vercel.app`
stayed pinned to a deployment from 2026-09-11 (commit `55bac67`, pre-Phase-0,
wired to the BOARD demo database) across at least 18 commits and several
successful Preview builds. Anyone opening the PR's "Visit Preview" link got
that build. It cost two separate debugging sessions: first "the Preview shows
BOARD demo data", then "the Preview still crashes" after the fix had shipped.

It went stale **again** on the very next deployment after being repaired, so
this is systematic, not a one-off.

**Best current explanation, not proof.** This project gates builds on a commit
marker (`scripts/vercel/ignore-build.mjs`; a commit without `[vercel deploy]`
exits 0 and Vercel cancels the deployment). Every real code push therefore
produces a **Canceled** deployment, and only a separate empty trigger commit
produces a **Ready** one. Vercel's branch-alias assignment does not reliably
follow that out-of-band second deployment. Manual `vercel alias set` repairs
may compound it, since an explicitly assigned alias is typically no longer
auto-managed.

What is *certain*: the alias does not track, it required manual repair twice
on 2026-09-15, and both repairs worked immediately. No Vercel setting exposed
through the CLI or API here explains it, and `aliasError` is `null`
throughout. Treat the explanation above as a hypothesis until someone
confirms it in the Vercel dashboard's alias history.

**Why "just use direct URLs" is not sufficient.** The branch-scoped
`NEXTAUTH_URL` for this branch points at the alias host. Auth callbacks and
invitation links therefore resolve to the alias regardless of which URL you
opened, which is how a session that started on a direct URL ended up back on
the stale build. Removing that variable is worse, not better: the shared
Production+Preview `NEXTAUTH_URL` would then apply and send Preview traffic at
production.

### The process to follow

1. Push the code commit, then the empty `chore(vercel): … [vercel deploy]`
   trigger commit. Wait for `READY` and confirm `target` is `null`.
2. **Repair the alias every time**, after the deployment reports READY:
   ```bash
   npx vercel alias set <new-deployment>.vercel.app \
     carbon-accounting-tnal-git-board-product-2-254e99-callum-carbon.vercel.app
   ```
   Guard it: abort if the alias argument is `carbon-accounting-tnal-five.vercel.app`
   or `carbon-accounting-tnal-callum-carbon.vercel.app`, and assert the exact
   alias and source strings before running. This is a Preview-only operation;
   it never touches a Production alias, a database, or an environment variable.
3. Verify by resolving the alias, not by trusting the command:
   ```bash
   npx vercel alias ls | grep board-product-2-254e99
   ```
   and confirm the deployed commit on the alias hostname is the one you expect.
4. Share the **alias** once repaired, since that is what auth redirects to.
   A direct deployment URL is still the right thing to quote in a report,
   because it is immutable and cannot silently become stale.
5. Force a fresh page load when testing (`Ctrl+Shift+R` or a private window).
   `/login` is statically prerendered and a cached copy from an older build has
   twice survived an alias repair.

`scripts/factors/check-preview-routes.mjs <url>` checks the routes respond
without 5xx. Under SSO protection that is all it proves — signed-in
verification remains manual.

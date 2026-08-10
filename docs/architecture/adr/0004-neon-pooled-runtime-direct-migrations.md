# 0004 — Neon pooled runtime connection with a separate direct migration connection

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The application currently uses a single `DATABASE_URL` and runs
`prisma migrate deploy` inside the production build script, before
`next build`. That pattern works for a single always-on deployment target but
is not the preferred pattern for Neon, whose runtime connections are expected
to go through a pooler while CLI/migration operations need a direct
(non-pooled) connection, and where migrations should run once per release,
not once per parallel build worker.

## Decision

Adopt two distinct connection strings: `DATABASE_URL` for the pooled runtime
connection used by the application's Prisma client, and `DIRECT_URL` for the
direct connection used by Prisma CLI/migration operations, configured through
`prisma.config.ts`. Remove `prisma migrate deploy` from the generic Next.js
build command and replace it with an explicit, separate release-migration
command that runs once per release rather than once per build/worker. The
Prisma client remains a singleton per runtime instance.

## Alternatives considered

- **Keep one `DATABASE_URL` and run migrations in the build step.** Rejected:
  this does not match Neon's pooled-connection guidance for runtime traffic,
  and running migrations inside a parallelised build risks concurrent
  migration attempts.
- **Run migrations lazily on first request.** Rejected: this makes migration
  timing non-deterministic and couples a user-facing request to schema
  changes; an explicit release step is safer and easier to audit.
- **Use only a direct connection everywhere.** Rejected: direct connections
  do not scale for concurrent runtime traffic the way Neon's pooler does, and
  would reintroduce the connection-saturation risk this decision exists to
  avoid.

## Consequences

- Deployment scripts, `.env.example`, and README must document both
  variables and state that migrations run once per release, not on every
  build.
- Missing either variable must fail with a safe, explicit configuration
  message rather than silently falling back to a default.
- No production database connection is established as part of this decision;
  configuration changes are validated with fake URLs in unit/config tests.

## Rollback / migration note

This is a configuration and script change with no schema migration attached.
Rollback is reverting `prisma.config.ts`, the build script, and environment
documentation to the single-`DATABASE_URL` form; no data migration is
involved either direction.

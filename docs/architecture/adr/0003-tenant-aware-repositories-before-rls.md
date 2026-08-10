# 0003 — Tenant-aware repositories before row-level security

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The codebase currently has many direct Prisma calls scattered across
services, server actions, and API routes. Under the single-group model this
is coherent because every signed-in user may see the same group's data.
Under multi-tenancy this becomes the largest isolation risk: a single query
missing an `organisationId` predicate can disclose another customer's data,
and that risk is proportional to the number of call sites, not to any single
line of business logic. PostgreSQL row-level security (RLS) could enforce
tenant isolation at the database layer, but the application uses Prisma over
a pooled Neon connection, and RLS correctness under connection pooling and
transaction-local session settings has not yet been proven for this stack.

## Decision

Introduce tenant-aware repository/context primitives that require an
explicit, server-derived `organisationId` (and, where applicable, Entity/Site
scope) to construct or call, so unscoped customer-data access is difficult to
write by accident. Centralise Prisma access for customer-owned domains behind
these repositories rather than calling `prisma.*` directly from route/action
modules. Treat PostgreSQL RLS as a later defence-in-depth layer: it is
deferred to a dedicated spike, using a non-owner application database role
and transaction-local organisation context in a synthetic test database,
before being applied to any production table, and even then only to a
minimal vertical slice first.

## Alternatives considered

- **Adopt RLS immediately as the primary isolation mechanism.** Rejected for
  the current phase: correctness under Prisma's connection pooling and Neon's
  transaction pooling mode is unproven here, and a false sense of safety from
  an unverified RLS policy is worse than explicit application-level scoping
  that can be code-reviewed and tested today.
- **Rely on code review alone to catch missing `organisationId` predicates.**
  Rejected: review-only enforcement does not scale with the number of call
  sites and has already produced the current unscoped-access baseline; a
  structural repository boundary plus an automated ratcheting check (see the
  CI unscoped-access rule) is required.
- **Skip repositories and go straight to a static-analysis-only rule against
  direct Prisma calls.** Rejected as insufficient alone: a static check can
  catch new violations but does not itself provide the safe, ergonomic way to
  perform scoped queries that the repository primitives provide.

## Consequences

- New customer-owned reads/writes should go through the tenant repository
  layer; direct Prisma calls in route/action modules become the exception,
  tracked by an explicit, non-broadening allowlist enforced in CI.
- RLS remains explicitly out of scope until its own spike task passes;
  application-level scoping is the primary isolation control until then.
- Repository primitives must support tenant-root, Entity, Site, and
  child-resource ownership assertions, and ownership checks may never accept
  an assertion supplied only by the browser.

## Rollback / migration note

Introducing repository primitives does not itself migrate existing call
sites, so it is safely reversible by simply not adopting them further. Once a
customer-owned domain is refactored onto repositories (a later, domain-scoped
task), rollback means reverting that domain's refactor commit; it does not
require a database migration since no schema changes are introduced by this
decision.

# 0001 — Organisation as the SaaS tenant above Entity

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

`Entity` currently represents an operating/legal company inside a single implicit
customer group (Paragon ID, RFID Discovery, Thames Technology), each with one
`Site`. There is no tenant table above `Entity`, and `User` has no
`organisationId`, membership, entity scope, or site scope. Onboarding a second
SaaS customer onto the current schema would let one customer's users read
another customer's Entities, Sites, activity, and reports, because reads are
intentionally group-wide today.

## Decision

Introduce `Organisation` as the SaaS tenant root, sitting above `Entity`.
`Entity` gains an `organisationId` foreign key and becomes an operating/legal
company scoped to exactly one `Organisation`. All customer-owned data (Entity,
Site, activity, contracts, surveys, calculations, reports, corporate
documents, and future EMS records) is reachable only through an `Organisation`
boundary. No `organisationId` supplied by the browser may be trusted without
verifying the requesting user holds a live membership in that organisation.

## Alternatives considered

- **Reuse `Entity` as the tenant root.** Rejected: `Entity` already carries the
  operational meaning of "operating/legal company," and a group can contain
  several such companies. Overloading it would break the existing Hull /
  Rayleigh / Milton Keynes structure and any future customer with more than
  one legal entity.
- **Separate database/schema per tenant.** Rejected for this phase: the
  platform is a modular monolith with one Prisma schema and one Postgres
  database; per-tenant databases would add operational complexity
  disproportionate to current scale and would complicate shared factor sets
  and legal-register data that are intentionally platform-global.
- **Tag rows with a customer ID without a first-class `Organisation` model.**
  Rejected: a first-class root is required to hang membership, permissions,
  EMS programme records, and audit envelopes off a single stable anchor.

## Consequences

- Every customer-owned Prisma model needs (directly or via `Entity`) a path to
  `organisationId`, and every repository/query touching such a model must
  accept and apply organisation scope.
- Two organisations may have entities with the same name; uniqueness
  constraints move from global to tenant-scoped.
- This is a prerequisite for membership-based RBAC (ADR 0002) and tenant-aware
  repositories (ADR 0003); it does not by itself change authorisation
  behaviour.

## Rollback / migration note

The schema migration introducing `Organisation` and `Entity.organisationId` is
additive (expand-only): existing columns remain compatible, and a single
organisation can be backfilled for the current customer without data loss.
Rollback is possible by reverting the migration before any second tenant is
onboarded; once a second organisation's data exists, rollback requires an
explicit data-preserving migration instead of a schema revert.

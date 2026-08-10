# 0002 — Membership-based RBAC with a configurable default compliance approver

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

Authorisation today is a single global enum role (`DATA_OWNER`,
`SUSTAINABILITY_LEAD`, `FINANCE`, `ADMIN`) stored on `User` and read from the
JWT session. There is no organisation membership, no site scope, and no
configurable permission model. A JWT role can become stale after a role
change takes effect server-side. The EMS expansion introduces
compliance-obligation approval, a decision the business requires to default
to the Sustainability Lead function only, without hard-coding that rule into
application logic.

## Decision

Replace the global role enum, for authorisation purposes, with
organisation-scoped membership and configurable role-based permissions:
`OrganisationMembership`, `RoleDefinition`, `PermissionDefinition`,
`RolePermission`, and `MembershipRole`/`MembershipScope`. Permission checks
are evaluated from current database membership state on every request, never
from the JWT role claim, so removed or suspended memberships take effect
immediately.

The permission `ems.compliance_obligation.approve` is granted only to the
Sustainability Lead system role template by default. The Organisation
Administrator system role template receives role/permission-management
capability but does **not** receive `ems.compliance_obligation.approve` by
default. The approval rule is expressed as configurable permission data, not
as a hard-coded "is Sustainability Lead" check, so an organisation may
reassign it deliberately, but the shipped default and seed data always
withhold it from Administrator.

## Alternatives considered

- **Keep the global enum role and add an `organisationId` to `User`.**
  Rejected: a single role per user cannot express "site-scoped reviewer in
  Organisation A, no access in Organisation B," and cannot support
  configurable permission sets per organisation.
- **Hard-code the compliance-approval check as `role === SUSTAINABILITY_LEAD`
  in code.** Rejected: the requirement is that approval stays configurable
  through permissions, and a hard-coded role check cannot be safely
  reassigned or audited as data.
- **Authorise from JWT claims for performance.** Rejected: stale JWT claims
  after a role or membership change is an explicit current gap this decision
  must close; permission evaluation must read live membership state.

## Consequences

- Every authorisation check moves from `session.user.role` to a permission
  evaluation service backed by current membership rows.
- Seed/test data must include the six system role templates and the
  permission catalogue as synthetic fixtures; no real personnel data is used.
- Administrator gaining role-management rights without compliance-approval
  rights must be covered by an explicit test, not left implicit.
- Legacy `User.role` remains present temporarily for rollback safety until a
  later tenancy-contract task retires it; no production authorisation path
  may read it once this decision is implemented.

## Rollback / migration note

`OrganisationMembership` and the permission tables are additive; the legacy
`User.role` column and its current authorisation call sites are left in place
until membership-based checks are proven in an equivalent later task.
Rollback before that cutover is a matter of disabling the new permission
checks and continuing to read `User.role`; rollback after the cutover
requires restoring the legacy authorisation path from version control rather
than reverting a schema migration.

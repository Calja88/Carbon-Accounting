# 0007 — Preserve carbon and LCA domain boundaries during EMS expansion

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The platform already contains two mature, separately governed domains: a
corporate Scope 1/2/3 carbon inventory with versioned factor sets, factor
snapshots on calculation, and immutable report snapshots; and a product
LCA/PCF system with its own pure calculation engine, issued/verified version
locking, and an append-only LCA audit trail. Corporate totals and product
intensity results are deliberately never combined today. The EMS expansion
adds a large number of new domains (aspects/impacts, legal register,
objectives/actions, audits, incidents/CAPA, competence, management review)
that will want to reference carbon and LCA data as evidence or as metric
sources.

## Decision

The EMS is added as additional bounded domains alongside the existing carbon
and LCA domains within the same modular monolith, not merged into their
tables or engines. The corporate calculation engine, the LCA pure engine,
factor/version snapshotting, immutable reports, issued LCA versions, and
their existing tests are preserved unless a specific, explicitly scoped task
states otherwise. Where EMS objectives or dashboards need carbon/LCA figures,
they reference the existing calculated results through a read-only adapter
that exposes provenance and version rather than copying values into a second
calculation system. LCA intensity results and corporate absolute totals
remain explicitly distinguished wherever EMS surfaces them.

## Alternatives considered

- **Fold EMS aspect/impact data directly into the carbon or LCA schema.**
  Rejected: aspects and impacts are a broader environmental-management
  concept than either domain models today, and merging schemas would risk
  destabilising factor snapshotting and immutable-report invariants that are
  load-bearing for existing customers.
- **Recalculate carbon/LCA figures inside the EMS domain for convenience.**
  Rejected: a second calculation path for the same figures creates a
  reconciliation risk and undermines the "one source of truth per number"
  property the existing engines were built to guarantee.
- **Rewrite the carbon/LCA domains as part of this expansion.** Rejected: the
  current-state assessment found strong existing foundations (auditability,
  versioning, immutability) that should be preserved, not replaced; the
  expansion's stated architectural limitation is tenancy, not the domain
  engines themselves.

## Consequences

- Any task touching carbon/LCA behaviour must justify the change explicitly
  and keep the golden regression tests (see the regression-invariants
  manifest) passing.
- EMS metric adapters are read-only with respect to carbon/LCA data; no EMS
  write path may mutate a carbon calculation, factor snapshot, or LCA version.
- Future EMS features referencing carbon/LCA numbers must carry provenance
  (which calculation/version the figure came from) rather than a bare value.

## Rollback / migration note

This decision constrains future work rather than changing code itself, so
there is nothing to roll back at this stage. If a later task is found to have
violated this boundary, the remedy is reverting that task's change, not
reverting this ADR.

# 0006 — Shared controlled-document and evidence storage

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

Corporate source documents are currently MIME allow-listed, size-capped,
hashed, and stored as bytes directly in PostgreSQL. Product LCA evidence uses
a separate provider abstraction. The EMS expansion needs evidence across many
new domains (aspects/controls, audits, incidents, competence, legal sources,
management review) plus a controlled-document lifecycle (draft, review,
approved, effective, obsolete) that neither existing mechanism fully
provides today.

## Decision

Adopt the existing LCA evidence provider abstraction as the shared storage
mechanism for new EMS evidence and controlled documents, rather than
introducing a third storage mechanism. Add controlled-document/revision
records (checksums, draft/review/approved/effective/obsolete states,
reviewers, approvers, effective/review dates, classification, and retention
metadata) as a domain layer on top of that shared provider. An approved
revision is immutable; a change creates a successor revision rather than
mutating the approved one. Downloads are checked against both tenant
membership and classification permissions. A malware-scanning interface is
defined even where the initial development-environment provider implementation
is a no-op, so the seam is not skipped.

## Alternatives considered

- **Keep corporate documents on PostgreSQL bytes and add EMS evidence there
  too.** Rejected: this does not scale for larger multi-tenant evidence
  volume and does not provide the provider seam needed for future object
  storage.
- **Build a brand-new evidence storage system for EMS.** Rejected: a third
  storage mechanism alongside the corporate byte-storage path and the LCA
  provider would fragment checksum/retention/classification handling and
  duplicate work the LCA provider already does correctly.
- **Migrate corporate document bytes into the LCA provider immediately.**
  Rejected for this decision's scope: migrating existing file bytes is a
  separate, higher-risk data-migration task; this ADR adapts the provider
  abstraction for new EMS evidence without moving existing corporate bytes
  yet.

## Consequences

- New EMS evidence and controlled documents must go through the shared
  provider abstraction, not a new bespoke path.
- Every evidence link must retain checksum, uploader, timestamp, organisation
  scope, classification, and retention state.
- Existing corporate document byte storage is left in place for now; a
  future, explicitly scoped task would be required to migrate those bytes if
  ever needed.

## Rollback / migration note

Adapting the provider interface for EMS evidence is additive and does not
alter existing LCA evidence rows or corporate document storage. Rollback is a
plain revert of the new controlled-document tables and adapter code; no
existing evidence data is touched by this decision.

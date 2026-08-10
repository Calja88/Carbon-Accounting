# 0008 — Official legal-source detection is separate from applicability and compliance decisions

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The EMS expansion introduces a legal register sourced from an official UK
publication feed (legislation.gov.uk) and, separately, an AI assistance layer
that already exists in the platform as an optional, fail-soft, non-authoritative
assistant. The legal register must detect and record legislative changes;
someone must then decide whether a given change applies to a given
organisation/entity/site/process/aspect, and separately, whether the
organisation is compliant with a resulting obligation. These are three
different kinds of judgement with different authority requirements, and
conflating them risks the platform appearing to make legal or compliance
decisions it is not authorised or competent to make.

## Decision

Detection of an official legal source change is a mechanical, provider-driven
process that never infers or implies applicability. A source change never
directly changes an active compliance obligation. A competent, permitted
human user must explicitly assess applicability (decision, rationale,
reviewer, evidence, and review date all required), and a separately
permitted human user (by default, only the Sustainability Lead permission
holder, per ADR 0002) must explicitly approve any resulting compliance
obligation version. AI may suggest or summarise a source or a candidate
change, but AI may never set an applicability decision, approve an
obligation, decide compliance status, close a nonconformity, or assert ISO
conformity/certification anywhere in the product.

## Alternatives considered

- **Let AI pre-fill an applicability decision that a human can overwrite.**
  Rejected: a pre-filled decision, even if editable, creates an anchoring
  effect and blurs accountability for a legal judgement that must remain
  human and auditable.
- **Auto-apply source changes to obligations when the match looks exact.**
  Rejected: legal text changes can carry consequences (repeal, amendment
  scope, commencement date) that a mechanical match cannot safely resolve;
  the acceptance criteria require obligations to remain versioned and
  independently approved.
- **Treat legal-source sync and compliance evaluation as a single workflow
  stage.** Rejected: keeping applicability, obligation approval, and
  compliance evaluation as distinct, separately permissioned steps is what
  makes each decision auditable and attributable to a named accountable
  person.

## Consequences

- The legal-source data model keeps immutable source/version/change-event
  provenance separate from the applicability and obligation-approval tables.
- Every applicability and obligation-approval action must be audited with
  actor, rationale, and timestamp.
- Product copy and UI must avoid language implying the platform itself has
  determined compliance or certification status.

## Rollback / migration note

This decision constrains later legal-register and AI-assistance tasks rather
than changing existing code. No migration is implied; if a later
implementation is found to violate this boundary, the remedy is fixing that
implementation, not reverting this ADR.

# Pilot gate register — gate 9 (licensed ISO/legal review), T84

Docs/PHASE8_HARDENING_READINESS_SPEC.md §1, gate 9: "Licensed ISO
14001:2026 requirement mapping." This register tracks the human-owned
readiness decisions for that gate only; it does not itself grant, deny, or
imply pilot approval, and it stores no ISO 14001:2026 standard text.

## Scope of this task (T84)

T84 delivered the configuration/content-review support named in the spec:

- `StandardRequirementMap` gained gap tracking (`gapStatus`,
  `gapDescription`), an owner decision (`ownerDecision`,
  `ownerDecisionAt`), and a competent-review record
  (`competentReviewerUserId`, `competentReviewedAt`,
  `competentReviewOutcome`, `competentReviewNotes`).
- Evidence objects can now be linked directly to a requirement mapping row
  (`resourceType: "standard_requirement_map"`).
- A new sensitive permission, `ems.readiness.review`, gates who may record
  a competent review outcome (Sustainability Lead and Organisation
  Administrator by default).
- See `docs/readiness/iso-14001-2026-mapping-template.md` for the owner
  workflow this supports.

T84 did **not** decide environmental significance, legal applicability,
compliance status, certification interpretation, or records-retention
policy for any organisation — those remain owner/competent-reviewer
decisions recorded through the fields above, never platform defaults.

## Gate 9 owner decisions still required (per-organisation, outside this repo)

| Item | Status | Owner |
| --- | --- | --- |
| Licensed ISO 14001:2026 copy obtained and internally distributed | Not tracked by this platform | Organisation |
| Requirement-to-feature/process/evidence mapping completed for the organisation's chosen scope | Owner-entered via `StandardRequirementMap` | Organisation |
| Competent legal review of source coverage, applicability method, evaluation cadence | Owner-entered via `recordCompetentReview` | Named competent reviewer |
| Certification-body independence confirmed (no certification claim made by this platform) | See "Certification-body independence" below | Organisation / certification body |
| Claims-language review of product/marketing copy | See "Standard-text/certification-claim safeguards" in the T84 task report | Organisation |

## Certification-body independence

This platform does not certify organisations, does not act as or on behalf
of a certification body, and does not issue ISO certificates. Any
certification status shown in the product must originate from, and be
attributed to, an independent accredited certification body — never
generated or asserted by this platform.

## Residual risk

This register is a record-keeping aid. It does not verify, on its own,
that an organisation's mapping is complete, that its competent review was
adequate, or that its claims language is accurate at any point in time —
those remain ongoing owner responsibilities.

# Licensed ISO 14001:2026 requirement mapping — owner template (T84)

Docs/PHASE8_HARDENING_READINESS_SPEC.md §8: "licensed ISO 14001:2026
requirement-to-feature/process/evidence mapping" performed by "authorised
humans" against their own licensed standard copy.

**This file is an empty, reusable template. It contains no ISO 14001:2026
standard text, no clause wording, and no paraphrase of clause wording — and
must never be edited to add any.** Anyone using this template supplies their
own `requirementKey` values (e.g. a bare clause number such as `6.1.2`) by
reading their own licensed copy of the standard; this repository never
stores or displays the standard's content.

The data described here is recorded and edited through the application, not
this file — `StandardRequirementMap` rows (`src/lib/ems/foundation/programme-service.ts`,
`upsertStandardRequirementMap` / `recordCompetentReview`). This document
explains the fields and the review process; it is not itself a data record.

## How to use this template

1. Open your organisation's licensed ISO 14001:2026 copy. This platform does
   not provide it and does not claim to.
2. For each requirement you choose to track, create or update a
   `StandardRequirementMap` row with:
   - `standardProfile` — an identifier for the standard edition you are
     mapping against (e.g. `"ISO-14001-2026"`), never the standard's title
     text copied verbatim if that text is itself licence-restricted.
   - `requirementKey` — a bare clause/requirement identifier (e.g. `6.1.2`),
     never clause wording.
   - `implementationStatus` — `NOT_STARTED` / `IN_PROGRESS` / `IMPLEMENTED` /
     `NOT_APPLICABLE`, your own assessment.
   - `notes` — your own organisation-authored implementation notes. Do not
     paste, quote, or closely paraphrase standard text here.
3. Link existing implemented evidence/control records (audit findings,
   controlled documents, monitoring results, competence evidence, and so
   on) to the row using the shared evidence-link service
   (`resourceType: "standard_requirement_map"` in
   `src/lib/documents/evidence-service.ts`) or by pointing to the specific
   EMS record that already demonstrates the control.
4. Record any gap using `gapStatus` (`NOT_ASSESSED` / `NO_GAP` /
   `GAP_IDENTIFIED` / `REMEDIATION_PLANNED` / `RESOLVED`) and a
   `gapDescription` in your own words.
5. Record the resulting decision in `ownerDecision` and `ownerDecisionAt` —
   this is always a decision made by your organisation, never inferred or
   suggested by the platform or by AI.
6. Have a competent reviewer (see below) record their outcome with
   `recordCompetentReview`.

## Competent review

Docs/PHASE8_HARDENING_READINESS_SPEC.md §8 requires "competent legal review
of source coverage, applicability method and evaluation cadence" as a
distinct step from the owner's own mapping and gap decisions. In this
platform:

- Only members holding `ems.readiness.review` (Sustainability Lead and
  Organisation Administrator by default — see
  `src/lib/rbac/role-templates.ts`) may record a competent review outcome.
- `competentReviewOutcome` is one of `NOT_REVIEWED` / `REVIEWED_NO_ISSUES` /
  `REVIEWED_ISSUES_FOUND`, recorded by a named human reviewer
  (`competentReviewerUserId`, `competentReviewedAt`) with their own
  `competentReviewNotes`.
- Recording a review here is not a certification act, a compliance
  determination, or a legal opinion issued by this platform — it is a
  record that your named reviewer performed one, and their own notes on
  the outcome.
- This platform does not decide, infer, or default `gapStatus`,
  `ownerDecision`, or `competentReviewOutcome`. Every one of these fields
  is set only by an explicit, human-initiated action.

## Certification-body independence and claims language

- This platform is not a certification body, does not perform
  certification audits, and does not issue certificates.
- UI and product copy referring to this feature must avoid "ISO
  certified", "ISO compliant", or similar unqualified claims. Where status
  is shown, it must be clearly framed as the organisation's own
  self-assessment or a named third party's independently issued
  certificate/assessment status — never a claim made by this platform on
  the organisation's behalf.
- A completed mapping, a resolved gap, or a recorded competent review does
  not by itself mean the organisation is "ISO 14001:2026 certified" or
  "compliant." Certification remains a matter for an independent,
  accredited certification body; legal/compliance conclusions remain a
  matter for the organisation's own competent advisers.

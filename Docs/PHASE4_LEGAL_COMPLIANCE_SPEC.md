# Phase 4 Build Specification — Legal Register and Compliance Evaluation

**Implements:** T40–T46  
**Prerequisite:** Phase 2 jobs/evidence/audit and Phase 3 aspects/controls.  
**Outcome:** provider-neutral legal-source monitoring, official UK connector, human applicability, versioned compliance obligations, controlled approval and evidenced compliance evaluation.

## 1. Fixed decisions and authority boundaries

- Provider data is source evidence, not legal advice.
- Publication/effect detection never decides applicability.
- Applicability never automatically creates an active obligation.
- Only an approved obligation version becomes active.
- Only users with `ems.compliance_obligation.approve` can approve; only Sustainability Lead has it by default.
- Compliance status is a human, evidenced evaluation. AI cannot set it.
- An upstream amendment never silently edits an approved obligation; it opens a review candidate.
- Official legislation, permits, consents, regulator notices, contracts, customer requirements and voluntary commitments share the applicability/obligation workflow but retain distinct source types.

## 2. State machines

```text
LegalChangeEvent: DETECTED → TRIAGED → REVIEW_REQUIRED → REVIEWED → DISMISSED/CLOSED
ApplicabilityAssessment: DRAFT → IN_REVIEW → APPLICABLE / NOT_APPLICABLE / UNCERTAIN → SUPERSEDED
ComplianceObligationVersion: DRAFT → IN_REVIEW → APPROVED → ACTIVE → SUPERSEDED / RETIRED
                                  ↘ REJECTED
ComplianceEvaluation: PLANNED → IN_PROGRESS → COMPLETED → ISSUED
Evaluation item: NOT_EVALUATED → COMPLIANT / PARTIALLY_COMPLIANT / NONCOMPLIANT / NOT_APPLICABLE
```

`UNCERTAIN` requires an owner and follow-up date. `NOT_APPLICABLE` requires rationale and periodic/change-triggered review.

## 3. Provider-neutral source model

- `Jurisdiction`: stable code, name, country/subdivision, active flag.
- `LegalTopic`: organisation-neutral taxonomy; organisation may add local tags separately.
- `LegalSourceProvider`: provider key, name, authority/editorial type, configuration reference (no secret), enabled/status.
- `LegalSyncCursor`: provider, stream (`PUBLICATIONS`, `EFFECTS`, `VERSIONS`), jurisdiction/filter key, cursor, overlap start, last success/attempt, status.
- `LegalInstrument`: provider canonical ID/URI, type, year/number, title, extent/jurisdictions, made/published/commencement dates where supplied, status, latest source hash, last checked.
- `LegalInstrumentVersion`: instrument, provider version/retrieval time, metadata JSON, text/document storage reference if permitted, checksum, source URL.
- `LegalProvisionReference`: instrument/version, provider provision identifier/URI, label; no unlicensed copied prose.
- `LegalChangeEvent`: provider event ID, event type, affecting/affected instrument and provisions, detected/effective dates, source version/hash, raw evidence, dedupe key, status.
- `LegalReviewCandidate`: organisation, change event, matched jurisdiction/topic/watched instrument, priority, assignment, due date, disposition.

Platform source records are global authoritative references. `LegalReviewCandidate` and all human decisions are Organisation-owned. One global event may fan out to many tenant candidates through explicit matching rules.

## 4. Provider contract

```ts
interface LegalContentProvider {
  readonly key: string;
  discoverPublications(input: DiscoveryInput): Promise<DiscoveryPage>;
  discoverEffects(input: EffectsInput): Promise<DiscoveryPage>;
  getInstrument(canonicalId: string): Promise<ProviderInstrument>;
  getVersionMetadata(canonicalId: string): Promise<ProviderVersion>;
  healthCheck(): Promise<ProviderHealth>;
}
```

Every returned object is Zod validated before persistence. Client requirements: timeout, bounded retry, user agent/contact, response-size limit, content-type validation, pagination ceiling, circuit status, structured errors and no secrets in logs.

For legislation.gov.uk, keep publication and effects streams/cursors separate. Poll with overlap because publication/effect metadata may appear at different times. Tests use recorded official fixtures and no live network.

## 5. Applicability and obligation model

- `ApplicabilityAssessment`: organisation, source/instrument/change/other requirement, decision, rationale, assessed scopes (Entity/Site/process/aspect), competent assessor, reviewer, dates, evidence, supersedes link.
- `ComplianceObligation`: stable organisation reference and current active version pointer.
- `ComplianceObligationVersion`: obligation, version, title, competent-person requirement summary, source/provisions, applicability assessment, owner, frequency/trigger, effective/review dates, controls/aspects/sites/entities, status, prepared/approved identities and times.
- `ComplianceObligationApproval`: append-only exact-version decision (`APPROVED`, `REJECTED`, `RETURNED`), approver, time, comment, permission snapshot code.
- `ObligationChangeReview`: source change event, affected obligation version, impact assessment, decision (`NO_CHANGE`, `REVISE`, `RETIRE`, `SEEK_ADVICE`), reviewer/follow-up.
- `OtherRequirementSource`: type, issuing party, reference, dates, controlled evidence, status.

Approved version columns that describe the obligation are immutable. New content creates a successor draft linked to the current version. Active pointer changes only inside approval transaction.

## 6. Compliance evaluation model

- `ComplianceEvaluationProgramme`: period, scope, evaluator assignment, schedule, status.
- `ComplianceEvaluation`: programme, date/range, entities/sites, lead, status, issued snapshot and evidence.
- `ComplianceEvaluationItem`: evaluation, exact obligation version, status, rationale, evaluator, evaluated time, evidence, follow-up date.
- `ComplianceEvaluationFindingLink`: item to NC/action interface.

Evaluation issue freezes obligation versions and item outcomes. Later obligation revisions do not rewrite the issued evaluation.

## 7. Matching and triage

Candidate matching may use deterministic metadata only:

- organisation jurisdiction subscriptions;
- watched instruments/provisions;
- configured legal topics/keywords;
- Entity/Site jurisdiction; and
- active obligation source links.

Match produces a review candidate with transparent reasons. It does not infer applicability. AI may summarise validated source metadata in a clearly labelled draft but may not provide or fabricate legal interpretation/citations.

## 8. Modules/routes

```text
src/lib/ems/legal/provider/types.ts
src/lib/ems/legal/provider/registry.ts
src/lib/ems/legal/provider/legislation-gov-uk.ts
src/lib/ems/legal/provider/schemas.ts
src/lib/ems/legal/legal-source-service.ts
src/lib/ems/legal/legal-sync-worker.ts
src/lib/ems/legal/candidate-matcher.ts
src/lib/ems/legal/applicability-service.ts
src/lib/ems/legal/obligation-service.ts
src/lib/ems/legal/evaluation-service.ts
src/lib/ems/legal/other-requirement-service.ts
src/app/(app)/ems/legal/sources/**
src/app/(app)/ems/legal/updates/**
src/app/(app)/ems/legal/applicability/**
src/app/(app)/ems/legal/obligations/**
src/app/(app)/ems/legal/evaluations/**
src/app/(app)/ems/legal/provider-health/**
src/app/api/ems/legal/obligations/export/route.ts
src/app/api/ems/legal/evaluations/[id]/report/route.ts
```

## 9. Security/domain tests

- Fixture replay and overlapping polls create no duplicate instruments/versions/events.
- Cursor advances only after committed batch; timeout/rate limit/parser error leaves cursor retryable.
- Delayed effects attach after original publication without replacing history.
- Global event fan-out creates only candidates matching each Organisation's configuration.
- Foreign candidate/applicability/obligation/evaluation/source IDs fail without existence disclosure.
- Mixed A obligation + B aspect/control/site/evidence fails.
- Source event does not create active obligation or change evaluation status.
- AI output cannot submit decision/approval endpoints.
- Organisation Administrator default approval attempt is denied.
- Sustainability Lead approval checks current grant and exact version.
- Approved version update/delete fails; successor revision succeeds.
- Self-approval denied when four-eyes enabled.
- Revoked/suspended approver denied after page load.
- `NOT_APPLICABLE` and `UNCERTAIN` require rationale; uncertain requires follow-up.
- Issued evaluation pins exact obligation versions and is immutable.
- Noncompliance link creates a request/interface call; it does not auto-close or fabricate NC details.
- Legal exports contain only selected Organisation decisions plus allowed public source metadata.
- Provider raw evidence obeys reuse/licence/storage limits.

## 10. PR sequence

```text
P4-01 Provider-neutral source schema/cursors/events (T40)
P4-02 legislation.gov.uk client, parsers and offline fixtures (T41)
P4-03 Sync worker, overlap/idempotency/health (T42 core)
P4-04 Organisation subscriptions, candidate matching and review queue (T42 UI)
P4-05 Applicability assessment workflow (T43)
P4-06 Obligation/version/source links (T44 model/edit)
P4-07 Approval transaction and adversarial permission tests (T44 approval)
P4-08 Evaluation programme/items/issued report (T45)
P4-09 Other requirements/manual sources (T46)
P4-10 Legal register exports, dashboards and end-to-end replay
```

## 11. Definition of done

Recorded official fixtures are ingested idempotently; relevant synthetic Organisations receive review candidates; a competent user records applicability; only the configured Sustainability Lead default permission approves an exact obligation version; evaluations are human, evidenced and frozen. Nothing claims automatic legal completeness.

## 12. Minimal Claude context

| Task | Provide |
|---|---|
| T40 | §§1–3, Phase 2 outbox/audit contracts, no UI files |
| T41 | provider interface/client requirements + official fixture samples only |
| T42 | sync/matching sections + job framework; no obligation workflow |
| T43 | applicability state/model/tests + aspect/scope search interfaces |
| T44 | obligation/approval model, permission catalogue, approval tests |
| T45 | evaluation model/state/tests + NC interface only |
| T46 | other-requirement model and controlled-evidence interface |

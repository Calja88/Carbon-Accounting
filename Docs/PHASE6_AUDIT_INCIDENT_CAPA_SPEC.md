# Phase 6 Build Specification — Audits, Incidents, Nonconformity and CAPA

**Implements:** T60–T64  
**Prerequisite:** EMS foundation, aspects/controls, legal evaluations and shared actions.  
**Outcome:** risk-based audit programmes, controlled audit execution/reports, environmental incident intake, nonconformity, root cause, corrective action, effectiveness review and controlled closure.

## 1. Fixed decisions

- An `AuditEvent` is system change history; an `EmsAudit` is a planned management-system audit. Names and modules must prevent confusion.
- Audit programmes and reports pin exact criteria/checklist/source versions.
- Audit independence is represented and checked, not assumed from a role name.
- Incidents and nonconformities are distinct records with optional links.
- Reporting an incident does not automatically conclude legal reportability or noncompliance.
- Findings may originate from audits, incidents, compliance evaluations, complaints, monitoring, emergency exercises or manual observation.
- Containment, root cause, corrective action, completion, effectiveness and closure are separate decisions.
- When four-eyes is enabled, the action owner cannot perform final effectiveness review/closure.
- Issued audit reports and closed NC snapshots are immutable; reopening is an explicit event.

## 2. State machines

```text
AuditProgramme: DRAFT → APPROVED → ACTIVE → COMPLETED / SUPERSEDED
EmsAudit: PLANNED → PREPARATION → IN_PROGRESS → REPORT_DRAFT → REPORT_ISSUED → CLOSED
AuditFinding: DRAFT → CONFIRMED → ACTION_REQUIRED / ACCEPTED_OBSERVATION → CLOSED
EnvironmentalIncident: REPORTED → TRIAGED → INVESTIGATING → RESPONSE_COMPLETE → CLOSED / REOPENED
Nonconformity: OPEN → CONTAINED → ROOT_CAUSE_APPROVED → ACTIONS_IN_PROGRESS → EFFECTIVENESS_REVIEW → CLOSED / REOPENED
CorrectiveAction: OPEN → IN_PROGRESS → COMPLETED → VERIFIED / REOPENED / CANCELLED
```

Transition guards return typed reasons; generic update endpoints may not set status.

## 3. Audit model

- `AuditProgramme`: organisation/programme, period, objectives, risk basis, scope, coverage targets, owner, approval/status/version.
- `AuditProgrammeItem`: planned audit, sites/processes/aspects/obligations/standard-map scope, timing, priority/rationale.
- `EmsAudit`: programme item optional, type (`INTERNAL`, `SUPPLIER`, `COMPLIANCE`, `SYSTEM`, `PROCESS`, `OTHER`), title, objectives, criteria summary/references, scope, lead, dates/status.
- `AuditTeamMember`: membership/person, role, competence evidence links, independence declaration and conflict decision.
- `AuditChecklistVersion`: audit, version, frozen questions/criteria/expected evidence.
- `AuditQuestionResponse`: checklist item, result, notes, evidence, auditor/time.
- `AuditFinding`: audit, type/configured classification, statement, objective evidence, criterion/requirement reference, scope, owner, due date, confirmation metadata.
- `AuditReportRevision`: audit, draft/issued number, frozen payload/storage/checksum, preparer/reviewer/issuer, issued time.
- `AuditCoverageSnapshot`: frozen coverage by Site/process/aspect/obligation/internal requirement.

Do not hard-code certification-body classifications. Organisation config may label severities, while stable internal categories remain generic.

## 4. Incident and nonconformity model

- `EnvironmentalIncident`: reference, reported/occurred/discovered times, Site/process/aspect, type, factual description, severity config snapshot, immediate response, potential receptors, external notification review state, reporter, restricted flag, evidence.
- `IncidentCorrection`: append-only correction to factual record with reason; original retained.
- `IncidentNotificationAssessment`: authority/party, due trigger, decision (`NOT_REQUIRED`, `REQUIRED`, `UNCERTAIN`), competent reviewer, rationale/evidence/time. Never automatic legal advice.
- `Nonconformity`: reference, source type/id, statement, requirement/obligation/control reference, classification config snapshot, owner, dates/status.
- `ContainmentRecord`: action taken, owner/time, evidence, adequacy review.
- `RootCauseAnalysis`: method (`FIVE_WHYS`, `FISHBONE`, `FAULT_TREE`, `OTHER`), analysis payload, contributors, conclusion, reviewer/approval.
- `CorrectiveAction`: NC, optional shared action link, description, owner, due date, completion criteria, status, evidence.
- `EffectivenessReview`: NC/actions, criteria, review date, reviewer, evidence, result (`EFFECTIVE`, `PARTIALLY_EFFECTIVE`, `INEFFECTIVE`), decision.
- `NonconformityClosure`: exact NC/action/review snapshot, closer/time, rationale; reopen creates event and successor workflow state.
- `LessonsLearnedLink`: affected aspects, controls, training, objectives, risk, documents and management-review input.

## 5. Permissions and confidentiality

- `ems.audit_programme.manage`, `ems.audit.perform`, `ems.audit_report.issue`.
- `ems.incident.report` allows minimal safe intake.
- `ems.incident.manage` allows triage/investigation; add `ems.incident.restricted.view` for confidential records.
- `ems.nonconformity.manage`, `ems.corrective_action.manage`, `ems.corrective_action.effectiveness_review`.
- Audit issue, root-cause approval, effectiveness review and closure are sensitive live-checked permissions.

Restricted incident list/search/count/notification text must not leak presence, person, type or Site to unauthorised members.

## 6. Integration interfaces

Use explicit commands, not direct cross-module writes:

```ts
createNonconformityFromSource(ctx, {
  sourceType,
  sourceId,
  statement,
  requirementRefs,
});

createActionFromFinding(ctx, findingId, input);
publishManagementReviewInput(ctx, sourceType, sourceId, summaryRef);
```

Legal evaluation/emergency exercise/monitoring may request NC creation; a user confirms required content. Closing NC may propose updates to aspects/controls/documents/competence but cannot silently mutate them.

## 7. Modules/routes

```text
src/lib/ems/audits/programme-service.ts
src/lib/ems/audits/audit-service.ts
src/lib/ems/audits/checklist-service.ts
src/lib/ems/audits/finding-service.ts
src/lib/ems/audits/report-service.ts
src/lib/ems/incidents/incident-service.ts
src/lib/ems/incidents/notification-assessment-service.ts
src/lib/ems/nonconformity/nonconformity-service.ts
src/lib/ems/nonconformity/root-cause-service.ts
src/lib/ems/nonconformity/corrective-action-service.ts
src/lib/ems/nonconformity/effectiveness-service.ts
src/app/(app)/ems/audits/**
src/app/(app)/ems/incidents/**
src/app/(app)/ems/nonconformities/**
src/app/api/ems/audits/[id]/report/route.ts
src/app/api/ems/incidents/[id]/evidence/[evidenceId]/route.ts
src/app/api/ems/nonconformities/export/route.ts
```

## 8. Adversarial/domain tests

- Foreign/mixed programme/audit/checklist/question/finding/report IDs fail.
- Audit team member and scope resources must belong to Organisation and accessible scope.
- Independence conflict blocks assignment/issue when policy requires it.
- Checklist/report pins exact versions; later edits do not change issued report.
- Issued report cannot be changed/deleted; foreign report download reveals nothing.
- Minimal incident reporter can create but not browse restricted incidents.
- Restricted incident aggregate/search/notifications leak no existence.
- Incident correction retains original.
- Notification assessment requires competent reviewer/rationale; system never auto-decides reportability.
- NC source belongs to same Organisation; duplicate source links supported without duplicate NC creation where idempotency key used.
- Closure fails without containment/root cause/actions/effectiveness requirements configured by policy.
- Action owner cannot effectiveness-review own action under four-eyes.
- `INEFFECTIVE` reopens/follow-up; it cannot close.
- Permission revoked or member suspended before issue/closure causes denial.
- Reopen preserves closure snapshot and history.
- Lessons-learned links never silently edit target modules.
- All scenarios use fictional incidents/findings.

## 9. PR sequence

```text
P6-01 Audit programme/scope/coverage (T60)
P6-02 Audit team/independence/checklist versioning (T60/T61)
P6-03 Execution, evidence and findings (T61)
P6-04 Frozen audit report, export and coverage dashboard (T61)
P6-05 Incident intake/confidentiality/corrections (T62)
P6-06 Incident investigation and notification assessment (T62)
P6-07 Nonconformity/source/containment workflow (T63)
P6-08 Root cause and corrective actions (T64)
P6-09 Effectiveness/closure/reopen/lessons (T64)
P6-10 End-to-end adversarial and separation-of-duties suite
```

## 10. Definition of done

A synthetic tenant can programme and issue an internal audit, report a restricted fictional incident, create/link an NC, document containment/root cause/actions, independently review effectiveness and close/reopen with frozen history. No workflow asserts certification or legal reportability automatically.

## 11. Minimal Claude context

| Task | Provide |
|---|---|
| T60 | audit programme/model/independence sections + competence interface stub |
| T61 | checklist/finding/report sections + controlled evidence/report pattern |
| T62 | incident model/confidentiality/tests + Site/aspect/evidence interfaces |
| T63 | NC model/state/source command interface + legal/audit source IDs |
| T64 | root cause/action/effectiveness/closure sections + shared action service |


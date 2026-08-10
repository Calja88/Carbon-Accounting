# Phase 7 Build Specification — Competence, Awareness and Management Review

**Implements:** T70–T73  
**Prerequisite:** operational controls, actions, audits, compliance and CAPA.  
**Outcome:** competence requirements/assignments/evidence/expiry and deterministic, versioned management-review packs, decisions, minutes and actions.

## 1. Fixed decisions

- Login identity and person/contractor profile are linked, not duplicated.
- Competence is not synonymous with attendance. Training may be one evidence type.
- Sensitive person/training/licence data has dedicated permissions and retention.
- Expiry creates a gap/notification; it does not delete historical competence.
- Management-review packs are deterministic snapshots of linked records at a cutoff.
- AI may draft a labelled narrative from the frozen pack but cannot create decisions, conclusions or approval.
- Approved minutes and issued packs are immutable; corrections require a successor/addendum.
- No real employee, contractor, medical, licence or training data is seeded.

## 2. State machines

```text
CompetenceRequirementVersion: DRAFT → APPROVED → ACTIVE → SUPERSEDED
CompetenceAssignment: REQUIRED → IN_PROGRESS → EVIDENCE_SUBMITTED → COMPETENT / GAP / EXPIRED
TrainingEvent: PLANNED → DELIVERED → COMPLETED / CANCELLED
CompetenceAssessment: DRAFT → COMPLETED → SUPERSEDED
ManagementReview: PLANNED → INPUT_COLLECTION → PACK_ISSUED → HELD → MINUTES_DRAFT → APPROVED → CLOSED
```

## 3. Competence and awareness model

- `PersonProfile`: organisation, optional User ID, type (`EMPLOYEE`, `CONTRACTOR`, `OTHER`), display identifier/name, Entity/Site, active dates, restricted metadata pointer. Avoid duplicating email/auth fields unless needed for non-users.
- `CompetenceRequirement`: stable reference/current version.
- `CompetenceRequirementVersion`: description, applies-to role/process/aspect/control/obligation/emergency role, validity/renewal rules, acceptable evidence/assessment rules, approver/status.
- `CompetenceAssignment`: exact requirement version, person, assigned/due dates, status, owner.
- `CompetenceEvidence`: assignment/person, type (`TRAINING`, `QUALIFICATION`, `LICENCE`, `EXPERIENCE`, `ASSESSMENT`, `OTHER`), controlled evidence, issued/expiry dates, verifier/status.
- `CompetenceAssessment`: assignment, method/criteria snapshot, assessor, date, outcome, rationale, evidence, reassessment date.
- `TrainingCourseVersion`: title/provider/objectives/content reference, validity and approval.
- `TrainingEvent`: exact course version, date/location/method, trainer, attendee assignments, evidence.
- `TrainingAttendance`: person, completion, result where relevant, acknowledgement.
- `AwarenessCampaign`: topic/audience/content revision/dates/owner.
- `AwarenessAcknowledgement`: person/campaign, acknowledged time/evidence.
- `CompetenceGap`: derived/read model or persisted workflow link with severity, mitigation/action and status.

Training completion may satisfy a requirement only where the approved requirement rule explicitly allows it; otherwise an assessment is required.

## 4. Management review model

- `ManagementReview`: organisation/programme, reference, period/cutoff, scheduled/held dates, chair, coordinator, status.
- `ManagementReviewAttendee`: member/person, role, attendance, conflicts/notes.
- `ManagementReviewAgendaTemplateVersion`: organisation, version, ordered agenda/input definitions, approval.
- `ManagementReviewInputDefinition`: stable key, source adapter type, required flag, period rule, presentation config.
- `ManagementReviewPack`: review, exact template version, cutoff, generation time, frozen JSON payload, file/checksum, generator version, issued by/time.
- `ManagementReviewInputSnapshot`: pack, input key, source type/IDs/versions, summary metrics, gaps/data freshness.
- `ManagementReviewDecision`: review, agenda/input link, decision type, text, rationale, owner/resources/timing.
- `ManagementReviewMinuteRevision`: draft/approved/addendum, controlled content/checksum, preparer/approver/times.
- `ManagementReviewActionLink`: decision to shared ActionItem.

Required default input keys may include context/interested-party changes, significant aspects, compliance status, objectives/performance, monitoring, communications, incidents/NC/CAPA, audits, competence, resources, risks/opportunities, prior actions and improvement opportunities. Labels/config are editable; do not paste ISO wording.

## 5. Pack adapter contract

```ts
interface ReviewInputAdapter {
  readonly key: string;
  collect(ctx, reviewScope, cutoff): Promise<ReviewInputSnapshot>;
}
```

Adapters query frozen/issued versions where available, report freshness and gaps, and return stable sorted data. Same database snapshot/cutoff and generator version must serialize identically. AI narrative runs after pack freeze and is stored as a reviewed optional attachment, never inside authoritative metric fields.

## 6. Permissions/privacy

- `ems.competence.view` for non-sensitive gap/status views; `ems.competence.manage` for requirements/person/evidence/assessment.
- Add `ems.competence.sensitive.view` for detailed certificates/results where needed.
- `ems.management_review.manage` for scheduling/input/minutes draft; `ems.management_review.approve` for pack/minutes approval.
- Person subject access and retention are explicit; Organisation Administrator sees configuration/metadata only unless separately granted sensitive competence permission.

## 7. Modules/routes

```text
src/lib/ems/competence/person-service.ts
src/lib/ems/competence/requirement-service.ts
src/lib/ems/competence/evidence-service.ts
src/lib/ems/competence/training-service.ts
src/lib/ems/competence/assessment-service.ts
src/lib/ems/competence/gap-service.ts
src/lib/ems/review/review-service.ts
src/lib/ems/review/agenda-service.ts
src/lib/ems/review/pack-service.ts
src/lib/ems/review/input-adapters/**
src/lib/ems/review/minutes-service.ts
src/app/(app)/ems/competence/**
src/app/(app)/ems/awareness/**
src/app/(app)/ems/management-reviews/**
src/app/api/ems/competence/export/route.ts
src/app/api/ems/management-reviews/[id]/pack/route.ts
src/app/api/ems/management-reviews/[id]/minutes/route.ts
```

## 8. Tests

- Foreign/mixed person/requirement/assignment/course/event/evidence/review/pack/source IDs fail.
- Organisation Administrator without sensitive grant cannot view certificate details/results.
- Site-scoped manager sees only allowed competence gaps, not unrelated personal data.
- Requirement revision does not alter historical assignment/assessment.
- Attendance does not establish competence unless exact rule permits.
- Expired evidence changes current gap state and sends deduplicated reminder while retaining history.
- Deactivated person remains in historical audit/review snapshots.
- Pack adapters use selected Organisation/scope/cutoff and exclude later changes.
- Same inputs/cutoff/version serialize identically with stable ordering.
- Pack records exact source IDs/versions and flags stale/missing inputs.
- Foreign pack/minutes download reveals no meeting title/attendees/filename.
- AI cannot populate decision or approval fields and is labelled draft attachment.
- Approved minutes/pack immutable; addendum links to original.
- Revoked/suspended approver denied after page load.
- Review actions link to shared actions and remain open after review closure.
- Synthetic people and records only.

## 9. PR sequence

```text
P7-01 Person profiles and competence requirement versioning (T70)
P7-02 Assignments, evidence, privacy and gap model (T70/T71)
P7-03 Courses/events/attendance/assessment/expiry reminders (T71)
P7-04 Awareness campaigns/acknowledgements (T71)
P7-05 Management review/attendee/agenda templates (T72)
P7-06 Input adapter interfaces and deterministic collectors (T72/T73)
P7-07 Frozen pack generation/download (T73)
P7-08 Decisions, approved minutes, actions and addenda (T73)
P7-09 Privacy/adversarial/determinism end-to-end suite
```

## 10. Definition of done

A synthetic organisation can define competence, assess fictional people, manage expiry/gaps and awareness, then issue a deterministic management-review pack, record human decisions, approve immutable minutes and track actions without leaking personal data or letting AI decide outcomes.

## 11. Minimal Claude context

| Task | Provide |
|---|---|
| T70 | competence/person models + privacy rules + Entity/Site/membership references |
| T71 | training/evidence/assessment/expiry sections + evidence/reminder services |
| T72 | review/agenda/input definitions + read-only interfaces from prior modules |
| T73 | pack adapter/determinism/minutes sections + report snapshot pattern and AI boundary |


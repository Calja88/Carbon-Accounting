# Phase 2 Build Specification — Shared EMS Foundation

**Implements:** T20–T24  
**Prerequisite:** Phase 1 complete through tenant contract constraints.  
**Outcome:** tenant-scoped EMS roots, context/planning, controlled documents, evidence, audit, reliable jobs, notifications and reminders. No real environmental records are seeded.

## 1. Fixed decisions

- One active EMS programme may contain many versioned scopes; historical programmes/scopes remain readable.
- Shared EMS audit events supplement, not replace, carbon/LCA provenance.
- Controlled document revisions are immutable after approval. New content creates a successor revision.
- Evidence bytes use one provider interface. Metadata and checksum live in Neon; storage keys are opaque.
- The database outbox is the reliability boundary. Domain writes and outbox events commit atomically.
- Notifications are derived delivery records, not evidence of task completion.
- ISO references store identifiers/internal mappings only. Do not seed copyrighted requirement text.

## 2. State machines

```text
EmsProgramme: DRAFT → ACTIVE → SUSPENDED → CLOSED
EmsScopeVersion: DRAFT → IN_REVIEW → APPROVED → SUPERSEDED
ControlledDocument: DRAFT → IN_REVIEW → APPROVED → EFFECTIVE → OBSOLETE
OutboxMessage: PENDING → LEASED → COMPLETED
                         ↘ RETRY → DEAD_LETTER
Notification: PENDING → DELIVERED → READ / DISMISSED
ChangeAssessment: DRAFT → REVIEW → APPROVED → IMPLEMENTED → EFFECTIVENESS_REVIEWED
```

Transitions are explicit service operations, permission checked, and audited. Status fields must not be updated through generic CRUD actions.

## 3. Normative data model

### EMS root and scope

- `EmsProgramme`: `organisationId`, name, status, standards profile identifier/version, owner membership, certification intent enum (`NONE`, `PLANNED`, `CERTIFIED_EXTERNALLY`), created/updated timestamps.
- `EmsScopeVersion`: programme, version number, statement, effective dates, exclusions and rationale, preparer, approver, approval time, status.
- `EmsScopeEntity` and `EmsScopeSite`: composite organisation-aware joins to existing Entity/Site.
- `EmsScopeActivity`: free-text structural activity/product/service included in the boundary; optional Site link.
- `StandardRequirementMap`: programme, standard/profile reference, internal requirement key, implementation status, owner, review date. `licensedText` must not exist unless licensing is separately approved.

Constraints: unique scope version per programme; exactly one current approved scope; Site must belong to an included Entity unless a documented exception is supported later.

### Context, interested parties, risk and change

- `ContextIssue`: type (`INTERNAL`, `EXTERNAL`, `ENVIRONMENTAL_CONDITION`), title, description, direction (`AFFECTS_ORGANISATION`, `AFFECTED_BY_ORGANISATION`, `BOTH`), significance, owner, review date, active dates.
- `InterestedParty`: name/type, influence, relationship owner, active status.
- `InterestedPartyRequirement`: party, requirement summary, source/evidence, mandatory/voluntary flag, evaluation/review date.
- `EmsRiskOpportunity`: source type/id, category, consequence, likelihood, initial/residual rating snapshots, controls/actions links, owner, status.
- `ChangeAssessment`: proposed change, trigger/date, affected scope/aspects/obligations/controls/documents/competence, assessment, decision, implementation and effectiveness review.
- `EnvironmentalPolicyRecord`: controlled-document revision link, approved/effective/review dates and top-management approver.

Ratings use organisation-configured scales stored as versioned JSON plus validated snapshots; no universal significance formula is seeded.

### Controlled documents and evidence

- `ControlledDocument`: organisation, reference, title, category, owner, review interval, current revision pointer, classification.
- `ControlledDocumentRevision`: document, revision number, status, change summary, content storage reference, SHA-256, MIME, size, prepared/reviewed/approved identities and times, effective/obsolete dates.
- `EvidenceObject`: organisation, filename, MIME, byte size, SHA-256, storage provider/key, classification, uploader/time, retention category, legal hold flag, malware scan status.
- `EvidenceLink`: evidence, resource type/id, purpose, linked by/time. Link service validates the target is in the same Organisation and is an allow-listed resource type.
- `DocumentDistribution`: revision, audience/member/role/site, issued/acknowledged dates.

No generic polymorphic link may skip target validation. Deleting metadata is prohibited while referenced, approved, issued, held or within retention.

### Audit, outbox and notifications

- `AuditEvent`: fields defined in Phase 1, append-only, indexed by organisation/resource/time/correlation.
- `OutboxMessage`: organisation nullable only for declared platform jobs, topic, version, payload, idempotency key, available time, lease owner/until, attempts, last error code/message, completed/dead-letter time.
- `JobRun`: job type, organisation, cursor/range, started/finished, status, counts, correlation and error summary.
- `Notification`: organisation, recipient membership, type, safe title/body, resource type/id, delivery/read/dismissed dates, dedupe key.
- `ReminderRule`: resource type/event, offset, recurrence, recipients resolution policy, active flag.

Outbox payloads contain stable IDs and safe metadata only—never file bytes, secrets, full environmental values or source-document text.

## 4. Permissions

Use Phase 1 catalogue. Required mappings:

- `ems.programme.manage`: programme/scope/context/risk/change records;
- `ems.policy.manage`: environmental policy workflow;
- `ems.controlled_document.manage`: document drafting/review workflow;
- add `ems.controlled_document.approve` before implementation if approval is separated (recommended; Sustainability Lead default);
- `audit.view` / `audit.export`; and
- organisation membership status must be active at every transition.

Author cannot approve their own policy/document revision when organisation four-eyes control is enabled.

## 5. Module and route contract

```text
src/lib/ems/foundation/types.ts
src/lib/ems/foundation/schemas.ts
src/lib/ems/foundation/programme-service.ts
src/lib/ems/foundation/context-service.ts
src/lib/ems/foundation/change-service.ts
src/lib/documents/document-control-service.ts
src/lib/documents/evidence-service.ts
src/lib/documents/storage/provider.ts
src/lib/jobs/outbox-service.ts
src/lib/jobs/worker.ts
src/lib/notifications/notification-service.ts
src/lib/notifications/reminder-service.ts
src/app/(app)/ems/page.tsx
src/app/(app)/ems/scope/**
src/app/(app)/ems/context/**
src/app/(app)/ems/changes/**
src/app/(app)/ems/documents/**
src/app/(app)/ems/audit/**
src/app/api/ems/evidence/[id]/route.ts
src/app/api/ems/documents/[id]/revisions/[revisionId]/route.ts
```

Server actions parse input, resolve OrganisationContext, check one named permission, and call services. Services own transitions and audit/outbox writes. Downloads check organisation, permission/classification, exact revision/evidence and non-disclosing errors before loading bytes.

## 6. Adversarial acceptance tests

- Foreign programme/scope/context/party/risk/change/document/evidence IDs return non-disclosing not-found.
- Mixed A document + B revision/evidence/target link fails in application and database constraints.
- Approved/effective document revision cannot be edited, replaced in place or deleted.
- Document download denial reveals no filename, MIME, size, checksum or existence.
- Suspended member cannot approve after page load.
- Revoked permission takes effect without re-login.
- Self-approval is denied when four-eyes enabled.
- Duplicate outbox delivery produces one domain effect.
- Lease expiry permits safe retry; concurrent workers cannot both complete the same message.
- Dead-letter preserves source event/correlation without sensitive payload.
- Notification recipient is revalidated as active/in-scope at delivery.
- Organisation B records do not affect A dashboard counts, reminders or audit export.
- Evidence legal hold blocks deletion; retention job is organisation scoped.
- Audit events cannot be updated/deleted through runtime application role.
- Every fixture is synthetic and contains no environmental performance data.

## 7. PR sequence

```text
P2-01 Audit event schema/service and Phase 1 event adoption (T20)
P2-02 Outbox/job schema, leasing and worker tests (T21)
P2-03 Evidence provider convergence and metadata (part of T22)
P2-04 Controlled documents/revisions/downloads (T22)
P2-05 EMS programme/scope/requirement mapping (part of T23)
P2-06 Context/interested parties/risk/change/policy (rest of T23)
P2-07 In-app notifications and reminder rules (T24)
P2-08 Foundation dashboards, audit/export and cross-tenant suite
```

## 8. Definition of done

- A synthetic tenant can approve a versioned EMS scope and policy, maintain context/interested parties/risks/change assessments, and retrieve controlled evidence.
- All material transitions create append-only audit events and reliable outbox messages atomically.
- Approved records and evidence provenance are immutable.
- Cross-tenant, mixed-parent and download attacks fail.
- No ISO clause text or real environmental record is seeded.

## 9. Minimal Claude context by task

| Task | Provide |
|---|---|
| T20 | This spec §§1–3 Audit only, Phase 1 audit event requirements, current LCA audit service as pattern |
| T21 | This spec state machine + outbox model/tests; Prisma client/Neon ADR |
| T22 | Document/evidence sections; current `documents-service.ts`, LCA evidence provider, download routes |
| T23 | EMS root/context sections and relevant permissions only |
| T24 | Notification/outbox sections and current app shell/user membership models |


# Claude Implementation Task Packets

These packets are deliberately narrow so an implementation agent does not need to rediscover the whole architecture. Run one packet per change/PR unless a packet explicitly says otherwise. Dependencies are strict.

## Global context to prepend to every task

```text
Repository: Next.js 16.3 / React 19 / TypeScript / Prisma 6.19 / PostgreSQL modular monolith.
Read AGENTS.md and the relevant Next.js 16 guide before editing.
Preserve the corporate carbon and product-LCA schemas, engines, factor snapshots, immutable reports/versions, and existing tests.
Target database is Neon PostgreSQL. No real environmental data may be added, copied, uploaded, logged, or used in tests; use synthetic fixtures only.
Entity means an operating/legal company inside a customer. Organisation is the new SaaS tenant above Entity.
All customer-owned access must be organisation-scoped. Never trust organisationId from a browser without membership validation.
The default compliance-obligation approver is Sustainability Lead only, implemented through configurable permissions rather than hard-coded role checks.
AI may suggest or summarise but may never decide legal applicability/compliance, approve an obligation, close a nonconformity, or claim ISO conformity.
Use Decimal for environmental numeric values. Approved/issued records are immutable and revised by successor versions.
Do not refactor unrelated code. Add/update tests for every acceptance criterion. Run the narrow test set, then the full suite and lint/type/build checks appropriate to the change.
```

Each task response should contain only: files changed, migration impact, tests run/results, residual risks, and any explicitly requested decision. Do not restate repository history.

## Phase 0 — Guardrails and Neon

### T00 — Golden regression manifest

**Depends on:** none  
**Goal:** create a documented, executable regression manifest for the existing carbon and LCA invariants.

**Scope:** inventory existing engine/report tests; add missing fixture-level tests only for factor snapshotting, Scope 2 non-double-counting, immutable report payloads, pure LCA repeatability, and issued-version immutability. Do not modify production behaviour.

**Deliverables:** `docs/architecture/regression-invariants.md`; focused tests beside existing carbon/LCA tests.

**Acceptance:** each invariant has at least one named test; all pre-existing tests pass; no database or real data is required.

### T01 — Architecture decision records

**Depends on:** none  
**Goal:** record accepted decisions for Organisation-above-Entity, membership-based RBAC, tenant repositories, later RLS, outbox jobs, and shared evidence storage.

**Scope:** documentation only. Create one concise ADR per decision with context, decision, alternatives, consequences, and migration note.

**Acceptance:** ADRs do not claim ISO certification or legal completeness; terminology matches the expansion plan.

### T02 — Neon pooled/direct configuration

**Depends on:** none  
**Goal:** configure Neon-compatible connections without connecting to a real database.

**Scope:** update `.env.example`, `prisma.config.ts`, Prisma client construction, deployment scripts, and README. Use `DATABASE_URL` for pooled runtime and `DIRECT_URL` for CLI/migrations. Remove `prisma migrate deploy` from the generic Next build and add an explicit release migration command.

**Acceptance:** missing variables fail with safe configuration messages; Prisma client remains singleton-safe; build does not mutate a database; documentation says migrations run once per release; unit/config tests use fake URLs.

### T03 — CI and unscoped-access rule

**Depends on:** T01  
**Goal:** prevent growth of direct, tenant-unaware Prisma calls.

**Scope:** establish allowed infrastructure/repository directories; add a static check that rejects new `prisma.*` calls in route/page/action modules except an explicit temporary allowlist of current files.

**Acceptance:** current baseline passes via checked-in allowlist; adding a new direct Prisma call to a server action makes the check fail; allowlist cannot use broad globs.

## Phase 1 — Multi-organisation and permissions

### T10 — Organisation and membership schema

**Depends on:** T00, T01  
**Goal:** introduce the tenant root without changing current authorisation.

**Scope:** add `Organisation`, `OrganisationMembership`, membership status enum, `organisationId` on `Entity`, timestamps, indexes, and tenant-consistent uniqueness. Create expand-only migration; existing columns remain compatible.

**Acceptance:** schema validates; migration is non-destructive; two organisations may have entities with the same name; an Entity must belong to exactly one Organisation after backfill phase, but expand migration may use a controlled nullable column if required.

### T11 — Permission schema and system templates

**Depends on:** T10  
**Goal:** add configurable RBAC data structures.

**Scope:** add `PermissionDefinition`, `RoleDefinition`, `RolePermission`, `MembershipRole`, and `MembershipScope`. Seed stable permission codes and six system role templates using synthetic data.

**Required permission:** `ems.compliance_obligation.approve` belongs only to the Sustainability Lead template by default. Organisation Administrator gets role/permission-management capability but not this approval.

**Acceptance:** constraints prevent cross-organisation role assignment; system permission codes are immutable; seed is idempotent; tests assert the default approval rule.

### T12 — Structural backfill command

**Depends on:** T10, T11  
**Goal:** provide an explicit, dry-runnable backfill for the existing single group.

**Scope:** create a command accepting organisation name/slug and `--dry-run`; link existing Entities; create memberships for current users; translate legacy roles to new role templates. Do not print or inspect environmental record values.

**Acceptance:** dry-run writes nothing and reports counts only; repeated execution is idempotent; ambiguous/conflicting state aborts; tests use synthetic users/entities.

### T13 — Request organisation context

**Depends on:** T11  
**Goal:** resolve current tenant and permissions from live database state.

**Scope:** add `OrganisationContext` service returning user, membership, organisation, permissions, and scopes. Add secure organisation selection/switching. Do not authorise from the legacy JWT role.

**Acceptance:** removed/suspended memberships take effect on the next request; supplied inaccessible organisation IDs are rejected; tests cover multi-membership, suspension, and site scopes.

### T14 — Permission evaluation service

**Depends on:** T13  
**Goal:** centralise permission checks.

**Scope:** implement `hasPermission`, `requirePermission`, resource-scope checks, and optional four-eyes policy evaluation. Permission codes are constants generated/validated from the definition catalogue.

**Acceptance:** deny by default; administrator has only granted permissions; Sustainability Lead approval works from template; all decisions use current DB membership; unit tests cover deny paths first.

### T15 — Tenant repository primitives

**Depends on:** T13  
**Goal:** make unscoped customer-data access difficult.

**Scope:** create repository/context helpers requiring `organisationId`; support tenant-root, Entity, Site, and child-resource ownership assertions; provide safe transaction wrapper.

**Acceptance:** no repository method can be called without context at compile time; ownership checks do not accept browser assertions; synthetic cross-tenant unit/integration tests pass.

### T16 — Carbon domain tenant refactor

**Depends on:** T12, T15  
**Goal:** scope every corporate-carbon read, mutation, report, export, document, and background calculation.

**Scope:** refactor one domain only: Entity/Site/activity/contracts/surveys/calculations/reports/corporate documents. Preserve numerical behaviour.

**Acceptance:** golden tests from T00 pass; a two-tenant test matrix proves no cross-tenant list/detail/mutation/export/download/IDOR access; derived calculations remain tenant-consistent.

### T17 — LCA domain tenant refactor

**Depends on:** T12, T15  
**Goal:** scope products, suppliers, methods, assessments, evidence, versions, exports, and audit rows.

**Acceptance:** LCA golden tests pass; all detail and export endpoints reject foreign tenant IDs; corporate citations cannot link across organisations; shared/global factors are explicitly distinguished from tenant-owned supplier factors.

### T18 — AI and administration tenant refactor

**Depends on:** T15, T16, T17  
**Goal:** scope AI context, suggestions, interactions, settings, factor administration, and document extraction.

**Scope:** decide in code whether AI settings/factor sets are platform-global or organisation-owned; express this explicitly in schema/repositories and permissions.

**Acceptance:** AI context cannot include another tenant; usage/audit reports are scoped; admin status does not imply platform-global access; tests cover crafted foreign IDs.

### T19 — Membership and role administration UI

**Depends on:** T14  
**Goal:** allow authorised organisation admins to invite/deactivate memberships and configure roles.

**Scope:** no email sending yet; invitation token lifecycle may be stubbed behind a service. Include dangerous-permission warnings and an audit preview.

**Acceptance:** cannot remove the last role-management principal without an explicit recovery path; cannot grant permissions outside current organisation; compliance approval is visibly absent from default Organisation Administrator.

### T1A — Tenant constraint contract migration

**Depends on:** T16, T17, T18  
**Goal:** make organisation ownership mandatory and retire application use of legacy `User.role`.

**Scope:** validate backfill, add non-null/composite constraints/indexes, switch authorisation, retain legacy field only if rollback requires it.

**Acceptance:** migration preflight aborts with diagnostic counts on orphaned/inconsistent rows; all access tests pass; no production action reads `User.role` for authorisation.

### T1B — PostgreSQL RLS defence-in-depth spike

**Depends on:** T1A, T02  
**Goal:** prove safe RLS with Prisma and Neon transaction pooling before rollout.

**Scope:** use a dedicated non-owner app role and transaction-local organisation setting in a synthetic test database. Apply policies to a minimal vertical slice only.

**Acceptance:** connection reuse cannot leak organisation context; missing context denies access; migrations use a separate owner role; document operational limitations. Do not expand RLS until the spike passes.

## Phase 2 — Shared EMS foundation

### T20 — Generic append-only audit events

**Depends on:** T14  
**Goal:** provide tenant-scoped audit envelopes without replacing existing domain provenance.

**Scope:** `AuditEvent` with actor, organisation, event type, resource type/id, before/after summaries or safe diff, correlation ID, source, timestamp, and integrity metadata. No secrets/file bytes/raw prompts.

**Acceptance:** application cannot update/delete events through normal repositories; membership/permission changes emit events atomically; cross-tenant access denied.

### T21 — Outbox and job framework

**Depends on:** T20, T02  
**Goal:** support reliable legal sync, reminders, and notifications.

**Scope:** transactional outbox, job lease, attempts, scheduled time, idempotency key, completion/failure/dead-letter status, structured error, and worker health. Use database-backed jobs initially.

**Acceptance:** two workers cannot process one lease concurrently; retries are idempotent; poison job reaches dead-letter state; tenant context is explicit on tenant jobs.

### T22 — Controlled documents and unified evidence

**Depends on:** T20  
**Goal:** add controlled revision lifecycle and a shared attachment provider.

**Scope:** controlled documents/revisions, checksums, draft/review/approved/effective/obsolete states, reviewers, approvers, effective/review dates, classification and retention metadata. Adapt existing LCA evidence provider; do not migrate file bytes yet.

**Acceptance:** approved revision immutable; replacement creates successor; download checks tenant and classification permissions; malware-scanning interface exists even if initial provider is no-op in development.

### T23 — EMS programme, scope, context and interested parties

**Depends on:** T14, T20, T22  
**Goal:** create the EMS root and planning records.

**Scope:** EMS programme/version, scope boundaries, context issues, environmental conditions, interested parties/requirements, risks/opportunities, change assessments, policy link, and internal standard requirement references.

**Acceptance:** entity/site references belong to organisation; changes are audited/versioned; no copyrighted ISO clause text is seeded; no environmental performance data is seeded.

### T24 — Notifications and reminders

**Depends on:** T21  
**Goal:** notify users of reviews, approvals, expiry, overdue actions, and legal changes.

**Scope:** in-app notification first; delivery adapter for email later. Add user preferences, deduplication and acknowledgement.

**Acceptance:** recipient is an active in-scope member at send time; reassigned/closed items suppress stale reminders; no sensitive record detail leaks into generic notification text.

## Phase 3 — Aspects and impacts

### T30 — Process/activity profile schema and UI

**Depends on:** T23  
**Goal:** capture site processes and lifecycle/operating conditions.

**Scope:** use only structural starter templates for Hull, Rayleigh, and Milton Keynes operations; template application requires confirmation and creates no aspect scores or environmental measurements.

**Acceptance:** templates are optional/idempotent; processes are tenant/site scoped; users can add/revise without changing old approved assessments.

### T31 — Aspect/impact register

**Depends on:** T30  
**Goal:** create aspects, impacts, links, scopes, conditions, lifecycle perspective, controls, and evidence.

**Acceptance:** many-to-many impacts supported; direct control vs influence represented; normal/abnormal/emergency states supported; no carbon/LCA total is copied.

### T32 — Versioned significance engine

**Depends on:** T31  
**Goal:** deterministic, configurable significance scoring.

**Scope:** pure engine, versioned criteria/formula/threshold, assessment snapshots, justified override, approval and successor reassessment.

**Acceptance:** same snapshot always returns same result; formula changes do not alter historic result; boundary/error tests cover missing criteria and invalid weights; UI displays formula inputs and rationale.

### T33 — Operational controls and review cycle

**Depends on:** T32, T22, T24  
**Goal:** link significant aspects to procedures, monitoring, responsibilities, external providers, competence, and review dates.

**Acceptance:** significant aspect without required control is visible as a gap; expired control review triggers notification; historic control versions remain traceable.

### T34 — Environmental monitoring and calibration

**Depends on:** T33, T24  
**Goal:** configure what is monitored/measured and retain reviewed results and equipment assurance.

**Scope:** monitoring plans, method/location/frequency/criteria, explicit units, Decimal results, quality flags, instrument/calibration requirements, certificates, due reminders, and out-of-tolerance response links. Use synthetic fixtures only.

**Acceptance:** unit and method are mandatory; results never overwrite prior results; overdue calibration is visible; out-of-tolerance does not silently invalidate records and requires a documented review; permissions protect environmental data.

### T35 — External providers, communications and emergency preparedness

**Depends on:** T33, T22, T24  
**Goal:** implement value-chain operational requirements, environmental communications, and emergency preparedness/response.

**Scope:** external-provider controls and evaluations; communication plans/records/approvals; emergency scenarios, controlled plans, contact roles, exercises, outcomes, lessons and action links. Do not store fabricated real emergency contacts in seeds.

**Acceptance:** provider requirements link to aspects/controls; external communications follow configured approval; emergency plan revisions are controlled documents; exercises preserve participants/outcome/evidence; failed exercise can explicitly create an incident/NC/action but makes no automatic legal conclusion.

## Phase 4 — Legal register

### T40 — Provider-neutral legal schema

**Depends on:** T21, T23  
**Goal:** persist providers, instruments, versions, change events, cursors, raw-source references, jurisdictions, and topics.

**Acceptance:** source provenance immutable; cursors advance transactionally after batch commit; unique idempotency constraints prevent duplicate events; no applicability decision is inferred.

### T41 — legislation.gov.uk client with recorded fixtures

**Depends on:** T40  
**Goal:** implement official UK publication/document/effects retrieval behind `LegalContentProvider`.

**Scope:** HTTP client, timeouts, retries, respectful user agent, parser, canonical identifiers, pagination/cursor mapping, fixture recorder instructions. Commit only small non-sensitive official response fixtures permitted for reuse.

**Acceptance:** tests run offline; malformed/partial responses fail safely; publication and effects are separate streams; rate limiting does not advance cursor.

### T42 — Legal sync worker and health view

**Depends on:** T41, T24  
**Goal:** poll with overlap, upsert instruments/versions/events, queue reviews, and expose freshness.

**Acceptance:** replaying fixtures creates no duplicates; delayed effects are accepted; dead-letter and stale-cursor conditions alert; deleting/disappearing upstream rows never deletes local history.

### T43 — Applicability workflow

**Depends on:** T42, T31  
**Goal:** let competent users assess legal-change candidates against organisations/entities/sites/processes/aspects.

**Acceptance:** decision/rationale/reviewer/evidence/review date required; `NOT_APPLICABLE` remains reviewable history; AI cannot set decision; source change never directly changes active obligation.

### T44 — Compliance obligation versioning and approval

**Depends on:** T43, T14  
**Goal:** create obligations from applicable sources with controlled versions.

**Acceptance:** only `ems.compliance_obligation.approve` can approve; only Sustainability Lead template has it by default; approval checks current permission; self-approval policy configurable; approved record immutable; edits create successor; every decision audited.

### T45 — Compliance evaluation

**Depends on:** T44, T24  
**Goal:** schedule and evidence compliance evaluations.

**Scope:** evaluation programme, items, status, evaluator, evidence, finding creation, due dates, recurrence and report.

**Acceptance:** noncompliance can create/link a nonconformity through an interface pending T63; results never auto-decided; overdue/unevaluated obligations are visible; report freezes source obligation versions.

### T46 — Other requirements and manual legal sources

**Depends on:** T44  
**Goal:** support permits, consents, regulator notices, contracts, customer requirements and voluntary commitments.

**Acceptance:** source type and authority clear; files use controlled evidence; manual source gets review/expiry; records follow identical applicability/approval/version rules.

## Phase 5 — Objectives and actions

### T50 — Objectives and metric definitions

**Depends on:** T23, T31, T44  
**Goal:** create objectives linked to policy, significant aspects, obligations, and risks/opportunities.

**Acceptance:** owner, target, unit, baseline description, date and evaluation method required; revisions preserve history; permissions and tenant checks complete.

### T51 — Carbon/LCA read-only metric adapters

**Depends on:** T50, T16, T17  
**Goal:** reference existing calculated results as EMS metric sources.

**Acceptance:** no value is copied into a second calculation system; adapter exposes provenance/version; organisation mismatch denied; LCA intensity and corporate absolute totals remain explicitly different.

### T52 — Action programmes and reminders

**Depends on:** T50, T24  
**Goal:** add programmes, actions, dependencies, owners, progress, completion evidence and overdue escalation.

**Acceptance:** closed action immutable except reopen event; completion does not automatically mean objective achieved; reassignment/history audited; dashboard query remains tenant scoped.

## Phase 6 — Audits, incidents and CAPA

### T60 — Audit programme and audit execution

**Depends on:** T23, T22, T24  
**Goal:** add risk-based programmes, audits, teams, independence declarations, criteria, scope and schedules.

**Acceptance:** coverage report spans sites/processes/aspects/obligations/requirements; auditor scope validated; schedule changes audited.

### T61 — Checklists, evidence, findings and frozen report

**Depends on:** T60  
**Goal:** execute audit steps and issue a controlled report.

**Acceptance:** checklist version frozen at audit start/issue; evidence downloads authorised; issued report immutable; finding classification configurable and clearly not an automatic certification judgement.

### T62 — Environmental incident intake

**Depends on:** T23, T22  
**Goal:** capture incident facts, immediate response, severity, notification status, confidentiality and evidence.

**Acceptance:** supports restricted sensitive incidents; preserves original report and corrections; no automatic legal-reportability conclusion; escalation rules configurable.

### T63 — Nonconformity workflow

**Depends on:** T61, T62, T45  
**Goal:** create/link NCs from audit, incident, compliance, complaint, monitoring or manual sources.

**Acceptance:** source linkage and requirement required; containment captured; duplicate linking supported; state transitions audited; closing is impossible without configured mandatory steps.

### T64 — Root cause, corrective action and effectiveness

**Depends on:** T63, T52  
**Goal:** implement root-cause methods, CAPA actions, evidence, effectiveness review, closure and reopen.

**Acceptance:** action owner cannot perform independent effectiveness review when policy enabled; overdue escalation works; ineffective outcome reopens or creates follow-up; closure permission checked live.

## Phase 7 — Competence and management review

### T70 — Competence requirements and person assignments

**Depends on:** T23, T33  
**Goal:** map competence requirements to roles/processes/aspects/obligations and people/contractors.

**Acceptance:** personal/training details have restricted permissions; gap report is tenant/site scoped; login identity and person profile are linked, not duplicated.

### T71 — Training, evidence, assessment and expiry

**Depends on:** T70, T22, T24  
**Goal:** capture training/experience/licence evidence and competence assessment.

**Acceptance:** expiry reminders deduplicated; expired competence appears as gap; attendance alone does not automatically prove competence unless policy says so; retention configurable.

### T72 — Management review model and agenda

**Depends on:** T45, T52, T61, T64, T71  
**Goal:** schedule reviews and represent required inputs, attendees, decisions, resources and actions.

**Acceptance:** agenda template is configurable/versioned; input links point to exact report/record versions; open prior actions are included.

### T73 — Deterministic review pack and approved minutes

**Depends on:** T72  
**Goal:** generate a frozen management-review pack, record decisions/minutes, approve, and track resulting actions.

**Acceptance:** repeated generation from same snapshot is stable; issue freezes inputs; AI narrative is optional, labelled and reviewed; decisions cannot be inferred; approved minutes immutable.

## Phase 8 — Hardening and launch readiness

### T80 — Cross-tenant adversarial suite

**Depends on:** all functional phases  
**Goal:** test IDOR, exports, downloads, nested references, search, notifications, AI context, jobs, and aggregate side channels across two synthetic tenants.

**Acceptance:** explicit negative test per customer-owned root and endpoint; failures reveal no existence metadata; suite is mandatory in CI.

### T81 — Audit integrity, retention and export

**Depends on:** T20, all functional phases  
**Goal:** verify material events, legal holds, retention, subject-access boundaries, and organisation export.

**Acceptance:** export is complete and tenant-scoped; retention never deletes frozen/legal-held records; destructive operations require audited privilege; restore procedure documented.

### T82 — Accessibility and usability review

**Depends on:** all UI phases  
**Goal:** keyboard, screen-reader, contrast, error, focus, responsive and print/export verification.

**Acceptance:** WCAG target documented; critical flows usable without colour alone; tables have equivalent accessible information; findings triaged and fixed.

### T83 — Performance and operational resilience

**Depends on:** T21 and functional phases  
**Goal:** load-test tenant dashboards, legal sync, exports and reminders on synthetic scale; validate Neon connection behaviour and recovery.

**Acceptance:** agreed SLOs met; jobs resume idempotently; restore drill succeeds; migration rollback/forward plan tested; no production data used.

### T84 — Licensed standard and competent review checklist

**Depends on:** functional phases  
**Goal:** let the EMS owner map implemented controls/evidence against a licensed ISO 14001:2026 copy and competent legal advice.

**Scope:** configuration/content review only; do not paste standard text into repository unless licensing explicitly permits it.

**Acceptance:** gaps and owner decisions recorded; platform language avoids “certified/compliant” claims; certification body remains independent.

## Recommended packet execution rules

1. Give Claude only the global context, the selected packet, its dependency summaries, relevant ADRs, and directly related files.
2. Never give the whole repository README unless the task concerns a documented invariant; provide the named invariant instead.
3. Require a file list before edits and reject unrelated-file changes.
4. Keep schema task, migration task, service task, and UI task separate where a packet begins exceeding one reviewable change.
5. Use recorded official fixtures for legal connector tests; never call a live API in unit tests.
6. Require negative authorisation tests in the same task as every new endpoint or mutation.
7. Start each new packet from a green main branch and do not ask an agent to reconcile unrelated unfinished work.
8. Do not ask Claude to decide environmental significance criteria, legal applicability, compliance status, certification interpretation, or records-retention policy; those are owner decisions represented by configurable software.

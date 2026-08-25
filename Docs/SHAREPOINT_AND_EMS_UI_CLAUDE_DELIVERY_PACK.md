# SharePoint integration and EMS UI delivery pack

**Prepared:** 24 August 2026  
**Purpose:** provide small, sequential Claude Code tasks that finish the user-facing EMS and connect its document/evidence layer to SharePoint without weakening tenancy, RBAC, immutable approvals, retention, or audit history.

## 1. Current-state finding

The T10-T84 implementation is not wholly "backend only". The latest inspected T84 tree already contains UI routes for:

- processes, aspects, significance, controls and monitoring;
- external providers, communications and emergency preparedness;
- legal provider health, applicability, obligations, evaluations and other requirements;
- objectives and action programmes;
- audits, incidents and nonconformities.

The current navigation hides most EMS routes in a long **More** menu and does not link every implemented route. That can make the deployed application appear to have no EMS UI. The genuine functional UI gaps are:

- an EMS home/dashboard and coherent EMS navigation;
- EMS programme, scope, context, interested parties, risks/opportunities and change-management screens;
- a controlled-document/evidence hub designed for SharePoint-backed content;
- a notification/work queue;
- the remaining competence UI after `T70UI-a`;
- management-review agenda, pack, minutes, decisions and actions;
- end-to-end accessibility and browser-flow verification after the UI is integrated.

Before writing new screens, verify that the deployment is built from the cumulative T84 line. A preview or production deployment built from the old carbon branch will not expose the later routes even when they exist in Git.

## 2. SharePoint boundary

Use this ownership model throughout all SP tasks:

| Concern | System of record |
|---|---|
| File bytes and SharePoint-native file history | SharePoint document library |
| EMS document reference, category, classification and workflow state | Neon / EMS application |
| EMS revision approval, effective/obsolete state and separation of duties | Neon / EMS application |
| Exact SharePoint site, drive, item and version reference | Neon / EMS application |
| SHA-256 checksum recorded at attachment/issue time | Neon / EMS application |
| EMS evidence links to aspects, audits, incidents, obligations, actions, etc. | Neon / EMS application |
| SharePoint retention label / Microsoft Purview hold | SharePoint / Microsoft 365 |
| EMS retention category, legal-hold intent and audit events | Neon / EMS application |
| Access decision inside the EMS | EMS tenant context and configurable RBAC |
| Native SharePoint authoring access | Microsoft Entra ID and SharePoint permissions |

Important rules:

1. Never treat a mutable SharePoint URL as the identity of a document. Persist stable `siteId`, `driveId`, `itemId` and, for issued evidence/revisions, the exact `versionId` plus checksum.
2. Never resolve an issued EMS revision to "the latest SharePoint version". Later edits must not change already approved evidence.
3. Never reveal a filename, URL or SharePoint identifier before EMS tenant, classification and permission checks pass.
4. Do not create anonymous or organisation-wide sharing links from the EMS.
5. Use Microsoft Entra ID application access with least privilege. Prefer `Sites.Selected` plus an explicit grant to the configured EMS site/library rather than tenant-wide `Sites.ReadWrite.All`.
6. SharePoint bytes must not be physically deleted merely because an EMS metadata retention job runs. The SharePoint retention/hold design must be agreed and enforced before deletion is enabled.
7. Keep the existing database provider for synthetic/local tests and as a controlled migration fallback. SharePoint becomes another provider, not a destructive rewrite.
8. All integration tests use mocks or a dedicated synthetic Microsoft 365 test site. Do not use real environmental records or business documents.

## 3. Owner decisions required during SP0

Claude should document these decisions and stop before credential-dependent implementation if they are unresolved:

- **Tenant model:** one multi-tenant Entra application with customer admin consent, or a customer-owned Entra application per organisation. The recommended SaaS default is one multi-tenant application with per-customer consent and an explicit site grant.
- **Credential model:** certificate/workload identity preferred for production; a client secret is acceptable only for a time-limited non-production pilot with rotation and secret-manager storage.
- **Library topology:** dedicated EMS library per customer site is recommended. Decide whether each organisation uses one library with folders or separate controlled-document/evidence libraries.
- **Authoring model:** browser users edit drafts in SharePoint under their own Microsoft identity; the EMS service account reads/writes only the selected library.
- **Retention model:** confirm whether Microsoft Purview retention labels/records management will protect issued records, and who owns label configuration.
- **External customers:** confirm whether each future customer supplies their own Microsoft 365 tenant/site and performs consent/site-grant onboarding.

## 4. Recommended delivery order

Run one task per fresh Claude Code chat and one cumulative branch at a time. Do not start a child task until its base task has pushed successfully.

| Order | Task | Model | Outcome |
|---:|---|---|---|
| 1 | UI00 | Sonnet Low | Verify the cumulative base and create an exact UI coverage/deployment inventory |
| 2 | SP00 | Sonnet Low | Approve SharePoint architecture, security and data boundary |
| 3 | UI01 | Sonnet Medium | Add an EMS home and usable navigation to existing pages |
| 4 | SP01 | Sonnet Medium | Add provider-neutral organisation storage configuration/reference schema |
| 5 | SP02 | Sonnet Medium | Add Microsoft Graph auth/client boundary and synthetic tests |
| 6 | SP03 | Sonnet Medium | Implement the SharePoint evidence-byte provider and exact-version reads |
| 7 | SP04 | Sonnet Medium | Integrate controlled-document revisions with exact SharePoint versions |
| 8 | SP05 | Sonnet Medium | Integrate evidence attachments/downloads across EMS and LCA safely |
| 9 | SP06 | Sonnet Medium | Add delta reconciliation, stale-reference handling and operational jobs |
| 10 | SP07 | Sonnet Medium | Add dry-run-first migration from database blobs to SharePoint |
| 11 | UI02 | Sonnet Medium | EMS programme/context/scope/interested-parties/change UI |
| 12 | UI03 | Sonnet Medium | Controlled documents, evidence and SharePoint connection UI |
| 13 | UI04 | Sonnet Low | Notifications, approvals and personal work queue |
| 14 | UI05 | Sonnet Low | Finish/cross-link existing Phase 3 screens |
| 15 | UI06 | Sonnet Medium | Finish/cross-link legal and compliance workspace |
| 16 | UI07 | Sonnet Medium | Finish objectives, measurements and actions workspace |
| 17 | UI08 | Sonnet Medium | Finish audits, incidents, NC and CAPA workspace |
| 18 | UI09 | Sonnet Medium | Competence requirements, people, assignments and gaps |
| 19 | UI10 | Sonnet Medium | Training, evidence, assessment and expiry |
| 20 | UI11 | Sonnet Medium | Management-review cycle, attendees, inputs and agenda |
| 21 | UI12 | Sonnet Medium | Review pack, minutes, decisions, actions, approval and closure |
| 22 | UI13 | Sonnet Medium | EMS dashboard, status summaries and reporting/export entry points |
| 23 | SP08 | Sonnet High | SharePoint adversarial/security/restore pilot gate |
| 24 | UI14 | Sonnet Medium | Browser-flow, responsive and accessibility completion; rerun T82 evidence |

`SP01-SP06` may be completed before most UI tasks. `UI03` must wait for `SP04-SP05` so it does not create a second temporary document experience. `SP07` must wait until the connector has passed synthetic tests. `SP08` and `UI14` are final gates, not feature tasks.

## 5. Common rules for every implementation prompt

Every prompt below intentionally repeats the following rules:

- use the Paragon ISO EMS task helper skill;
- find and verify the latest cumulative dependency branch before planning;
- implement only the named task;
- maximum 12-line plan before editing;
- preserve the carbon/LCA calculations and existing user actions, including delete where already permitted;
- no real environmental data, documents, contacts, people or credentials;
- no production deployment;
- no background monitoring, timed check-ins, PR watching or PR subscriptions;
- run focused tests, typecheck, lint and build as proportionate;
- open a scoped PR if tooling is available, but lack of PR tooling is never an implementation blocker.

## 6. SharePoint task prompts

### SP00 - SharePoint integration architecture and data-boundary specification

```text
Use the Paragon ISO EMS task helper skill.

Complete SP00 only: SharePoint integration architecture and data-boundary specification.

Repo docs are at: Docs/
Model/effort: Sonnet Low.

First identify the latest remote branch containing the complete T10-T84 cumulative chain. Verify it rather than assuming the current branch is correct. This is a documentation task: do not implement connector code, schema, credentials, or live calls.

Before editing, give me a maximum 12-line plan.

Create Docs/SP00_SHAREPOINT_INTEGRATION_SPEC.md. Define:
- SharePoint stores file bytes and native file history; Neon stores EMS metadata, exact version references, workflow/approval state, evidence links, checksums, retention intent and audit history.
- multi-organisation onboarding for organisations that may each use a different Microsoft 365 tenant;
- the decision between one multi-tenant Entra application and customer-owned applications; recommend a default and record trade-offs;
- least-privilege application access using Sites.Selected plus an explicit selected-site grant;
- site/library/folder topology and per-organisation configuration;
- exact identity fields: Entra tenant ID, SharePoint site ID, drive/library ID, item ID, version ID, eTag/cTag where useful, web URL for authorised display only, SHA-256 and observed timestamps;
- draft authoring versus immutable issued revision behaviour; issued EMS records must never silently follow the newest SharePoint version;
- server-proxied authorised downloads versus opening drafts in SharePoint;
- SharePoint/Purview retention, legal hold and deletion ownership versus T81 EMS retention metadata;
- delta reconciliation, rename/move/delete/stale-reference behaviour, retries, idempotency and audit events;
- credential storage/rotation, admin consent and customer offboarding;
- synthetic test-site strategy, migration approach and rollback;
- explicit non-goals and owner decisions.

Use only official Microsoft Graph/SharePoint documentation as external technical authority. Do not copy secrets, real site IDs, documents or environmental data into the repo.

Verification: check internal links and terminology against T22/T81/T80. No source-code changes except an optional docs index link.

Final report:
1. Base branch/commit
2. Documents changed
3. Decisions/recommendations
4. Unresolved owner decisions
5. PR status

If complete, open a docs-only PR against the correct cumulative base. Do not monitor it afterward.
```

### SP01 - Organisation storage configuration and external-file reference schema

```text
Use the Paragon ISO EMS task helper skill.

Implement SP01 only: provider-neutral organisation storage configuration and SharePoint external-file reference schema.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Base this task on the latest cumulative branch containing T10-T84 and completed SP00. If SP00 is absent, stop and report the dependency. Do not implement Microsoft Graph calls in this task.

Before editing, give me a maximum 12-line plan.

Requirements:
- preserve the existing EvidenceStorageProvider/database fallback;
- add the minimum tenant-scoped configuration needed to associate an Organisation with a document-storage connection;
- model SharePoint tenant/site/drive/library and root-folder identifiers without storing access tokens, client secrets or private keys in Neon;
- add an exact external-file/version reference for an EvidenceObject or controlled revision using stable siteId/driveId/itemId/versionId and checksum;
- make every relation organisation-consistent through composite constraints or validated tenant repositories;
- ensure issued evidence can be pinned to an exact version and never resolved as latest implicitly;
- support connection status/disabled state and safe offboarding without cascading deletion of audit/evidence history;
- add explicit configurable permissions for connection administration; Organisation Administrator must not automatically gain document-content access unless granted;
- use an expand-only Neon-compatible migration and synthetic fixtures only;
- add tenant-adversarial and schema tests.

Do not build OAuth, Graph HTTP, UI, migration of existing blobs, live SharePoint access, or production deployment.

Run focused tests, Prisma validation/generation, typecheck and lint. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Schema/migration files changed
3. Tests/checks
4. PR status
5. Residual risks/owner decisions
```

### SP02 - Microsoft Graph authentication and client boundary

```text
Use the Paragon ISO EMS task helper skill.

Implement SP02 only: Microsoft Graph authentication/configuration boundary and SharePoint client primitives.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Use the latest cumulative branch containing SP00-SP01. Stop if either dependency is missing. Do not use live credentials or call a real tenant.

Before editing, give me a maximum 12-line plan.

Requirements:
- implement a small Graph client interface for site/drive/item/version metadata, download, upload-session creation and health validation;
- implement app-only token acquisition behind an injectable provider, designed for the SP00-selected Entra topology;
- keep tokens and credentials out of Neon, logs, errors, audit payloads and browser bundles;
- default to Sites.Selected assumptions and reject unconfigured organisation/site combinations before HTTP calls;
- add timeouts, bounded retry/backoff for safe idempotent calls, correlation IDs, Graph error normalisation and Retry-After support;
- prevent redirects or upload-session URLs from being logged;
- distinguish permission/configuration failures from missing files without exposing foreign-tenant metadata;
- add mocked unit/contract tests for token caching/expiry, 401/403/404/409/412/429/5xx, timeout and malformed responses;
- add environment-variable documentation using placeholders only.

Do not upload/download files, change schema beyond an unavoidable SP01 correction, create UI, migrate data, or deploy.

Run focused tests, typecheck and lint. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Files changed
3. Tests/checks
4. PR status
5. Residual risks/owner decisions
```

### SP03 - SharePoint evidence storage provider

```text
Use the Paragon ISO EMS task helper skill.

Implement SP03 only: SharePoint-backed EvidenceStorageProvider and exact-version content reads.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Use the latest cumulative branch containing SP00-SP02. Do not connect to a real SharePoint tenant.

Before editing, give me a maximum 12-line plan.

Requirements:
- implement/register a SharePoint provider without removing the database provider;
- upload into the configured organisation library/root using safe generated paths and conflict-safe behaviour;
- support resumable upload sessions where appropriate, with sequential chunks and retry safety;
- after upload, capture stable siteId/driveId/itemId/versionId, checksum, byte size, MIME type and observed metadata;
- download an exact recorded version after EMS tenant/classification/permission checks; never fall through to current/latest content for an issued record;
- make rename/move safe by using IDs rather than paths;
- define remove semantics compatible with T81: default to no physical SharePoint deletion until retention/Purview policy authorises it;
- preserve malware-scan state and do not equate successful SharePoint upload with a clean scan unless the agreed scanner proves it;
- avoid loading unbounded files into memory where streaming is supported;
- add mocked tests for exact-version reads, missing/pruned versions, checksum mismatch, 412/429, interrupted upload, wrong organisation and restricted classifications.

Do not integrate every domain UI, migrate existing blobs, use real documents/credentials, or deploy.

Run focused tests, typecheck, lint and build if standard. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Files changed
3. Tests/checks
4. PR status
5. Residual risks/owner decisions
```

### SP04 - Controlled-document SharePoint workflow

```text
Use the Paragon ISO EMS task helper skill.

Implement SP04 only: controlled-document revision integration with SharePoint.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Use the latest cumulative branch containing SP00-SP03 and T22/T81. Do not use live SharePoint.

Before editing, give me a maximum 12-line plan.

Requirements:
- connect ControlledDocumentRevision content to the SharePoint provider through the existing evidence abstraction;
- allow a draft revision to attach/link a SharePoint file and capture a candidate version;
- at review/approval/effective transition, freeze the exact SharePoint version ID and checksum in the EMS revision;
- a newer SharePoint version must produce a visible drift/new-draft condition, never mutate an approved/effective revision;
- preserve reviewer/approver separation, current configurable permissions and append-only audit events;
- handle missing/pruned/inaccessible versions as a blocking evidence-integrity state with safe user messaging;
- preserve distribution and acknowledgement records;
- prevent foreign organisation/site/drive/item IDs and stale page permissions;
- add mocked workflow and cross-tenant tests.

Do not build the general document UI yet, migrate existing blobs, alter unrelated EMS workflows, use real documents, or deploy.

Run focused tests, typecheck and lint. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Files changed
3. Tests/checks
4. PR status
5. Residual risks/owner decisions
```

### SP05 - Unified evidence and authorised downloads

```text
Use the Paragon ISO EMS task helper skill.

Implement SP05 only: SharePoint-backed unified evidence across EMS and LCA download paths.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Use the latest cumulative branch containing SP00-SP04. Do not use live SharePoint or migrate current blobs.

Before editing, give me a maximum 12-line plan.

Requirements:
- route new shared EvidenceObject uploads/links through the configured organisation provider;
- integrate the existing LCA provider registry without changing LCA calculation/report invariants;
- keep database-backed historic evidence readable;
- make every download go through server-side organisation, resource ownership, classification, permission, malware and tombstone checks before fetching SharePoint content;
- do not expose a SharePoint URL, filename or identifier on denied/not-found paths;
- preserve exact-version and checksum verification for evidence used by aspects, monitoring, controls, legal, objectives/actions, audits, incidents, NC/CAPA, competence and management review;
- support linking an existing authorised SharePoint item without copying bytes, subject to the same validation and version pinning;
- audit successful attachment/linking and material integrity failures without logging content or secrets;
- add mocked cross-tenant/IDOR, restricted evidence, deleted item, pruned version, checksum mismatch and legacy database-provider tests.

Do not create the full UI, migrate existing blobs, use real data or deploy.

Run focused tests, golden carbon/LCA tests, typecheck and lint. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Files changed
3. Tests/checks
4. PR status
5. Residual risks/owner decisions
```

### SP06 - SharePoint reconciliation and change processing

```text
Use the Paragon ISO EMS task helper skill.

Implement SP06 only: SharePoint reconciliation, delta processing and stale-reference handling.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Use the latest cumulative branch containing SP00-SP05 and the T21 outbox/job framework. Use mocked Graph responses only.

Before editing, give me a maximum 12-line plan.

Requirements:
- add a tenant-explicit, idempotent reconciliation job using Graph driveItem delta tokens or a bounded full scan when a token is invalid;
- commit a cursor only after the corresponding batch commits;
- detect metadata/version changes, rename/move, deletion, inaccessible item, permission loss and checksum drift;
- never delete EMS history because an upstream item disappears;
- create review/integrity events and notifications rather than silently updating approved/effective evidence;
- make duplicate delivery/replay safe and use existing leases/retry/dead-letter patterns;
- document webhook notifications as an optional accelerator only; correctness must come from delta reconciliation;
- add health/freshness status without exposing customer file names or content in platform logs;
- add offline fixture tests for paging, nextLink/deltaLink, replay, expired cursor, 410/resync, 429, deletion and cross-organisation cursor isolation.

Do not add a webhook endpoint unless the spec explicitly approves it, build UI beyond a narrow health interface, use live credentials/data, or deploy.

Run focused tests, typecheck and lint. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Files changed
3. Tests/checks
4. PR status
5. Residual risks/owner decisions
```

### SP07 - Dry-run-first evidence migration

```text
Use the Paragon ISO EMS task helper skill.

Implement SP07 only: dry-run-first migration of database-backed evidence bytes to SharePoint.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Use the latest cumulative branch containing SP00-SP06. This task may implement and test the command, but must not run --apply against any real/shared database or SharePoint site.

Before editing, give me a maximum 12-line plan.

Requirements:
- add a resumable, idempotent command scoped to one explicit organisation and one configured SharePoint connection;
- dry-run by default and report counts/bytes/status only, never filenames or content;
- upload one item, verify exact version/size/SHA-256, then transactionally repoint metadata while preserving IDs/audit links;
- retain source database bytes until a separately authorised cleanup stage after verification/rollback window;
- skip already migrated items safely and detect conflicting partial state;
- honour legal hold, restricted classification, tombstone and retention policy;
- support a bounded batch size, checkpoint/resume and failure report;
- include a rollback design and prohibit bulk destructive deletion;
- cover EvidenceObject and LCA evidence deliberately; if one cannot be migrated safely in the same task, stop and split it rather than guessing;
- add synthetic tests for dry-run, repeat run, interrupted batch, checksum mismatch, provider error and cross-tenant denial.

Do not run against real data, print secrets, remove blobs, or deploy.

Run focused tests, typecheck and lint. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Files changed
3. Tests/checks
4. Dry-run synthetic result
5. PR status
6. Residual risks/owner decisions
```

### SP08 - SharePoint security and synthetic pilot gate

```text
Use the Paragon ISO EMS task helper skill.

Complete SP08 only: SharePoint integration adversarial suite, operations runbook and synthetic pilot gate.

Repo docs are at: Docs/
Model/effort: Sonnet High.

Use the latest cumulative branch containing SP00-SP07 and UI03. Do not use production or real documents. A dedicated synthetic Microsoft 365 test tenant/site may be used only if credentials are already provided through approved secret mechanisms and the owner explicitly authorises that test environment.

Before editing, give me a maximum 12-line plan.

Requirements:
- test cross-organisation site/drive/item/version substitution and denied-response metadata leakage;
- test revoked consent/site grant, expired credential, token replay/cache isolation, stale permission after page load and restricted evidence;
- test upload interruption, duplicate retry, checksum mismatch, pruned version, item deletion, rename/move, delta replay/expiry and provider outage;
- verify approved/effective records never follow latest content and retention/legal hold cannot trigger unsafe physical deletion;
- validate logs/telemetry redact URLs, tokens, upload-session URLs, file names where restricted, document text and environmental values;
- document consent, site grant, secret/certificate rotation, connection disable/offboarding, reconciliation, outage, restore and incident-response runbooks;
- produce an evidence-backed GO/NO-GO checklist for a synthetic pilot only;
- leave real-data onboarding and production approval explicitly separate.

Fix only defects directly exposed by this SharePoint gate. If a broad architectural/security defect appears, stop and report it rather than expanding scope.

Run focused/full relevant tests, typecheck, lint and production build. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Tests and evidence produced
3. Defects fixed or blockers
4. Synthetic pilot gate result
5. PR status
6. Residual risks/owner decisions
```

## 7. EMS UI task prompts

### UI00 - Cumulative base, deployed-route and UI coverage inventory

```text
Use the Paragon ISO EMS task helper skill.

Complete UI00 only: verify the cumulative implementation base and create the EMS UI coverage inventory.

Repo docs are at: Docs/
Model/effort: Sonnet Low.

First identify the latest remote branch containing the complete T10-T84 dependency chain, including the T34 integration. Current evidence suggests origin/claude/t84-licensed-review-checklist-tn9k12, but verify ancestry. Also inspect origin/claude/t70ui-a-competence-requirement-admin and record whether its UI commit is already present or must later be integrated.

Before editing, give me a maximum 12-line plan.

Create Docs/EMS_UI_COVERAGE.md containing a task-to-service-to-route matrix for T20-T73. Classify each workflow as COMPLETE, PARTIAL, MISSING or UNREACHABLE-IN-NAV. Include existing routes, missing detail pages/actions, permissions, and critical browser flows. Check the current nav and deployment configuration/branch documentation to explain why existing EMS screens may not be visible.

Do not build UI, merge/cherry-pick feature code, change deployment, use real data, or deploy. Documentation only except an optional docs index link.

Final report:
1. Exact cumulative branch/commit
2. Existing UI routes
3. Missing/partial/unreachable UI
4. T70UI-a integration status
5. Deployment-branch finding
6. PR status

Open a docs-only PR if possible. Do not monitor it.
```

### UI01 - EMS home and navigation shell

```text
Use the Paragon ISO EMS task helper skill.

Implement UI01 only: EMS home, module navigation and route discoverability.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Use the latest cumulative branch containing T10-T84 and completed UI00. Stop if UI00 shows the base is incomplete.

Before editing, give me a maximum 12-line plan.

Requirements:
- add a permission-aware /ems landing page with concise module cards/status links, not environmental performance claims;
- replace the long hidden EMS section in More with a coherent EMS entry/navigation pattern that works on desktop and mobile;
- link every existing EMS route, including objectives, actions, obligations and nonconformities;
- hide/disable modules according to current permissions without using legacy User.role;
- show clear empty/configuration states when an EMS programme has not been configured;
- preserve the existing carbon/LCA navigation and all existing actions, including delete where currently allowed;
- use existing design primitives and accessible focus/keyboard patterns;
- add navigation/permission tests and a small route-registry test so implemented pages cannot silently become unreachable.

Do not build missing domain forms, redesign carbon/LCA pages, use real data, or deploy.

Run focused tests, typecheck, lint and build. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Routes/navigation added or exposed
3. Files changed
4. Tests/checks
5. PR status
6. Residual risks
```

### UI02 - EMS programme, scope, context and change UI

```text
Use the Paragon ISO EMS task helper skill.

Implement UI02 only: user interfaces for the T23 EMS foundation workflows.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Use the latest cumulative branch containing UI01 and T23 services. Do not invent new business logic when a service already exists.

Before editing, give me a maximum 12-line plan.

Build permission-aware pages/actions/forms for EMS programme/profile, scope statement and included entities/sites, context issues, interested parties/needs, risks/opportunities, environmental policy document reference and planned changes. Reuse T23 services, versioning, evidence and audit patterns. Make approved/versioned records read-only and create successors through existing services. Validate every entity/site/membership reference server-side. Include useful empty states, history/status, review dates and links to controlled documents.

Do not implement SharePoint connector behaviour, legal/aspects/objectives UI, new workflow rules, real data or deployment. Preserve existing user actions.

Run focused tests, typecheck, lint and build. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Pages/workflows added
3. Existing services reused
4. Files changed
5. Tests/checks
6. PR status/residual risks
```

### UI03 - Controlled documents, evidence and SharePoint connection UI

```text
Use the Paragon ISO EMS task helper skill.

Implement UI03 only: controlled-document/evidence hub and SharePoint connection administration UI.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Use the latest cumulative branch containing UI01, SP01-SP05 and T22/T81. Stop if the SharePoint service contracts are not present; do not create a competing temporary storage design.

Before editing, give me a maximum 12-line plan.

Requirements:
- controlled-document list/detail with revisions, status, owner, classification, review/effective dates, successor, distribution and acknowledgements;
- forms for draft/create/attach/link/review/approve/effective/obsolete transitions strictly through existing services and permissions;
- evidence hub showing linked resources, provider, integrity/version status, retention/legal-hold/tombstone state and authorised download;
- organisation storage-connection admin page showing safe IDs/status/health only, never credentials/tokens;
- allow linking an existing SharePoint item and uploading a new file where services support it;
- clearly distinguish editable SharePoint draft from the exact version frozen into an issued EMS record;
- safe errors for inaccessible/missing/pruned/drifted content without metadata leakage;
- retain database-backed evidence usability;
- responsive/keyboard accessible forms and tables.

Do not add new Graph logic, migrate blobs, expose secrets, use real documents or deploy.

Run focused tests, typecheck, lint and build. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Pages/workflows added
3. Files changed
4. Tests/checks
5. PR status
6. Residual risks/owner decisions
```

### UI04 - Notifications, approvals and personal work queue

```text
Use the Paragon ISO EMS task helper skill.

Implement UI04 only: T24 notifications, approvals and personal work queue UI.

Repo docs are at: Docs/
Model/effort: Sonnet Low; move to Medium only if existing service contracts require broader server-action work.

Use the latest cumulative branch containing UI01 and T24.

Before editing, give me a maximum 12-line plan.

Add a permission-aware inbox/work queue for unread notifications, due/overdue actions, reviews, approvals, expiries and legal-change reviews. Reuse existing T24/job/domain links, deduplication and read-state services. Each item must link to an authorised route and reveal no foreign/restricted metadata. Add filters, counts, mark-read and safe empty states. Do not invent a second task engine or auto-approve anything.

Do not alter domain workflows, add background monitors, use real data or deploy.

Run focused tests, typecheck, lint and build. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. UI/workflows added
3. Files changed
4. Tests/checks
5. PR status/residual risks
```

### UI05 - Phase 3 UI completion and cross-linking

```text
Use the Paragon ISO EMS task helper skill.

Implement UI05 only: complete and cross-link the existing T30-T35 screens.

Repo docs are at: Docs/
Model/effort: Sonnet Low; remain narrow and move to Medium only if a missing action is required by the documented acceptance criteria.

Use the latest cumulative branch containing UI01 and T30-T35, including T34 integration.

Before editing, give me a maximum 12-line plan.

Audit the existing process, aspect/significance, control, monitoring/calibration, external-provider, communications and emergency pages against Docs/PHASE3_ASPECTS_OPERATIONS_SPEC.md. Add only missing user-visible workflow steps, detail links, statuses, histories, gaps, due/overdue indicators and cross-links that existing services already support. Preserve append-only monitoring results, controlled revisions, explicit NC/incident/action creation and all current delete actions. Do not reimplement service logic in components.

Do not broaden into legal/objectives/CAPA/competence, use real data or deploy.

Run focused tests, typecheck, lint and build. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Coverage gaps fixed
3. Files changed
4. Tests/checks
5. PR status/residual risks
```

### UI06 - Legal and compliance workspace completion

```text
Use the Paragon ISO EMS task helper skill.

Implement UI06 only: complete and cross-link the T40-T46 legal/compliance UI.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Use the latest cumulative branch containing UI01 and T40-T46.

Before editing, give me a maximum 12-line plan.

Audit existing provider health, applicability, obligations, evaluations and other-requirements routes against PHASE4_LEGAL_COMPLIANCE_SPEC.md. Finish missing detail/history/review/approval/evidence/report interactions using existing services. Make source provenance and freshness visible, keep publication/effects streams distinct, and never imply automatic applicability, compliance or legal advice. Only the configurable approval permission may approve obligations; recheck permission on mutation. Add safe links among source change, applicability record, exact obligation version, evaluation and linked NC.

Do not change the legal provider/client/sync algorithm except for a UI-blocking defect, use real data, or deploy.

Run focused tests, typecheck, lint and build. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Coverage gaps fixed
3. Files changed
4. Tests/checks
5. PR status/residual risks
```

### UI07 - Objectives, measurements and actions workspace

```text
Use the Paragon ISO EMS task helper skill.

Implement UI07 only: complete the T50-T52 objectives, measurements, reviews and action-programme UI.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Use the latest cumulative branch containing UI01 and T50-T52.

Before editing, give me a maximum 12-line plan.

Audit existing objectives/actions routes against PHASE5_OBJECTIVES_ACTIONS_SPEC.md. Add the missing detail/history/version, metric definition, manual measurement, read-only carbon/LCA source, progress review, programme/dependency, completion evidence, verification and overdue views through existing services. Make units, baselines, source provenance and carbon absolute versus LCA intensity semantics explicit. Preserve immutable historic versions and never copy/recalculate carbon/LCA values in the EMS.

Do not change calculation engines, invent management-review sources, use real data or deploy.

Run focused/golden tests, typecheck, lint and build. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Coverage gaps fixed
3. Files changed
4. Tests/checks
5. PR status/residual risks
```

### UI08 - Audits, incidents, nonconformity and CAPA workspace

```text
Use the Paragon ISO EMS task helper skill.

Implement UI08 only: complete the T60-T64 audit, incident, NC and CAPA user flows.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Use the latest cumulative branch containing UI01 and T60-T64.

Before editing, give me a maximum 12-line plan.

Audit the existing audit/incidents/nonconformities routes against PHASE6_AUDIT_INCIDENT_CAPA_SPEC.md. Complete missing root-cause, corrective-action, effectiveness-review, closure/reopen, containment, evidence, findings, frozen-report and lessons-learned interactions through existing services. Preserve restricted-incident permissions and safe not-found behaviour. Do not automatically decide legal reportability, certification classification or NC creation. Show state prerequisites and immutable issued records clearly.

Do not modify unrelated service rules, use real incidents/people/data or deploy.

Run focused tests, typecheck, lint and build. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Coverage gaps fixed
3. Files changed
4. Tests/checks
5. PR status/residual risks
```

### UI09 - Competence requirements, people, assignments and gaps

```text
Use the Paragon ISO EMS task helper skill.

Implement UI09 only: competence requirements, people, assignments and gap UI.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Use the latest cumulative branch containing UI01 and T70. Inspect origin/claude/t70ui-a-competence-requirement-admin. If its clean competence-requirement UI commit is not already in the cumulative line, integrate/cherry-pick that specific commit first, resolve only local conflicts, then continue. Do not merge an older branch wholesale.

Before editing, give me a maximum 12-line plan.

Complete requirement version/scope administration, person profiles, restricted sensitive profile view, assignments and tenant/site-scoped gap dashboard using existing T70 services. Enforce ems.competence.sensitive.view separately from ordinary competence status. Link login identity to person profile without duplicating it. Preserve DRAFT/APPROVED/ACTIVE/SUPERSEDED history and current permission checks.

Do not implement evidence/training/assessment/expiry (UI10), management review, new business rules, real personal data or deployment.

Run focused tests, typecheck, lint and build. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. T70UI-a integration result
3. Pages/workflows added
4. Files changed
5. Tests/checks
6. PR status/residual risks
```

### UI10 - Training, evidence, assessment and expiry

```text
Use the Paragon ISO EMS task helper skill.

Implement UI10 only: T71 training, competence evidence, assessment and expiry UI.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Use the latest cumulative branch containing UI09 and T71.

Before editing, give me a maximum 12-line plan.

Build course/version, training-event, attendee, competence-evidence, verifier, assessment/reassessment and expiry/reminder screens using existing services and controlled evidence. Make it explicit that attendance alone does not prove competence unless configured policy says so. Show expired evidence as a gap while retaining history. Apply sensitive permissions and safe downloads. Use synthetic fixtures only.

Do not implement management review, invent business rules, add real people/certificates or deploy.

Run focused tests, typecheck, lint and build. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Pages/workflows added
3. Existing services reused
4. Files changed
5. Tests/checks
6. PR status/residual risks
```

### UI11 - Management-review cycle and agenda

```text
Use the Paragon ISO EMS task helper skill.

Implement UI11 only: T72 management-review cycle, attendees, inputs and agenda UI.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Use the latest cumulative branch containing UI10 and T72.

Before editing, give me a maximum 12-line plan.

Build review scheduling/rescheduling, attendee/role management, input collection/freshness, prior-action status and agenda-template versioning through existing T72 services. Show missing/stale required inputs clearly. Validate all linked source IDs against the active organisation. Preserve agenda DRAFT/APPROVED/ACTIVE/SUPERSEDED states. Do not paste ISO clause text or let AI set decisions/approvals.

Do not implement pack/minutes/decisions/closure (UI12), new source adapters, real meeting data or deploy.

Run focused tests, typecheck, lint and build. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Pages/workflows added
3. Files changed
4. Tests/checks
5. PR status/residual risks
```

### UI12 - Management-review pack, minutes, decisions and closure

```text
Use the Paragon ISO EMS task helper skill.

Implement UI12 only: T73 management-review pack, meeting, minutes, decisions, action links, approval and closure UI.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Use the latest cumulative branch containing UI11 and T73.

Before editing, give me a maximum 12-line plan.

Build deterministic pack generation/preview/issue/download, hold-meeting transition, decision capture, shared-action linking, minutes draft/review/approval, addenda and close/reopen-safe history through existing T73 services. Clearly show cutoff, source versions/freshness, generator version and immutable issued artifacts. AI narrative must remain labelled draft support and cannot populate decisions or approvals. Recheck current approval permission on mutation.

Do not change deterministic pack composition, create new business decisions, use real meetings/people/data or deploy.

Run focused tests, typecheck, lint and build. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Pages/workflows added
3. Files changed
4. Tests/checks
5. PR status/residual risks
```

### UI13 - EMS dashboard and reporting entry points

```text
Use the Paragon ISO EMS task helper skill.

Implement UI13 only: EMS dashboard, status summaries and reporting/export entry points.

Repo docs are at: Docs/
Model/effort: Sonnet Medium.

Use the latest cumulative branch containing UI02-UI12.

Before editing, give me a maximum 12-line plan.

Create a tenant-scoped EMS dashboard using existing read services only: review/approval queue, significant-aspect control gaps, overdue monitoring/calibration, legal freshness/applicability/evaluation status, objectives/actions, audits/findings, incidents/NC/CAPA, competence gaps/expiry and management-review readiness. Use counts/statuses and authorised links; do not create a second calculation system or claim compliance/certification. Add report/export entry points only where existing authorised APIs/services exist. Avoid unbounded queries and sensitive record details.

Do not implement new domain state transitions, analytics engines, real data or deployment.

Run focused tests, typecheck, lint, build and basic query-count/performance checks. Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Dashboard/reporting added
3. Files changed
4. Tests/checks
5. PR status/residual risks
```

### UI14 - Browser flows, responsive/accessibility completion and T82 rerun

```text
Use the Paragon ISO EMS task helper skill.

Complete UI14 only: final EMS browser-flow, responsive and accessibility verification/remediation, including a fresh T82 evidence run.

Repo docs are at: Docs/
Model/effort: Sonnet Medium. Move to High only if a security/tenant-isolation defect is found.

Use the latest cumulative branch containing UI01-UI13 and SP08. Do not proceed if Phase 7 UI is absent.

Before editing, give me a maximum 12-line plan.

Requirements:
- create/update a machine-readable critical UI flow inventory for all EMS modules;
- exercise synthetic end-to-end flows for Sustainability Lead, Organisation Administrator, contributor, read-only and restricted/suspended users;
- verify route discovery, empty states, validation, stale permission after page load, tenant ID substitution, downloads and responsive navigation;
- run automated accessibility checks plus keyboard/manual checks for critical flows, focus, labels, errors, headings, tables and non-colour status cues;
- cover competence evidence/expiry and management-review pack/minutes, which previously blocked T82;
- fix only findings within this UI/accessibility scope and record residual issues with severity/owner;
- rerun typecheck, lint, full tests and production build;
- produce Docs/EMS_UI_RELEASE_GATE.md with evidence and an explicit synthetic-pilot GO/NO-GO result.

Do not ingest real data, claim ISO certification, deploy production, create monitors or watch PR/CI.

Open a scoped PR if possible; do not monitor it.

Final report:
1. Base branch/commit
2. Critical flows tested
3. Accessibility/browser findings fixed
4. Tests/checks/build
5. Synthetic UI gate result
6. PR status/residual risks
```

## 8. How to use these prompts without wasting Claude usage

1. Use a fresh chat for each task.
2. Start the next task only after the prior task has pushed its branch/commit.
3. Paste only the one prompt for the current task. The helper skill and `Docs/` references should supply the rest.
4. Use Sonnet Low for SP00, UI00, UI04 and UI05. Use Sonnet Medium for normal implementation. Reserve High for SP08 or a genuinely difficult security failure.
5. Do not ask Claude to wait for reviews, subscribe to PRs, monitor CI or schedule check-ins.
6. If a task reports a dependency branch problem, respond with an exact cumulative branch/commit; do not authorise it to rebuild earlier tasks.
7. Keep each branch cumulative and based on the immediately preceding completed task. This prevents the repeated "T10 does not exist" problem caused by new branches starting from the old repository base.
8. After each implementation, trigger CI once and handle concrete failures in a short fix session. Do not leave an agent polling.

## 9. Official Microsoft references for SP00

- Microsoft Graph file model: https://learn.microsoft.com/en-us/graph/api/resources/onedrive?view=graph-rest-1.0
- Get a DriveItem by stable ID: https://learn.microsoft.com/en-us/graph/api/driveitem-get?view=graph-rest-1.0
- List SharePoint/OneDrive file versions: https://learn.microsoft.com/en-us/graph/api/driveitem-list-versions?view=graph-rest-1.0
- Resumable upload sessions: https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0
- Delta change tracking: https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0
- Microsoft Graph permission reference and Sites.Selected: https://learn.microsoft.com/en-us/graph/permissions-reference
- Selected permissions overview: https://learn.microsoft.com/en-us/graph/permissions-selected-overview
- Graph subscriptions/change notifications: https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0
- SharePoint app-only access direction: https://learn.microsoft.com/en-us/sharepoint/dev/solution-guidance/security-apponly


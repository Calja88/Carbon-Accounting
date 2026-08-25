# SharePoint integration — synthetic pilot gate (SP08)

Implements Docs/SHAREPOINT_AND_EMS_UI_CLAUDE_DELIVERY_PACK.md's SP08 prompt
and Docs/PHASE8_HARDENING_READINESS_SPEC.md's release-gate pattern, scoped
to the SharePoint integration only (SP00-SP07). This is a register of what
this gate checked and found, not a certification — see "Residual risks"
below for what it does not cover, and `docs/readiness/pilot-gate-register.md`
/ `docs/security/tenant-isolation-register.md` for the platform-wide T80/T84
gates this complements.

**Result: GO for a synthetic pilot only.** No production deployment, no
real Microsoft 365 tenant, and no real environmental/customer data are
authorised by this gate — see §9.

## 1. Checklist and evidence

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Org-level SharePoint config exists and is disabled by default until explicitly enabled | PASS | `OrganisationStorageConnection.status` defaults to `NOT_CONNECTED` (`prisma/schema.prisma`); `StorageSiteBinding.status` defaults to `CONNECTED` only once an admin explicitly adds a binding via `connection-service.ts`'s `connectStorage`/`addSiteBinding`, both gated on `ems.storage_connection.manage`. `resolveForTenant` (`graph/config.ts`) refuses any Graph call unless status is exactly `CONNECTED`. |
| 2 | Least-privilege Graph permissions documented, preferring `Sites.Selected` | PASS | Docs/SP00_SHAREPOINT_INTEGRATION_SPEC.md §4 recommends `Sites.Selected` plus an explicit per-site grant over tenant-wide `Sites.ReadWrite.All`; `token-provider.ts` requests only `https://graph.microsoft.com/.default` (whatever the app registration was actually granted), never a broader scope hard-coded in code. |
| 3 | No anonymous SharePoint links generated or exposed | PASS | No `createLink`/sharing-link Graph call exists anywhere in `src/lib/documents/storage/**` (verified by search); `webUrl` is captured from Graph responses but `download-boundary.ts`'s docstring states, and its code confirms, it is "never read, returned, or logged" — no API route (`src/app/**`) ever serializes `webUrl`. |
| 4 | All downloads/previews use EMS server-side tenancy/RBAC checks | PASS | Every read goes through `download-boundary.ts`'s `resolveEvidenceObjectDownload`/`resolveControlledDocumentRevisionDownload`, which re-check organisation ownership, classification clearance, tombstone and malware state before ever calling the Graph client; the Graph client itself is never reachable from a client component (`GraphAccessToken`/`GRAPH_CLIENT_SECRET` are read only in server-only modules under `src/lib/documents/storage/graph/`). |
| 5 | Access tokens/secrets never exposed to client components | PASS | `token-provider.ts`'s `assertServerSide()` throws if imported where `window` is defined; grep of every `"use client"` file in `src/app`/`src/components` found no reference to `GRAPH_CLIENT_ID`/`GRAPH_CLIENT_SECRET`/the Graph client modules. |
| 6 | Issued revisions pin exact identity/version/checksum, never "latest" | PASS | `connection-service.ts`'s `pinExternalFileReference` is the only writer of `itemId`/`versionId`/`checksumSha256`/`pinnedAt` and refuses a second call on an already-pinned row; `downloadPinnedReference` (`download-boundary.ts`) always calls `graphClient.downloadContent` with the pinned `itemId`/`versionId`, never a "get latest" Graph call. Covered by `connection-service.test.ts` and `controlled-document-link-service.test.ts`. |
| 7 | Checksum/version drift is visible and never silently updates issued records | PASS | `reconciliation-service.ts`'s `reconcileOneReference` records `VERSION_DRIFT_BEHIND_ISSUED` and an audit event when a pinned reference's upstream checksum changes, and explicitly never rewrites `itemId`/`versionId`/`checksumSha256` on a pinned row; `downloadPinnedReference` independently re-verifies the checksum on every read and marks the reference `UNREACHABLE` on mismatch rather than serving unverified bytes. Covered by `reconciliation-service.test.ts`. |
| 8 | Deletion/tombstone/legal-hold/retention behaviour is T81-compatible | **FIXED** | `SharePointEvidenceStorageProvider.remove()` (`sharepoint-provider.ts`) previously called Graph `deleteItem` unconditionally from T81's retention `tombstoneOne()` path — a Paragon-side metadata retention decision was physically deleting the customer's SharePoint file, contradicting Docs/SP00_SHAREPOINT_INTEGRATION_SPEC.md §10 ("SharePoint/Purview retention... is a separate control plane"; deletion of the underlying file is the customer's own action) and SP03's own brief ("no physical SharePoint deletion until retention/Purview policy authorises it"). Fixed in this task: `remove()` now only marks the `ExternalFileReference` `UNREACHABLE` in Neon and never calls `deleteItem`. Legal hold (`isUnderLegalHold`) continues to block `tombstoneOne` from running at all, per existing T81 tests. |
| 9 | Idempotent, retry-safe delta reconciliation | PASS | `applyReconciliationBatch` commits a page's writes and its cursor advance in one transaction; `reconcileOneReference` short-circuits when the reference already reflects the observed state (e.g. already `UNREACHABLE`/`DELETED`), making a replayed page a no-op. Covered by `reconciliation-service.test.ts`'s paging/replay/expired-cursor/429/deletion cases. |
| 10 | SP07 migration tooling defaults to dry-run and refuses unsafe apply | PASS | `scripts/migrate-evidence-to-sharepoint.ts` is dry-run unless `--apply` is passed; `assertApplySafetyPreconditions` (`evidence-migration-apply.ts`) additionally requires an explicit `--organisation`, `CONNECTED` status, an active site binding, a bounded `--batch-size`, and a separate `--confirm` flag, collecting every failing reason rather than stopping at the first. Covered by `evidence-migration-apply.test.ts`/`evidence-migration-plan.test.ts`. |
| 11 | Mocked/synthetic pilot data exists or can be generated | PASS | Every SP00-SP07 test file (`sharepoint-provider.test.ts`, `reconciliation-service.test.ts`, `connection-service.test.ts`, etc.) constructs synthetic Aster/Birch-style fixtures and a `fakeGraphClient()`; no test in the repository calls a real Microsoft Graph endpoint. No dedicated synthetic-tenant seed script exists yet for a live synthetic Microsoft 365 site — see residual risk below. |
| 12 | Failure modes covered: missing file, moved/renamed, deleted, revoked access, tenant mismatch, checksum mismatch, expired token, provider outage | PASS | `reconciliation-service.test.ts` covers deletion, move-out-of-scope, rename, checksum drift, permission-revoked, tenant-mismatch, expired/`410` cursor and `429`; `sharepoint-provider.test.ts`/`download-boundary.test.ts` cover missing file, checksum mismatch on read, and unreachable references; `token-provider.test.ts` covers token expiry/caching and 401/malformed responses; `client.test.ts` covers 404/403/409/412/429/5xx/timeout/malformed. |
| 13 | Audit/event logging for sensitive SharePoint actions, following T20 | PASS | Every connection lifecycle, site-binding, pin, stale-marking and reconciliation-outcome write calls `recordAuditEvent` (T20 pattern) inside the same transaction as the state change — `connection-service.ts`, `sharepoint-provider.ts`, `reconciliation-service.ts`, `download-boundary.ts`'s `markReferenceUnreachable`. |
| 14 | Live pilot prerequisites explicit and owner-approved | DOCUMENTED, NOT YET APPROVED | See §9. |

## 2. New coverage added by this task

`storage-connection-repository.ts` (SP01) — `findTenantStorageConnection`,
`findTenantSiteBinding`, `findTenantExternalFileReference`,
`findTenantExternalFileReferenceForRevision` — was never added to
`src/lib/security/resource-endpoint-registry.ts`, so it escaped the T80 CI
completeness/coverage gate entirely (Docs/PHASE8_HARDENING_READINESS_SPEC.md
§3's "adding a new customer-owned route without an isolation test fails
CI" did not, in fact, apply to any SharePoint resource before this task).
Fixed:

- `resource-endpoint-registry.ts` now lists `storage-connection-repository`
  in `REGISTRY_SOURCE_MODULES` and registers all four accessors.
- `src/lib/repositories/__tests__/storage-connection-repository.test.ts`
  (new) exercises the SP08-required "cross-organisation site/drive/item/
  version substitution" case directly: foreign-tenant connection/binding/
  reference denial in both directions, and the nested-parent-substitution
  guard (a genuine Organisation A `ExternalFileReference` attached to a
  *different* Organisation A site binding than the caller expected).

Both `resource-endpoint-registry.test.ts` checks (registry completeness,
and "every entry is referenced by its declared test file") now pass for
these four resources.

## 3. Runbooks

Architecture-level decisions (application-identity model, credential
storage/rotation cadence, admin-consent recording, offboarding sequence)
are specified in Docs/SP00_SHAREPOINT_INTEGRATION_SPEC.md §§10-11. The
operational steps below are the concise pilot-stage procedures built on
top of that design using the services this task verified.

**Admin consent / initial connection.** An Organisation Administrator or
Sustainability Lead (the only role templates holding
`ems.storage_connection.manage`) records admin consent out-of-band (Entra
admin-consent grant is a Microsoft-side action, not something this
codebase performs), then calls `connectStorage` with the resulting Entra
tenant ID. The connection starts `CONNECTED` but resolves no Graph calls
until at least one `CONNECTED` `StorageSiteBinding` is added via
`addSiteBinding`.

**Site grant / adding a library.** After the customer grants the
Paragon application `Sites.Selected` access to one specific site (a
Microsoft-side action under the customer's own SharePoint admin), call
`addSiteBinding` with the resulting `siteId`/`driveId`. `resolveForTenant`
requires exactly one `CONNECTED` binding by default, or an explicit
`siteBindingId` if more than one exists — it never guesses.

**Secret/certificate rotation.** `GRAPH_CLIENT_ID`/`GRAPH_CLIENT_SECRET`
live only in the deployment's secret store, read once per process by
`EntraClientCredentialsTokenProvider`; the in-memory token cache is keyed
per Entra tenant ID and expires independently of the secret's own
lifetime. Rotating the secret takes effect on the next token acquisition
(≤ the cache's `TOKEN_REFRESH_SKEW_MS` after expiry) with no code
deployment required — restart the process only if an immediate cutover
(rather than natural cache expiry) is required.

**Connection disable / offboarding.** Call `disableStorage` with
`SUSPENDED` (temporary) or `OFFBOARDED` (permanent). Neither deletes the
connection, its site bindings, or any `ExternalFileReference` row — per
SP00 §11 and verified by `connection-service.test.ts`. `resolveForTenant`
immediately refuses new Graph calls once status leaves `CONNECTED`. A
suspended/offboarded organisation's reconciliation job continues to run
harmlessly (it fails fast on the same status check) until the operator
also disables the scheduled job for that organisation.

**Reconciliation outage / stale cursor.** `runReconciliationCycle` marks
every tracked reference `UNREACHABLE` (not deleted) and sets the cursor
`status: "ERROR"` on a permission/auth/not-found failure, and resets
`deltaLink: null` on an expired (`410`) cursor, forcing a bounded resync
on the next scheduled attempt rather than an unbounded full scan in the
same attempt (`MAX_PAGES_PER_RUN` caps each run). No manual intervention
is required for a transient outage; a `PERMISSION_DENIED` or
`TENANT_MISMATCH` marking should be triaged by an administrator before
the next scheduled run, since it will keep failing fast otherwise.

**Restore.** Neon remains the system of record for all metadata,
workflow, approval and audit state regardless of SharePoint availability
(SP00 §12). Restoring Neon from backup restores that state as-is; no
SharePoint-side action is required or implied. If SharePoint content
itself needs restoring, that is the customer's own SharePoint/Purview
recovery action — Paragon's reconciliation job will pick up the restored
item's current state on its next run without any Paragon-side replay.

**Incident response — suspected credential compromise.** Rotate
`GRAPH_CLIENT_SECRET` immediately (see above); optionally call
`disableStorage` with `SUSPENDED` for the affected organisation(s) to stop
new Graph calls while investigating, since `Sites.Selected` scoping limits
blast radius to explicitly granted sites. Review `AuditEvent` rows for
`external_file_reference.*`/`storage_connection.*`/`storage_site_binding.*`
event types in the affected window — every state-changing SharePoint
action in this codebase is audited (T20 pattern, §1 row 13 above).

## 4. Fix only, no scope expansion

Per SP08's instruction to fix only defects this gate directly exposes: the
retention/physical-deletion defect (§1 row 8) was fixed. No other
architectural or security defect was found during this review; nothing
else was changed.

## 5. Verification performed

- `pnpm exec tsc --noEmit` — clean.
- `pnpm run lint` — 0 errors (5 pre-existing warnings in unrelated files).
- `pnpm test` (full suite) — 1888 passed, 11 skipped, 0 failed, including
  the new `storage-connection-repository.test.ts` and the updated
  `sharepoint-provider.test.ts`/`resource-endpoint-registry.test.ts`.
- No real Microsoft Graph call was made; no real Microsoft 365 tenant,
  credential, or document was used anywhere in this task.

## 6. Residual risks / owner decisions

- **No live synthetic-tenant integration run.** All SP00-SP08 tests mock
  the `GraphClient` boundary; there is no dedicated synthetic Microsoft 365
  developer tenant/seed script wired into CI (Docs/SP00_SHAREPOINT_INTEGRATION_SPEC.md
  §12 names this as the intended strategy but it is not yet built).
  Owner decision: whether a live run against a synthetic tenant is required
  before a real (non-mocked) pilot, and who provisions/owns that tenant.
- **UI03 (controlled-document/evidence hub and connection admin UI) does
  not exist yet** on this branch — this gate covers the service/data layer
  only. A pilot user currently has no screen to configure a connection,
  attach evidence, or see drift/integrity state; that is either built
  before a synthetic pilot starts, or the pilot is API/script-driven only.
  This is a scope note, not a defect: SP08's own dependency line names
  UI03, but this task's explicit instruction was SP00-SP07 only.
- **Reconciliation and migration jobs are not yet scheduled/wired into a
  running worker** in this repository snapshot — `SHAREPOINT_RECONCILE_JOB_TOPIC`
  and the migration CLI exist and are tested, but an owner must confirm the
  outbox worker/cron actually invokes them in the target deployment before
  relying on reconciliation freshness claims.
- **Purview/retention-label application is explicitly out of scope**
  (SP00 §13) — this gate verifies Paragon never *initiates* a physical
  SharePoint deletion, not that a customer's own Purview policy is
  correctly configured to protect issued records; that remains the
  customer's responsibility per §10.
- **Application identity model (SP00 §3) and per-organisation vs. shared
  credential rotation cadence (§11)** remain owner decisions recorded in
  the spec, not enforced defaults in code — `ApplicationIdentityMode.CUSTOMER_OWNED`
  is modelled in the schema but its credential resolution is explicitly
  unimplemented (SP02 scope note).
- Certificate-based credentials (SP00 §3's production recommendation) are
  not implemented — only the client-secret flow (`EntraClientCredentialsTokenProvider`)
  exists, which the spec accepts only for a time-limited non-production
  pilot with rotation and secret-manager storage. Confirm this pilot stays
  within that boundary before any extended or production use.

## 9. Real-tenant / production boundary

This gate authorises nothing beyond a synthetic pilot using mocked Graph
responses and synthetic fixtures. Before any real Microsoft 365 tenant,
real document, or production deployment:

- complete the residual risks above, with named owners and dates;
- obtain explicit written approval for connecting to a real tenant,
  per this programme's standing rule (no real credentials, no real
  environmental/customer data, no production deployment without separate
  authorisation);
- define the real-data onboarding plan required by
  Docs/PHASE8_HARDENING_READINESS_SPEC.md §9, which this gate does not
  attempt to satisfy.

# SP00 — SharePoint Integration Architecture and Data-Boundary Specification

**Status:** Architecture and data-boundary specification only. No connector code, schema migration, credentials, or live Microsoft Graph calls are part of this task.

**Depends on (context, not implementation):** T22 (controlled documents and unified evidence), T81 (audit integrity, retention and export), T80 (cross-tenant adversarial suite).

**External technical authority:** official Microsoft Graph and SharePoint REST/Graph documentation only (`learn.microsoft.com/graph`, `learn.microsoft.com/sharepoint/dev`). No secrets, real tenant IDs, real site IDs, real documents, or real environmental data appear anywhere in this document — all identifiers below are illustrative placeholders.

---

## 1. Purpose and scope boundary

SharePoint and Neon own different halves of the same controlled-document record. Neither system is a cache of the other.

| Owns | System |
|---|---|
| File bytes, native version history, native co-authoring/locking | **SharePoint / OneDrive for Business (via Microsoft Graph)** |
| EMS metadata, exact version reference, workflow/approval state, evidence links, checksum, retention intent, audit history | **Neon (Paragon EMS database)** |

Neon never stores file bytes. SharePoint never becomes an authority for EMS workflow state, approvals, or audit trail — it is a byte store with its own native version history, addressed by exact, pinned references from Neon.

This boundary follows the same pattern as T22's `EvidenceObject`/`ControlledDocumentRevision` split: metadata, checksum and lifecycle state live in Neon regardless of which storage provider holds the bytes. SharePoint is a second storage provider behind the same provider interface (`src/lib/documents/storage/provider.ts`), not a replacement for it.

## 2. Multi-organisation, multi-tenant onboarding

Each Paragon `Organisation` may use a different Microsoft 365 tenant, or none at all (organisations that never connect SharePoint keep using the existing evidence provider unchanged).

Per-organisation configuration record (conceptual; no schema is defined here — see §6):

- Paragon `Organisation` ID (existing tenancy root).
- Connection status: `NOT_CONNECTED` / `CONNECTED` / `SUSPENDED` / `OFFBOARDED`.
- Entra tenant ID for that organisation's Microsoft 365 tenant.
- Application identity used for that organisation (see §3).
- One or more site bindings (see §4).
- Connected-by identity, connected-at timestamp, last-verified timestamp.

An organisation's SharePoint configuration is visible and editable only within that organisation's own membership scope, following the existing rule that customer-owned data must never be accessed without membership validation and must never trust a client-supplied `organisationId`.

A single Paragon deployment must be able to hold configurations for many distinct customer Entra tenants concurrently, with no cross-tenant assumption baked into any query, job, or cache key. Every SharePoint-bound record is keyed first by Paragon `Organisation`, never by tenant ID alone, because two Paragon organisations must never be able to collide even in the (disallowed) case that they pointed at the same external tenant.

## 3. Application identity model: multi-tenant vs customer-owned

Two candidate models for the Entra application that Paragon uses to call Graph on a customer's behalf:

**Option A — one multi-tenant Entra application, owned and published by Paragon.**
Customers grant admin consent to Paragon's single app registration. Paragon holds one set of application credentials (rotated by Paragon) and calls Graph as that app into each consenting tenant.

**Option B — customer-owned Entra application per organisation.**
Each customer registers their own single-tenant app in their own tenant and hands Paragon a client ID/secret or certificate for it. Paragon stores one distinct credential per organisation.

| | Option A (multi-tenant) | Option B (customer-owned) |
|---|---|---|
| Onboarding friction | Low — one admin-consent click | Higher — customer IT must register an app, configure certificate/secret, share credential securely |
| Credential blast radius | One compromised Paragon credential does not expose customer-managed secrets, but a Paragon-side compromise could touch every consenting tenant | A compromised credential is scoped to one customer only |
| Customer control/visibility | Customer sees a single external app in their Entra admin center; less granular control over Paragon's own key rotation | Customer controls their own app's secret rotation and can revoke independently at any time |
| Operational overhead for Paragon | Low — one app, one rotation cycle | High — one credential store entry, rotation schedule and expiry alert per organisation |
| Enterprise procurement fit | Some enterprise customers require vendor-specific app registrations as a security policy | Satisfies that requirement directly |

**Recommended default: Option A (single Paragon multi-tenant Entra application)**, combined with `Sites.Selected` least-privilege scoping (§4) so that even under the shared-app model, Paragon's application permission grants access to nothing beyond the specific sites each organisation explicitly authorises. This keeps onboarding low-friction for the majority of customers while keeping the actual data blast radius per-tenant regardless of app model, because `Sites.Selected` — not the app registration choice — is what limits data access.

Customer-owned application (Option B) remains available as an **opt-in override** for organisations whose procurement or security policy requires it; this is an owner decision to formalise before any organisation requests it (see §12).

## 4. Least-privilege access: `Sites.Selected`

Paragon's Entra application requests the `Sites.Selected` **application** permission only — never `Sites.Read.All` or `Sites.ReadWrite.All`. `Sites.Selected` grants zero site access by default; access to a specific SharePoint site must be explicitly granted per site via the Graph site-permissions endpoint, after a customer tenant admin has consented to the app.

Onboarding sequence per organisation:

1. Paragon presents an admin-consent URL scoped to `Sites.Selected` for the customer's tenant.
2. Customer's Global/SharePoint admin consents.
3. Customer's admin (or Paragon, using delegated permission granted temporarily for this step, per customer preference) grants the Paragon application `write` or `read` permission on the exact site(s) Paragon should use, via Graph's site-permission grant.
4. Paragon records the resulting site ID(s) and permission level against the organisation's configuration.

No Paragon application credential can enumerate or reach a customer's other SharePoint sites. This is the primary technical control for the "different tenant per organisation" requirement in §2 — a defence-in-depth measure independent of, and in addition to, Paragon's own organisation-scoped query discipline.

## 5. Site / library / folder topology

Recommended per-organisation topology, configurable but defaulting to:

```
<customer SharePoint site granted via Sites.Selected>
  └── document library (e.g. "Paragon EMS Controlled Documents")
        └── one folder per ControlledDocument category (mirrors T22 `category`)
              └── one file per ControlledDocument, SharePoint-versioned natively
```

Configuration held per organisation (conceptual fields, not a schema definition):

- target site ID;
- target drive (library) ID;
- optional root folder path/ID within that drive;
- folder-naming convention (by category, by entity, or flat — organisation choice).

Paragon does not require a specific folder-per-category layout — it stores whatever drive/item path is returned by Graph — but the default gives customers a predictable, auditable structure and gives Paragon a stable place to enumerate for delta reconciliation (§9).

## 6. Exact identity fields recorded in Neon

For every SharePoint-backed `ControlledDocumentRevision` (or `EvidenceObject`), Neon records the exact reference needed to retrieve that exact byte content, never a "latest" pointer:

| Field | Source | Purpose |
|---|---|---|
| Entra tenant ID | Organisation's SharePoint configuration | Identify which customer tenant this reference belongs to |
| SharePoint site ID | Graph site resource | Locate the site |
| Drive (library) ID | Graph drive resource | Locate the document library |
| Item ID | Graph driveItem resource | Locate the file, stable across renames/moves |
| Version ID | Graph driveItem version resource | Pin the exact SharePoint version this Neon revision maps to |
| eTag / cTag | Graph driveItem resource, where useful | Cheap change-detection signal for delta reconciliation; not a substitute for version ID as the pinned reference |
| Web URL | Graph driveItem resource | **Authorised display only** — shown to a permitted user as a convenience link into SharePoint; never used as the retrieval path for a server-proxied download and never trusted as a stable identifier |
| SHA-256 | Computed by Paragon on ingest, or taken from Graph file hash facet when available | Independent integrity check against tampering or silent content substitution |
| Observed timestamp(s) | Paragon system clock at sync time, plus Graph's `lastModifiedDateTime` | Audit trail of when Paragon observed this state, independent of SharePoint's own clock |

Item ID is the durable identifier across rename/move (§9); version ID is what makes an issued revision immutable (§7). Web URL is deliberately excluded from any resolution or authorization logic — it is a UI convenience, not a capability.

## 7. Draft authoring vs. immutable issued revision

This is the same lifecycle boundary T22 already enforces (`ControlledDocument`: `DRAFT → IN_REVIEW → APPROVED → EFFECTIVE → OBSOLETE`, approved revision immutable), extended to a SharePoint-backed body:

- **Draft authoring** (`DRAFT` / `IN_REVIEW`): the SharePoint file may continue to change — co-authoring, comments, further edits are expected and desirable. Neon's draft revision record may re-sync its recorded version ID/eTag as the draft evolves, because no approval has been issued yet.
- **Issued revision** (`APPROVED` / `EFFECTIVE`): the moment an approval action is recorded in Neon, the current SharePoint version ID at that instant is pinned into the revision record and becomes immutable. If the underlying SharePoint file is edited afterward (intentionally or accidentally), the **issued Paragon record continues to reference the pinned version ID, never the newest SharePoint version.** A later edit in SharePoint produces, at most, a new *draft* candidate for a *successor* revision — it never silently mutates what an already-issued record points to.

This is a hard invariant, not a UX preference: any reconciliation job (§9) that finds a newer SharePoint version on an item behind an issued Neon revision must never rewrite that revision's stored version ID. It may only flag the discrepancy for review or open a new draft successor, exactly as T22's "replacement creates successor" rule already requires for the non-SharePoint case.

## 8. Server-proxied downloads vs. opening drafts in SharePoint

Two distinct access paths, deliberately kept separate:

- **Authorised download (issued/approved content):** the client never receives a direct SharePoint/Graph URL or credential. The Paragon server resolves the requesting user's organisation membership and permission, resolves the exact pinned reference (§6) for the requested revision, calls Graph server-side to stream those exact bytes, and returns them to the client through Paragon's own download route — following the same pattern T22 already specifies ("Downloads check organisation, permission/classification, exact revision/evidence and non-disclosing errors before loading bytes"). This is the only path for issued/effective revisions, and the only path that can be audited, checksum-verified, and rate-limited by Paragon.
- **Opening a draft for editing:** for a document still in `DRAFT`/`IN_REVIEW`, an authorised author may be handed an authorised deep link (the Graph `webUrl`, §6) to open and continue co-authoring the file directly in SharePoint/Office. This path is explicitly *not* used for issued content, and is only ever offered to a user whose Paragon permission already allows editing that draft — Paragon does not proxy draft editing itself.

Web URL (§6) is therefore only ever used in the second path, and only after Paragon's own authorization check — never as an unauthenticated or unauthorized shortcut.

## 9. Delta reconciliation and change handling

Paragon periodically reconciles its recorded state against SharePoint using Graph's delta query capability (`/drive/root/delta`) scoped to the configured drive/folder, rather than polling every item individually.

Handling per change type:

- **Content change on a draft:** update the draft revision's recorded version ID/eTag; no immutability concern (§7).
- **Content change on an item behind an issued revision:** never overwrite the pinned reference; record a reconciliation-audit event and surface it for a successor-revision decision.
- **Rename:** item ID is unchanged (§6), so a rename alone does not break an existing pinned reference; Paragon updates only the display name/path it may separately cache for UI purposes.
- **Move (within the granted site/library):** same — item ID persists; Paragon updates cached path metadata.
- **Move outside the granted site/library scope, or delete:** the pinned reference becomes stale. Paragon does not delete or silently null the Neon record (issued records are immutable per §7); it marks the reference `STALE`/`UNREACHABLE`, records an audit event, and surfaces this to the organisation's document owner. Immutable audit and evidence history in Neon is retained regardless of SharePoint-side deletion — see §10 on retention-ownership separation.
- **Site/library unreachable (permission revoked, site deleted, tenant offboarded):** same stale-marking behaviour, plus an organisation-level alert distinct from a single-item alert.

Reconciliation runs are idempotent and retryable, following the existing T21 outbox/job pattern (lease, attempts, scheduled time, idempotency key, dead-letter on repeated failure) — this task does not introduce a new job framework, it specifies that SharePoint reconciliation is a job of that existing shape. Every reconciliation outcome (change detected, pin preserved, marked stale, error) is written as an append-only audit event, matching T20/T81's audit-integrity requirements: reconciliation history is itself evidence, and must be exportable and tamper-evident.

## 10. Retention, legal hold and deletion ownership

SharePoint/Microsoft Purview retention policies, legal holds, and deletion are a **separate control plane** from T81's EMS retention metadata, and this specification does not attempt to unify them into one system:

- **SharePoint/Purview owns:** the actual retention/hold enforcement on the file bytes and native version history sitting in the customer's tenant — retention labels, litigation hold, and eventual deletion of the underlying SharePoint content, all governed by the customer's own Microsoft 365 compliance configuration and the customer's own admins.
- **T81 EMS retention metadata owns:** Paragon's own record of retention *intent* and legal-hold *state* against the Neon evidence/document record — the same fields that already govern retention and hold behaviour for non-SharePoint evidence (`EvidenceObject.retention_category`, legal hold flag) apply identically whether the bytes live in Paragon's own storage or in SharePoint.

Because these are two independently governed systems, Paragon must not assume that a SharePoint-side deletion is a Paragon-authorised retention action, and must not assume that a T81 legal hold in Neon has any enforcement effect inside the customer's SharePoint tenant. Concretely:

- A SharePoint-side deletion of a file behind an issued revision does **not** delete or alter the Neon audit/evidence-link history for that revision (T81's "retention never deletes frozen/legal-held records" applies to Neon's own records regardless of source-file availability). It surfaces as `STALE`/`UNREACHABLE` per §9.
- A T81 legal hold recorded in Neon is a Paragon-side compliance record and control on Paragon's own destructive operations; it is **not** itself a Microsoft Purview hold. If a customer needs the underlying SharePoint file placed under an actual Purview hold, that is the customer's own action in their own tenant — this specification only requires that Paragon surface, for the document owner, whether Paragon believes a hold should exist, not that Paragon enforce it inside SharePoint. Actually applying/removing a Purview retention label or hold via Graph/Purview APIs is out of scope for SP00 (see §13) and would be a separate, explicit connector task if ever undertaken.
- Offboarding an organisation (§11) removes Paragon's access and stops reconciliation; it makes no change to the customer's own SharePoint retention/hold configuration, which remains entirely theirs.

## 11. Credential storage, rotation, admin consent, and offboarding

- **Credential storage:** whichever application-identity model is in effect (§3), the resulting client secret/certificate is stored in Paragon's existing secrets-management mechanism, never in the Neon application database, never in source control, and never logged. This specification does not define a new secrets store — it assumes Paragon's existing operational secrets infrastructure is extended to hold one entry per organisation (Option B) or one shared entry (Option A).
- **Rotation:** Option A credentials are rotated on a Paragon-controlled schedule with overlap (old and new both valid during a cutover window) so no customer session is interrupted. Option B credentials are rotated on the customer's own schedule; Paragon alerts the organisation's admin before a stored customer-owned credential's expiry.
- **Admin consent:** captured explicitly — Paragon records which customer identity performed admin consent and when, as part of the organisation's SharePoint configuration audit trail, not just as a Microsoft-side consent grant invisible to Paragon.
- **Offboarding:** when an organisation disconnects (voluntarily or on contract end), Paragon: stops all reconciliation jobs for that organisation; revokes/deletes its stored credential (Option B) or simply stops using the shared credential for that tenant (Option A, since the site-level grant under `Sites.Selected` is what actually gates access — revoking that site permission on the customer side, or Paragon ceasing to call into that site, ends access); retains Neon-side audit/evidence metadata per T81 retention rules (metadata is Paragon's own record and is not deleted just because the SharePoint connection ended); and marks all that organisation's pinned references `UNREACHABLE` going forward rather than deleting them.

## 12. Synthetic test-site strategy, migration, and rollback

- **Testing:** all development and adversarial testing (per the T80 pattern of two synthetic tenants) uses a dedicated synthetic Microsoft 365 developer tenant with synthetic sites, synthetic document content, and no real customer or environmental data — consistent with this programme's standing rule against real environmental data and real customer content in any fixture. At minimum two synthetic organisations, each bound to a distinct synthetic Entra tenant/site, are needed to exercise the cross-tenant isolation guarantees this design depends on (no query, cache key, or job may leak across them).
- **Migration:** organisations already using Paragon's existing (non-SharePoint) evidence provider are not force-migrated. Migration to SharePoint-backed storage is opt-in per organisation, per document going forward — existing `EvidenceObject`/`ControlledDocumentRevision` records already stored under the current provider are left as-is unless an organisation explicitly requests a backfill, which would be a separate, explicitly scoped task (not part of SP00).
- **Rollback:** because Neon remains the system of record for metadata/workflow/audit regardless of storage provider, disabling SharePoint for an organisation (or for the feature globally) does not corrupt EMS state — it only removes the ability to fetch bytes for SharePoint-backed references until reconnected. Rollback of a partial rollout is therefore a configuration change (disable the organisation's SharePoint binding), not a data migration.

## 13. Explicit non-goals

- No connector/adapter code, Graph client wiring, schema/migration, or credential handling is implemented by SP00 — this document specifies the target architecture only.
- No automatic real-time push/webhook subscription design is specified here; reconciliation is delta-poll based (§9). A Graph change-notification (webhook) design, if wanted, is a separate future task.
- No design for applying, removing, or reading Microsoft Purview retention labels/holds via API is included (§10) — Paragon only records its own T81-side intent and observes SharePoint-side unreachability; enforcing holds inside SharePoint is out of scope.
- No bulk historical migration/backfill design of existing non-SharePoint evidence into SharePoint is included (§12) — noted as a candidate future task only.
- No UI/UX design (screens, components) is specified — this is a data and access-boundary architecture document.
- No decision is made here about pricing, licensing, or which customer tiers get SharePoint integration — that is a product/commercial decision outside this document's scope.

## 14. Owner decisions required before implementation

The following require an explicit decision from the EMS/product owner, not an engineering default, before any SP01+ implementation task begins:

1. Confirm Option A (Paragon multi-tenant Entra app) as the default, and confirm the criteria under which an organisation is offered the Option B (customer-owned app) override (§3).
2. Confirm default site/library/folder topology (§5) or approve a different default.
3. Confirm reconciliation frequency/schedule for delta queries (§9) — an operational SLO, not an architectural question, but needed before implementation sizing.
4. Confirm whether Paragon should ever call Purview retention/hold APIs on the customer's behalf in a future task, or whether hold enforcement remains permanently the customer's own responsibility (§10).
5. Confirm the offboarding data-retention period for Paragon-side metadata after a customer disconnects SharePoint (§11), consistent with whatever the organisation's broader data-retention/export agreement specifies.
6. Approve whether existing non-SharePoint evidence is ever eligible for backfill migration into SharePoint, and under what customer request process (§12).

# T81 — Organisation restore procedure

Restore is a **separately validated administrative operation**, never
assumed from export (Docs/PHASE8_HARDENING_READINESS_SPEC.md §4). This
document is the required "restore procedure documented" deliverable for
T81. It describes the manual/administrative procedure for restoring an
organisation from a `generateOrganisationExport` output
(`src/lib/exports/organisation-export-service.ts`); it does not implement
an automated import path, which is out of T81 scope (no such requirement
in `Docs/CLAUDE_IMPLEMENTATION_TASKS.md` T81 acceptance criteria) and is
listed as a residual risk below.

## When this procedure applies

- Recovering a single organisation's data into a **new, isolated**
  environment after export (tenant offboarding, dispute resolution,
  regulator request, disaster recovery drill).
- Never as a way to "undo" retention execution or a legal-hold release —
  those are one-way per the retention/legal-hold services; restoring from
  an earlier export brings back rows tombstoned since that export was
  generated, which is an explicit administrative decision, not a background
  effect of the export/import tooling.

## Preconditions

1. The restore target is an **isolated environment** — never the live
   production database, and never a database another organisation's data
   also lives in. This mirrors the platform's tenant-isolation guarantee:
   a restore must not create a shared-database window where two
   organisations' rows coexist outside the normal tenant-scoped
   application path.
2. The operator has independently verified the requester's authority to
   receive this organisation's data (this is an owner/support-process
   decision, not something the export tooling can verify).
3. The export bundle (`OrganisationExportManifest` + per-model
   `OrganisationExportSection`s) is available in full — a partial bundle
   must not be restored, since a partial restore can silently drop
   `EvidenceLink`/`AuditEvent` references that other sections depend on.

## Procedure

1. **Validate the manifest before touching any data.**
   - Confirm `manifest.schemaVersion` matches (or has a documented
     migration path from) `ORGANISATION_EXPORT_SCHEMA_VERSION` in
     `organisation-export-service.ts`.
   - Recompute each section's checksum
     (`sha256(canonicalStringify(section.records))`,
     `src/lib/audit/integrity.ts` provides `canonicalStringify`) and
     compare against `manifest.sections[i].checksumSha256`. Recompute
     `manifest.exportChecksumSha256` the same way over the section manifest
     list. Any mismatch stops the restore — the bundle may be corrupted or
     tampered.
   - Confirm `manifest.sectionCount` and `manifest.totalRecordCount` match
     what the bundle actually contains.

2. **Dry-run reconciliation in the isolated environment.**
   - Load the bundle into a scratch schema/database and compare record
     counts per model against the manifest before writing into the real
     restore target.
   - Confirm every foreign-tenant reference resolves within the bundle
     itself (e.g. every `EvidenceLink.resourceId` referenced by an
     `EvidenceObject` row is either present in the bundle or the reference
     is expected to be dangling because the referenced resource was itself
     tombstoned/retired before export).

3. **Restore in dependency order**, not manifest/table order:
   `Organisation` → `OrganisationMembership`/`RoleDefinition`/
   `PermissionDefinition`/`RolePermission`/`MembershipRole` → domain
   records → `AuditEvent` (last, and inserted preserving `sequence` order
   and `contentHash`/`previousEventHash` exactly as exported — never
   recomputed — so the restored chain matches what was actually audited).
   Every insert uses the exported primary keys unchanged; this procedure
   is a same-id restore, not a re-import with new ids, so `EvidenceLink`/
   audit-event resource references keep resolving.

4. **Do not restore secrets/tokens.** The export already redacts
   `OrganisationMembership.inviteTokenHash` and every `Bytes`-typed column
   (`EXPORT_FIELD_REDACTIONS` / the generic Bytes-field redaction in
   `organisation-export-service.ts`). A restored organisation has no valid
   invitation tokens and no evidence bytes; regenerate invitations and
   re-upload evidence bytes (or restore them from the storage provider's
   own backup, out of this export's scope) as a separate step.

5. **Verify after restore, before handing the environment back:**
   - Recompute the `AuditEvent` hash chain per organisation
     (`src/lib/audit/integrity.ts`'s `computeContentHash`, walking rows in
     `sequence` order) and confirm every row's `previousEventHash` matches
     the prior row's `contentHash` — the same check a tamper-detection job
     would run.
   - Spot-check that the append-only triggers (`audit_event_deny_mutation`,
     `legal_hold_deny_mutation` — `prisma/migrations/20260811132659_add_audit_event`
     and `prisma/migrations/20260820180000_add_legal_hold_retention_tombstone`)
     are present and firing in the restored database — a restore procedure
     that recreates tables without these triggers would silently reopen
     the immutability guarantee.
   - Confirm no cross-tenant row leaked in: every restored row's
     `organisationId` equals the organisation being restored.

6. **Sign-off.** Record the restore itself as a synthetic/administrative
   action outside the application's own audit log (this procedure is a
   break-glass operation performed with direct database access, not
   something the application's `recordAuditEvent` path can capture) —
   who performed it, when, from which export manifest
   (`generatedAt`/`exportChecksumSha256`), and the verification results
   from step 5, in the operator's own incident/change record.

## Residual risk

- No automated import tool exists yet; this is a manual/scripted DBA
  procedure. Building one is a reasonable Phase 8 follow-up but is not
  required by the T81 acceptance criteria, which asks only that the
  procedure be documented.
- Backup/PITR-based restore (as opposed to restoring from an
  `organisation-export-service.ts` bundle) is T83's "backup/PITR and full
  restore to isolated environment" scope, not this document's.

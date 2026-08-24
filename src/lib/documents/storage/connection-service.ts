/**
 * Organisation storage connection / external-file-reference service (task
 * SP01, Docs/SP00_SHAREPOINT_INTEGRATION_SPEC.md §§2,6-7,9,11). This is the
 * tenant-scoped configuration layer only — no Microsoft Graph HTTP call, no
 * credential, and no UI ships here. It exists so a later connector task
 * (SP02+) has a schema and set of invariants already enforced:
 *
 *  - a connection/site binding models identifiers only, never a token,
 *    client secret, or private key (SP00 §11);
 *  - `pinExternalFileReference` is the *only* way `pinnedAt`/`itemId`/
 *    `versionId`/`checksumSha256` on a pinned reference can be set, and it
 *    refuses to run twice on the same row — once pinned, a reference is
 *    immutable here exactly as SP00 §7 requires ("the issued Paragon record
 *    continues to reference the pinned version ID, never the newest
 *    SharePoint version");
 *  - `markExternalFileReferenceStale` is the only mutation permitted on a
 *    pinned row afterward, and it can only move status, never touch the
 *    pinned identity fields (SP00 §9's reconciliation contract, ahead of the
 *    reconciliation job itself landing in a later task);
 *  - disabling/offboarding a connection never deletes the connection, its
 *    site bindings, or any file reference row (SP00 §11 "safe offboarding");
 *  - every write is permission-gated on `ems.storage_connection.manage`
 *    (connection administration) — never `ems.controlled_document.manage`/
 *    `ems.view`, so granting the former (an Organisation Administrator duty)
 *    never implies document-content access.
 */

import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import {
  findTenantExternalFileReference,
  findTenantSiteBinding,
  findTenantStorageConnection,
  toTenantRepositoryContext,
} from "@/lib/repositories/storage-connection-repository";
import { findTenantControlledDocumentRevision, findTenantEvidenceObject } from "@/lib/repositories/documents-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

export { TenantOwnershipError };

export class StorageConnectionError extends Error {}

const MANAGE_PERMISSION = "ems.storage_connection.manage" as const;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Loads the organisation's storage connection, or null if it has never created one — the "no SharePoint connected" default state. */
export async function getStorageConnection(context: OrganisationContext) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const connection = await findTenantStorageConnection(ctx);
  if (!connection) return null;
  return prisma.organisationStorageConnection.findUnique({
    where: { id: connection.id },
    include: { siteBindings: true },
  });
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

export interface ConnectStorageInput {
  entraTenantId: string;
  applicationIdentityMode: "PARAGON_MULTI_TENANT" | "CUSTOMER_OWNED";
  actorUserId: string;
}

/**
 * Creates (or reconnects) the organisation's single storage connection row.
 * Records only identifiers — no credential is ever accepted here. Requires
 * `ems.storage_connection.manage`.
 */
export async function connectStorage(context: OrganisationContext, input: ConnectStorageInput) {
  requirePermission(context, MANAGE_PERMISSION);
  if (!input.entraTenantId.trim()) {
    throw new StorageConnectionError("A storage connection requires an Entra tenant id.");
  }

  const ctx = toTenantRepositoryContext(context);
  const existing = await findTenantStorageConnection(ctx);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const connection = await tx.organisationStorageConnection.upsert({
      where: { organisationId: txCtx.organisationId },
      create: {
        organisationId: txCtx.organisationId,
        entraTenantId: input.entraTenantId,
        applicationIdentityMode: input.applicationIdentityMode,
        status: "CONNECTED",
        connectedByUserId: input.actorUserId,
        connectedAt: new Date(),
        lastVerifiedAt: new Date(),
      },
      update: {
        entraTenantId: input.entraTenantId,
        applicationIdentityMode: input.applicationIdentityMode,
        status: "CONNECTED",
        connectedByUserId: input.actorUserId,
        connectedAt: new Date(),
        lastVerifiedAt: new Date(),
        disabledByUserId: null,
        disabledAt: null,
        disabledReason: null,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: existing ? "storage_connection.status_changed" : "storage_connection.created",
      resourceType: "organisation_storage_connection",
      resourceId: connection.id,
      summary: existing
        ? "Organisation storage connection reconnected."
        : "Organisation storage connection created.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { status: connection.status, entraTenantId: connection.entraTenantId },
    });

    return connection;
  });
}

export interface DisableStorageInput {
  status: "SUSPENDED" | "OFFBOARDED";
  reason: string;
  actorUserId: string;
}

/**
 * Suspends or offboards the organisation's storage connection. Never
 * deletes the connection, its site bindings, or any file reference — SP00
 * §11 "safe offboarding without cascading deletion of audit/evidence
 * history". Requires `ems.storage_connection.manage`.
 */
export async function disableStorage(context: OrganisationContext, input: DisableStorageInput) {
  requirePermission(context, MANAGE_PERMISSION);
  if (!input.reason.trim()) {
    throw new StorageConnectionError("Disabling a storage connection requires a reason.");
  }

  const ctx = toTenantRepositoryContext(context);
  const connection = await findTenantStorageConnection(ctx);
  if (!connection) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.organisationStorageConnection.update({
      where: { organisationId: txCtx.organisationId },
      data: {
        status: input.status,
        disabledByUserId: input.actorUserId,
        disabledAt: new Date(),
        disabledReason: input.reason,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "storage_connection.status_changed",
      resourceType: "organisation_storage_connection",
      resourceId: updated.id,
      summary: `Organisation storage connection ${input.status === "OFFBOARDED" ? "offboarded" : "suspended"}: ${input.reason}`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { status: updated.status },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Site bindings
// ---------------------------------------------------------------------------

export interface AddSiteBindingInput {
  siteId: string;
  driveId: string;
  rootFolderId?: string | null;
  rootFolderPath?: string | null;
  label?: string | null;
  actorUserId: string;
}

/** Adds a site/drive binding to the organisation's connection. Requires `ems.storage_connection.manage`. */
export async function addSiteBinding(context: OrganisationContext, input: AddSiteBindingInput) {
  requirePermission(context, MANAGE_PERMISSION);
  if (!input.siteId.trim() || !input.driveId.trim()) {
    throw new StorageConnectionError("A site binding requires both a site id and a drive id.");
  }

  const ctx = toTenantRepositoryContext(context);
  const connection = await findTenantStorageConnection(ctx);
  if (!connection) {
    throw new StorageConnectionError("The organisation has no storage connection to bind a site to.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const binding = await tx.storageSiteBinding.create({
      data: {
        connectionId: connection.id,
        organisationId: txCtx.organisationId,
        siteId: input.siteId,
        driveId: input.driveId,
        rootFolderId: input.rootFolderId ?? null,
        rootFolderPath: input.rootFolderPath ?? null,
        label: input.label ?? null,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "storage_site_binding.created",
      resourceType: "storage_site_binding",
      resourceId: binding.id,
      summary: `Site binding added${input.label ? ` (${input.label})` : ""}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { siteId: binding.siteId, driveId: binding.driveId },
    });

    return binding;
  });
}

export interface DisableSiteBindingInput {
  siteBindingId: string;
  status: "SUSPENDED" | "OFFBOARDED";
  actorUserId: string;
}

/** Suspends or offboards a single site binding without touching its file references. Requires `ems.storage_connection.manage`. */
export async function disableSiteBinding(context: OrganisationContext, input: DisableSiteBindingInput) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const binding = await findTenantSiteBinding(ctx, input.siteBindingId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.storageSiteBinding.update({
      where: { id: binding.id, organisationId: txCtx.organisationId },
      data: { status: input.status },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "storage_site_binding.status_changed",
      resourceType: "storage_site_binding",
      resourceId: updated.id,
      summary: `Site binding ${input.status === "OFFBOARDED" ? "offboarded" : "suspended"}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { status: updated.status },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// External file references
// ---------------------------------------------------------------------------

export interface CreateExternalFileReferenceInput {
  siteBindingId: string;
  /** Exactly one of these two must be set. */
  evidenceObjectId?: string | null;
  controlledDocumentRevisionId?: string | null;
  itemId: string;
  versionId: string;
  eTag?: string | null;
  webUrl?: string | null;
  checksumSha256: string;
  byteSize?: number | null;
  mimeType?: string | null;
  actorUserId: string;
}

function assertExactlyOneTarget(input: Pick<CreateExternalFileReferenceInput, "evidenceObjectId" | "controlledDocumentRevisionId">): void {
  const hasEvidence = Boolean(input.evidenceObjectId);
  const hasRevision = Boolean(input.controlledDocumentRevisionId);
  if (hasEvidence === hasRevision) {
    throw new StorageConnectionError(
      "An external file reference must target exactly one of an EvidenceObject or a ControlledDocumentRevision.",
    );
  }
}

/**
 * Creates a draft (unpinned) external-file reference for an EvidenceObject
 * or ControlledDocumentRevision — SP00 §7's "draft authoring" state, where
 * the recorded version id may still be re-synced as the draft evolves.
 * Requires `ems.storage_connection.manage` (connection administration, not
 * document content access — the target's own organisation ownership is
 * still checked, but this operation does not require
 * `ems.controlled_document.manage`).
 */
export async function createExternalFileReference(context: OrganisationContext, input: CreateExternalFileReferenceInput) {
  requirePermission(context, MANAGE_PERMISSION);
  assertExactlyOneTarget(input);
  if (!input.itemId.trim() || !input.versionId.trim() || !input.checksumSha256.trim()) {
    throw new StorageConnectionError("An external file reference requires an itemId, versionId and checksum.");
  }

  const ctx = toTenantRepositoryContext(context);
  const binding = await findTenantSiteBinding(ctx, input.siteBindingId);
  if (input.evidenceObjectId) await findTenantEvidenceObject(ctx, input.evidenceObjectId);
  if (input.controlledDocumentRevisionId) await findTenantControlledDocumentRevision(ctx, input.controlledDocumentRevisionId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const reference = await tx.externalFileReference.create({
      data: {
        organisationId: txCtx.organisationId,
        siteBindingId: binding.id,
        evidenceObjectId: input.evidenceObjectId ?? null,
        controlledDocumentRevisionId: input.controlledDocumentRevisionId ?? null,
        itemId: input.itemId,
        versionId: input.versionId,
        eTag: input.eTag ?? null,
        webUrl: input.webUrl ?? null,
        checksumSha256: input.checksumSha256,
        byteSize: input.byteSize ?? null,
        mimeType: input.mimeType ?? null,
        lastObservedAt: new Date(),
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "external_file_reference.created",
      resourceType: "external_file_reference",
      resourceId: reference.id,
      summary: "External file reference created.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { itemId: reference.itemId, versionId: reference.versionId },
    });

    return reference;
  });
}

export interface PinExternalFileReferenceInput {
  referenceId: string;
  /** The exact version id in force at the moment of issue — SP00 §7. */
  versionId: string;
  checksumSha256: string;
  actorUserId: string;
}

/**
 * Pins an external file reference to its current exact version — called the
 * moment an approval is recorded upstream (T22's revision-approval
 * transition). Once pinned, this is the *only* place `itemId`/`versionId`/
 * `checksumSha256`/`pinnedAt` can ever be written for this row again: a
 * second call is rejected outright (SP00 §7's hard invariant — a later
 * SharePoint edit "never silently mutates what an already-issued record
 * points to"). Requires `ems.storage_connection.manage`.
 */
export async function pinExternalFileReference(context: OrganisationContext, input: PinExternalFileReferenceInput) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const reference = await findTenantExternalFileReference(ctx, input.referenceId);
  if (!reference) throw new TenantOwnershipError();
  if (reference.pinnedAt) {
    throw new StorageConnectionError("This external file reference is already pinned to an issued version and cannot be repinned.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.externalFileReference.update({
      where: { id: reference.id, organisationId: txCtx.organisationId },
      data: {
        versionId: input.versionId,
        checksumSha256: input.checksumSha256,
        pinnedAt: new Date(),
        lastObservedAt: new Date(),
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "external_file_reference.pinned",
      resourceType: "external_file_reference",
      resourceId: updated.id,
      summary: `External file reference pinned to version ${updated.versionId}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { versionId: updated.versionId, pinnedAt: updated.pinnedAt },
    });

    return updated;
  });
}

export interface MarkExternalFileReferenceStaleInput {
  referenceId: string;
  status: "STALE" | "UNREACHABLE";
  reason: string;
  actorUserId: string;
}

/**
 * Marks a reference stale/unreachable (SP00 §9 reconciliation outcome).
 * Never touches `itemId`/`versionId`/`checksumSha256`/`pinnedAt` — a pinned
 * reference's identity is untouchable here regardless of status. Requires
 * `ems.storage_connection.manage`.
 */
export async function markExternalFileReferenceStale(context: OrganisationContext, input: MarkExternalFileReferenceStaleInput) {
  requirePermission(context, MANAGE_PERMISSION);
  if (!input.reason.trim()) {
    throw new StorageConnectionError("Marking a reference stale requires a reason.");
  }

  const ctx = toTenantRepositoryContext(context);
  const reference = await findTenantExternalFileReference(ctx, input.referenceId);
  if (!reference) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.externalFileReference.update({
      where: { id: reference.id, organisationId: txCtx.organisationId },
      data: {
        referenceStatus: input.status,
        staleReason: input.reason,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "external_file_reference.marked_stale",
      resourceType: "external_file_reference",
      resourceId: updated.id,
      summary: `External file reference marked ${input.status.toLowerCase()}: ${input.reason}`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { referenceStatus: updated.referenceStatus },
    });

    return updated;
  });
}

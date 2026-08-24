/**
 * SharePoint-backed `EvidenceStorageProvider` (task SP03,
 * Docs/SP00_SHAREPOINT_INTEGRATION_SPEC.md). Talks to Microsoft Graph only
 * through the SP02 `GraphClient` boundary — never `fetch` directly — and
 * records the exact pinned item/version identity in SP01's
 * `ExternalFileReference` table so a later download always resolves the
 * same bytes, never SharePoint's "latest" (SP00 §7).
 *
 * This is a second implementation of the existing `EvidenceStorageProvider`
 * contract (`storage/provider.ts`) — the interface itself is untouched, so
 * the built-in database provider and every non-SharePoint call site
 * (LCA's separate evidence registry, the retention job) are unaffected.
 * `storageKey` is the evidence object's own id, matching the database
 * provider's convention; the SharePoint identity (site/drive/item/version)
 * lives in `ExternalFileReference`, keyed 1:1 off that same id, not encoded
 * into the key itself.
 *
 * Because `EvidenceStorageProvider.get`/`remove` receive no organisation
 * context (by design — see `storage/provider.ts`), this provider resolves
 * organisation and Graph site purely from the `ExternalFileReference` row
 * itself, which is only ever reachable via a `storageKey` the caller
 * already organisation-checked before calling the provider
 * (`readEvidenceObjectBytes` in `documents/evidence-service.ts`). No
 * organisation id is ever accepted from a browser here.
 *
 * A generic `EvidenceObject` has no draft-authoring workflow of its own
 * (unlike a `ControlledDocumentRevision`) — the uploaded bytes are the
 * final content — so the reference is pinned immediately on upload rather
 * than staged as an unpinned draft reference (SP00 §7's distinction still
 * applies to the *storage-layer invariant*: once pinned here, this row's
 * itemId/versionId/checksum are never rewritten by a later SharePoint
 * edit).
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { EvidenceStorageProvider, StoredEvidenceBytes } from "@/lib/documents/storage/provider";
import { getGraphClient } from "@/lib/documents/storage/graph/registry";
import { resolveGraphSiteTargetForEvidenceProvider } from "@/lib/documents/storage/graph/config";
import { GraphClient } from "@/lib/documents/storage/graph/types";
import { findExternalFileReferenceByEvidenceObjectId, systemTenantRepositoryContext } from "@/lib/repositories/storage-connection-repository";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

export interface SharePointEvidenceStorageProviderOptions {
  /** Injectable for tests — defaults to the shared `MicrosoftGraphClient`. */
  graphClient?: GraphClient;
}

function correlationId(operation: string, evidenceId: string): string {
  return `sharepoint-evidence-${operation}-${evidenceId}-${Date.now()}`;
}

export function createSharePointEvidenceStorageProvider(options: SharePointEvidenceStorageProviderOptions = {}): EvidenceStorageProvider {
  const client = () => options.graphClient ?? getGraphClient();

  return {
    name: "sharepoint",

    async put({ evidenceId, fileName, mimeType, bytes }): Promise<StoredEvidenceBytes> {
      const evidence = await prisma.evidenceObject.findUnique({
        where: { id: evidenceId },
        select: { organisationId: true, uploadedByUserId: true },
      });
      if (!evidence) {
        throw new Error("Cannot store SharePoint evidence bytes: the evidence object does not exist.");
      }

      const cid = correlationId("put", evidenceId);
      const resolved = await resolveGraphSiteTargetForEvidenceProvider(evidence.organisationId);
      const uploaded = await client().uploadContent(resolved.target, resolved.rootFolderPath ?? "", fileName, bytes, cid);
      const checksumSha256 = uploaded.sha256 ?? createHash("sha256").update(bytes).digest("hex");

      const ctx = systemTenantRepositoryContext(evidence.organisationId, "sharepoint-evidence-storage");
      await runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
        const reference = await tx.externalFileReference.create({
          data: {
            organisationId: txCtx.organisationId,
            siteBindingId: resolved.siteBindingId,
            evidenceObjectId: evidenceId,
            itemId: uploaded.itemId,
            versionId: uploaded.versionId,
            eTag: uploaded.eTag,
            webUrl: uploaded.webUrl,
            checksumSha256,
            byteSize: uploaded.size || bytes.byteLength,
            mimeType,
            // Pinned immediately — see module docstring: a generic
            // EvidenceObject has no separate approval step to pin at.
            pinnedAt: new Date(),
            lastObservedAt: new Date(),
          },
        });

        await recordAuditEvent(tx, txCtx, {
          eventType: "external_file_reference.created",
          resourceType: "external_file_reference",
          resourceId: reference.id,
          summary: `Evidence bytes stored in SharePoint and pinned to version ${reference.versionId}.`,
          actorUserId: evidence.uploadedByUserId,
          correlationId: txCtx.correlationId,
          source: "web-app",
          after: { itemId: reference.itemId, versionId: reference.versionId },
        });
      });

      return { storageProvider: "sharepoint", storageKey: evidenceId };
    },

    async get(storageKey): Promise<Buffer | null> {
      try {
        const reference = await findExternalFileReferenceByEvidenceObjectId(storageKey);
        if (!reference || reference.referenceStatus !== "ACTIVE") return null;

        const cid = correlationId("get", storageKey);
        const resolved = await resolveGraphSiteTargetForEvidenceProvider(reference.organisationId, reference.siteBindingId);
        // Always the pinned itemId/versionId — never "latest" (SP00 §7/§8).
        return await client().downloadContent(resolved.target, reference.itemId, reference.versionId, cid);
      } catch {
        // Any failure (Graph unreachable, connection disconnected, item
        // gone) is indistinguishable from "not found" to the caller —
        // matches the non-disclosing-error contract `readEvidenceObjectBytes`
        // already documents for every provider.
        return null;
      }
    },

    async remove(storageKey): Promise<void> {
      const reference = await findExternalFileReferenceByEvidenceObjectId(storageKey);
      if (!reference) return;

      const cid = correlationId("remove", storageKey);
      const resolved = await resolveGraphSiteTargetForEvidenceProvider(reference.organisationId, reference.siteBindingId);
      await client().deleteItem(resolved.target, reference.itemId, cid);

      const ctx = systemTenantRepositoryContext(reference.organisationId, "sharepoint-evidence-storage");
      await runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
        const updated = await tx.externalFileReference.update({
          where: { id: reference.id, organisationId: txCtx.organisationId },
          data: { referenceStatus: "UNREACHABLE", staleReason: "Evidence bytes deleted by Paragon-side retention execution." },
        });

        await recordAuditEvent(tx, txCtx, {
          eventType: "external_file_reference.marked_stale",
          resourceType: "external_file_reference",
          resourceId: updated.id,
          summary: "External file reference marked unreachable: evidence bytes removed by retention execution.",
          actorUserId: null,
          actorType: "SYSTEM",
          correlationId: txCtx.correlationId,
          source: "system",
          after: { referenceStatus: updated.referenceStatus },
        });
      });
    },
  };
}

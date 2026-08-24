/**
 * Organisation storage connection / external-file-reference tenant
 * repository (task SP01, Docs/SP00_SHAREPOINT_INTEGRATION_SPEC.md §§2,6-7).
 * Follows the T15/T22 tenant-repository pattern (`documents-repository.ts`):
 * every read bakes `organisationId` into the query itself, and a
 * foreign-tenant id is denied identically to a missing one.
 */

import { prisma } from "@/lib/prisma";
import { toTenantRepositoryContext, systemTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { assertChildOwnership, assertOwned, tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";

export { TenantOwnershipError, toTenantRepositoryContext, systemTenantRepositoryContext };

/** Loads an organisation's storage connection (at most one), or null if it has never created one. */
export async function findTenantStorageConnection(ctx: TenantRepositoryContext) {
  return prisma.organisationStorageConnection.findUnique({ where: { organisationId: ctx.organisationId } });
}

/** Loads a StorageSiteBinding only if it belongs to the given tenant context. */
export async function findTenantSiteBinding(ctx: TenantRepositoryContext, siteBindingId: string) {
  const binding = await prisma.storageSiteBinding.findFirst({ where: tenantWhere(ctx, { id: siteBindingId }) });
  return assertOwned(ctx, binding);
}

/**
 * Loads an ExternalFileReference only if it belongs to the given tenant
 * context, and (when `expectedSiteBindingId` is supplied) is attached to
 * that exact site binding — the nested-parent-substitution guard.
 */
export async function findTenantExternalFileReference(
  ctx: TenantRepositoryContext,
  referenceId: string,
  expectedSiteBindingId?: string,
) {
  const reference = await prisma.externalFileReference.findFirst({ where: tenantWhere(ctx, { id: referenceId }) });
  if (!reference) return null;
  return assertChildOwnership(ctx, reference, expectedSiteBindingId, "siteBindingId");
}

/**
 * Loads an ExternalFileReference by its unique `evidenceObjectId`, or null
 * if that evidence object has no SharePoint-backed reference. Unlike
 * `findTenantExternalFileReference`, this takes no tenant context: the
 * lookup key is the unique foreign key itself, and it is only ever called
 * from `SharePointEvidenceStorageProvider` (task SP03) after the caller
 * (evidence-service.ts) has already resolved and organisation-checked the
 * `EvidenceObject` whose id this is — the same trust boundary the built-in
 * database provider's `get(storageKey)`/`remove(storageKey)` already rely
 * on (no organisation context reaches the storage-provider interface
 * either). The returned row's own `organisationId` is what the provider
 * then uses to resolve the Graph site target.
 */
export async function findExternalFileReferenceByEvidenceObjectId(evidenceObjectId: string) {
  return prisma.externalFileReference.findUnique({ where: { evidenceObjectId } });
}

/**
 * Loads an ExternalFileReference by its unique `controlledDocumentRevisionId`
 * (task SP04), or null if that revision has no SharePoint-backed reference.
 * Tenant-scoped like `findTenantExternalFileReference` (unlike the
 * `evidenceObjectId` lookup above, which is only reachable from the
 * SP03 provider's own trust boundary): callers here already hold a
 * `TenantRepositoryContext` for the revision itself.
 */
export async function findTenantExternalFileReferenceForRevision(ctx: TenantRepositoryContext, controlledDocumentRevisionId: string) {
  return prisma.externalFileReference.findFirst({ where: tenantWhere(ctx, { controlledDocumentRevisionId }) });
}

export { tenantWhere };

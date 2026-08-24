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

export { tenantWhere };

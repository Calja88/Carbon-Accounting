/**
 * Controlled documents / shared evidence tenant repository (task T22,
 * Docs/PHASE2_EMS_FOUNDATION_SPEC.md §3 "Controlled documents and
 * evidence"). Follows the T15/T17 tenant-repository pattern: every read
 * bakes `organisationId` into the query itself, and a foreign-tenant id is
 * denied identically to a missing one.
 */

import { prisma } from "@/lib/prisma";
import { toTenantRepositoryContext, systemTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { assertChildOwnership, assertOwned, tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";

export { TenantOwnershipError, toTenantRepositoryContext, systemTenantRepositoryContext };

/** Loads a ControlledDocument only if it belongs to the given tenant context. */
export async function findTenantControlledDocument(ctx: TenantRepositoryContext, documentId: string) {
  const document = await prisma.controlledDocument.findFirst({ where: tenantWhere(ctx, { id: documentId }) });
  return assertOwned(ctx, document);
}

/**
 * Loads a ControlledDocumentRevision only if it belongs to the given tenant
 * context, and (when `expectedDocumentId` is supplied) is attached to that
 * exact document — the nested-parent-substitution guard for the revision
 * download/lifecycle routes.
 */
export async function findTenantControlledDocumentRevision(
  ctx: TenantRepositoryContext,
  revisionId: string,
  expectedDocumentId?: string,
) {
  const revision = await prisma.controlledDocumentRevision.findFirst({ where: tenantWhere(ctx, { id: revisionId }) });
  if (!revision) return null;
  return assertChildOwnership(ctx, revision, expectedDocumentId, "documentId");
}

/** Loads an EvidenceObject only if it belongs to the given tenant context. */
export async function findTenantEvidenceObject(ctx: TenantRepositoryContext, evidenceObjectId: string) {
  const evidence = await prisma.evidenceObject.findFirst({ where: tenantWhere(ctx, { id: evidenceObjectId }) });
  return assertOwned(ctx, evidence);
}

/** Loads an EvidenceLink only if it belongs to the given tenant context. */
export async function findTenantEvidenceLink(ctx: TenantRepositoryContext, linkId: string) {
  const link = await prisma.evidenceLink.findFirst({ where: tenantWhere(ctx, { id: linkId }) });
  return assertOwned(ctx, link);
}

export { tenantWhere };

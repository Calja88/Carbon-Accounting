/**
 * Corporate-carbon tenant repository (Phase 1 spec §8, task T16). The single
 * place Batch B services and Batch C actions go through to resolve an
 * Entity/Site/ActivityEntry/Calculation/ReportSnapshot/SourceDocument by id,
 * so the "record id + organisationId in the same query" rule
 * (PHASE1_FILE_REFACTOR_MAP.md §11) has one implementation instead of being
 * repeated — and possibly forgotten — at every call site.
 *
 * `requireSiteInScope`/`requireEntityInScope` combine two independent checks
 * that are each insufficient alone:
 *  - `assertSiteAccess`/`assertEntityAccess` (T14) enforce a RESTRICTED
 *    membership's Entity/Site allow-list, but pass unconditionally for an
 *    ORGANISATION_WIDE member regardless of which organisation the id
 *    actually belongs to;
 *  - the tenant-scoped DB lookup below proves the record is actually owned
 *    by the caller's organisation.
 * Skipping either one reopens the IDOR the adversarial matrix requires
 * closed: a foreign-tenant id must be denied even for an
 * ORGANISATION_WIDE member of a *different* organisation.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { assertEntityAccess, assertSiteAccess } from "@/lib/rbac/authorize";
import { createTenantRepositoryContext, type TenantRepositoryContext } from "@/lib/repositories/context";
import {
  assertChildOwnership,
  assertOwned,
  assertSiteOwnership,
  tenantWhere,
  TenantOwnershipError,
} from "@/lib/repositories/tenant-scope";

export { TenantOwnershipError };

let systemCorrelationCounter = 0;

/** Derives the narrower repository-layer context from a resolved request-level OrganisationContext. */
export function toTenantRepositoryContext(context: OrganisationContext): TenantRepositoryContext {
  return createTenantRepositoryContext({
    organisationId: context.organisationId,
    userId: context.userId,
    correlationId: context.correlationId,
  });
}

/**
 * Builds a tenant repository context for an audited platform/system fan-out
 * (e.g. recalculating every organisation's AWAITING_FACTOR entries after a
 * platform factor import) — never for a browser-facing request, which must
 * always go through `toTenantRepositoryContext` and a real resolved
 * membership. `userId` is a fixed system-actor marker, not a real User row.
 */
export function systemTenantRepositoryContext(organisationId: string, reason: string): TenantRepositoryContext {
  systemCorrelationCounter += 1;
  return createTenantRepositoryContext({
    organisationId,
    userId: "system",
    correlationId: `system-${reason}-${systemCorrelationCounter}`,
  });
}

/** Loads an Entity the caller's Organisation owns and is scoped to, or throws TenantOwnershipError. */
export async function requireEntityInScope(context: OrganisationContext, entityId: string) {
  assertEntityAccess(context, entityId);
  const ctx = toTenantRepositoryContext(context);
  const entity = await prisma.entity.findFirst({ where: tenantWhere(ctx, { id: entityId }) });
  return assertOwned(ctx, entity);
}

/** Loads a Site the caller's Organisation owns and is scoped to, or throws TenantOwnershipError. */
export async function requireSiteInScope(context: OrganisationContext, siteId: string) {
  assertSiteAccess(context, siteId);
  const ctx = toTenantRepositoryContext(context);
  const site = await prisma.site.findFirst({ where: tenantWhere(ctx, { id: siteId }) });
  return assertOwned(ctx, site);
}

/**
 * Loads an ActivityEntry only if it belongs to the given tenant context, and
 * (when `expectedSiteId` is supplied) is attached to that exact Site — the
 * nested-parent-substitution guard from the adversarial matrix ("A Site with
 * B factor option/reference misuse").
 */
export async function findTenantActivityEntry(
  ctx: TenantRepositoryContext,
  entryId: string,
  expectedSiteId?: string,
) {
  const entry = await prisma.activityEntry.findFirst({ where: tenantWhere(ctx, { id: entryId }) });
  if (!entry) return null;
  return assertChildOwnership(ctx, entry, expectedSiteId, "siteId");
}

/** Loads a Calculation only if it belongs to the given tenant context. */
export async function findTenantCalculation(ctx: TenantRepositoryContext, calculationId: string) {
  return prisma.calculation.findFirst({ where: tenantWhere(ctx, { id: calculationId }) });
}

/** Loads a ReportSnapshot only if it belongs to the given tenant context. */
export async function findTenantReportSnapshot(ctx: TenantRepositoryContext, snapshotId: string) {
  return prisma.reportSnapshot.findFirst({ where: tenantWhere(ctx, { id: snapshotId }) });
}

/**
 * Loads a SourceDocument only if it belongs to the given tenant context.
 * `assertSiteOwnership` is not used here — a document's `siteId` is
 * nullable (platform-wide upload before triage) — so ownership is the
 * document's own organisationId only.
 */
export async function findTenantSourceDocument(ctx: TenantRepositoryContext, documentId: string) {
  return prisma.sourceDocument.findFirst({ where: tenantWhere(ctx, { id: documentId }) });
}

/**
 * Loads a DocumentExtraction only if its parent SourceDocument belongs to
 * the given tenant context. DocumentExtraction has no organisationId column
 * of its own (spec §4: descendants use composite/parent relationships where
 * practical) — ownership is entirely inherited from `document`.
 */
export async function findTenantDocumentExtraction(ctx: TenantRepositoryContext, extractionId: string) {
  const extraction = await prisma.documentExtraction.findFirst({
    where: { id: extractionId },
    include: { document: true },
  });
  if (!extraction) return null;
  assertOwned(ctx, extraction.document);
  return extraction;
}

export { assertSiteOwnership, tenantWhere };

/**
 * Site visibility for list/aggregate queries (dashboard, reports): an
 * ORGANISATION_WIDE member sees every Site in the organisation (tenant
 * filter alone is enough); a RESTRICTED member sees only Sites directly
 * granted to their membership or under an Entity granted to it — matching
 * the adversarial matrix row "User has Site A1 scope and attempts
 * Entity-wide aggregate: Aggregate contains A1 only". A RESTRICTED member
 * with no scopes at all matches nothing (deny by default), not everything.
 */
export function accessibleSiteFilter(context: OrganisationContext): Prisma.SiteWhereInput {
  if (context.access.mode === "ORGANISATION_WIDE") return {};
  return {
    OR: [{ id: { in: [...context.access.siteIds] } }, { entityId: { in: [...context.access.entityIds] } }],
  };
}

/** The same visibility rule as `accessibleSiteFilter`, expressed as an ActivityEntry-side filter via its Site. */
export function accessibleActivityEntryFilter(context: OrganisationContext): Prisma.ActivityEntryWhereInput {
  if (context.access.mode === "ORGANISATION_WIDE") return {};
  return { site: accessibleSiteFilter(context) };
}

/** Entity visibility for list/narrative queries, mirroring `accessibleSiteFilter`. */
export function accessibleEntityFilter(context: OrganisationContext): Prisma.EntityWhereInput {
  if (context.access.mode === "ORGANISATION_WIDE") return {};
  return { id: { in: [...context.access.entityIds] } };
}

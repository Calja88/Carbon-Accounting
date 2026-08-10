/**
 * Product-LCA tenant repository (Phase 1 spec §8, task T17) — the LCA-domain
 * counterpart to `carbon-repository.ts` (T16). Batch E services and Batch F
 * actions/pages go through this module to resolve a Product/Supplier/
 * LcaAssessment/LcaEvidence/LcaAssessmentVersion/LcaSupplierPcf by id, so the
 * "record id + organisationId in the same query" rule
 * (PHASE1_FILE_REFACTOR_MAP.md §11) has one implementation for LCA too.
 *
 * Two ownership shapes appear below:
 *
 *  - Direct-owned roots (Product, Supplier, LcaAssessment, LcaEvidence,
 *    LcaAssessmentVersion, LcaSupplierPcf) carry their own nullable
 *    `organisationId` (T17 migration) and are checked with `assertOwned`,
 *    same as the carbon repository.
 *  - Assessment-owned children (LcaProcess, LcaInventoryItem) have no
 *    organisationId column of their own (spec §4: "enforce composite parent
 *    links") — ownership is proven by joining through their parent
 *    `assessment` in the query itself, never by trusting the child id alone.
 *
 * `requireAssessmentInScope`/`requireProductInScope`/`requireSupplierInScope`
 * combine two independent checks that are each insufficient alone, same as
 * `requireEntityInScope` in the carbon repository:
 *  - `assertEntityAccess` (T14) enforces a RESTRICTED membership's Entity
 *    allow-list, but passes unconditionally for an ORGANISATION_WIDE member
 *    regardless of which organisation the id actually belongs to;
 *  - the tenant-scoped DB lookup proves the record is actually owned by the
 *    caller's organisation.
 * Skipping either one reopens the IDOR the adversarial matrix requires
 * closed.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { assertEntityAccess } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext, systemTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { accessibleEntityFilter } from "@/lib/repositories/carbon-repository";
import { assertChildOwnership, assertOwned, tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";

export { TenantOwnershipError, toTenantRepositoryContext, systemTenantRepositoryContext };

/**
 * Assessment visibility for list/search queries: an ORGANISATION_WIDE
 * member sees every assessment in the organisation (tenant filter alone is
 * enough); a RESTRICTED member sees only assessments under an Entity granted
 * to their membership, mirroring `accessibleEntityFilter`.
 */
export function accessibleAssessmentFilter(context: OrganisationContext): Prisma.LcaAssessmentWhereInput {
  if (context.access.mode === "ORGANISATION_WIDE") return {};
  return { entity: accessibleEntityFilter(context) };
}

/** Same rule, expressed for Product/Supplier, which are also Entity-scoped roots. */
export function accessibleProductFilter(context: OrganisationContext): Prisma.ProductWhereInput {
  if (context.access.mode === "ORGANISATION_WIDE") return {};
  return { entity: accessibleEntityFilter(context) };
}

export function accessibleSupplierFilter(context: OrganisationContext): Prisma.SupplierWhereInput {
  if (context.access.mode === "ORGANISATION_WIDE") return {};
  return { entity: accessibleEntityFilter(context) };
}

/** Loads an LcaAssessment the caller's Organisation owns and is Entity-scoped to, or throws TenantOwnershipError/PermissionDeniedError. */
export async function requireAssessmentInScope(context: OrganisationContext, assessmentId: string) {
  const ctx = toTenantRepositoryContext(context);
  const assessment = await prisma.lcaAssessment.findFirst({ where: tenantWhere(ctx, { id: assessmentId }) });
  const owned = assertOwned(ctx, assessment);
  assertEntityAccess(context, owned.entityId);
  return owned;
}

/** Loads a Product the caller's Organisation owns and is Entity-scoped to, or throws. */
export async function requireProductInScope(context: OrganisationContext, productId: string) {
  const ctx = toTenantRepositoryContext(context);
  const product = await prisma.product.findFirst({ where: tenantWhere(ctx, { id: productId }) });
  const owned = assertOwned(ctx, product);
  assertEntityAccess(context, owned.entityId);
  return owned;
}

/** Loads a Supplier the caller's Organisation owns and is Entity-scoped to, or throws. */
export async function requireSupplierInScope(context: OrganisationContext, supplierId: string) {
  const ctx = toTenantRepositoryContext(context);
  const supplier = await prisma.supplier.findFirst({ where: tenantWhere(ctx, { id: supplierId }) });
  const owned = assertOwned(ctx, supplier);
  assertEntityAccess(context, owned.entityId);
  return owned;
}

/**
 * Loads an LcaMethodologyProfile visible to the caller: either owned by
 * their Organisation, or a null-organisationId platform-shared profile
 * (spec §4/§11: platform-global reference data is explicit, never inferred
 * from a bare nullable column). Distinct from `assertOwned` because a null
 * organisationId here is a legitimate "anyone may read/select this" case,
 * not a deny — `assertMethodologyProfileMutable` below is the stricter check
 * for edits.
 */
export async function findVisibleMethodologyProfile(ctx: TenantRepositoryContext, profileId: string) {
  const profile = await prisma.lcaMethodologyProfile.findFirst({ where: { id: profileId } });
  if (!profile) return null;
  if (profile.organisationId !== null && profile.organisationId !== ctx.organisationId) return null;
  return profile;
}

/** Only an organisation-owned methodology profile may be edited; a platform-shared (null) or foreign-tenant profile may not. */
export function assertMethodologyProfileMutable<T extends { organisationId: string | null }>(
  ctx: TenantRepositoryContext,
  profile: T | null | undefined,
): T {
  if (!profile || profile.organisationId !== ctx.organisationId) {
    throw new TenantOwnershipError();
  }
  return profile;
}

/**
 * Loads an LcaEvidence row only if it belongs to the given tenant context,
 * and (when `expectedAssessmentId` is supplied) is attached to that exact
 * assessment — the nested-parent-substitution guard for the evidence
 * download route.
 */
export async function findTenantEvidence(
  ctx: TenantRepositoryContext,
  evidenceId: string,
  expectedAssessmentId?: string,
) {
  const evidence = await prisma.lcaEvidence.findFirst({ where: tenantWhere(ctx, { id: evidenceId }) });
  if (!evidence) return null;
  return assertChildOwnership(ctx, evidence, expectedAssessmentId, "assessmentId");
}

/** Loads the blob bytes for an evidence row already proven in-tenant by `findTenantEvidence`. */
export async function findTenantEvidenceBlob(ctx: TenantRepositoryContext, evidenceId: string) {
  const evidence = await findTenantEvidence(ctx, evidenceId);
  if (!evidence) return null;
  return prisma.lcaEvidenceBlob.findUnique({ where: { evidenceId: evidence.id } });
}

/**
 * Loads an LcaAssessmentVersion only if it belongs to the given tenant
 * context, and (when `expectedAssessmentId` is supplied) is attached to that
 * exact assessment.
 */
export async function findTenantAssessmentVersion(
  ctx: TenantRepositoryContext,
  versionId: string,
  expectedAssessmentId?: string,
) {
  const version = await prisma.lcaAssessmentVersion.findFirst({ where: tenantWhere(ctx, { id: versionId }) });
  if (!version) return null;
  return assertChildOwnership(ctx, version, expectedAssessmentId, "assessmentId");
}

/** Loads an LcaSupplierPcf only if it belongs to the given tenant context — so a foreign-tenant supplier PCF can never be resolved into an inventory item's factor selection. */
export async function findTenantSupplierPcf(ctx: TenantRepositoryContext, supplierPcfId: string) {
  return prisma.lcaSupplierPcf.findFirst({ where: tenantWhere(ctx, { id: supplierPcfId }) });
}

/**
 * Loads an LcaProcess only if its parent assessment belongs to the given
 * tenant context (LcaProcess itself has no organisationId column — spec §4:
 * composite parent link). When `expectedAssessmentId` is supplied, also
 * guards the nested-parent-substitution attack ("Child ID from B under A
 * assessment route").
 */
export async function findTenantProcess(
  ctx: TenantRepositoryContext,
  processId: string,
  expectedAssessmentId?: string,
) {
  const process = await prisma.lcaProcess.findFirst({
    where: { id: processId, assessment: tenantWhere(ctx, {}) },
  });
  if (!process) return null;
  if (expectedAssessmentId !== undefined && process.assessmentId !== expectedAssessmentId) {
    throw new TenantOwnershipError();
  }
  return process;
}

/** Loads an LcaInventoryItem only if its parent assessment belongs to the given tenant context, same composite-parent-link rule as `findTenantProcess`. */
export async function findTenantInventoryItem(
  ctx: TenantRepositoryContext,
  itemId: string,
  expectedAssessmentId?: string,
) {
  const item = await prisma.lcaInventoryItem.findFirst({
    where: { id: itemId, assessment: tenantWhere(ctx, {}) },
  });
  if (!item) return null;
  if (expectedAssessmentId !== undefined && item.assessmentId !== expectedAssessmentId) {
    throw new TenantOwnershipError();
  }
  return item;
}

/**
 * Loads an LcaCalculationRun only if its parent assessment belongs to the
 * given tenant context. LcaCalculationRun has no organisationId column of
 * its own — ownership is entirely inherited from `assessment`.
 */
export async function findTenantRun(ctx: TenantRepositoryContext, runId: string, expectedAssessmentId?: string) {
  const run = await prisma.lcaCalculationRun.findFirst({
    where: { id: runId, assessment: tenantWhere(ctx, {}) },
  });
  if (!run) return null;
  if (expectedAssessmentId !== undefined && run.assessmentId !== expectedAssessmentId) {
    throw new TenantOwnershipError();
  }
  return run;
}

/**
 * Loads an LcaCalculationResult only if its parent assessment belongs to the
 * given tenant context — the "Export B run through A assessment route"
 * adversarial case for the result detail page.
 */
export async function findTenantResult(ctx: TenantRepositoryContext, resultId: string, expectedAssessmentId?: string) {
  const result = await prisma.lcaCalculationResult.findFirst({
    where: { id: resultId, assessment: tenantWhere(ctx, {}) },
  });
  if (!result) return null;
  if (expectedAssessmentId !== undefined && result.assessmentId !== expectedAssessmentId) {
    throw new TenantOwnershipError();
  }
  return result;
}

export { tenantWhere };

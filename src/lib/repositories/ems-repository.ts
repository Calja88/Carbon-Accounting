/**
 * EMS programme foundation tenant repository (task T23,
 * Docs/PHASE2_EMS_FOUNDATION_SPEC.md §3 "EMS root and scope" / "Context,
 * interested parties, risk and change"). Follows the T15/T17/T22
 * tenant-repository pattern exactly: every read bakes `organisationId` into
 * the query itself, and a foreign-tenant id is denied identically to a
 * missing one.
 */

import { prisma } from "@/lib/prisma";
import { toTenantRepositoryContext, systemTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { assertChildOwnership, assertOwned, tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";

export { TenantOwnershipError, toTenantRepositoryContext, systemTenantRepositoryContext, tenantWhere };

/** Loads an EmsProgramme only if it belongs to the given tenant context. */
export async function findTenantEmsProgramme(ctx: TenantRepositoryContext, programmeId: string) {
  const programme = await prisma.emsProgramme.findFirst({ where: tenantWhere(ctx, { id: programmeId }) });
  return assertOwned(ctx, programme);
}

/**
 * Loads an EmsScopeVersion only if it belongs to the given tenant context,
 * and (when `expectedProgrammeId` is supplied) is attached to that exact
 * programme — the nested-parent-substitution guard.
 */
export async function findTenantEmsScopeVersion(
  ctx: TenantRepositoryContext,
  scopeVersionId: string,
  expectedProgrammeId?: string,
) {
  const version = await prisma.emsScopeVersion.findFirst({ where: tenantWhere(ctx, { id: scopeVersionId }) });
  if (!version) return null;
  return assertChildOwnership(ctx, version, expectedProgrammeId, "programmeId");
}

export async function findTenantStandardRequirementMap(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.standardRequirementMap.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

export async function findTenantContextIssue(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.contextIssue.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

export async function findTenantInterestedParty(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.interestedParty.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

/**
 * Loads an InterestedPartyRequirement only if it belongs to the given tenant
 * context, and (when `expectedPartyId` is supplied) is attached to that
 * exact interested party — the nested-parent-substitution guard.
 */
export async function findTenantInterestedPartyRequirement(
  ctx: TenantRepositoryContext,
  id: string,
  expectedPartyId?: string,
) {
  const row = await prisma.interestedPartyRequirement.findFirst({ where: tenantWhere(ctx, { id }) });
  if (!row) return null;
  return assertChildOwnership(ctx, row, expectedPartyId, "interestedPartyId");
}

export async function findTenantEmsRiskOpportunity(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.emsRiskOpportunity.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

export async function findTenantChangeAssessment(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.changeAssessment.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

export async function findTenantEnvironmentalPolicyRecord(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.environmentalPolicyRecord.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

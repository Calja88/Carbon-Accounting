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

/**
 * Loads an ActivityProcess only if it belongs to the given tenant context
 * (task T30). `expectedProgrammeId` guards against the nested-parent-
 * substitution attack the same way `findTenantEmsScopeVersion` does.
 */
export async function findTenantActivityProcess(
  ctx: TenantRepositoryContext,
  id: string,
  expectedProgrammeId?: string,
) {
  const row = await prisma.activityProcess.findFirst({ where: tenantWhere(ctx, { id }) });
  if (!row) return null;
  return assertChildOwnership(ctx, row, expectedProgrammeId, "programmeId");
}

/** Loads a T31 environmental aspect only inside the current organisation. */
export async function findTenantEnvironmentalAspect(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.environmentalAspect.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

/** Loads a T31 impact catalogue item only inside the current organisation. */
export async function findTenantEnvironmentalImpact(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.environmentalImpact.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

/** Loads one exact T32 method version only inside the current organisation. */
export async function findTenantSignificanceMethod(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.significanceMethod.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

/** Loads one exact T32 assessment version only inside the current organisation. */
export async function findTenantAspectAssessment(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.aspectAssessment.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

/** Loads one exact T33 operational-control version only inside the current organisation. */
export async function findTenantOperationalControl(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.operationalControl.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

/** Loads a T33 control check only inside the current organisation. */
export async function findTenantControlCheck(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.controlCheck.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

/** Loads a T35 external-provider control only inside the current organisation. */
export async function findTenantExternalProviderControl(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.externalProviderControl.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

/** Loads a T35 external-provider evaluation only inside the current organisation. */
export async function findTenantExternalProviderEvaluation(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.externalProviderEvaluation.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

/** Loads a T35 communication plan only inside the current organisation. */
export async function findTenantCommunicationPlan(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.communicationPlan.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

/** Loads a T35 communication record only inside the current organisation. */
export async function findTenantCommunicationRecord(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.communicationRecord.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

/** Loads a T35 emergency scenario only inside the current organisation. */
export async function findTenantEmergencyScenario(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.emergencyScenario.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

/**
 * Loads one exact T35 emergency-plan version only inside the current
 * organisation, and (when `expectedScenarioId` is supplied) attached to that
 * exact scenario — the nested-parent-substitution guard.
 */
export async function findTenantEmergencyPlan(
  ctx: TenantRepositoryContext,
  id: string,
  expectedScenarioId?: string,
) {
  const row = await prisma.emergencyPlan.findFirst({ where: tenantWhere(ctx, { id }) });
  if (!row) return null;
  return assertChildOwnership(ctx, row, expectedScenarioId, "scenarioId");
}

/** Loads a T35 emergency exercise only inside the current organisation. */
export async function findTenantEmergencyExercise(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.emergencyExercise.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

/** Loads one exact T43 applicability assessment version only inside the current organisation. */
export async function findTenantApplicabilityAssessment(ctx: TenantRepositoryContext, id: string) {
  const row = await prisma.applicabilityAssessment.findFirst({ where: tenantWhere(ctx, { id }) });
  return assertOwned(ctx, row);
}

/**
 * Loads a ProcessProfileTemplate by id. Templates are platform content, not
 * tenant data (task T30 — no organisationId column), so this is a plain
 * lookup rather than a tenant-scoped one; callers still go through this
 * function (never `prisma.processProfileTemplate` directly) so the
 * distinction stays visible at every call site.
 */
export async function findProcessProfileTemplate(id: string) {
  return prisma.processProfileTemplate.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
}

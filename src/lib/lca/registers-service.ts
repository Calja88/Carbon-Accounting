/**
 * The assumptions and exclusions registers, verification records, and links to
 * corporate inventory data.
 *
 * These are the parts of an assessment a reviewer reads before they look at
 * any number, because they say what the model does not measure directly.
 * Approval is separated from authorship throughout: the person who records an
 * assumption is not the person who signs it off.
 */

import { LcaAssuranceType, LcaCorporateLinkType, LcaMateriality, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "./audit-service";
import type { OrganisationContext } from "@/lib/organisation/context";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { findVisibleMethodologyProfile, requireAssessmentInScope } from "@/lib/repositories/lca-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";

/**
 * Verifies a register row's parent assessment belongs to the caller's
 * Organisation and Entity scope (assumptions/exclusions/verifications/
 * corporate links carry no organisationId of their own — spec §4: composite
 * parent link). Throws TenantOwnershipError/PermissionDeniedError for a
 * foreign-tenant assessment, a genuinely missing row, or (when supplied) an
 * assessmentId that doesn't match the row's actual parent — the
 * nested-parent-substitution guard.
 */
async function requireRegisterRowInScope(
  context: OrganisationContext,
  assessmentId: string,
  expectedAssessmentId?: string,
): Promise<void> {
  if (expectedAssessmentId !== undefined && assessmentId !== expectedAssessmentId) {
    throw new TenantOwnershipError();
  }
  await requireAssessmentInScope(context, assessmentId);
}

// ---------------------------------------------------------------------------
// Assumptions
// ---------------------------------------------------------------------------

export interface UpsertAssumptionInput {
  id?: string | null;
  assessmentId: string;
  assumption: string;
  category: string;
  rationale: string;
  source?: string | null;
  uncertainty?: string | null;
  materiality: LcaMateriality;
  ownerUserId?: string | null;
  processId?: string | null;
  inventoryItemId?: string | null;
  actorUserId: string;
}

export const ASSUMPTION_CATEGORIES = [
  "Activity data",
  "Emission factor",
  "Unit conversion",
  "Allocation",
  "Transport",
  "Use phase",
  "End of life",
  "Recycled content",
  "Cut-off",
  "Proxy substitution",
  "Other",
];

export async function upsertAssumption(context: OrganisationContext, input: UpsertAssumptionInput) {
  const data = {
    assumption: input.assumption,
    category: input.category,
    rationale: input.rationale,
    source: input.source || null,
    uncertainty: input.uncertainty || null,
    materiality: input.materiality,
    ownerUserId: input.ownerUserId || null,
    processId: input.processId || null,
    inventoryItemId: input.inventoryItemId || null,
  };

  let assumption;
  if (input.id) {
    const existing = await prisma.lcaAssumption.findUniqueOrThrow({ where: { id: input.id } });
    await requireRegisterRowInScope(context, existing.assessmentId, input.assessmentId);
    assumption = await prisma.lcaAssumption.update({
      where: { id: input.id },
      // Editing an approved assumption withdraws its approval — otherwise a
      // sign-off could be inherited by wording nobody approved.
      data: { ...data, approvedAt: null, approvedByUserId: null },
    });
  } else {
    await requireRegisterRowInScope(context, input.assessmentId);
    assumption = await prisma.lcaAssumption.create({ data: { ...data, assessmentId: input.assessmentId } });
  }

  await recordAuditEvent({
    assessmentId: input.assessmentId,
    entityType: "assumption",
    entityId: assumption.id,
    action: input.id ? "updated" : "created",
    actorUserId: input.actorUserId,
    summary: input.id
      ? `Assumption updated: "${assumption.assumption}". Any previous approval has been withdrawn because the wording changed.`
      : `Assumption recorded (${assumption.materiality.toLowerCase()} materiality, ${assumption.category.toLowerCase()}): "${assumption.assumption}".`,
    after: data,
  });

  return assumption;
}

export async function approveAssumption(context: OrganisationContext, assumptionId: string, actorUserId: string) {
  const existing = await prisma.lcaAssumption.findUniqueOrThrow({ where: { id: assumptionId } });
  await requireRegisterRowInScope(context, existing.assessmentId);
  const assumption = await prisma.lcaAssumption.update({
    where: { id: assumptionId },
    data: { approvedByUserId: actorUserId, approvedAt: new Date() },
  });

  await recordAuditEvent({
    assessmentId: assumption.assessmentId,
    entityType: "approval",
    entityId: assumptionId,
    action: "approved",
    actorUserId,
    summary: `Assumption approved: "${assumption.assumption}".`,
    after: { approvedAt: assumption.approvedAt?.toISOString() },
  });

  return assumption;
}

export async function deleteAssumption(context: OrganisationContext, assumptionId: string, actorUserId: string) {
  const assumption = await prisma.lcaAssumption.findUniqueOrThrow({ where: { id: assumptionId } });
  await requireRegisterRowInScope(context, assumption.assessmentId);
  await prisma.$transaction(async (tx) => {
    await tx.lcaEvidence.updateMany({ where: { assumptionId }, data: { assumptionId: null } });
    await tx.lcaAssumption.delete({ where: { id: assumptionId } });
  });
  await recordAuditEvent({
    assessmentId: assumption.assessmentId,
    entityType: "assumption",
    entityId: assumptionId,
    action: "deleted",
    actorUserId,
    summary: `Assumption removed from the register: "${assumption.assumption}".`,
    before: { assumption: assumption.assumption, rationale: assumption.rationale },
  });
}

export async function listAssumptions(assessmentId: string) {
  return prisma.lcaAssumption.findMany({
    where: { assessmentId },
    include: {
      owner: true,
      approvedBy: true,
      process: { select: { id: true, name: true } },
      inventoryItem: { select: { id: true, name: true } },
      evidence: { select: { id: true, title: true } },
    },
    orderBy: [{ materiality: "desc" }, { recordedAt: "asc" }],
  });
}

export type AssumptionListItem = Awaited<ReturnType<typeof listAssumptions>>[number];

// ---------------------------------------------------------------------------
// Exclusions
// ---------------------------------------------------------------------------

export interface UpsertExclusionInput {
  id?: string | null;
  assessmentId: string;
  excludedItem: string;
  rationale: string;
  estimatedRelevance: string;
  estimatedPercentOfTotal?: string | null;
  ownerUserId?: string | null;
  processId?: string | null;
  actorUserId: string;
}

export async function upsertExclusion(context: OrganisationContext, input: UpsertExclusionInput) {
  const data = {
    excludedItem: input.excludedItem,
    rationale: input.rationale,
    estimatedRelevance: input.estimatedRelevance,
    estimatedPercentOfTotal: input.estimatedPercentOfTotal || null,
    ownerUserId: input.ownerUserId || null,
    processId: input.processId || null,
  };

  let exclusion;
  if (input.id) {
    const existing = await prisma.lcaExclusion.findUniqueOrThrow({ where: { id: input.id } });
    await requireRegisterRowInScope(context, existing.assessmentId, input.assessmentId);
    exclusion = await prisma.lcaExclusion.update({
      where: { id: input.id },
      data: { ...data, approvedAt: null, approvedByUserId: null },
    });
  } else {
    await requireRegisterRowInScope(context, input.assessmentId);
    exclusion = await prisma.lcaExclusion.create({ data: { ...data, assessmentId: input.assessmentId } });
  }

  await recordAuditEvent({
    assessmentId: input.assessmentId,
    entityType: "exclusion",
    entityId: exclusion.id,
    action: input.id ? "updated" : "created",
    actorUserId: input.actorUserId,
    summary: input.id
      ? `Exclusion updated: "${exclusion.excludedItem}". Any previous approval has been withdrawn because the wording changed.`
      : `Exclusion recorded: "${exclusion.excludedItem}" — ${exclusion.rationale} Estimated relevance: ${exclusion.estimatedRelevance}.`,
    after: data,
  });

  return exclusion;
}

export async function approveExclusion(context: OrganisationContext, exclusionId: string, actorUserId: string) {
  const existing = await prisma.lcaExclusion.findUniqueOrThrow({ where: { id: exclusionId } });
  await requireRegisterRowInScope(context, existing.assessmentId);
  const exclusion = await prisma.lcaExclusion.update({
    where: { id: exclusionId },
    data: { approvedByUserId: actorUserId, approvedAt: new Date() },
  });

  await recordAuditEvent({
    assessmentId: exclusion.assessmentId,
    entityType: "approval",
    entityId: exclusionId,
    action: "approved",
    actorUserId,
    summary: `Exclusion approved: "${exclusion.excludedItem}".`,
    after: { approvedAt: exclusion.approvedAt?.toISOString() },
  });

  return exclusion;
}

export async function deleteExclusion(context: OrganisationContext, exclusionId: string, actorUserId: string) {
  const exclusion = await prisma.lcaExclusion.findUniqueOrThrow({ where: { id: exclusionId } });
  await requireRegisterRowInScope(context, exclusion.assessmentId);
  await prisma.$transaction(async (tx) => {
    await tx.lcaEvidence.updateMany({ where: { exclusionId }, data: { exclusionId: null } });
    await tx.lcaExclusion.delete({ where: { id: exclusionId } });
  });
  await recordAuditEvent({
    assessmentId: exclusion.assessmentId,
    entityType: "exclusion",
    entityId: exclusionId,
    action: "deleted",
    actorUserId,
    summary: `Exclusion removed from the register: "${exclusion.excludedItem}".`,
    before: { excludedItem: exclusion.excludedItem, rationale: exclusion.rationale },
  });
}

export async function listExclusions(assessmentId: string) {
  return prisma.lcaExclusion.findMany({
    where: { assessmentId },
    include: {
      owner: true,
      approvedBy: true,
      process: { select: { id: true, name: true } },
      evidence: { select: { id: true, title: true } },
    },
    orderBy: { recordedAt: "asc" },
  });
}

export type ExclusionListItem = Awaited<ReturnType<typeof listExclusions>>[number];

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface RecordVerificationInput {
  assessmentId: string;
  organisation: string;
  verifierName: string;
  verificationDate: Date;
  assuranceType: LcaAssuranceType;
  scopeOfVerification: string;
  statementReference?: string | null;
  statementUrl?: string | null;
  conclusion?: string | null;
  notes?: string | null;
  actorUserId: string;
}

/**
 * Records what an external verifier said. The platform never generates or
 * infers this: it stores a third party's statement, attributed to them.
 */
export async function recordVerification(context: OrganisationContext, input: RecordVerificationInput) {
  await requireRegisterRowInScope(context, input.assessmentId);
  const verification = await prisma.lcaVerification.create({
    data: {
      assessmentId: input.assessmentId,
      organisation: input.organisation,
      verifierName: input.verifierName,
      verificationDate: input.verificationDate,
      assuranceType: input.assuranceType,
      scopeOfVerification: input.scopeOfVerification,
      statementReference: input.statementReference || null,
      statementUrl: input.statementUrl || null,
      conclusion: input.conclusion || null,
      notes: input.notes || null,
      recordedByUserId: input.actorUserId,
    },
  });

  await recordAuditEvent({
    assessmentId: input.assessmentId,
    entityType: "verification",
    entityId: verification.id,
    action: "created",
    actorUserId: input.actorUserId,
    summary: `Verification recorded: ${verification.organisation} (${verification.verifierName}), ${verification.assuranceType.replace(/_/g, " ").toLowerCase()}, dated ${verification.verificationDate.toISOString().slice(0, 10)}${verification.statementReference ? `, statement ${verification.statementReference}` : ""}.`,
    after: {
      organisation: verification.organisation,
      verifierName: verification.verifierName,
      assuranceType: verification.assuranceType,
      verificationDate: verification.verificationDate.toISOString(),
      scopeOfVerification: verification.scopeOfVerification,
      statementReference: verification.statementReference,
    },
  });

  return verification;
}

export async function listVerifications(assessmentId: string) {
  return prisma.lcaVerification.findMany({
    where: { assessmentId },
    include: { recordedBy: true, evidence: true },
    orderBy: { verificationDate: "desc" },
  });
}

export async function deleteVerification(context: OrganisationContext, verificationId: string, actorUserId: string) {
  const verification = await prisma.lcaVerification.findUniqueOrThrow({ where: { id: verificationId } });
  await requireRegisterRowInScope(context, verification.assessmentId);
  await prisma.$transaction(async (tx) => {
    await tx.lcaEvidence.updateMany({ where: { verificationId }, data: { verificationId: null } });
    await tx.lcaVerification.delete({ where: { id: verificationId } });
  });
  await recordAuditEvent({
    assessmentId: verification.assessmentId,
    entityType: "verification",
    entityId: verificationId,
    action: "deleted",
    actorUserId,
    summary: `Verification record removed: ${verification.organisation}, dated ${verification.verificationDate.toISOString().slice(0, 10)}.`,
    before: { organisation: verification.organisation, assuranceType: verification.assuranceType },
  });
}

// ---------------------------------------------------------------------------
// Corporate inventory links
// ---------------------------------------------------------------------------

export interface CreateCorporateLinkInput {
  assessmentId: string;
  inventoryItemId: string;
  linkType: LcaCorporateLinkType;
  activityEntryId?: string | null;
  siteId?: string | null;
  supplierName?: string | null;
  allocationPercent: string;
  allocationBasis?: string | null;
  notes?: string | null;
  actorUserId: string;
}

/**
 * Records that a product inventory line was sourced from a corporate record.
 *
 * This is a citation, not a transfer. The corporate inventory keeps its full
 * absolute figure and the product footprint keeps its own; nothing is moved
 * between them, and neither total changes because a link exists. Recording the
 * link is what stops the same underlying meter reading being described two
 * different ways in two different reports with no way to tell.
 */
export async function createCorporateLink(context: OrganisationContext, input: CreateCorporateLinkInput) {
  const item = await prisma.lcaInventoryItem.findUniqueOrThrow({ where: { id: input.inventoryItemId } });
  await requireRegisterRowInScope(context, item.assessmentId, input.assessmentId);

  // A corporate citation is only ever a reference (spec T17 acceptance:
  // "corporate citations cannot link across organisations") — the
  // ActivityEntry/Site being cited must belong to the same Organisation as
  // the product assessment doing the citing, checked in the query itself,
  // not after the fact.
  const carbonCtx = toTenantRepositoryContext(context);
  const activityEntry = input.activityEntryId
    ? await prisma.activityEntry.findFirst({
        where: tenantWhere(carbonCtx, { id: input.activityEntryId }),
        include: { activityDataPoint: true, site: true },
      })
    : null;
  if (input.activityEntryId && !activityEntry) throw new TenantOwnershipError();

  if (input.siteId) {
    const site = await prisma.site.findFirst({ where: tenantWhere(carbonCtx, { id: input.siteId }) });
    if (!site) throw new TenantOwnershipError();
  }

  const link = await prisma.lcaCorporateDataLink.create({
    data: {
      inventoryItemId: input.inventoryItemId,
      linkType: input.linkType,
      activityEntryId: input.activityEntryId || null,
      siteId: input.siteId || null,
      supplierName: input.supplierName || null,
      allocationPercent: input.allocationPercent,
      allocationBasis: input.allocationBasis || null,
      notes: input.notes || null,
    },
  });

  await recordAuditEvent({
    assessmentId: input.assessmentId,
    entityType: "corporate_link",
    entityId: link.id,
    action: "created",
    actorUserId: input.actorUserId,
    summary: `"${item.name}" cited as sourced from a corporate record${activityEntry ? `: ${activityEntry.activityDataPoint.code} ${activityEntry.activityDataPoint.dataPointName} at ${activityEntry.site.name} (${activityEntry.rawValue.toString()} ${activityEntry.rawUnit})` : ""}, at ${input.allocationPercent}% attribution. Reference only — no emissions move between the corporate inventory and this product footprint.`,
    after: {
      linkType: input.linkType,
      activityEntryId: input.activityEntryId,
      allocationPercent: input.allocationPercent,
      allocationBasis: input.allocationBasis,
    },
  });

  return link;
}

export async function deleteCorporateLink(context: OrganisationContext, linkId: string, assessmentId: string, actorUserId: string) {
  const link = await prisma.lcaCorporateDataLink.findUniqueOrThrow({
    where: { id: linkId },
    include: { inventoryItem: { select: { name: true, assessmentId: true } } },
  });
  await requireRegisterRowInScope(context, link.inventoryItem.assessmentId, assessmentId);
  await prisma.lcaCorporateDataLink.delete({ where: { id: linkId } });
  await recordAuditEvent({
    assessmentId,
    entityType: "corporate_link",
    entityId: linkId,
    action: "deleted",
    actorUserId,
    summary: `Corporate data citation removed from "${link.inventoryItem.name}".`,
    before: { linkType: link.linkType, allocationPercent: link.allocationPercent.toString() },
  });
}

/**
 * Corporate activity entries a product line could reasonably cite — the
 * facility energy, fuel and Scope 3 records already held for the sites this
 * product is made at.
 */
export async function corporateEntriesForLinking(
  context: OrganisationContext,
  options: {
    siteIds?: string[];
    periodStart?: Date | null;
    periodEnd?: Date | null;
    take?: number;
  },
) {
  const carbonCtx = toTenantRepositoryContext(context);
  return prisma.activityEntry.findMany({
    where: tenantWhere<Prisma.ActivityEntryWhereInput>(carbonCtx, {
      ...(options.siteIds && options.siteIds.length > 0 ? { siteId: { in: options.siteIds } } : {}),
      ...(options.periodStart && options.periodEnd
        ? { periodStart: { gte: options.periodStart }, periodEnd: { lte: options.periodEnd } }
        : {}),
      status: { not: "REJECTED" },
    }),
    include: {
      activityDataPoint: true,
      site: { include: { entity: true } },
      calculations: { select: { resultKgCo2e: true, scope: true, basis: true } },
    },
    orderBy: [{ periodStart: "desc" }],
    take: options.take ?? 100,
  });
}

export type CorporateEntryOption = Awaited<ReturnType<typeof corporateEntriesForLinking>>[number];

export async function listCorporateLinks(context: OrganisationContext, assessmentId: string) {
  await requireRegisterRowInScope(context, assessmentId);
  return prisma.lcaCorporateDataLink.findMany({
    where: { inventoryItem: { assessmentId } },
    include: {
      inventoryItem: { select: { id: true, name: true } },
      site: { include: { entity: true } },
      activityEntry: { include: { activityDataPoint: true, site: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Methodology profiles
// ---------------------------------------------------------------------------

/**
 * Visible methodology profiles: the caller's own Organisation's profiles,
 * plus any platform-shared (null organisationId) profile — never another
 * tenant's (spec §11: platform-global reference data is explicit).
 */
export async function listMethodologyProfiles(context: OrganisationContext, entityId?: string) {
  return prisma.lcaMethodologyProfile.findMany({
    where: {
      AND: [
        { OR: [{ organisationId: context.organisationId }, { organisationId: null }] },
        entityId ? { OR: [{ entityId }, { entityId: null }] } : {},
      ],
    },
    include: { entity: true, _count: { select: { assessments: true } } },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }, { version: "desc" }],
  });
}

export async function getMethodologyProfile(context: OrganisationContext, profileId: string) {
  const ctx = toTenantRepositoryContext(context);
  const visible = await findVisibleMethodologyProfile(ctx, profileId);
  if (!visible) return null;
  return prisma.lcaMethodologyProfile.findUnique({
    where: { id: profileId },
    include: {
      entity: true,
      assessments: {
        select: { id: true, reference: true, title: true, status: true },
        orderBy: { updatedAt: "desc" },
      },
    },
  });
}

/**
 * Aspect/impact register service (task T31).
 *
 * Every customer-owned read and mutation includes organisationId in the
 * database query. Nested process/aspect/impact ids are resolved through the
 * tenant repository before writes, while composite database foreign keys
 * provide a second boundary against mixed-organisation links. This module
 * stores descriptive register data only and never reads or copies carbon or
 * LCA totals.
 */

import type {
  AspectControlRelationship,
  EmsLifecycleStage,
  EmsOperatingCondition,
  EnvironmentalEffect,
  EnvironmentalImpactExtent,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requireUnscopedEmsAccess as requirePermission } from "@/lib/rbac/ems-access";
import {
  findTenantActivityProcess,
  findTenantEnvironmentalAspect,
  findTenantEnvironmentalImpact,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { isUnderLegalHold } from "@/lib/retention/legal-hold-service";
import { linkEvidence, uploadEvidenceObject } from "@/lib/documents/evidence-service";

export { TenantOwnershipError };

export class AspectRegisterError extends Error {}

export interface CreateEnvironmentalAspectInput {
  processId: string;
  name: string;
  description?: string | null;
  sourceInputOutput?: string | null;
  scopeDescription?: string | null;
  existingControls?: string | null;
  controlRelationship: AspectControlRelationship;
  lifecycleStage?: EmsLifecycleStage | null;
  operatingCondition: EmsOperatingCondition;
  effect: EnvironmentalEffect;
  actorUserId: string;
}

export interface CreateEnvironmentalImpactInput {
  name: string;
  category: string;
  receptor?: string | null;
  extent: EnvironmentalImpactExtent;
  effect: EnvironmentalEffect;
  description?: string | null;
  actorUserId: string;
}

export async function listEnvironmentalAspects(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.environmentalAspect.findMany({
    where: tenantWhere(ctx, {}),
    include: {
      process: { select: { id: true, name: true, programmeId: true, entityId: true, siteId: true } },
      impactLinks: { include: { impact: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function listEnvironmentalImpacts(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.environmentalImpact.findMany({
    where: tenantWhere(ctx, {}),
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}

export async function createEnvironmentalAspect(context: OrganisationContext, input: CreateEnvironmentalAspectInput) {
  requirePermission(context, "ems.aspect.edit");
  const ctx = toTenantRepositoryContext(context);
  const process = await findTenantActivityProcess(ctx, input.processId);
  if (!process) throw new TenantOwnershipError();
  if (process.status === "ARCHIVED" || process.status === "SUPERSEDED") {
    throw new AspectRegisterError("Choose a current process/activity profile.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const aspect = await tx.environmentalAspect.create({
      data: {
        organisationId: txCtx.organisationId,
        processId: process.id,
        name: input.name,
        description: input.description ?? null,
        sourceInputOutput: input.sourceInputOutput ?? null,
        scopeDescription: input.scopeDescription ?? null,
        existingControls: input.existingControls ?? null,
        controlRelationship: input.controlRelationship,
        lifecycleStage: input.lifecycleStage ?? process.lifecycleStage,
        operatingCondition: input.operatingCondition,
        effect: input.effect,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_aspect.created",
      resourceType: "environmental_aspect",
      resourceId: aspect.id,
      summary: `Environmental aspect "${input.name}" created.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { processId: process.id, controlRelationship: input.controlRelationship },
    });
    return aspect;
  });
}

export async function updateEnvironmentalAspect(
  context: OrganisationContext,
  aspectId: string,
  input: CreateEnvironmentalAspectInput,
) {
  requirePermission(context, "ems.aspect.edit");
  const ctx = toTenantRepositoryContext(context);
  const [aspect, process] = await Promise.all([
    findTenantEnvironmentalAspect(ctx, aspectId),
    findTenantActivityProcess(ctx, input.processId),
  ]);
  if (!aspect) throw new TenantOwnershipError();
  if (!process) throw new TenantOwnershipError();
  if (process.status === "ARCHIVED" || process.status === "SUPERSEDED") {
    throw new AspectRegisterError("Choose a current process/activity profile.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.environmentalAspect.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: aspect.id } },
      data: {
        processId: process.id,
        name: input.name,
        description: input.description ?? null,
        sourceInputOutput: input.sourceInputOutput ?? null,
        scopeDescription: input.scopeDescription ?? null,
        existingControls: input.existingControls ?? null,
        controlRelationship: input.controlRelationship,
        lifecycleStage: input.lifecycleStage ?? null,
        operatingCondition: input.operatingCondition,
        effect: input.effect,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_aspect.updated",
      resourceType: "environmental_aspect",
      resourceId: aspect.id,
      summary: `Environmental aspect "${input.name}" updated.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { processId: aspect.processId, name: aspect.name },
      after: { processId: process.id, name: input.name },
    });
    return updated;
  });
}

export async function deleteEnvironmentalAspect(context: OrganisationContext, aspectId: string, actorUserId: string) {
  requirePermission(context, "ems.aspect.edit");
  const ctx = toTenantRepositoryContext(context);
  const aspect = await findTenantEnvironmentalAspect(ctx, aspectId);
  if (!aspect) throw new TenantOwnershipError();
  if (await isUnderLegalHold(ctx, "environmental_aspect", aspect.id)) {
    throw new AspectRegisterError("This aspect is under legal hold and cannot be deleted.");
  }
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    // EvidenceObject is retained as shared evidence; only the polymorphic
    // attachment is removed with the deleted aspect so no orphan link can
    // later imply that the resource still exists.
    await tx.evidenceLink.deleteMany({
      where: tenantWhere(txCtx, { resourceType: "environmental_aspect", resourceId: aspect.id }),
    });
    await tx.environmentalAspect.delete({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: aspect.id } },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_aspect.deleted",
      resourceType: "environmental_aspect",
      resourceId: aspect.id,
      summary: `Environmental aspect "${aspect.name}" deleted.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { processId: aspect.processId, name: aspect.name },
    });
  });
}

export async function createEnvironmentalImpact(context: OrganisationContext, input: CreateEnvironmentalImpactInput) {
  requirePermission(context, "ems.aspect.edit");
  const ctx = toTenantRepositoryContext(context);
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const impact = await tx.environmentalImpact.create({
      data: {
        organisationId: txCtx.organisationId,
        name: input.name,
        category: input.category,
        receptor: input.receptor ?? null,
        extent: input.extent,
        effect: input.effect,
        description: input.description ?? null,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_impact.created",
      resourceType: "environmental_impact",
      resourceId: impact.id,
      summary: `Environmental impact "${input.name}" created.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { category: input.category, extent: input.extent, effect: input.effect },
    });
    return impact;
  });
}

export async function deleteEnvironmentalImpact(context: OrganisationContext, impactId: string, actorUserId: string) {
  requirePermission(context, "ems.aspect.edit");
  const ctx = toTenantRepositoryContext(context);
  const impact = await findTenantEnvironmentalImpact(ctx, impactId);
  if (!impact) throw new TenantOwnershipError();
  if (await isUnderLegalHold(ctx, "environmental_impact", impact.id)) {
    throw new AspectRegisterError("This impact is under legal hold and cannot be deleted.");
  }
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.environmentalImpact.delete({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: impact.id } },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_impact.deleted",
      resourceType: "environmental_impact",
      resourceId: impact.id,
      summary: `Environmental impact "${impact.name}" deleted.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { category: impact.category, name: impact.name },
    });
  });
}

export async function linkAspectToImpact(
  context: OrganisationContext,
  input: { aspectId: string; impactId: string; causalDescription?: string | null; actorUserId: string },
) {
  requirePermission(context, "ems.aspect.edit");
  const ctx = toTenantRepositoryContext(context);
  const [aspect, impact] = await Promise.all([
    findTenantEnvironmentalAspect(ctx, input.aspectId),
    findTenantEnvironmentalImpact(ctx, input.impactId),
  ]);
  if (!aspect || !impact) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const link = await tx.aspectImpactLink.upsert({
      where: {
        organisationId_aspectId_impactId: {
          organisationId: txCtx.organisationId,
          aspectId: aspect.id,
          impactId: impact.id,
        },
      },
      update: { causalDescription: input.causalDescription ?? null },
      create: {
        organisationId: txCtx.organisationId,
        aspectId: aspect.id,
        impactId: impact.id,
        causalDescription: input.causalDescription ?? null,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "aspect_impact.linked",
      resourceType: "aspect_impact_link",
      resourceId: link.id,
      summary: "Environmental aspect linked to impact.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { aspectId: aspect.id, impactId: impact.id },
    });
    return link;
  });
}

export async function unlinkAspectImpact(context: OrganisationContext, linkId: string, actorUserId: string) {
  requirePermission(context, "ems.aspect.edit");
  const ctx = toTenantRepositoryContext(context);
  const link = await prisma.aspectImpactLink.findFirst({ where: tenantWhere(ctx, { id: linkId }) });
  if (!link) throw new TenantOwnershipError();
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.aspectImpactLink.delete({ where: { id: link.id } });
    await recordAuditEvent(tx, txCtx, {
      eventType: "aspect_impact.unlinked",
      resourceType: "aspect_impact_link",
      resourceId: link.id,
      summary: "Environmental aspect unlinked from impact.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { aspectId: link.aspectId, impactId: link.impactId },
    });
  });
}

export async function attachEvidenceToAspect(
  context: OrganisationContext,
  input: { aspectId: string; evidenceId: string; purpose?: string | null; actorUserId: string },
) {
  requirePermission(context, "ems.aspect.edit");
  const ctx = toTenantRepositoryContext(context);
  const aspect = await findTenantEnvironmentalAspect(ctx, input.aspectId);
  if (!aspect) throw new TenantOwnershipError();
  return linkEvidence(context, {
    evidenceId: input.evidenceId,
    resourceType: "environmental_aspect",
    resourceId: aspect.id,
    purpose: input.purpose,
    linkedByUserId: input.actorUserId,
  });
}

export async function uploadEvidenceToAspect(
  context: OrganisationContext,
  input: { aspectId: string; fileName: string; mimeType: string; bytes: Buffer; purpose?: string | null; actorUserId: string },
) {
  requirePermission(context, "ems.aspect.edit");
  const ctx = toTenantRepositoryContext(context);
  const aspect = await findTenantEnvironmentalAspect(ctx, input.aspectId);
  if (!aspect) throw new TenantOwnershipError();
  const evidence = await uploadEvidenceObject(context, {
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
    uploadedByUserId: input.actorUserId,
  });
  await linkEvidence(context, {
    evidenceId: evidence.id,
    resourceType: "environmental_aspect",
    resourceId: aspect.id,
    purpose: input.purpose,
    linkedByUserId: input.actorUserId,
  });
  return evidence;
}

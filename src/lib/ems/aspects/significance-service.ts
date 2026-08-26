/** Tenant-scoped lifecycle service for T32 significance methods/assessments. */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import {
  findTenantAspectAssessment,
  findTenantEmsProgramme,
  findTenantSignificanceMethod,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { calculateSignificance, SignificanceValidationError } from "./significance-engine";
import type { SignificanceFormulaConfig, SignificanceScaleConfig, SignificanceSnapshot } from "./types";

export { SignificanceValidationError, TenantOwnershipError };

export class SignificanceWorkflowError extends Error {}

export type SignificanceCriterionDefinition = {
  key: string;
  label: string;
  scaleConfig: SignificanceScaleConfig;
  weight?: string;
  required: boolean;
  sortOrder: number;
};

export type SignificanceMethodDefinition = {
  programmeId: string;
  methodKey: string;
  name: string;
  formulaConfig: SignificanceFormulaConfig;
  threshold: string;
  criteria: SignificanceCriterionDefinition[];
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function validationSnapshot(definition: SignificanceMethodDefinition): SignificanceSnapshot {
  return {
    methodKey: definition.methodKey,
    version: 1,
    formula: definition.formulaConfig.formula,
    formulaConfig: definition.formulaConfig,
    threshold: definition.threshold,
    criteria: definition.criteria.map((criterion) => ({
      key: criterion.key,
      value: criterion.scaleConfig.kind === "NUMERIC" ? criterion.scaleConfig.min : criterion.scaleConfig.options[0]?.value ?? "",
      weight: criterion.weight,
      required: criterion.required,
      scale: criterion.scaleConfig,
    })),
  };
}

function validateDefinition(definition: SignificanceMethodDefinition): void {
  const keys = new Set<string>();
  for (const criterion of definition.criteria) {
    if (keys.has(criterion.key)) throw new SignificanceWorkflowError(`Criterion key "${criterion.key}" is duplicated.`);
    keys.add(criterion.key);
  }
  if (definition.formulaConfig.formula === "RULE_SET") {
    for (const rule of definition.formulaConfig.rules) {
      if (!keys.has(rule.criterionKey)) throw new SignificanceWorkflowError(`Rule references unknown criterion "${rule.criterionKey}".`);
    }
  }
  calculateSignificance(validationSnapshot(definition));
}

export async function listSignificanceMethods(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.significanceMethod.findMany({
    where: tenantWhere(ctx, {}),
    include: { criteria: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ methodKey: "asc" }, { version: "desc" }],
  });
}

export async function listAspectAssessments(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.aspectAssessment.findMany({
    where: tenantWhere(ctx, {}),
    include: { aspect: { select: { id: true, name: true } }, method: { select: { id: true, name: true } } },
    orderBy: [{ aspectId: "asc" }, { assessmentVersion: "desc" }],
  });
}

async function createMethodVersion(
  context: OrganisationContext,
  definition: SignificanceMethodDefinition,
  version: number,
  supersedesMethodId: string | null,
) {
  requirePermission(context, "ems.aspect.edit");
  validateDefinition(definition);
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantEmsProgramme(ctx, definition.programmeId);
  if (!programme) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const method = await tx.significanceMethod.create({
      data: {
        organisationId: txCtx.organisationId,
        programmeId: programme.id,
        methodKey: definition.methodKey,
        name: definition.name,
        version,
        formula: definition.formulaConfig.formula,
        formulaConfig: json(definition.formulaConfig),
        threshold: definition.threshold,
        preparedByMembershipId: context.membershipId,
        supersedesMethodId,
        criteria: {
          create: definition.criteria.map((criterion) => ({
            key: criterion.key,
            label: criterion.label,
            scaleConfig: json(criterion.scaleConfig),
            weight: criterion.weight ?? null,
            required: criterion.required,
            sortOrder: criterion.sortOrder,
          })),
        },
      },
      include: { criteria: { orderBy: { sortOrder: "asc" } } },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "significance_method.created",
      resourceType: "significance_method",
      resourceId: method.id,
      summary: `Significance method "${definition.name}" version ${version} created.`,
      actorUserId: context.userId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { methodKey: definition.methodKey, version, formula: definition.formulaConfig.formula },
    });
    return method;
  });
}

export async function createSignificanceMethod(context: OrganisationContext, definition: SignificanceMethodDefinition) {
  requirePermission(context, "ems.aspect.edit");
  const ctx = toTenantRepositoryContext(context);
  const existing = await prisma.significanceMethod.findFirst({ where: tenantWhere(ctx, { methodKey: definition.methodKey }) });
  if (existing) throw new SignificanceWorkflowError("That method key already exists. Create a successor version instead.");
  return createMethodVersion(context, definition, 1, null);
}

export async function createSuccessorSignificanceMethod(
  context: OrganisationContext,
  methodId: string,
  definition: Omit<SignificanceMethodDefinition, "programmeId" | "methodKey">,
) {
  requirePermission(context, "ems.aspect.edit");
  const ctx = toTenantRepositoryContext(context);
  const current = await prisma.significanceMethod.findFirst({ where: tenantWhere(ctx, { id: methodId }) });
  if (!current) throw new TenantOwnershipError();
  if (current.status === "DRAFT") throw new SignificanceWorkflowError("Approve or discard the draft method before creating a successor.");
  const latest = await prisma.significanceMethod.findFirst({
    where: tenantWhere(ctx, { methodKey: current.methodKey }),
    orderBy: { version: "desc" },
  });
  if (!latest || latest.id !== current.id) throw new SignificanceWorkflowError("Create the successor from the latest method version.");
  return createMethodVersion(context, {
    ...definition,
    programmeId: current.programmeId,
    methodKey: current.methodKey,
  }, current.version + 1, current.id);
}

/**
 * Removes a draft method outright — the only lifecycle exit for a draft
 * nobody wants, referenced but never implemented by
 * `createSuccessorSignificanceMethod`'s "Approve or discard the draft
 * method" error. Restricted to DRAFT: an approved/superseded method can
 * have been used to snapshot real assessments and must stay immutable, and
 * a draft can never have one (`createAspectAssessment` only accepts an
 * APPROVED method), so this hard delete is safe.
 */
export async function discardSignificanceMethod(context: OrganisationContext, methodId: string, actorUserId: string) {
  requirePermission(context, "ems.aspect.edit");
  const ctx = toTenantRepositoryContext(context);
  const method = await findTenantSignificanceMethod(ctx, methodId);
  if (!method) throw new TenantOwnershipError();
  if (method.status !== "DRAFT") throw new SignificanceWorkflowError("Only a draft significance method can be discarded.");
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    // SignificanceCriterion has onDelete: Cascade on this relation, so its
    // rows are removed automatically.
    await tx.significanceMethod.delete({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: method.id } },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "significance_method.discarded",
      resourceType: "significance_method",
      resourceId: method.id,
      summary: `Draft significance method "${method.name}" version ${method.version} discarded.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "DRAFT", methodKey: method.methodKey, version: method.version },
    });
  });
}

export async function approveSignificanceMethod(context: OrganisationContext, methodId: string) {
  requirePermission(context, "ems.aspect.approve");
  const ctx = toTenantRepositoryContext(context);
  const method = await findTenantSignificanceMethod(ctx, methodId);
  if (!method) throw new TenantOwnershipError();
  if (method.status !== "DRAFT") throw new SignificanceWorkflowError("Only a draft significance method can be approved.");
  const approvedAt = new Date();
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    if (method.supersedesMethodId) {
      const predecessor = await tx.significanceMethod.findFirst({ where: tenantWhere(txCtx, { id: method.supersedesMethodId }) });
      if (!predecessor) throw new TenantOwnershipError();
      if (predecessor.status === "APPROVED") {
        await tx.significanceMethod.update({ where: { organisationId_id: { organisationId: txCtx.organisationId, id: predecessor.id } }, data: { status: "SUPERSEDED" } });
        await recordAuditEvent(tx, txCtx, {
          eventType: "significance_method.superseded", resourceType: "significance_method", resourceId: predecessor.id,
          summary: `Significance method version ${predecessor.version} superseded by version ${method.version}.`, actorUserId: context.userId,
          correlationId: txCtx.correlationId, source: "web-app", before: { status: "APPROVED" }, after: { status: "SUPERSEDED" },
        });
      }
    }
    const approved = await tx.significanceMethod.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: method.id } },
      data: { status: "APPROVED", approvedByMembershipId: context.membershipId, approvedAt },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "significance_method.approved", resourceType: "significance_method", resourceId: method.id,
      summary: `Significance method version ${method.version} approved.`, actorUserId: context.userId,
      correlationId: txCtx.correlationId, source: "web-app", before: { status: "DRAFT" }, after: { status: "APPROVED" },
    });
    return approved;
  });
}

export type CreateAspectAssessmentInput = {
  aspectId: string;
  methodId: string;
  inputs: Record<string, string>;
  overrideSignificant?: boolean | null;
  overrideRationale?: string | null;
};

export async function createAspectAssessment(context: OrganisationContext, input: CreateAspectAssessmentInput) {
  requirePermission(context, "ems.aspect.edit");
  if (input.overrideSignificant !== null && input.overrideSignificant !== undefined) {
    requirePermission(context, "ems.aspect.approve");
    if (!input.overrideRationale?.trim()) throw new SignificanceWorkflowError("A significance override requires a rationale.");
  }
  const ctx = toTenantRepositoryContext(context);
  const [aspect, method] = await Promise.all([
    prisma.environmentalAspect.findFirst({ where: tenantWhere(ctx, { id: input.aspectId }), include: { process: { select: { programmeId: true } } } }),
    prisma.significanceMethod.findFirst({ where: tenantWhere(ctx, { id: input.methodId }), include: { criteria: { orderBy: { sortOrder: "asc" } } } }),
  ]);
  if (!aspect || !method) throw new TenantOwnershipError();
  if (method.status !== "APPROVED") throw new SignificanceWorkflowError("Assessments must use an approved significance method.");
  if (aspect.process.programmeId !== method.programmeId) throw new SignificanceWorkflowError("The method and aspect must belong to the same EMS programme.");

  const criteriaSnapshot = method.criteria.map((criterion) => ({
    key: criterion.key,
    label: criterion.label,
    scaleConfig: criterion.scaleConfig as SignificanceScaleConfig,
    weight: criterion.weight?.toString(),
    required: criterion.required,
    sortOrder: criterion.sortOrder,
  }));
  const snapshot: SignificanceSnapshot = {
    methodKey: method.methodKey,
    version: method.version,
    formula: method.formula,
    formulaConfig: method.formulaConfig as SignificanceFormulaConfig,
    threshold: method.threshold.toString(),
    criteria: criteriaSnapshot.map((criterion) => ({
      key: criterion.key,
      value: input.inputs[criterion.key] ?? "",
      weight: criterion.weight,
      required: criterion.required,
      scale: criterion.scaleConfig,
    })),
  };
  const result = calculateSignificance(snapshot);
  const finalSignificant = input.overrideSignificant ?? result.calculatedSignificant;
  const latest = await prisma.aspectAssessment.findFirst({ where: tenantWhere(ctx, { aspectId: aspect.id }), orderBy: { assessmentVersion: "desc" } });
  if (latest?.status === "DRAFT") throw new SignificanceWorkflowError("Approve the current draft before reassessing this aspect.");
  const assessmentVersion = (latest?.assessmentVersion ?? 0) + 1;

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const assessment = await tx.aspectAssessment.create({
      data: {
        organisationId: txCtx.organisationId,
        aspectId: aspect.id,
        methodId: method.id,
        assessmentVersion,
        methodKeySnapshot: method.methodKey,
        methodVersionSnapshot: method.version,
        formulaSnapshot: method.formula,
        formulaConfigSnapshot: json(method.formulaConfig),
        thresholdSnapshot: method.threshold,
        criteriaSnapshot: json(criteriaSnapshot),
        criterionInputs: json(input.inputs),
        calculatedScore: result.score,
        calculatedSignificant: result.calculatedSignificant,
        calculationTrace: json(result.trace),
        overrideSignificant: input.overrideSignificant ?? null,
        overrideRationale: input.overrideRationale?.trim() || null,
        finalSignificant,
        assessedByMembershipId: context.membershipId,
        supersedesAssessmentId: latest?.id ?? null,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "aspect_assessment.created", resourceType: "aspect_assessment", resourceId: assessment.id,
      summary: `Aspect assessment version ${assessmentVersion} created.`, actorUserId: context.userId,
      correlationId: txCtx.correlationId, source: "web-app",
      after: { aspectId: aspect.id, methodKey: method.methodKey, methodVersion: method.version, assessmentVersion, overrideApplied: input.overrideSignificant != null },
    });
    return assessment;
  });
}

export async function approveAspectAssessment(context: OrganisationContext, assessmentId: string) {
  requirePermission(context, "ems.aspect.approve");
  const ctx = toTenantRepositoryContext(context);
  const assessment = await findTenantAspectAssessment(ctx, assessmentId);
  if (!assessment) throw new TenantOwnershipError();
  if (assessment.status !== "DRAFT") throw new SignificanceWorkflowError("Only a draft assessment can be approved.");
  const approvedAt = new Date();
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    if (assessment.supersedesAssessmentId) {
      const predecessor = await tx.aspectAssessment.findFirst({ where: tenantWhere(txCtx, { id: assessment.supersedesAssessmentId }) });
      if (!predecessor) throw new TenantOwnershipError();
      if (predecessor.status === "APPROVED") {
        await tx.aspectAssessment.update({ where: { organisationId_id: { organisationId: txCtx.organisationId, id: predecessor.id } }, data: { status: "SUPERSEDED" } });
        await recordAuditEvent(tx, txCtx, {
          eventType: "aspect_assessment.superseded", resourceType: "aspect_assessment", resourceId: predecessor.id,
          summary: `Aspect assessment version ${predecessor.assessmentVersion} superseded.`, actorUserId: context.userId,
          correlationId: txCtx.correlationId, source: "web-app", before: { status: "APPROVED" }, after: { status: "SUPERSEDED" },
        });
      }
    }
    const approved = await tx.aspectAssessment.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: assessment.id } },
      data: { status: "APPROVED", approvedByMembershipId: context.membershipId, approvedAt },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "aspect_assessment.approved", resourceType: "aspect_assessment", resourceId: assessment.id,
      summary: `Aspect assessment version ${assessment.assessmentVersion} approved.`, actorUserId: context.userId,
      correlationId: txCtx.correlationId, source: "web-app", before: { status: "DRAFT" }, after: { status: "APPROVED" },
    });
    return approved;
  });
}

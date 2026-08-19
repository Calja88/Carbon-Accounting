/**
 * Objective metric definitions — versioning and approval (task T50,
 * Docs/PHASE5_OBJECTIVES_ACTIONS_SPEC.md §§1,3). A metric definition is
 * versioned and kept separate from measurement values (spec §1) — this
 * module defines what a metric *is* (name, source type, unit, frequency,
 * boundary, data-quality rules) for one `EnvironmentalObjective` and
 * versions/approves that definition. Resolving actual observations through
 * the manual/corporate-carbon/product-LCA/monitoring adapters is T51, not
 * built here.
 *
 * State machine (spec §2): DRAFT -> APPROVED -> ACTIVE -> SUPERSEDED.
 * `ems.objective.manage` drafts a version; only `ems.objective.approve`
 * (Sustainability Lead default) can approve one, moving it straight to
 * ACTIVE and superseding whatever version was previously ACTIVE for this
 * metric definition — the same single-write-site shape T44/T50's objective
 * module use for their active-version pointers. Approved/active/superseded
 * content is immutable at the database layer
 * (`objective_metric_version_immutable_once_approved`); content changes
 * only ever happen through a successor version.
 */

import type { ObjectiveMetricSourceType, ObjectiveMetricVersionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, assertFourEyes } from "@/lib/rbac/authorize";
import {
  findTenantEnvironmentalObjective,
  findTenantObjectiveMetricDefinition,
  findTenantObjectiveMetricVersion,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

export { TenantOwnershipError };

export class ObjectiveMetricError extends Error {}

const APPROVE_PERMISSION = "ems.objective.approve" as const;
const EDIT_PERMISSION = "ems.objective.manage" as const;

export interface ObjectiveMetricDraftFields {
  name: string;
  sourceType: ObjectiveMetricSourceType;
  aggregationConfig?: Prisma.InputJsonValue | null;
  unit: string;
  frequency: string;
  boundaryDescription?: string | null;
  dataQualityRules?: Prisma.InputJsonValue | null;
}

export interface CreateObjectiveMetricDefinitionInput extends ObjectiveMetricDraftFields {
  objectiveId: string;
  actorUserId: string;
}

export interface UpdateObjectiveMetricVersionDraftInput extends ObjectiveMetricDraftFields {
  actorUserId: string;
}

export interface CreateSuccessorObjectiveMetricVersionInput extends ObjectiveMetricDraftFields {
  actorUserId: string;
}

function assertRequiredFields(fields: ObjectiveMetricDraftFields) {
  if (!fields.name.trim()) throw new ObjectiveMetricError("Enter a metric name.");
  if (!fields.unit.trim()) throw new ObjectiveMetricError("Enter a unit.");
  if (!fields.frequency.trim()) throw new ObjectiveMetricError("Enter a measurement frequency.");
}

function draftData(fields: ObjectiveMetricDraftFields) {
  return {
    name: fields.name.trim(),
    sourceType: fields.sourceType,
    aggregationConfig: fields.aggregationConfig ?? undefined,
    unit: fields.unit.trim(),
    frequency: fields.frequency.trim(),
    boundaryDescription: fields.boundaryDescription?.trim() || null,
    dataQualityRules: fields.dataQualityRules ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listObjectiveMetricDefinitions(context: OrganisationContext, objectiveId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const objective = await findTenantEnvironmentalObjective(ctx, objectiveId);
  if (!objective) throw new TenantOwnershipError();
  return prisma.objectiveMetricDefinition.findMany({
    where: tenantWhere(ctx, { objectiveId: objective.id }),
    include: { activeVersion: true, versions: { orderBy: { version: "desc" } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getObjectiveMetricVersion(context: OrganisationContext, versionId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantObjectiveMetricVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  return prisma.objectiveMetricVersion.findUnique({
    where: { id: version.id },
    include: { metricDefinition: true },
  });
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/** Creates a new `ObjectiveMetricDefinition` (for one objective) with its first DRAFT version. */
export async function createObjectiveMetricDefinition(context: OrganisationContext, input: CreateObjectiveMetricDefinitionInput) {
  requirePermission(context, EDIT_PERMISSION);
  assertRequiredFields(input);
  const ctx = toTenantRepositoryContext(context);
  const objective = await findTenantEnvironmentalObjective(ctx, input.objectiveId);
  if (!objective) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const definition = await tx.objectiveMetricDefinition.create({
      data: { organisationId: txCtx.organisationId, objectiveId: objective.id },
    });

    const version = await tx.objectiveMetricVersion.create({
      data: {
        organisationId: txCtx.organisationId,
        metricDefinitionId: definition.id,
        version: 1,
        ...draftData(input),
        preparedByUserId: input.actorUserId,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "objective_metric_version.created",
      resourceType: "objective_metric_version",
      resourceId: version.id,
      summary: `Metric definition drafted: ${input.name}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { objectiveId: objective.id, metricDefinitionId: definition.id, name: input.name },
    });

    return { definition, version };
  });
}

// ---------------------------------------------------------------------------
// Draft editing (DRAFT only)
// ---------------------------------------------------------------------------

export async function updateObjectiveMetricVersionDraft(
  context: OrganisationContext,
  versionId: string,
  input: UpdateObjectiveMetricVersionDraftInput,
) {
  requirePermission(context, EDIT_PERMISSION);
  assertRequiredFields(input);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantObjectiveMetricVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "DRAFT") throw new ObjectiveMetricError("Only a draft version can be edited.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.objectiveMetricVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: draftData(input),
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "objective_metric_version.created",
      resourceType: "objective_metric_version",
      resourceId: version.id,
      summary: "Draft metric definition version updated.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { name: input.name },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Approval transaction — the only place the active-version pointer moves.
// ---------------------------------------------------------------------------

export interface ApproveObjectiveMetricVersionInput {
  actorUserId: string;
  /** Whether four-eyes (the drafting user cannot also approve) is enforced. Defaults to enabled — the same interim decision T22/T23/T44/T50 objectives made. */
  fourEyesEnabled?: boolean;
}

export async function approveObjectiveMetricVersion(
  context: OrganisationContext,
  versionId: string,
  input: ApproveObjectiveMetricVersionInput,
) {
  requirePermission(context, APPROVE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantObjectiveMetricVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "DRAFT") throw new ObjectiveMetricError("Only a draft version can be approved.");
  assertFourEyes({
    enabled: input.fourEyesEnabled ?? true,
    actorUserId: input.actorUserId,
    authorUserId: version.preparedByUserId,
  });

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const definition = await tx.objectiveMetricDefinition.findFirst({ where: tenantWhere(txCtx, { id: version.metricDefinitionId }) });
    if (!definition) throw new TenantOwnershipError();

    if (definition.activeVersionId && definition.activeVersionId !== version.id) {
      const previousActive = await tx.objectiveMetricVersion.findFirst({
        where: tenantWhere(txCtx, { id: definition.activeVersionId }),
      });
      if (previousActive) {
        await tx.objectiveMetricVersion.update({
          where: { organisationId_id: { organisationId: txCtx.organisationId, id: previousActive.id } },
          data: { status: "SUPERSEDED" },
        });
        await recordAuditEvent(tx, txCtx, {
          eventType: "objective_metric_version.superseded",
          resourceType: "objective_metric_version",
          resourceId: previousActive.id,
          summary: "Metric definition version superseded by a newly approved version.",
          actorUserId: input.actorUserId,
          correlationId: txCtx.correlationId,
          source: "web-app",
          before: { status: previousActive.status },
          after: { status: "SUPERSEDED" },
        });
      }
    }

    const updated = await tx.objectiveMetricVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: { status: "ACTIVE", approvedByUserId: input.actorUserId, approvedAt: new Date() },
    });

    await tx.objectiveMetricDefinition.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: definition.id } },
      data: { activeVersionId: version.id },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "objective_metric_version.approved",
      resourceType: "objective_metric_version",
      resourceId: version.id,
      summary: "Metric definition version approved and made active.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "DRAFT" },
      after: { status: "ACTIVE" },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Successor versions — the only path to changing an approved/active/
// superseded metric definition's content.
// ---------------------------------------------------------------------------

export async function createSuccessorObjectiveMetricVersion(
  context: OrganisationContext,
  metricDefinitionId: string,
  input: CreateSuccessorObjectiveMetricVersionInput,
) {
  requirePermission(context, EDIT_PERMISSION);
  assertRequiredFields(input);
  const ctx = toTenantRepositoryContext(context);
  const definition = await findTenantObjectiveMetricDefinition(ctx, metricDefinitionId);
  if (!definition) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const latest = await tx.objectiveMetricVersion.findFirst({
      where: tenantWhere(txCtx, { metricDefinitionId: definition.id }),
      orderBy: { version: "desc" },
    });
    if (!latest) throw new ObjectiveMetricError("Metric definition has no versions to replace.");
    if (latest.status === "DRAFT") {
      throw new ObjectiveMetricError(`Version ${latest.version} is still DRAFT — edit it directly instead of creating a successor.`);
    }

    const successor = await tx.objectiveMetricVersion.create({
      data: {
        organisationId: txCtx.organisationId,
        metricDefinitionId: definition.id,
        version: latest.version + 1,
        ...draftData(input),
        preparedByUserId: input.actorUserId,
        supersedesVersionId: latest.id,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "objective_metric_version.created",
      resourceType: "objective_metric_version",
      resourceId: successor.id,
      summary: `Successor metric version ${successor.version} created, replacing version ${latest.version}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { version: successor.version, supersedesVersionId: latest.id },
    });

    return successor;
  });
}

export type { ObjectiveMetricVersionStatus };

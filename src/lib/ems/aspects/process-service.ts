/**
 * Process/activity profile service (task T30,
 * Docs/PHASE3_ASPECTS_OPERATIONS_SPEC.md §§1-2 "Process/activity structure").
 *
 * Fixed decisions this module encodes (spec §1, §6):
 *  - Applying a structural starter template requires an explicit `confirm:
 *    true` — no template is ever applied as a side effect of another call.
 *  - Template application is idempotent: re-applying the same template to
 *    the same site reuses the existing (non-superseded) ActivityProcess for
 *    each template item instead of duplicating it.
 *  - Applying a template creates DRAFT ActivityProcesses only, and touches
 *    no other table — no aspect, score, or environmental measurement model
 *    exists yet (T31/T34), so there is nothing else for this module to
 *    create even if it wanted to.
 *  - Revising a profile never updates an existing ActivityProcess row in
 *    place: `reviseActivityProcess` creates a new row and marks the old one
 *    SUPERSEDED, the same supersede-chain shape T23 uses for
 *    `EmsScopeVersion` — so anything that already references the old row
 *    (a future aspect/assessment) keeps pointing at unchanged data.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requireUnscopedEmsAccess as requirePermission } from "@/lib/rbac/ems-access";
import { requireEntityInScope, requireSiteInScope } from "@/lib/repositories/carbon-repository";
import {
  findTenantEmsProgramme,
  findTenantActivityProcess,
  findProcessProfileTemplate,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import type { ActivityProcessStatus, EmsLifecycleStage, EmsOperatingCondition, ProcessActivityType } from "./types";

export { TenantOwnershipError };

export class ActivityProcessError extends Error {}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListActivityProcessesFilter {
  programmeId?: string;
  siteId?: string;
  entityId?: string;
  status?: ActivityProcessStatus;
}

export async function listActivityProcesses(context: OrganisationContext, filter: ListActivityProcessesFilter = {}) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.activityProcess.findMany({
    where: tenantWhere(ctx, {
      ...(filter.programmeId ? { programmeId: filter.programmeId } : {}),
      ...(filter.siteId ? { siteId: filter.siteId } : {}),
      ...(filter.entityId ? { entityId: filter.entityId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    }),
    orderBy: { createdAt: "desc" },
  });
}

export async function getActivityProcess(context: OrganisationContext, id: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return findTenantActivityProcess(ctx, id);
}

/** Lists every active platform structural starter template, with its items. Read-only catalogue content — no tenant scoping applies. */
export async function listProcessProfileTemplates(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  return prisma.processProfileTemplate.findMany({
    where: { isActive: true },
    include: { items: { orderBy: { sortOrder: "asc" } } },
    orderBy: { name: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Hand-authored processes
// ---------------------------------------------------------------------------

async function resolveSiteAndEntity(
  context: OrganisationContext,
  input: { entityId?: string | null; siteId?: string | null },
): Promise<{ entityId: string | null; siteId: string | null }> {
  if (input.siteId) {
    const site = await requireSiteInScope(context, input.siteId);
    if (input.entityId && input.entityId !== site.entityId) {
      throw new ActivityProcessError("Site does not belong to the given Entity.");
    }
    return { entityId: site.entityId, siteId: site.id };
  }
  if (input.entityId) {
    const entity = await requireEntityInScope(context, input.entityId);
    return { entityId: entity.id, siteId: null };
  }
  return { entityId: null, siteId: null };
}

export interface CreateActivityProcessInput {
  programmeId: string;
  entityId?: string | null;
  siteId?: string | null;
  parentId?: string | null;
  name: string;
  description?: string | null;
  activityType?: ProcessActivityType;
  lifecycleStage?: EmsLifecycleStage | null;
  operatingCondition?: EmsOperatingCondition;
  createdByMembershipId?: string | null;
  actorUserId: string;
}

export async function createActivityProcess(context: OrganisationContext, input: CreateActivityProcessInput) {
  requirePermission(context, "ems.aspect.edit");
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantEmsProgramme(ctx, input.programmeId);
  const { entityId, siteId } = await resolveSiteAndEntity(context, input);

  let parent = null;
  if (input.parentId) {
    parent = await findTenantActivityProcess(ctx, input.parentId, programme.id);
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const process = await tx.activityProcess.create({
      data: {
        organisationId: txCtx.organisationId,
        programmeId: programme.id,
        entityId,
        siteId,
        parentId: parent?.id ?? null,
        name: input.name,
        description: input.description ?? null,
        activityType: input.activityType ?? "ACTIVITY",
        lifecycleStage: input.lifecycleStage ?? null,
        operatingCondition: input.operatingCondition ?? "NORMAL",
        status: "ACTIVE",
        createdByMembershipId: input.createdByMembershipId ?? null,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "activity_process.created",
      resourceType: "activity_process",
      resourceId: process.id,
      summary: `Process/activity profile "${input.name}" created.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { name: input.name, siteId, entityId },
    });

    return process;
  });
}

export interface ReviseActivityProcessInput {
  name?: string;
  description?: string | null;
  activityType?: ProcessActivityType;
  lifecycleStage?: EmsLifecycleStage | null;
  operatingCondition?: EmsOperatingCondition;
  actorUserId: string;
}

/**
 * Revises a process by creating a new row that supersedes the given one —
 * the original row is never updated, only marked SUPERSEDED, so anything
 * that already references it (a future aspect/assessment) keeps pointing at
 * unchanged data.
 */
export async function reviseActivityProcess(context: OrganisationContext, processId: string, input: ReviseActivityProcessInput) {
  requirePermission(context, "ems.aspect.edit");
  const ctx = toTenantRepositoryContext(context);
  const current = await findTenantActivityProcess(ctx, processId);
  if (!current) throw new TenantOwnershipError();
  if (current.status === "SUPERSEDED") {
    throw new ActivityProcessError("This process has already been revised; revise its current successor instead.");
  }
  if (current.status === "ARCHIVED") {
    throw new ActivityProcessError("An archived process cannot be revised.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const revised = await tx.activityProcess.create({
      data: {
        organisationId: txCtx.organisationId,
        programmeId: current.programmeId,
        entityId: current.entityId,
        siteId: current.siteId,
        parentId: current.parentId,
        name: input.name ?? current.name,
        description: input.description === undefined ? current.description : input.description,
        activityType: input.activityType ?? current.activityType,
        lifecycleStage: input.lifecycleStage === undefined ? current.lifecycleStage : input.lifecycleStage,
        operatingCondition: input.operatingCondition ?? current.operatingCondition,
        status: current.status,
        sourceTemplateId: current.sourceTemplateId,
        sourceTemplateItemId: current.sourceTemplateItemId,
        supersedesProcessId: current.id,
        createdByMembershipId: current.createdByMembershipId,
      },
    });

    await tx.activityProcess.update({
      where: { id: current.id, organisationId: txCtx.organisationId },
      data: { status: "SUPERSEDED" },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "activity_process.revised",
      resourceType: "activity_process",
      resourceId: revised.id,
      summary: `Process/activity profile "${current.name}" revised.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { id: current.id, name: current.name },
      after: { id: revised.id, name: revised.name },
    });

    return revised;
  });
}

async function transitionActivityProcessStatus(
  context: OrganisationContext,
  processId: string,
  options: {
    from: ActivityProcessStatus[];
    to: ActivityProcessStatus;
    eventType: "activity_process.activated" | "activity_process.archived";
    summary: string;
    actorUserId: string;
  },
) {
  requirePermission(context, "ems.aspect.edit");
  const ctx = toTenantRepositoryContext(context);
  const process = await findTenantActivityProcess(ctx, processId);
  if (!process) throw new TenantOwnershipError();
  if (!options.from.includes(process.status)) {
    throw new ActivityProcessError(`Process must be ${options.from.join(" or ")} to move to ${options.to} (it is ${process.status}).`);
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.activityProcess.update({
      where: { id: process.id, organisationId: txCtx.organisationId },
      data: { status: options.to },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: options.eventType,
      resourceType: "activity_process",
      resourceId: process.id,
      summary: options.summary,
      actorUserId: options.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: process.status },
      after: { status: options.to },
    });

    return updated;
  });
}

/** Promotes a DRAFT process (typically a just-applied template item) to ACTIVE once a user has reviewed it. */
export async function activateActivityProcess(context: OrganisationContext, processId: string, actorUserId: string) {
  return transitionActivityProcessStatus(context, processId, {
    from: ["DRAFT"],
    to: "ACTIVE",
    eventType: "activity_process.activated",
    summary: "Process/activity profile activated.",
    actorUserId,
  });
}

export async function archiveActivityProcess(context: OrganisationContext, processId: string, actorUserId: string) {
  return transitionActivityProcessStatus(context, processId, {
    from: ["DRAFT", "ACTIVE"],
    to: "ARCHIVED",
    eventType: "activity_process.archived",
    summary: "Process/activity profile archived.",
    actorUserId,
  });
}

// ---------------------------------------------------------------------------
// Structural starter templates
// ---------------------------------------------------------------------------

export interface ApplyProcessProfileTemplateInput {
  programmeId: string;
  templateId: string;
  siteId: string;
  entityId?: string | null;
  /** Must be explicitly true — applying a template is never a side effect of another call. */
  confirm: boolean;
  createdByMembershipId?: string | null;
  actorUserId: string;
}

export interface ApplyProcessProfileTemplateResult {
  templateId: string;
  createdProcessIds: string[];
  reusedProcessIds: string[];
}

/**
 * Applies a structural starter template to one site, creating a DRAFT
 * ActivityProcess for each ProcessTemplateItem. Requires explicit
 * confirmation, is idempotent per (organisation, site, template item), and
 * creates nothing beyond ActivityProcess rows — no aspect, score, or
 * environmental measurement (spec §1, §6).
 */
export async function applyProcessProfileTemplate(
  context: OrganisationContext,
  input: ApplyProcessProfileTemplateInput,
): Promise<ApplyProcessProfileTemplateResult> {
  requirePermission(context, "ems.aspect.edit");
  if (!input.confirm) {
    throw new ActivityProcessError("Template application requires explicit confirmation.");
  }

  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantEmsProgramme(ctx, input.programmeId);
  const { entityId, siteId } = await resolveSiteAndEntity(context, { entityId: input.entityId, siteId: input.siteId });
  if (!siteId) {
    throw new ActivityProcessError("Template application requires a site.");
  }

  const template = await findProcessProfileTemplate(input.templateId);
  if (!template || !template.isActive) {
    throw new ActivityProcessError("Unknown or inactive process profile template.");
  }

  return runInTenantTransaction(ctx, prisma, (tx, txCtx) =>
    applyTemplateItemsInTransaction(tx, txCtx, {
      programmeId: programme.id,
      entityId,
      siteId,
      template,
      createdByMembershipId: input.createdByMembershipId ?? null,
      actorUserId: input.actorUserId,
    }),
  );
}

interface ApplyTemplateContext {
  programmeId: string;
  entityId: string | null;
  siteId: string;
  template: NonNullable<Awaited<ReturnType<typeof findProcessProfileTemplate>>>;
  createdByMembershipId: string | null;
  actorUserId: string;
}

async function applyTemplateItemsInTransaction(
  tx: Prisma.TransactionClient,
  txCtx: TenantRepositoryContext,
  input: ApplyTemplateContext,
): Promise<ApplyProcessProfileTemplateResult> {
  const createdProcessIds: string[] = [];
  const reusedProcessIds: string[] = [];
  const itemIdToProcessId = new Map<string, string>();

  // Topological order: an item is only eligible once its parent (if any)
  // is already placed, so an arbitrarily deep template hierarchy is
  // handled correctly, not just one level.
  const placed = new Set<string>();
  const remaining = [...input.template.items].sort((a, b) => a.sortOrder - b.sortOrder);
  const orderedItems: typeof remaining = [];
  while (remaining.length > 0) {
    const eligibleIndex = remaining.findIndex((item) => !item.parentId || placed.has(item.parentId));
    if (eligibleIndex === -1) {
      // Cycle or dangling parent reference — not creatable from this
      // template's own item set; stop rather than loop forever.
      throw new ActivityProcessError("Process profile template contains an unresolvable item hierarchy.");
    }
    const [item] = remaining.splice(eligibleIndex, 1);
    placed.add(item.id);
    orderedItems.push(item);
  }

  for (const item of orderedItems) {
    const existing = await tx.activityProcess.findFirst({
      where: {
        organisationId: txCtx.organisationId,
        siteId: input.siteId,
        sourceTemplateItemId: item.id,
        status: { not: "ARCHIVED" },
      },
    });

    if (existing) {
      reusedProcessIds.push(existing.id);
      itemIdToProcessId.set(item.id, existing.id);
      continue;
    }

    const created = await tx.activityProcess.create({
      data: {
        organisationId: txCtx.organisationId,
        programmeId: input.programmeId,
        entityId: input.entityId,
        siteId: input.siteId,
        parentId: item.parentId ? (itemIdToProcessId.get(item.parentId) ?? null) : null,
        name: item.name,
        description: item.description,
        activityType: item.activityType,
        lifecycleStage: item.suggestedLifecycleStage,
        operatingCondition: item.suggestedOperatingCondition,
        status: "DRAFT",
        sourceTemplateId: input.template.id,
        sourceTemplateItemId: item.id,
        createdByMembershipId: input.createdByMembershipId,
      },
    });
    createdProcessIds.push(created.id);
    itemIdToProcessId.set(item.id, created.id);
  }

  await recordAuditEvent(tx, txCtx, {
    eventType: "activity_process.template_applied",
    resourceType: "process_profile_template",
    resourceId: input.template.id,
    summary: `Structural template "${input.template.name}" applied to site (${createdProcessIds.length} created, ${reusedProcessIds.length} reused).`,
    actorUserId: input.actorUserId,
    correlationId: txCtx.correlationId,
    source: "web-app",
    after: { siteId: input.siteId, createdProcessIds, reusedProcessIds },
  });

  return { templateId: input.template.id, createdProcessIds, reusedProcessIds };
}

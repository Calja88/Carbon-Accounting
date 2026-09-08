/**
 * Management review agenda templates (task T72, Docs/PHASE7_COMPETENCE_MANAGEMENT_REVIEW_SPEC.md
 * §4, PR sequence P7-05). Depends on T23 (EmsProgramme/context foundation),
 * already on this branch.
 *
 * Fixed decisions this module enforces (spec §1 "agenda template is
 * configurable/versioned"):
 *  - state machine is DRAFT -> APPROVED -> ACTIVE -> SUPERSEDED, the exact
 *    narrower (no IN_REVIEW step) machine `CompetenceRequirementVersion`
 *    (T70) uses — the catalogue has only one management-review manage
 *    permission for this module (`ems.management_review.manage`), so there
 *    is no maker-checker step to enforce here;
 *  - `ManagementReviewAgendaTemplate.activeVersionId` only ever moves
 *    inside `activateManagementReviewAgendaTemplateVersion` — approving a
 *    version does not itself activate it;
 *  - a version that has left DRAFT is never edited in place —
 *    `createSuccessorManagementReviewAgendaTemplateVersion` is the only way
 *    to change an approved/active/superseded version's item list;
 *  - `ManagementReview.agendaTemplateVersionId` (review-service.ts) always
 *    pins the exact version selected at schedule time, never the
 *    template's mutable `activeVersionId` pointer, so a later template
 *    revision never rewrites an already-scheduled review's agenda.
 */

import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import {
  findTenantManagementReviewAgendaTemplate,
  findTenantManagementReviewAgendaTemplateVersion,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

export { TenantOwnershipError };

export class ManagementReviewAgendaError extends Error {}

const MANAGE_PERMISSION = "ems.management_review.manage" as const;
const VIEW_PERMISSION = "ems.view" as const;

export interface ManagementReviewAgendaItemInput {
  order: number;
  title: string;
  description?: string | null;
  inputDefinitionKey?: string | null;
}

export interface ManagementReviewAgendaTemplateDraftFields {
  name: string;
  items: ManagementReviewAgendaItemInput[];
}

export interface CreateManagementReviewAgendaTemplateInput extends ManagementReviewAgendaTemplateDraftFields {
  templateKey: string;
  actorUserId: string;
}

export interface UpdateManagementReviewAgendaTemplateVersionDraftInput extends ManagementReviewAgendaTemplateDraftFields {
  actorUserId: string;
}

export interface CreateSuccessorManagementReviewAgendaTemplateVersionInput extends ManagementReviewAgendaTemplateDraftFields {
  actorUserId: string;
  revisionRationale: string;
}

// ---------------------------------------------------------------------------
// Item validation
// ---------------------------------------------------------------------------

function validateItems(items: ManagementReviewAgendaItemInput[]) {
  if (items.length === 0) {
    throw new ManagementReviewAgendaError("Add at least one agenda item.");
  }
  const orders = new Set<number>();
  for (const item of items) {
    if (!item.title.trim()) throw new ManagementReviewAgendaError("Every agenda item needs a title.");
    if (orders.has(item.order)) throw new ManagementReviewAgendaError("Agenda item order must be unique.");
    orders.add(item.order);
  }
  return items
    .map((item) => ({
      order: item.order,
      title: item.title.trim(),
      description: item.description?.trim() || null,
      inputDefinitionKey: item.inputDefinitionKey?.trim() || null,
    }))
    .sort((a, b) => a.order - b.order);
}

function assertRequiredFields(fields: ManagementReviewAgendaTemplateDraftFields) {
  if (!fields.name.trim()) throw new ManagementReviewAgendaError("Enter a template name.");
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const versionInclude = {
  items: { orderBy: { order: "asc" } },
} as const;

export async function listManagementReviewAgendaTemplates(context: OrganisationContext) {
  requirePermission(context, VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  return prisma.managementReviewAgendaTemplate.findMany({
    where: tenantWhere(ctx, {}),
    include: {
      activeVersion: true,
      versions: { orderBy: { version: "desc" }, include: versionInclude },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getManagementReviewAgendaTemplateVersion(context: OrganisationContext, versionId: string) {
  requirePermission(context, VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantManagementReviewAgendaTemplateVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  return prisma.managementReviewAgendaTemplateVersion.findUnique({
    where: { id: version.id },
    include: { template: true, ...versionInclude },
  });
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export async function createManagementReviewAgendaTemplate(
  context: OrganisationContext,
  input: CreateManagementReviewAgendaTemplateInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  assertRequiredFields(input);
  if (!input.templateKey.trim()) throw new ManagementReviewAgendaError("Enter a template key.");
  const items = validateItems(input.items);
  const ctx = toTenantRepositoryContext(context);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const template = await tx.managementReviewAgendaTemplate.create({
      data: { organisationId: txCtx.organisationId, templateKey: input.templateKey.trim(), name: input.name.trim() },
    });

    const version = await tx.managementReviewAgendaTemplateVersion.create({
      data: {
        organisationId: txCtx.organisationId,
        templateId: template.id,
        version: 1,
        name: input.name.trim(),
        preparedByUserId: input.actorUserId,
        items: { create: items.map((item) => ({ organisationId: txCtx.organisationId, ...item })) },
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_agenda_template_version.created",
      resourceType: "management_review_agenda_template_version",
      resourceId: version.id,
      summary: `Management review agenda template drafted: ${input.name}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { templateId: template.id, name: input.name },
    });

    return { template, version };
  });
}

// ---------------------------------------------------------------------------
// Draft editing (DRAFT only)
// ---------------------------------------------------------------------------

export async function updateManagementReviewAgendaTemplateVersionDraft(
  context: OrganisationContext,
  versionId: string,
  input: UpdateManagementReviewAgendaTemplateVersionDraftInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  assertRequiredFields(input);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantManagementReviewAgendaTemplateVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "DRAFT") throw new ManagementReviewAgendaError("Only a draft version can be edited.");
  const items = validateItems(input.items);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.managementReviewAgendaItemDefinition.deleteMany({ where: tenantWhere(txCtx, { templateVersionId: version.id }) });

    const updated = await tx.managementReviewAgendaTemplateVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: {
        name: input.name.trim(),
        items: { create: items.map((item) => ({ organisationId: txCtx.organisationId, ...item })) },
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_agenda_template_version.created",
      resourceType: "management_review_agenda_template_version",
      resourceId: version.id,
      summary: "Draft management review agenda template version updated.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { name: input.name },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Approval / activation
// ---------------------------------------------------------------------------

export async function approveManagementReviewAgendaTemplateVersion(
  context: OrganisationContext,
  versionId: string,
  actorUserId: string,
) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantManagementReviewAgendaTemplateVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "DRAFT") throw new ManagementReviewAgendaError("Only a draft version can be approved.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.managementReviewAgendaTemplateVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: { status: "APPROVED", approvedByUserId: actorUserId, approvedAt: new Date() },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_agenda_template_version.approved",
      resourceType: "management_review_agenda_template_version",
      resourceId: version.id,
      summary: "Management review agenda template version approved.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "DRAFT" },
      after: { status: "APPROVED" },
    });
    return updated;
  });
}

/**
 * Activates an APPROVED version, moves the template's active pointer, and
 * supersedes whatever version was previously ACTIVE — all in one
 * transaction, mirroring `activateCompetenceRequirementVersion` (T70).
 */
export async function activateManagementReviewAgendaTemplateVersion(
  context: OrganisationContext,
  versionId: string,
  actorUserId: string,
) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantManagementReviewAgendaTemplateVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "APPROVED") throw new ManagementReviewAgendaError("Only an approved version can be activated.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const template = await tx.managementReviewAgendaTemplate.findFirst({ where: tenantWhere(txCtx, { id: version.templateId }) });
    if (!template) throw new TenantOwnershipError();

    if (template.activeVersionId && template.activeVersionId !== version.id) {
      const previousActive = await tx.managementReviewAgendaTemplateVersion.findFirst({
        where: tenantWhere(txCtx, { id: template.activeVersionId }),
      });
      if (previousActive) {
        await tx.managementReviewAgendaTemplateVersion.update({
          where: { organisationId_id: { organisationId: txCtx.organisationId, id: previousActive.id } },
          data: { status: "SUPERSEDED" },
        });
        await recordAuditEvent(tx, txCtx, {
          eventType: "management_review_agenda_template_version.superseded",
          resourceType: "management_review_agenda_template_version",
          resourceId: previousActive.id,
          summary: "Management review agenda template version superseded by a newly activated version.",
          actorUserId,
          correlationId: txCtx.correlationId,
          source: "web-app",
          before: { status: previousActive.status },
          after: { status: "SUPERSEDED" },
        });
      }
    }

    const updated = await tx.managementReviewAgendaTemplateVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: { status: "ACTIVE" },
    });

    await tx.managementReviewAgendaTemplate.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: template.id } },
      data: { activeVersionId: version.id },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_agenda_template_version.activated",
      resourceType: "management_review_agenda_template_version",
      resourceId: version.id,
      summary: "Management review agenda template version activated.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "APPROVED" },
      after: { status: "ACTIVE" },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Successor versions
// ---------------------------------------------------------------------------

export async function createSuccessorManagementReviewAgendaTemplateVersion(
  context: OrganisationContext,
  templateId: string,
  input: CreateSuccessorManagementReviewAgendaTemplateVersionInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  assertRequiredFields(input);
  if (!input.revisionRationale.trim()) throw new ManagementReviewAgendaError("Enter a revision rationale.");
  const ctx = toTenantRepositoryContext(context);
  const template = await findTenantManagementReviewAgendaTemplate(ctx, templateId);
  if (!template) throw new TenantOwnershipError();
  const items = validateItems(input.items);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const latest = await tx.managementReviewAgendaTemplateVersion.findFirst({
      where: tenantWhere(txCtx, { templateId: template.id }),
      orderBy: { version: "desc" },
    });
    if (!latest) throw new ManagementReviewAgendaError("Template has no versions to replace.");
    if (latest.status === "DRAFT") {
      throw new ManagementReviewAgendaError(`Version ${latest.version} is still DRAFT — edit it directly instead of creating a successor.`);
    }

    const successor = await tx.managementReviewAgendaTemplateVersion.create({
      data: {
        organisationId: txCtx.organisationId,
        templateId: template.id,
        version: latest.version + 1,
        name: input.name.trim(),
        preparedByUserId: input.actorUserId,
        revisionRationale: input.revisionRationale.trim(),
        supersedesVersionId: latest.id,
        items: { create: items.map((item) => ({ organisationId: txCtx.organisationId, ...item })) },
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_agenda_template_version.created",
      resourceType: "management_review_agenda_template_version",
      resourceId: successor.id,
      summary: `Successor version ${successor.version} created, replacing version ${latest.version}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { version: successor.version, supersedesVersionId: latest.id },
    });

    return successor;
  });
}

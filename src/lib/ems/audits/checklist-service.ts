/**
 * Audit checklist versioning and question responses (task T61,
 * Docs/PHASE6_AUDIT_INCIDENT_CAPA_SPEC.md §§1-3,6-9). One `AuditChecklistVersion`
 * per audit is built up as `DRAFT` — items may be added/edited/removed —
 * then frozen no later than the audit leaving `PREPARATION` for
 * `IN_PROGRESS` (spec: "checklist version frozen at audit start").
 *
 * `freezeActiveChecklistVersion` is the single freeze entry point: it is
 * called both directly (an explicit "freeze checklist" action while still
 * in preparation) and internally, in the same transaction, by
 * `audit-service.ts#startAuditExecution` — so a checklist can never still be
 * `DRAFT` once execution begins. Once `FROZEN`, no item on that version is
 * ever edited again; `assertChecklistEditable` is the only place that
 * decision is made.
 *
 * `recordQuestionResponse` upserts one response per frozen checklist item —
 * responses stay mutable through `IN_PROGRESS`/`REPORT_DRAFT` and are
 * blocked once the audit's report has been issued (spec: "issued report
 * immutable" — the frozen `AuditReportRevision.frozenPayload` copies these
 * at issue time, so a later edit here would silently diverge from what was
 * issued if it weren't blocked).
 */

import { prisma } from "@/lib/prisma";
import type { Prisma, AuditQuestionResult } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, hasPermission } from "@/lib/rbac/authorize";
import {
  findTenantEmsAudit,
  findTenantAuditChecklistVersion,
  findTenantAuditChecklistItem,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { linkEvidence, uploadEvidenceObject } from "@/lib/documents/evidence-service";

export { TenantOwnershipError };

export class AuditChecklistError extends Error {}

const PROGRAMME_MANAGE_PERMISSION = "ems.audit_programme.manage" as const;
const AUDIT_PERFORM_PERMISSION = "ems.audit.perform" as const;

/**
 * A caller may manage an audit's execution content (checklist, responses,
 * findings) if they hold programme-management authority, or if they hold
 * `ems.audit.perform` and are themselves assigned to this audit's team —
 * matching the T60 `AUDITOR` role template, which is granted `ems.audit.perform`
 * but not `ems.audit_programme.manage` (spec §8 "audit team member ...
 * resources must belong to Organisation and accessible scope").
 */
async function assertAuditExecutionAccess(context: OrganisationContext, auditId: string): Promise<void> {
  if (hasPermission(context, PROGRAMME_MANAGE_PERMISSION)) return;
  requirePermission(context, AUDIT_PERFORM_PERMISSION);
  const member = await prisma.auditTeamMember.findFirst({
    where: { organisationId: context.organisationId, auditId, membershipId: context.membershipId },
    select: { id: true },
  });
  if (!member) throw new AuditChecklistError("Only an assigned team member can work on this audit.");
}

async function loadAuditOrThrow(ctx: TenantRepositoryContext, auditId: string) {
  const audit = await findTenantEmsAudit(ctx, auditId);
  if (!audit) throw new TenantOwnershipError();
  return audit;
}

// ---------------------------------------------------------------------------
// Checklist versions and items
// ---------------------------------------------------------------------------

async function latestChecklistVersion(ctx: TenantRepositoryContext, auditId: string) {
  return prisma.auditChecklistVersion.findFirst({
    where: tenantWhere(ctx, { auditId }),
    orderBy: { version: "desc" },
  });
}

/** Returns the audit's checklist (latest version + items + responses), or null if none has been started. */
export async function getAuditChecklist(context: OrganisationContext, auditId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  await loadAuditOrThrow(ctx, auditId);
  const version = await latestChecklistVersion(ctx, auditId);
  if (!version) return null;
  return prisma.auditChecklistVersion.findUnique({
    where: { id: version.id },
    include: {
      items: {
        include: { response: { include: { auditor: { include: { user: { select: { name: true } } } } } } },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
}

/**
 * Starts (or returns) the one allowed DRAFT checklist version for an audit.
 * Only one DRAFT version may exist at a time — once frozen, a new version is
 * never created for the same execution (T61 does not re-open a frozen plan;
 * see module docblock).
 */
export async function ensureDraftChecklistVersion(context: OrganisationContext, auditId: string, actorUserId: string) {
  await assertAuditExecutionAccess(context, auditId);
  const ctx = toTenantRepositoryContext(context);
  const audit = await loadAuditOrThrow(ctx, auditId);
  if (audit.status === "REPORT_ISSUED" || audit.status === "CLOSED") {
    throw new AuditChecklistError("The checklist of an issued or closed audit cannot be changed.");
  }

  const existing = await latestChecklistVersion(ctx, auditId);
  if (existing) {
    if (existing.status === "DRAFT") return existing;
    throw new AuditChecklistError("This audit's checklist is already frozen; a new version cannot be started.");
  }

  return prisma.auditChecklistVersion.create({
    data: { organisationId: ctx.organisationId, auditId, version: 1, createdByUserId: actorUserId },
  });
}

export interface AddChecklistItemInput {
  question: string;
  criteriaReference?: string | null;
  expectedEvidence?: string | null;
  actorUserId: string;
}

export async function addChecklistItem(context: OrganisationContext, checklistVersionId: string, input: AddChecklistItemInput) {
  if (!input.question.trim()) throw new AuditChecklistError("Enter the checklist question.");
  const version = await requireChecklistVersionForWrite(context, checklistVersionId);
  await assertAuditExecutionAccess(context, version.auditId);
  const ctx = toTenantRepositoryContext(context);

  const count = await prisma.auditChecklistItem.count({ where: tenantWhere(ctx, { checklistVersionId: version.id }) });

  return prisma.auditChecklistItem.create({
    data: {
      organisationId: ctx.organisationId,
      checklistVersionId: version.id,
      sortOrder: count,
      question: input.question.trim(),
      criteriaReference: input.criteriaReference?.trim() || null,
      expectedEvidence: input.expectedEvidence?.trim() || null,
    },
  });
}

async function requireChecklistVersionForWrite(context: OrganisationContext, checklistVersionId: string) {
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantAuditChecklistVersion(ctx, checklistVersionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "DRAFT") throw new AuditChecklistError("A frozen checklist version cannot be edited.");
  return version;
}

export async function removeChecklistItem(context: OrganisationContext, itemId: string, actorUserId: string) {
  const ctx = toTenantRepositoryContext(context);
  const item = await findTenantAuditChecklistItem(ctx, itemId);
  if (!item) throw new TenantOwnershipError();
  const version = await requireChecklistVersionForWrite(context, item.checklistVersionId);
  await assertAuditExecutionAccess(context, version.auditId);
  void actorUserId;
  await prisma.auditChecklistItem.delete({
    where: { organisationId_checklistVersionId_sortOrder: { organisationId: ctx.organisationId, checklistVersionId: item.checklistVersionId, sortOrder: item.sortOrder } },
  });
  return { id: item.id };
}

/**
 * Freezes the audit's current DRAFT checklist version, if any — a no-op
 * (returns null) when the audit has no checklist at all, since a checklist
 * is optional. Callable both as a standalone action and, in the same
 * transaction, from `audit-service.ts#startAuditExecution` — see module
 * docblock.
 */
export async function freezeActiveChecklistVersionInTransaction(
  tx: Prisma.TransactionClient,
  ctx: TenantRepositoryContext,
  auditId: string,
  actorUserId: string,
) {
  const version = await tx.auditChecklistVersion.findFirst({
    where: tenantWhere(ctx, { auditId }),
    orderBy: { version: "desc" },
  });
  if (!version || version.status === "FROZEN") return null;

  const itemCount = await tx.auditChecklistItem.count({ where: tenantWhere(ctx, { checklistVersionId: version.id }) });
  if (itemCount === 0) throw new AuditChecklistError("Add at least one checklist item before freezing the checklist.");

  const frozen = await tx.auditChecklistVersion.update({
    where: { organisationId_id: { organisationId: ctx.organisationId, id: version.id } },
    data: { status: "FROZEN", frozenAt: new Date(), frozenByUserId: actorUserId },
  });
  await recordAuditEvent(tx, ctx, {
    eventType: "audit_checklist_version.frozen",
    resourceType: "audit_checklist_version",
    resourceId: frozen.id,
    summary: `Checklist version ${frozen.version} frozen.`,
    actorUserId,
    correlationId: ctx.correlationId,
    source: "web-app",
    before: { status: "DRAFT" },
    after: { status: "FROZEN" },
  });
  return frozen;
}

/** Standalone freeze action for an audit still in PREPARATION (see module docblock for the audit-start path). */
export async function freezeChecklistVersion(context: OrganisationContext, auditId: string, actorUserId: string) {
  await assertAuditExecutionAccess(context, auditId);
  const ctx = toTenantRepositoryContext(context);
  await loadAuditOrThrow(ctx, auditId);
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => freezeActiveChecklistVersionInTransaction(tx, txCtx, auditId, actorUserId));
}

// ---------------------------------------------------------------------------
// Question responses
// ---------------------------------------------------------------------------

export interface RecordQuestionResponseInput {
  result: AuditQuestionResult;
  notes?: string | null;
  auditorMembershipId: string;
  actorUserId: string;
}

async function assertReportNotIssued(ctx: TenantRepositoryContext, auditId: string) {
  const report = await prisma.auditReportRevision.findFirst({ where: tenantWhere(ctx, { auditId }) });
  if (report && report.status === "ISSUED") {
    throw new AuditChecklistError("This audit's report has been issued; its checklist responses can no longer change.");
  }
}

export async function recordQuestionResponse(context: OrganisationContext, checklistItemId: string, input: RecordQuestionResponseInput) {
  const ctx = toTenantRepositoryContext(context);
  const item = await findTenantAuditChecklistItem(ctx, checklistItemId);
  if (!item) throw new TenantOwnershipError();
  const version = await findTenantAuditChecklistVersion(ctx, item.checklistVersionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "FROZEN") {
    throw new AuditChecklistError("Only a question on a frozen checklist version can be answered.");
  }
  await assertAuditExecutionAccess(context, version.auditId);
  await assertReportNotIssued(ctx, version.auditId);

  const membership = await prisma.organisationMembership.findFirst({
    where: { id: input.auditorMembershipId, organisationId: ctx.organisationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!membership) throw new TenantOwnershipError();

  const existing = await prisma.auditQuestionResponse.findFirst({ where: tenantWhere(ctx, { checklistItemId }) });

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const response = existing
      ? await tx.auditQuestionResponse.update({
          where: { organisationId_checklistItemId: { organisationId: txCtx.organisationId, checklistItemId } },
          data: { result: input.result, notes: input.notes?.trim() || null, auditorMembershipId: input.auditorMembershipId, respondedAt: new Date() },
        })
      : await tx.auditQuestionResponse.create({
          data: {
            organisationId: txCtx.organisationId,
            checklistItemId,
            auditId: version.auditId,
            result: input.result,
            notes: input.notes?.trim() || null,
            auditorMembershipId: input.auditorMembershipId,
            respondedAt: new Date(),
          },
        });
    await recordAuditEvent(tx, txCtx, {
      eventType: existing ? "audit_question_response.updated" : "audit_question_response.recorded",
      resourceType: "audit_question_response",
      resourceId: response.id,
      summary: `Checklist question answered: ${input.result}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { checklistItemId, result: input.result },
    });
    return response;
  });
}

export async function uploadEvidenceToQuestionResponse(
  context: OrganisationContext,
  input: { checklistItemId: string; fileName: string; mimeType: string; bytes: Buffer; purpose?: string | null; actorUserId: string },
) {
  const ctx = toTenantRepositoryContext(context);
  const response = await prisma.auditQuestionResponse.findFirst({ where: tenantWhere(ctx, { checklistItemId: input.checklistItemId }) });
  if (!response) throw new TenantOwnershipError();
  await assertAuditExecutionAccess(context, response.auditId);

  const evidence = await uploadEvidenceObject(context, {
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
    uploadedByUserId: input.actorUserId,
  });
  await linkEvidence(context, {
    evidenceId: evidence.id,
    resourceType: "audit_question_response",
    resourceId: response.id,
    purpose: input.purpose,
    linkedByUserId: input.actorUserId,
  });
  return evidence;
}

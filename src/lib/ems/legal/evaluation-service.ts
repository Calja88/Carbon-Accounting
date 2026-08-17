/**
 * Compliance evaluation (task T45, Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md
 * §§1-2,6,9). Schedules and evidences the human check of whether this
 * organisation is actually meeting each ACTIVE `ComplianceObligationVersion`
 * T44 approved — a distinct question from T44's approval, which only ever
 * decides what an obligation *requires*, never whether it is being met.
 *
 * Fixed decisions this module enforces (spec §§1,9):
 *  - `recordComplianceEvaluationItemResult` is the only function that writes
 *    an item's status, and only while the parent evaluation is IN_PROGRESS —
 *    there is no default/inferred outcome anywhere in this module, so
 *    "results never auto-decided" holds architecturally;
 *  - `completeComplianceEvaluation` refuses to move an evaluation to
 *    COMPLETED while any item is still NOT_EVALUATED — every item needs an
 *    explicit human decision (including NOT_APPLICABLE) first;
 *  - once COMPLETED, items are frozen by the
 *    `compliance_evaluation_item_immutable_once_locked` trigger; once
 *    ISSUED, the evaluation itself is frozen by
 *    `compliance_evaluation_immutable_once_issued` (both defence-in-depth
 *    for the same rule this module's transition functions already enforce);
 *  - `issueComplianceEvaluation` snapshots every item's pinned, already-
 *    immutable obligation-version content into `reportPayload` — "report
 *    freezes source obligation versions" (spec §9) holds both by the
 *    obligation-version row's own T44 immutability and by this independent
 *    snapshot;
 *  - `requestComplianceEvaluationFindingLink` only ever creates an
 *    append-only request row referencing a free-text note — it never reads,
 *    writes, or references a Nonconformity/CorrectiveAction table, because
 *    those belong to T63/T64 and do not exist yet. "Noncompliance link
 *    creates a request/interface call; it does not auto-close or fabricate
 *    NC details" (spec §9) holds because there is no other write path;
 *  - only a resolved, permission-checked `OrganisationContext` can reach any
 *    exported function here — there is no AI-callable entry point, so "AI
 *    cannot set decision" holds architecturally.
 */

import type { ComplianceEvaluationItemStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, assertEntityAccess, assertSiteAccess } from "@/lib/rbac/authorize";
import {
  findTenantComplianceEvaluation,
  findTenantComplianceEvaluationItem,
  findTenantComplianceEvaluationProgramme,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { linkEvidence, uploadEvidenceObject } from "@/lib/documents/evidence-service";

export { TenantOwnershipError };

export class ComplianceEvaluationError extends Error {}

const PERFORM_PERMISSION = "ems.compliance_evaluation.perform" as const;

/** The four decided outcomes a `ComplianceEvaluationItem` can be recorded as — everything other than NOT_EVALUATED. */
export const COMPLIANCE_EVALUATION_ITEM_DECISIONS = [
  "COMPLIANT",
  "PARTIALLY_COMPLIANT",
  "NONCOMPLIANT",
  "NOT_APPLICABLE",
] as const;
export type ComplianceEvaluationItemDecision = (typeof COMPLIANCE_EVALUATION_ITEM_DECISIONS)[number];

function isComplianceEvaluationItemDecision(value: string): value is ComplianceEvaluationItemDecision {
  return (COMPLIANCE_EVALUATION_ITEM_DECISIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Programmes
// ---------------------------------------------------------------------------

export interface CreateComplianceEvaluationProgrammeInput {
  name: string;
  description?: string | null;
  periodStart: Date;
  periodEnd: Date;
  recurrence?: string | null;
  leadMembershipId: string;
  actorUserId: string;
}

async function validateMembership(context: OrganisationContext, membershipId: string) {
  const membership = await prisma.organisationMembership.findFirst({
    where: { id: membershipId, organisationId: context.organisationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!membership) throw new TenantOwnershipError();
}

function assertPeriod(periodStart: Date, periodEnd: Date) {
  if (!(periodStart instanceof Date) || Number.isNaN(periodStart.getTime())) {
    throw new ComplianceEvaluationError("Enter a valid period start date.");
  }
  if (!(periodEnd instanceof Date) || Number.isNaN(periodEnd.getTime())) {
    throw new ComplianceEvaluationError("Enter a valid period end date.");
  }
  if (periodEnd.getTime() < periodStart.getTime()) {
    throw new ComplianceEvaluationError("The period end date must be on or after the period start date.");
  }
}

export async function createComplianceEvaluationProgramme(
  context: OrganisationContext,
  input: CreateComplianceEvaluationProgrammeInput,
) {
  requirePermission(context, PERFORM_PERMISSION);
  if (!input.name.trim()) throw new ComplianceEvaluationError("Enter a programme name.");
  assertPeriod(input.periodStart, input.periodEnd);
  await validateMembership(context, input.leadMembershipId);
  const ctx = toTenantRepositoryContext(context);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const programme = await tx.complianceEvaluationProgramme.create({
      data: {
        organisationId: txCtx.organisationId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        recurrence: input.recurrence?.trim() || "ONCE",
        leadMembershipId: input.leadMembershipId,
        createdByUserId: input.actorUserId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "compliance_evaluation_programme.created",
      resourceType: "compliance_evaluation_programme",
      resourceId: programme.id,
      summary: `Compliance evaluation programme "${input.name}" created.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { name: input.name, periodStart: input.periodStart.toISOString(), periodEnd: input.periodEnd.toISOString() },
    });
    return programme;
  });
}

export async function listComplianceEvaluationProgrammes(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.complianceEvaluationProgramme.findMany({
    where: tenantWhere(ctx, {}),
    include: { lead: { include: { user: { select: { name: true } } } }, evaluations: { select: { id: true, status: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function closeComplianceEvaluationProgramme(context: OrganisationContext, programmeId: string, actorUserId: string) {
  requirePermission(context, PERFORM_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantComplianceEvaluationProgramme(ctx, programmeId);
  if (!programme) throw new TenantOwnershipError();
  if (programme.status === "CLOSED") throw new ComplianceEvaluationError("This programme is already closed.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.complianceEvaluationProgramme.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: programme.id } },
      data: { status: "CLOSED" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "compliance_evaluation_programme.closed",
      resourceType: "compliance_evaluation_programme",
      resourceId: programme.id,
      summary: "Compliance evaluation programme closed.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "ACTIVE" },
      after: { status: "CLOSED" },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Evaluations — created with an auto-populated item per in-scope ACTIVE
// obligation version.
// ---------------------------------------------------------------------------

export interface ComplianceEvaluationScopeInput {
  entityId?: string | null;
  siteId?: string | null;
}

export interface CreateComplianceEvaluationInput {
  programmeId: string;
  periodStart: Date;
  periodEnd: Date;
  leadMembershipId: string;
  scopes: ComplianceEvaluationScopeInput[];
  actorUserId: string;
}

async function validateEvaluationScopes(context: OrganisationContext, scopes: ComplianceEvaluationScopeInput[]) {
  const ctx = toTenantRepositoryContext(context);
  const validated: ComplianceEvaluationScopeInput[] = [];
  for (const scope of scopes) {
    const entityId = scope.entityId || null;
    const siteId = scope.siteId || null;
    const setCount = [entityId, siteId].filter(Boolean).length;
    if (setCount !== 1) {
      throw new ComplianceEvaluationError("Each scope row must identify exactly one entity or site.");
    }
    if (entityId) {
      assertEntityAccess(context, entityId);
      const entity = await prisma.entity.findFirst({ where: tenantWhere(ctx, { id: entityId }), select: { id: true } });
      if (!entity) throw new TenantOwnershipError();
    } else if (siteId) {
      assertSiteAccess(context, siteId);
      const site = await prisma.site.findFirst({ where: tenantWhere(ctx, { id: siteId }), select: { id: true } });
      if (!site) throw new TenantOwnershipError();
    }
    validated.push({ entityId, siteId });
  }
  return validated;
}

/**
 * The ACTIVE obligation versions an evaluation should cover: every ACTIVE
 * version if the evaluation carries no scope rows (an organisation-wide
 * cycle), otherwise only versions with at least one
 * `ComplianceObligationVersionScope` row matching one of the evaluation's
 * entity/site ids.
 */
async function resolveObligationVersionsForScope(
  ctx: ReturnType<typeof toTenantRepositoryContext>,
  scopes: ComplianceEvaluationScopeInput[],
) {
  if (scopes.length === 0) {
    return prisma.complianceObligationVersion.findMany({ where: tenantWhere(ctx, { status: "ACTIVE" as const }) });
  }
  const entityIds = scopes.map((s) => s.entityId).filter((id): id is string => Boolean(id));
  const siteIds = scopes.map((s) => s.siteId).filter((id): id is string => Boolean(id));
  return prisma.complianceObligationVersion.findMany({
    where: tenantWhere(ctx, {
      status: "ACTIVE" as const,
      scopes: { some: { OR: [...(entityIds.length ? [{ entityId: { in: entityIds } }] : []), ...(siteIds.length ? [{ siteId: { in: siteIds } }] : [])] } },
    }),
  });
}

export async function createComplianceEvaluation(context: OrganisationContext, input: CreateComplianceEvaluationInput) {
  requirePermission(context, PERFORM_PERMISSION);
  assertPeriod(input.periodStart, input.periodEnd);
  await validateMembership(context, input.leadMembershipId);
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantComplianceEvaluationProgramme(ctx, input.programmeId);
  if (!programme) throw new TenantOwnershipError();
  if (programme.status !== "ACTIVE") throw new ComplianceEvaluationError("Only an active programme can start a new evaluation.");
  const scopes = await validateEvaluationScopes(context, input.scopes);
  const obligationVersions = await resolveObligationVersionsForScope(ctx, scopes);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const evaluation = await tx.complianceEvaluation.create({
      data: {
        organisationId: txCtx.organisationId,
        programmeId: programme.id,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        leadMembershipId: input.leadMembershipId,
        createdByUserId: input.actorUserId,
        scopes: { create: scopes.map((scope) => ({ organisationId: txCtx.organisationId, ...scope })) },
        items: {
          create: obligationVersions.map((version) => ({
            organisationId: txCtx.organisationId,
            obligationVersionId: version.id,
          })),
        },
      },
      include: { scopes: true, items: true },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "compliance_evaluation.created",
      resourceType: "compliance_evaluation",
      resourceId: evaluation.id,
      summary: `Compliance evaluation created with ${obligationVersions.length} obligation version(s) in scope.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { programmeId: programme.id, itemCount: obligationVersions.length },
    });

    return evaluation;
  });
}

const evaluationDetailInclude = {
  programme: { select: { name: true } },
  lead: { include: { user: { select: { name: true } } } },
  scopes: {
    include: {
      entity: { select: { id: true, name: true } },
      site: { select: { id: true, name: true } },
    },
  },
  items: {
    include: {
      obligationVersion: { include: { instrument: { select: { title: true } }, obligation: { select: { id: true } } } },
      evaluator: { include: { user: { select: { name: true } } } },
      findingLinks: { orderBy: { requestedAt: "desc" as const } },
    },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

export async function listComplianceEvaluations(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.complianceEvaluation.findMany({
    where: tenantWhere(ctx, {}),
    include: evaluationDetailInclude,
    orderBy: { createdAt: "desc" },
  });
}

export async function getComplianceEvaluation(context: OrganisationContext, evaluationId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const evaluation = await findTenantComplianceEvaluation(ctx, evaluationId);
  if (!evaluation) throw new TenantOwnershipError();
  return prisma.complianceEvaluation.findUnique({ where: { id: evaluation.id }, include: evaluationDetailInclude });
}

// ---------------------------------------------------------------------------
// Evaluation lifecycle
// ---------------------------------------------------------------------------

export async function startComplianceEvaluation(context: OrganisationContext, evaluationId: string, actorUserId: string) {
  requirePermission(context, PERFORM_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const evaluation = await findTenantComplianceEvaluation(ctx, evaluationId);
  if (!evaluation) throw new TenantOwnershipError();
  if (evaluation.status !== "PLANNED") throw new ComplianceEvaluationError("Only a planned evaluation can be started.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.complianceEvaluation.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: evaluation.id } },
      data: { status: "IN_PROGRESS" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "compliance_evaluation.started",
      resourceType: "compliance_evaluation",
      resourceId: evaluation.id,
      summary: "Compliance evaluation started.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "PLANNED" },
      after: { status: "IN_PROGRESS" },
    });
    return updated;
  });
}

export interface RecordComplianceEvaluationItemResultInput {
  status: ComplianceEvaluationItemDecision;
  rationale: string;
  followUpDate?: Date | null;
  actorUserId: string;
}

/** Records one item's outcome. The only function in this module that writes `ComplianceEvaluationItem.status` — see module docblock. */
export async function recordComplianceEvaluationItemResult(
  context: OrganisationContext,
  evaluationItemId: string,
  input: RecordComplianceEvaluationItemResultInput,
) {
  requirePermission(context, PERFORM_PERMISSION);
  if (!isComplianceEvaluationItemDecision(input.status)) throw new ComplianceEvaluationError("Choose a valid outcome.");
  if (!input.rationale.trim()) throw new ComplianceEvaluationError("Enter a rationale for this outcome.");

  const ctx = toTenantRepositoryContext(context);
  const item = await findTenantComplianceEvaluationItem(ctx, evaluationItemId);
  if (!item) throw new TenantOwnershipError();
  const evaluation = await findTenantComplianceEvaluation(ctx, item.evaluationId);
  if (!evaluation) throw new TenantOwnershipError();
  if (evaluation.status !== "IN_PROGRESS") {
    throw new ComplianceEvaluationError("Item outcomes can only be recorded while the evaluation is in progress.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.complianceEvaluationItem.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: item.id } },
      data: {
        status: input.status,
        rationale: input.rationale.trim(),
        evaluatorMembershipId: context.membershipId,
        evaluatedAt: new Date(),
        followUpDate: input.followUpDate ?? null,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "compliance_evaluation_item.recorded",
      resourceType: "compliance_evaluation_item",
      resourceId: item.id,
      summary: `Compliance evaluation item outcome recorded: ${input.status}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: item.status },
      after: { status: input.status },
    });
    return updated;
  });
}

export async function attachEvidenceToComplianceEvaluationItem(
  context: OrganisationContext,
  input: { evaluationItemId: string; evidenceId: string; purpose?: string | null; actorUserId: string },
) {
  requirePermission(context, PERFORM_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const item = await findTenantComplianceEvaluationItem(ctx, input.evaluationItemId);
  if (!item) throw new TenantOwnershipError();
  const evaluation = await findTenantComplianceEvaluation(ctx, item.evaluationId);
  if (!evaluation) throw new TenantOwnershipError();
  if (evaluation.status !== "IN_PROGRESS") {
    throw new ComplianceEvaluationError("Evidence can only be attached while the evaluation is in progress.");
  }
  return linkEvidence(context, {
    evidenceId: input.evidenceId,
    resourceType: "compliance_evaluation_item",
    resourceId: item.id,
    purpose: input.purpose,
    linkedByUserId: input.actorUserId,
  });
}

export async function uploadEvidenceToComplianceEvaluationItem(
  context: OrganisationContext,
  input: { evaluationItemId: string; fileName: string; mimeType: string; bytes: Buffer; purpose?: string | null; actorUserId: string },
) {
  requirePermission(context, PERFORM_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const item = await findTenantComplianceEvaluationItem(ctx, input.evaluationItemId);
  if (!item) throw new TenantOwnershipError();
  const evaluation = await findTenantComplianceEvaluation(ctx, item.evaluationId);
  if (!evaluation) throw new TenantOwnershipError();
  if (evaluation.status !== "IN_PROGRESS") {
    throw new ComplianceEvaluationError("Evidence can only be attached while the evaluation is in progress.");
  }
  const evidence = await uploadEvidenceObject(context, {
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
    uploadedByUserId: input.actorUserId,
  });
  await linkEvidence(context, {
    evidenceId: evidence.id,
    resourceType: "compliance_evaluation_item",
    resourceId: item.id,
    purpose: input.purpose,
    linkedByUserId: input.actorUserId,
  });
  return evidence;
}

// ---------------------------------------------------------------------------
// Finding-link interface — T63/T64 do not exist yet; see module docblock.
// ---------------------------------------------------------------------------

export interface RequestComplianceEvaluationFindingLinkInput {
  linkType: "NONCONFORMITY" | "CORRECTIVE_ACTION";
  referenceNote: string;
  actorUserId: string;
}

export async function requestComplianceEvaluationFindingLink(
  context: OrganisationContext,
  evaluationItemId: string,
  input: RequestComplianceEvaluationFindingLinkInput,
) {
  requirePermission(context, PERFORM_PERMISSION);
  if (!input.referenceNote.trim()) throw new ComplianceEvaluationError("Enter a reference note.");
  const ctx = toTenantRepositoryContext(context);
  const item = await findTenantComplianceEvaluationItem(ctx, evaluationItemId);
  if (!item) throw new TenantOwnershipError();
  if (item.status !== "NONCOMPLIANT" && item.status !== "PARTIALLY_COMPLIANT") {
    throw new ComplianceEvaluationError("A finding link can only be requested for a noncompliant or partially compliant item.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const link = await tx.complianceEvaluationFindingLink.create({
      data: {
        organisationId: txCtx.organisationId,
        evaluationItemId: item.id,
        linkType: input.linkType,
        referenceNote: input.referenceNote.trim(),
        requestedByMembershipId: context.membershipId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "compliance_evaluation_finding_link.requested",
      resourceType: "compliance_evaluation_finding_link",
      resourceId: link.id,
      summary: `${input.linkType === "NONCONFORMITY" ? "Nonconformity" : "Corrective action"} link requested for evaluation item ${item.id}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { evaluationItemId: item.id, linkType: input.linkType },
    });
    return link;
  });
}

// ---------------------------------------------------------------------------
// Completion and issue
// ---------------------------------------------------------------------------

export async function completeComplianceEvaluation(context: OrganisationContext, evaluationId: string, actorUserId: string) {
  requirePermission(context, PERFORM_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const evaluation = await findTenantComplianceEvaluation(ctx, evaluationId);
  if (!evaluation) throw new TenantOwnershipError();
  if (evaluation.status !== "IN_PROGRESS") throw new ComplianceEvaluationError("Only an in-progress evaluation can be completed.");

  const items = await prisma.complianceEvaluationItem.findMany({ where: tenantWhere(ctx, { evaluationId: evaluation.id }) });
  if (items.length === 0) throw new ComplianceEvaluationError("This evaluation has no items to evaluate.");
  const outstanding = items.filter((item) => item.status === "NOT_EVALUATED");
  if (outstanding.length > 0) {
    throw new ComplianceEvaluationError(`${outstanding.length} item(s) still need a recorded outcome before this evaluation can be completed.`);
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.complianceEvaluation.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: evaluation.id } },
      data: { status: "COMPLETED" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "compliance_evaluation.completed",
      resourceType: "compliance_evaluation",
      resourceId: evaluation.id,
      summary: "Compliance evaluation completed — every item has a recorded outcome.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "IN_PROGRESS" },
      after: { status: "COMPLETED" },
    });
    return updated;
  });
}

interface ReportPayloadItem {
  itemId: string;
  status: ComplianceEvaluationItemStatus;
  rationale: string | null;
  evaluatedAt: string | null;
  obligationVersionId: string;
  obligationVersion: number;
  obligationTitle: string;
  obligationRequirementSummary: string;
}

/**
 * Moves a COMPLETED evaluation to ISSUED, snapshotting every item's pinned
 * obligation-version content into `reportPayload` (spec §9/§11 "report
 * freezes source obligation versions"). Nothing else in this module writes
 * `reportPayload`/`issuedAt`/`issuedByUserId`.
 */
export async function issueComplianceEvaluation(context: OrganisationContext, evaluationId: string, actorUserId: string) {
  requirePermission(context, PERFORM_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const evaluation = await findTenantComplianceEvaluation(ctx, evaluationId);
  if (!evaluation) throw new TenantOwnershipError();
  if (evaluation.status !== "COMPLETED") throw new ComplianceEvaluationError("Only a completed evaluation can be issued.");

  const items = await prisma.complianceEvaluationItem.findMany({
    where: tenantWhere(ctx, { evaluationId: evaluation.id }),
    include: { obligationVersion: true },
  });

  const reportPayload: { issuedAt: string; items: ReportPayloadItem[] } = {
    issuedAt: new Date().toISOString(),
    items: items.map((item) => ({
      itemId: item.id,
      status: item.status,
      rationale: item.rationale,
      evaluatedAt: item.evaluatedAt ? item.evaluatedAt.toISOString() : null,
      obligationVersionId: item.obligationVersionId,
      obligationVersion: item.obligationVersion.version,
      obligationTitle: item.obligationVersion.title,
      obligationRequirementSummary: item.obligationVersion.requirementSummary,
    })),
  };

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.complianceEvaluation.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: evaluation.id } },
      data: {
        status: "ISSUED",
        issuedAt: new Date(),
        issuedByUserId: actorUserId,
        reportPayload: reportPayload as unknown as Prisma.InputJsonValue,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "compliance_evaluation.issued",
      resourceType: "compliance_evaluation",
      resourceId: evaluation.id,
      summary: `Compliance evaluation issued, pinning ${reportPayload.items.length} obligation version(s).`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "COMPLETED" },
      after: { status: "ISSUED" },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Overdue/unevaluated visibility (spec §9 "overdue/unevaluated obligations
// are visible") — read-only.
// ---------------------------------------------------------------------------

export interface OverdueOrUnevaluatedObligation {
  obligationVersionId: string;
  obligationId: string;
  title: string;
  version: number;
  reviewDueDate: Date | null;
  reviewOverdue: boolean;
  neverEvaluated: boolean;
  latestItemStatus: ComplianceEvaluationItemStatus | null;
}

/**
 * Every ACTIVE obligation version that is either past its own
 * `reviewDueDate`, or has never been given a decided evaluation-item outcome
 * (its most recent item, if any, is still NOT_EVALUATED). Read-only — this
 * is visibility, not a gate on anything.
 */
export async function listOverdueOrUnevaluatedObligations(context: OrganisationContext): Promise<OverdueOrUnevaluatedObligation[]> {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const now = new Date();

  const activeVersions = await prisma.complianceObligationVersion.findMany({
    where: tenantWhere(ctx, { status: "ACTIVE" as const }),
    include: {
      evaluationItems: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true },
      },
    },
  });

  const rows: OverdueOrUnevaluatedObligation[] = activeVersions.map((version) => {
    const latestItem = version.evaluationItems[0] ?? null;
    const reviewOverdue = version.reviewDueDate ? version.reviewDueDate.getTime() < now.getTime() : false;
    const neverEvaluated = !latestItem || latestItem.status === "NOT_EVALUATED";
    return {
      obligationVersionId: version.id,
      obligationId: version.obligationId,
      title: version.title,
      version: version.version,
      reviewDueDate: version.reviewDueDate,
      reviewOverdue,
      neverEvaluated,
      latestItemStatus: latestItem?.status ?? null,
    };
  });

  return rows.filter((row) => row.reviewOverdue || row.neverEvaluated);
}

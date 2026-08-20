/**
 * Nonconformity workflow (task T63, extended by T64 for the closure gate —
 * see `root-cause-service.ts`, `corrective-action-service.ts` and
 * `effectiveness-service.ts` for the rest of the T64 state machine),
 * Docs/PHASE6_AUDIT_INCIDENT_CAPA_SPEC.md §§1-3,6-9. Depends on T61
 * (`AuditFinding`), T62 (`EnvironmentalIncident`) and T45
 * (`ComplianceEvaluationItem`/`ComplianceEvaluationFindingLink`). Full state
 * machine per spec §2 (this module only ever writes OPEN/CONTAINED/CLOSED/
 * REOPENED directly — ROOT_CAUSE_APPROVED/ACTIONS_IN_PROGRESS/
 * EFFECTIVENESS_REVIEW are written by the T64 services above):
 *
 *   OPEN -> CONTAINED -> ROOT_CAUSE_APPROVED -> ACTIONS_IN_PROGRESS
 *     -> EFFECTIVENESS_REVIEW -> CLOSED / REOPENED
 *
 * Fixed decisions this module enforces (spec §§1,4,8, T63/T64 acceptance):
 *  - `createNonconformityFromSource` always requires a source (type + id, or
 *    a free-text reference note when the source type has no backing model
 *    yet) and a requirement reference — a nonconformity can never be created
 *    without both;
 *  - for source types with a backing model in this codebase
 *    (`AUDIT_FINDING`, `INCIDENT`, `COMPLIANCE_EVALUATION_ITEM`,
 *    `CONTROL_CHECK`) `sourceId` is validated against that model in the same
 *    Organisation before the row is created — see
 *    `resolveAndValidateSource`;
 *  - `linkAdditionalSourceToNonconformity` records a further source against
 *    an *existing* Nonconformity instead of spawning a second one, so a
 *    duplicate finding/incident/evaluation item is linked without losing its
 *    own traceability (spec acceptance: "duplicate linking supported without
 *    losing source traceability");
 *  - containment is captured via `ContainmentRecord`, separate from root
 *    cause/corrective action/effectiveness review, which live in their own
 *    T64 modules;
 *  - every status transition is audited (`recordAuditEvent`);
 *  - `closeNonconformity` checks the organisation's
 *    `NonconformityClosurePolicy` live, on every call, against the real T64
 *    models: `requireRootCauseApproval` needs an approved
 *    `RootCauseAnalysis`, `requireCorrectiveActionsComplete` needs every
 *    non-cancelled `CorrectiveAction` COMPLETED/VERIFIED, and
 *    `requireEffectivenessReview` needs the most recent
 *    `EffectivenessReview` to be `EFFECTIVE` (T64 acceptance: "ineffective
 *    outcome ... it cannot close"). When only `requireContainment` applies,
 *    closing is only possible once an adequate containment record exists
 *    (T63 acceptance: "closing is impossible without configured mandatory
 *    steps").
 */

import { prisma } from "@/lib/prisma";
import type { NonconformitySourceType } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import {
  findTenantAuditFinding,
  findTenantEnvironmentalIncident,
  findTenantComplianceEvaluationItem,
  findTenantControlCheck,
  findTenantComplianceObligation,
  findTenantOperationalControl,
  findTenantNonconformityClassification,
  findTenantNonconformity,
  findTenantContainmentRecord,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { linkEvidence, uploadEvidenceObject } from "@/lib/documents/evidence-service";

export { TenantOwnershipError };

export class NonconformityError extends Error {}

export const NONCONFORMITY_MANAGE_PERMISSION = "ems.nonconformity.manage" as const;

/** Source types backed by an existing model, whose `sourceId` is FK-validated. */
const SOURCE_TYPES_WITH_MODEL: ReadonlySet<NonconformitySourceType> = new Set([
  "AUDIT_FINDING",
  "INCIDENT",
  "COMPLIANCE_EVALUATION_ITEM",
  "CONTROL_CHECK",
]);

/**
 * Validates a source reference before it is recorded against a
 * Nonconformity. Source types with a backing model require `sourceId` and
 * check it belongs to the same Organisation; `COMPLAINT`/`MANUAL` have no
 * backing model in this codebase, so they require `sourceReferenceNote`
 * instead (spec acceptance: "source linkage ... required for each
 * nonconformity" — one or the other must always be present).
 */
async function resolveAndValidateSource(
  ctx: ReturnType<typeof toTenantRepositoryContext>,
  input: { sourceType: NonconformitySourceType; sourceId?: string | null; sourceReferenceNote?: string | null },
): Promise<void> {
  if (SOURCE_TYPES_WITH_MODEL.has(input.sourceType)) {
    if (!input.sourceId?.trim()) {
      throw new NonconformityError(`Choose the ${input.sourceType.toLowerCase().replace(/_/g, " ")} this nonconformity comes from.`);
    }
    switch (input.sourceType) {
      case "AUDIT_FINDING": {
        const row = await findTenantAuditFinding(ctx, input.sourceId);
        if (!row) throw new TenantOwnershipError();
        break;
      }
      case "INCIDENT": {
        const row = await findTenantEnvironmentalIncident(ctx, input.sourceId);
        if (!row) throw new TenantOwnershipError();
        break;
      }
      case "COMPLIANCE_EVALUATION_ITEM": {
        const row = await findTenantComplianceEvaluationItem(ctx, input.sourceId);
        if (!row) throw new TenantOwnershipError();
        break;
      }
      case "CONTROL_CHECK": {
        const row = await findTenantControlCheck(ctx, input.sourceId);
        if (!row) throw new TenantOwnershipError();
        break;
      }
    }
    return;
  }
  // COMPLAINT / MANUAL: no backing model. sourceId, if given at all, is not
  // validated against anything — a free-text reference note is required
  // instead so the source is still traceable.
  if (!input.sourceReferenceNote?.trim()) {
    throw new NonconformityError("Enter a source reference note describing where this nonconformity came from.");
  }
}

// ---------------------------------------------------------------------------
// Classification — organisation-configurable (T62 severity-level convention).
// ---------------------------------------------------------------------------

export interface CreateNonconformityClassificationInput {
  key: string;
  label: string;
  rank: number;
  actorUserId: string;
}

export async function createNonconformityClassification(context: OrganisationContext, input: CreateNonconformityClassificationInput) {
  requirePermission(context, NONCONFORMITY_MANAGE_PERMISSION);
  if (!input.key.trim()) throw new NonconformityError("Enter a classification key.");
  if (!input.label.trim()) throw new NonconformityError("Enter a classification label.");

  const existing = await prisma.nonconformityClassification.findFirst({
    where: { organisationId: context.organisationId, key: input.key.trim() },
  });
  if (existing) throw new NonconformityError(`A classification with key "${input.key}" already exists.`);

  return prisma.nonconformityClassification.create({
    data: {
      organisationId: context.organisationId,
      key: input.key.trim(),
      label: input.label.trim(),
      rank: input.rank,
      createdByUserId: input.actorUserId,
    },
  });
}

export async function listNonconformityClassifications(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.nonconformityClassification.findMany({
    where: tenantWhere(ctx, { isActive: true }),
    orderBy: { rank: "asc" },
  });
}

export async function deactivateNonconformityClassification(context: OrganisationContext, classificationId: string) {
  requirePermission(context, NONCONFORMITY_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const classification = await findTenantNonconformityClassification(ctx, classificationId);
  if (!classification) throw new TenantOwnershipError();
  return prisma.nonconformityClassification.update({
    where: { organisationId_id: { organisationId: ctx.organisationId, id: classification.id } },
    data: { isActive: false },
  });
}

export async function assignNonconformityClassification(context: OrganisationContext, nonconformityId: string, classificationId: string, actorUserId: string) {
  requirePermission(context, NONCONFORMITY_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const nonconformity = await findTenantNonconformity(ctx, nonconformityId);
  if (!nonconformity) throw new TenantOwnershipError();
  const classification = await findTenantNonconformityClassification(ctx, classificationId);
  if (!classification) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.nonconformity.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: nonconformity.id } },
      data: {
        classificationId: classification.id,
        classificationConfigSnapshot: { key: classification.key, label: classification.label, rank: classification.rank },
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "nonconformity.classified",
      resourceType: "nonconformity",
      resourceId: nonconformity.id,
      summary: `Nonconformity "${nonconformity.reference}" classified as "${classification.label}".`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { classificationKey: classification.key },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Closure policy — single row per Organisation (T63 acceptance: "closing is
// impossible without configured mandatory steps").
// ---------------------------------------------------------------------------

export interface UpsertNonconformityClosurePolicyInput {
  requireContainment?: boolean;
  requireRootCauseApproval?: boolean;
  requireCorrectiveActionsComplete?: boolean;
  requireEffectivenessReview?: boolean;
  actorUserId: string;
}

export async function upsertNonconformityClosurePolicy(context: OrganisationContext, input: UpsertNonconformityClosurePolicyInput) {
  requirePermission(context, NONCONFORMITY_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const existing = await prisma.nonconformityClosurePolicy.findFirst({ where: tenantWhere(ctx, {}) });
  const data = {
    requireContainment: input.requireContainment ?? true,
    requireRootCauseApproval: input.requireRootCauseApproval ?? false,
    requireCorrectiveActionsComplete: input.requireCorrectiveActionsComplete ?? false,
    requireEffectivenessReview: input.requireEffectivenessReview ?? false,
    updatedByUserId: input.actorUserId,
  };
  if (existing) {
    return prisma.nonconformityClosurePolicy.update({
      where: { id: existing.id },
      data,
    });
  }
  return prisma.nonconformityClosurePolicy.create({
    data: { organisationId: ctx.organisationId, ...data },
  });
}

export async function getNonconformityClosurePolicy(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const existing = await prisma.nonconformityClosurePolicy.findFirst({ where: tenantWhere(ctx, {}) });
  // Same default as the schema column default: containment required,
  // nothing else — an organisation that has never configured a policy still
  // gets a real, enforced default rather than an unguarded close.
  return (
    existing ?? {
      requireContainment: true,
      requireRootCauseApproval: false,
      requireCorrectiveActionsComplete: false,
      requireEffectivenessReview: false,
    }
  );
}

// ---------------------------------------------------------------------------
// Nonconformity creation and source linkage
// ---------------------------------------------------------------------------

export interface CreateNonconformityFromSourceInput {
  reference: string;
  sourceType: NonconformitySourceType;
  sourceId?: string | null;
  sourceReferenceNote?: string | null;
  statement: string;
  requirementReference: string;
  complianceObligationId?: string | null;
  operationalControlId?: string | null;
  classificationId?: string | null;
  ownerMembershipId?: string | null;
  dueDate?: Date | null;
  actorUserId: string;
}

/**
 * Creates a new Nonconformity from a source (spec §6 interface
 * `createNonconformityFromSource`). Always lands in `OPEN` with the given
 * source recorded both on the row itself and as the primary
 * `NonconformitySourceLink` — see the module docblock for why source and
 * requirement reference are always required.
 */
export async function createNonconformityFromSource(context: OrganisationContext, input: CreateNonconformityFromSourceInput) {
  requirePermission(context, NONCONFORMITY_MANAGE_PERMISSION);
  if (!input.reference.trim()) throw new NonconformityError("Enter a nonconformity reference.");
  if (!input.statement.trim()) throw new NonconformityError("Describe the nonconformity.");
  if (!input.requirementReference.trim()) throw new NonconformityError("Enter the requirement reference.");

  const ctx = toTenantRepositoryContext(context);
  await resolveAndValidateSource(ctx, input);

  const duplicateReference = await prisma.nonconformity.findFirst({
    where: tenantWhere(ctx, { reference: input.reference.trim() }),
  });
  if (duplicateReference) throw new NonconformityError(`A nonconformity with reference "${input.reference}" already exists.`);

  if (input.complianceObligationId) {
    const obligation = await findTenantComplianceObligation(ctx, input.complianceObligationId);
    if (!obligation) throw new TenantOwnershipError();
  }
  if (input.operationalControlId) {
    const control = await findTenantOperationalControl(ctx, input.operationalControlId);
    if (!control) throw new TenantOwnershipError();
  }
  let classificationSnapshot: { key: string; label: string; rank: number } | null = null;
  if (input.classificationId) {
    const classification = await findTenantNonconformityClassification(ctx, input.classificationId);
    if (!classification) throw new TenantOwnershipError();
    classificationSnapshot = { key: classification.key, label: classification.label, rank: classification.rank };
  }
  if (input.ownerMembershipId) {
    const owner = await prisma.organisationMembership.findFirst({
      where: { id: input.ownerMembershipId, organisationId: ctx.organisationId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!owner) throw new TenantOwnershipError();
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const nonconformity = await tx.nonconformity.create({
      data: {
        organisationId: txCtx.organisationId,
        reference: input.reference.trim(),
        sourceType: input.sourceType,
        sourceId: input.sourceId?.trim() || null,
        sourceReferenceNote: input.sourceReferenceNote?.trim() || null,
        statement: input.statement.trim(),
        requirementReference: input.requirementReference.trim(),
        complianceObligationId: input.complianceObligationId || null,
        operationalControlId: input.operationalControlId || null,
        classificationId: input.classificationId || null,
        classificationConfigSnapshot: classificationSnapshot ?? undefined,
        ownerMembershipId: input.ownerMembershipId || null,
        dueDate: input.dueDate ?? null,
        createdByUserId: input.actorUserId,
      },
    });
    await tx.nonconformitySourceLink.create({
      data: {
        organisationId: txCtx.organisationId,
        nonconformityId: nonconformity.id,
        sourceType: input.sourceType,
        sourceId: input.sourceId?.trim() || null,
        sourceReferenceNote: input.sourceReferenceNote?.trim() || null,
        isPrimary: true,
        linkedByMembershipId: context.membershipId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "nonconformity.created",
      resourceType: "nonconformity",
      resourceId: nonconformity.id,
      summary: `Nonconformity "${input.reference}" created from ${input.sourceType}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { reference: input.reference, sourceType: input.sourceType, sourceId: input.sourceId ?? null },
    });
    return nonconformity;
  });
}

export interface LinkAdditionalSourceInput {
  sourceType: NonconformitySourceType;
  sourceId?: string | null;
  sourceReferenceNote?: string | null;
  actorUserId: string;
}

/**
 * Links a further source to an existing Nonconformity instead of creating a
 * second record for what turns out to be the same underlying issue (spec
 * acceptance: "duplicate linking supported without losing source
 * traceability"). The new source is validated exactly like a creating
 * source, then recorded as a non-primary `NonconformitySourceLink` — the
 * Nonconformity's own `sourceType`/`sourceId` (its original, primary source)
 * are never overwritten.
 */
export async function linkAdditionalSourceToNonconformity(context: OrganisationContext, nonconformityId: string, input: LinkAdditionalSourceInput) {
  requirePermission(context, NONCONFORMITY_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const nonconformity = await findTenantNonconformity(ctx, nonconformityId);
  if (!nonconformity) throw new TenantOwnershipError();
  await resolveAndValidateSource(ctx, input);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const link = await tx.nonconformitySourceLink.create({
      data: {
        organisationId: txCtx.organisationId,
        nonconformityId: nonconformity.id,
        sourceType: input.sourceType,
        sourceId: input.sourceId?.trim() || null,
        sourceReferenceNote: input.sourceReferenceNote?.trim() || null,
        isPrimary: false,
        linkedByMembershipId: context.membershipId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "nonconformity_source_link.created",
      resourceType: "nonconformity_source_link",
      resourceId: link.id,
      summary: `Additional source (${input.sourceType}) linked to nonconformity "${nonconformity.reference}".`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { nonconformityId: nonconformity.id, sourceType: input.sourceType, sourceId: input.sourceId ?? null },
    });
    return link;
  });
}

/** Every source (primary and duplicate) ever linked to a Nonconformity. */
export async function listNonconformitySourceLinks(context: OrganisationContext, nonconformityId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const nonconformity = await findTenantNonconformity(ctx, nonconformityId);
  if (!nonconformity) throw new TenantOwnershipError();
  return prisma.nonconformitySourceLink.findMany({
    where: tenantWhere(ctx, { nonconformityId: nonconformity.id }),
    orderBy: { linkedAt: "asc" },
  });
}

export async function getNonconformity(context: OrganisationContext, nonconformityId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const nonconformity = await findTenantNonconformity(ctx, nonconformityId);
  if (!nonconformity) throw new TenantOwnershipError();
  const [sourceLinks, containmentRecords] = await Promise.all([
    prisma.nonconformitySourceLink.findMany({ where: tenantWhere(ctx, { nonconformityId: nonconformity.id }), orderBy: { linkedAt: "asc" } }),
    prisma.containmentRecord.findMany({ where: tenantWhere(ctx, { nonconformityId: nonconformity.id }), orderBy: { createdAt: "asc" } }),
  ]);
  return { ...nonconformity, sourceLinks, containmentRecords };
}

export async function listNonconformities(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.nonconformity.findMany({
    where: tenantWhere(ctx, {}),
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Containment
// ---------------------------------------------------------------------------

export interface RecordContainmentInput {
  actionTaken: string;
  actionTakenAt: Date;
  ownerMembershipId: string;
  actorUserId: string;
}

/**
 * Records a containment action against a Nonconformity and (on the first
 * containment record while `OPEN`) moves it to `CONTAINED`. Root cause,
 * corrective action and effectiveness review are separate decisions handled
 * by the T64 services — only containment and its own adequacy review are
 * captured here. Also accepted while `REOPENED` (T64: a nonconformity sent
 * back for remediation by an ineffective effectiveness review may need a
 * fresh containment record before it re-enters the root-cause/action cycle).
 */
export async function recordContainment(context: OrganisationContext, nonconformityId: string, input: RecordContainmentInput) {
  requirePermission(context, NONCONFORMITY_MANAGE_PERMISSION);
  if (!input.actionTaken.trim()) throw new NonconformityError("Describe the containment action taken.");
  const ctx = toTenantRepositoryContext(context);
  const nonconformity = await findTenantNonconformity(ctx, nonconformityId);
  if (!nonconformity) throw new TenantOwnershipError();
  if (!["OPEN", "CONTAINED", "REOPENED"].includes(nonconformity.status)) {
    throw new NonconformityError(`Containment cannot be recorded while the nonconformity is ${nonconformity.status}.`);
  }
  const owner = await prisma.organisationMembership.findFirst({
    where: { id: input.ownerMembershipId, organisationId: ctx.organisationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!owner) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const containment = await tx.containmentRecord.create({
      data: {
        organisationId: txCtx.organisationId,
        nonconformityId: nonconformity.id,
        actionTaken: input.actionTaken.trim(),
        actionTakenAt: input.actionTakenAt,
        ownerMembershipId: input.ownerMembershipId,
        createdByUserId: input.actorUserId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "containment_record.created",
      resourceType: "containment_record",
      resourceId: containment.id,
      summary: `Containment recorded for nonconformity "${nonconformity.reference}".`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { nonconformityId: nonconformity.id },
    });
    if (nonconformity.status === "OPEN") {
      await tx.nonconformity.update({
        where: { organisationId_id: { organisationId: txCtx.organisationId, id: nonconformity.id } },
        data: { status: "CONTAINED" },
      });
      await recordAuditEvent(tx, txCtx, {
        eventType: "nonconformity.contained",
        resourceType: "nonconformity",
        resourceId: nonconformity.id,
        summary: `Nonconformity "${nonconformity.reference}" moved from OPEN to CONTAINED.`,
        actorUserId: input.actorUserId,
        correlationId: txCtx.correlationId,
        source: "web-app",
        before: { status: "OPEN" },
        after: { status: "CONTAINED" },
      });
    }
    return containment;
  });
}

export interface ReviewContainmentAdequacyInput {
  adequate: boolean;
  notes?: string | null;
  actorUserId: string;
}

export async function reviewContainmentAdequacy(context: OrganisationContext, containmentId: string, input: ReviewContainmentAdequacyInput) {
  requirePermission(context, NONCONFORMITY_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const containment = await findTenantContainmentRecord(ctx, containmentId);
  if (!containment) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.containmentRecord.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: containment.id } },
      data: {
        adequacyReviewed: true,
        adequate: input.adequate,
        adequacyReviewNotes: input.notes?.trim() || null,
        adequacyReviewerMembershipId: context.membershipId,
        adequacyReviewedAt: new Date(),
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "containment_record.adequacy_reviewed",
      resourceType: "containment_record",
      resourceId: containment.id,
      summary: `Containment adequacy reviewed: ${input.adequate ? "adequate" : "not adequate"}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { adequate: input.adequate },
    });
    return updated;
  });
}

export async function uploadEvidenceToNonconformity(
  context: OrganisationContext,
  input: { nonconformityId: string; fileName: string; mimeType: string; bytes: Buffer; purpose?: string | null; actorUserId: string },
) {
  requirePermission(context, NONCONFORMITY_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const nonconformity = await findTenantNonconformity(ctx, input.nonconformityId);
  if (!nonconformity) throw new TenantOwnershipError();

  const evidence = await uploadEvidenceObject(context, {
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
    uploadedByUserId: input.actorUserId,
  });
  await linkEvidence(context, {
    evidenceId: evidence.id,
    resourceType: "nonconformity",
    resourceId: nonconformity.id,
    purpose: input.purpose,
    linkedByUserId: input.actorUserId,
  });
  return evidence;
}

// ---------------------------------------------------------------------------
// Closure and reopen
// ---------------------------------------------------------------------------

/** Statuses a nonconformity may be closed directly from (spec §2 state machine: OPEN -> CONTAINED -> ... -> EFFECTIVENESS_REVIEW -> CLOSED). */
const CLOSABLE_STATUSES = new Set(["OPEN", "CONTAINED", "EFFECTIVENESS_REVIEW"]);

/**
 * Throws with a typed reason unless every step the organisation's
 * `NonconformityClosurePolicy` marks mandatory is satisfied. Checked live,
 * on every call — a permission or policy change since the record last moved
 * takes effect immediately (T64 acceptance: "closure permission checked
 * live"). `requireRootCauseApproval`/`requireCorrectiveActionsComplete`/
 * `requireEffectivenessReview` are backed by the real T64 models
 * (`root-cause-service.ts`, `corrective-action-service.ts`,
 * `effectiveness-service.ts`) — this function only reads their state, it
 * never mutates it.
 */
async function assertMandatoryCloseStepsComplete(
  ctx: ReturnType<typeof toTenantRepositoryContext>,
  nonconformity: { id: string; status: string },
): Promise<void> {
  const policy = await prisma.nonconformityClosurePolicy.findFirst({ where: tenantWhere(ctx, {}) });
  const requireContainment = policy?.requireContainment ?? true;
  const requireRootCauseApproval = policy?.requireRootCauseApproval ?? false;
  const requireCorrectiveActionsComplete = policy?.requireCorrectiveActionsComplete ?? false;
  const requireEffectivenessReview = policy?.requireEffectivenessReview ?? false;

  if (requireContainment) {
    const containmentRecords = await prisma.containmentRecord.findMany({ where: tenantWhere(ctx, { nonconformityId: nonconformity.id }) });
    const hasAdequateContainment = containmentRecords.some((record) => record.adequacyReviewed && record.adequate === true);
    if (!hasAdequateContainment) {
      throw new NonconformityError("Closing requires an adequate, reviewed containment record.");
    }
  }

  if (requireRootCauseApproval) {
    const approvedAnalysis = await prisma.rootCauseAnalysis.findFirst({
      where: tenantWhere(ctx, { nonconformityId: nonconformity.id, approvedAt: { not: null } }),
    });
    if (!approvedAnalysis) {
      throw new NonconformityError("Closing requires an approved root-cause analysis.");
    }
  }

  if (requireCorrectiveActionsComplete) {
    const actions = await prisma.correctiveAction.findMany({ where: tenantWhere(ctx, { nonconformityId: nonconformity.id }) });
    const nonCancelled = actions.filter((action) => action.status !== "CANCELLED");
    const allComplete = nonCancelled.length > 0 && nonCancelled.every((action) => action.status === "COMPLETED" || action.status === "VERIFIED");
    if (!allComplete) {
      throw new NonconformityError("Closing requires every corrective action to be completed.");
    }
  }

  if (requireEffectivenessReview) {
    const latestReview = await prisma.effectivenessReview.findFirst({
      where: tenantWhere(ctx, { nonconformityId: nonconformity.id }),
      orderBy: { createdAt: "desc" },
    });
    // T64 acceptance: "INEFFECTIVE reopens/follow-up; it cannot close" —
    // only the most recent review's EFFECTIVE result satisfies this gate. A
    // PARTIALLY_EFFECTIVE/INEFFECTIVE result already moved the
    // nonconformity out of a closable status (effectiveness-service.ts), so
    // this check is defence-in-depth against a stale/superseded review.
    if (!latestReview || latestReview.result !== "EFFECTIVE") {
      throw new NonconformityError("Closing requires the most recent effectiveness review to have found the corrective actions effective.");
    }
  }
}

/** JSON-safe copy of Prisma rows for a `NonconformityClosure` snapshot (Date objects are not valid Prisma Json input). */
function toJsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function closeNonconformity(context: OrganisationContext, nonconformityId: string, actorUserId: string) {
  requirePermission(context, NONCONFORMITY_MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const nonconformity = await findTenantNonconformity(ctx, nonconformityId);
  if (!nonconformity) throw new TenantOwnershipError();
  if (!CLOSABLE_STATUSES.has(nonconformity.status)) {
    throw new NonconformityError(`A nonconformity in status ${nonconformity.status} cannot be closed directly.`);
  }
  await assertMandatoryCloseStepsComplete(ctx, nonconformity);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const [containmentRecords, rootCauseAnalyses, correctiveActions, effectivenessReviews] = await Promise.all([
      tx.containmentRecord.findMany({ where: tenantWhere(txCtx, { nonconformityId: nonconformity.id }) }),
      tx.rootCauseAnalysis.findMany({ where: tenantWhere(txCtx, { nonconformityId: nonconformity.id }) }),
      tx.correctiveAction.findMany({ where: tenantWhere(txCtx, { nonconformityId: nonconformity.id }) }),
      tx.effectivenessReview.findMany({ where: tenantWhere(txCtx, { nonconformityId: nonconformity.id }) }),
    ]);
    const updated = await tx.nonconformity.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: nonconformity.id } },
      data: { status: "CLOSED", closedAt: new Date(), closedByUserId: actorUserId },
    });
    await tx.nonconformityClosure.create({
      data: {
        organisationId: txCtx.organisationId,
        nonconformityId: nonconformity.id,
        snapshot: toJsonSafe({ containmentRecords, rootCauseAnalyses, correctiveActions, effectivenessReviews }),
        closedByUserId: actorUserId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "nonconformity.closed",
      resourceType: "nonconformity",
      resourceId: nonconformity.id,
      summary: `Nonconformity "${nonconformity.reference}" closed.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: nonconformity.status },
      after: { status: "CLOSED" },
    });
    return updated;
  });
}

export async function reopenNonconformity(context: OrganisationContext, nonconformityId: string, reason: string, actorUserId: string) {
  requirePermission(context, NONCONFORMITY_MANAGE_PERMISSION);
  if (!reason.trim()) throw new NonconformityError("Enter a reason for reopening this nonconformity.");
  const ctx = toTenantRepositoryContext(context);
  const nonconformity = await findTenantNonconformity(ctx, nonconformityId);
  if (!nonconformity) throw new TenantOwnershipError();
  if (nonconformity.status !== "CLOSED") throw new NonconformityError("Only a closed nonconformity can be reopened.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.nonconformity.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: nonconformity.id } },
      data: { status: "REOPENED", reopenedAt: new Date(), reopenedByUserId: actorUserId, reopenReason: reason.trim() },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "nonconformity.reopened",
      resourceType: "nonconformity",
      resourceId: nonconformity.id,
      summary: `Nonconformity "${nonconformity.reference}" reopened: ${reason}`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: nonconformity.status },
      after: { status: "REOPENED" },
    });
    return updated;
  });
}

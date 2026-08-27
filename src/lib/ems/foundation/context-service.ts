/**
 * EMS context, interested parties, risk/opportunity and policy service
 * (task T23, Docs/PHASE2_EMS_FOUNDATION_SPEC.md §3 "Context, interested
 * parties, risk and change"). Every write is audited (T20 pattern); these
 * records have no dedicated state machine in the Phase 2 spec beyond the
 * environmental policy's approval step, so create/update here are plain
 * permission-checked mutations rather than a transition table — but every
 * one still runs inside a transaction with its audit event, matching the
 * "changes are audited/versioned" T23 acceptance criterion for the policy
 * link and every other record type.
 *
 * `ems.programme.manage` covers context/interested-party/risk records per
 * the Phase 2 spec §4 permission mapping; `ems.policy.manage` (plus
 * `ems.controlled_document.approve` for the four-eyes top-management
 * approval) covers the environmental policy record specifically.
 */

import type { ContextIssueDirection, ContextIssueType, EmsRiskOpportunityKind, InterestedPartyInfluence } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, assertFourEyes } from "@/lib/rbac/authorize";
import {
  findTenantEmsProgramme,
  findTenantInterestedParty,
  findTenantInterestedPartyRequirement,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { findTenantControlledDocumentRevision } from "@/lib/repositories/documents-repository";
import { TenantOwnershipError, assertOwned } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

export { TenantOwnershipError };

export class EmsContextError extends Error {}

// ---------------------------------------------------------------------------
// Context issues
// ---------------------------------------------------------------------------

export interface CreateContextIssueInput {
  programmeId: string;
  type: ContextIssueType;
  title: string;
  description?: string | null;
  direction: ContextIssueDirection;
  significance?: string | null;
  ownerMembershipId?: string | null;
  reviewDate?: Date | null;
  activeFrom?: Date | null;
  activeUntil?: Date | null;
  actorUserId: string;
}

export async function createContextIssue(context: OrganisationContext, input: CreateContextIssueInput) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantEmsProgramme(ctx, input.programmeId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const issue = await tx.contextIssue.create({
      data: {
        programmeId: programme.id,
        organisationId: txCtx.organisationId,
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        direction: input.direction,
        significance: input.significance ?? null,
        ownerMembershipId: input.ownerMembershipId ?? null,
        reviewDate: input.reviewDate ?? null,
        activeFrom: input.activeFrom ?? null,
        activeUntil: input.activeUntil ?? null,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "context_issue.created",
      resourceType: "context_issue",
      resourceId: issue.id,
      summary: `Context issue "${input.title}" created.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { type: input.type, direction: input.direction },
    });

    return issue;
  });
}

export interface UpdateContextIssueInput {
  title?: string;
  description?: string | null;
  significance?: string | null;
  ownerMembershipId?: string | null;
  reviewDate?: Date | null;
  activeFrom?: Date | null;
  activeUntil?: Date | null;
  actorUserId: string;
}

export async function updateContextIssue(context: OrganisationContext, issueId: string, input: UpdateContextIssueInput) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const issue = assertOwned(ctx, await prisma.contextIssue.findFirst({ where: { id: issueId } }));

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.contextIssue.update({
      where: { id: issue.id, organisationId: txCtx.organisationId },
      data: {
        title: input.title ?? undefined,
        description: input.description === undefined ? undefined : input.description,
        significance: input.significance === undefined ? undefined : input.significance,
        ownerMembershipId: input.ownerMembershipId === undefined ? undefined : input.ownerMembershipId,
        reviewDate: input.reviewDate === undefined ? undefined : input.reviewDate,
        activeFrom: input.activeFrom === undefined ? undefined : input.activeFrom,
        activeUntil: input.activeUntil === undefined ? undefined : input.activeUntil,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "context_issue.updated",
      resourceType: "context_issue",
      resourceId: issue.id,
      summary: `Context issue "${updated.title}" updated.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
    });

    return updated;
  });
}

/**
 * Checks whether a foundation record (context issue, interested party, risk
 * or opportunity) is cited by a change assessment's free-text `affectedRefs`
 * pointer (Json, not a hard FK — see change-service.ts). Deleting a record
 * a change assessment relies on would silently invalidate that assessment,
 * so this is the dependency check the general deletion policy requires
 * before any hard delete here.
 */
async function isReferencedByChangeAssessment(
  ctx: { organisationId: string },
  resourceType: "context_issue" | "interested_party" | "ems_risk_opportunity",
  resourceId: string,
): Promise<boolean> {
  const assessments = await prisma.changeAssessment.findMany({
    where: { organisationId: ctx.organisationId },
    select: { affectedRefs: true },
  });
  return assessments.some((row) => {
    const refs = row.affectedRefs;
    if (!Array.isArray(refs)) return false;
    return refs.some(
      (ref) =>
        ref &&
        typeof ref === "object" &&
        (ref as Record<string, unknown>).resourceType === resourceType &&
        (ref as Record<string, unknown>).resourceId === resourceId,
    );
  });
}

/**
 * Hard-deletes a context issue. These carry no approval workflow of their
 * own (Phase 2 spec §3), so the only guard is that no change assessment
 * already cites this issue as part of its record.
 */
export async function deleteContextIssue(context: OrganisationContext, issueId: string, actorUserId: string) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const issue = assertOwned(ctx, await prisma.contextIssue.findFirst({ where: { id: issueId } }));

  if (await isReferencedByChangeAssessment(ctx, "context_issue", issue.id)) {
    throw new EmsContextError("This context issue is cited by a change assessment and cannot be deleted.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.contextIssue.delete({ where: { id: issue.id, organisationId: txCtx.organisationId } });
    await recordAuditEvent(tx, txCtx, {
      eventType: "context_issue.deleted",
      resourceType: "context_issue",
      resourceId: issue.id,
      summary: `Context issue "${issue.title}" deleted.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { title: issue.title, type: issue.type },
    });
    return { id: issue.id };
  });
}

/** All context issues for a programme, newest first — read-only, UI02 listing. */
export async function listContextIssues(context: OrganisationContext, programmeId: string) {
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantEmsProgramme(ctx, programmeId);
  return prisma.contextIssue.findMany({
    where: { organisationId: ctx.organisationId, programmeId: programme.id },
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Interested parties and their requirements
// ---------------------------------------------------------------------------

export interface CreateInterestedPartyInput {
  programmeId: string;
  name: string;
  type: string;
  influence?: InterestedPartyInfluence | null;
  relationshipOwnerMembershipId?: string | null;
  actorUserId: string;
}

export async function createInterestedParty(context: OrganisationContext, input: CreateInterestedPartyInput) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantEmsProgramme(ctx, input.programmeId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const party = await tx.interestedParty.create({
      data: {
        programmeId: programme.id,
        organisationId: txCtx.organisationId,
        name: input.name,
        type: input.type,
        influence: input.influence ?? null,
        relationshipOwnerMembershipId: input.relationshipOwnerMembershipId ?? null,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "interested_party.created",
      resourceType: "interested_party",
      resourceId: party.id,
      summary: `Interested party "${input.name}" created.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { name: input.name, type: input.type },
    });

    return party;
  });
}

export interface DeactivateInterestedPartyInput {
  actorUserId: string;
}

export async function deactivateInterestedParty(context: OrganisationContext, partyId: string, input: DeactivateInterestedPartyInput) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const party = await findTenantInterestedParty(ctx, partyId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.interestedParty.update({
      where: { id: party.id, organisationId: txCtx.organisationId },
      data: { isActive: false },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "interested_party.updated",
      resourceType: "interested_party",
      resourceId: party.id,
      summary: `Interested party "${party.name}" deactivated.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { isActive: true },
      after: { isActive: false },
    });

    return updated;
  });
}

/**
 * Hard-deletes an interested party — only when it has no requirements
 * recorded (an accidental duplicate entry) and no change assessment cites
 * it. A party with requirement history must be deactivated instead
 * (`deactivateInterestedParty`), which already exists.
 */
export async function deleteInterestedParty(context: OrganisationContext, partyId: string, actorUserId: string) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const party = await findTenantInterestedParty(ctx, partyId);

  const requirementCount = await prisma.interestedPartyRequirement.count({ where: { interestedPartyId: party.id } });
  if (requirementCount > 0) {
    throw new EmsContextError(
      `This interested party has ${requirementCount} requirement${requirementCount === 1 ? "" : "s"} on record and cannot be deleted. Deactivate it instead.`,
    );
  }
  if (await isReferencedByChangeAssessment(ctx, "interested_party", party.id)) {
    throw new EmsContextError("This interested party is cited by a change assessment and cannot be deleted. Deactivate it instead.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.interestedParty.delete({ where: { id: party.id, organisationId: txCtx.organisationId } });
    await recordAuditEvent(tx, txCtx, {
      eventType: "interested_party.deleted",
      resourceType: "interested_party",
      resourceId: party.id,
      summary: `Interested party "${party.name}" deleted.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { name: party.name },
    });
    return { id: party.id };
  });
}

/**
 * Hard-deletes a requirement recorded against an interested party, along
 * with any `EvidenceLink` rows pointing at it — the linked `EvidenceObject`
 * itself is never touched, only the link.
 */
export async function deleteInterestedPartyRequirement(context: OrganisationContext, requirementId: string, actorUserId: string) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const requirement = await findTenantInterestedPartyRequirement(ctx, requirementId);
  if (!requirement) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.evidenceLink.deleteMany({
      where: { organisationId: txCtx.organisationId, resourceType: "interested_party_requirement", resourceId: requirement.id },
    });
    await tx.interestedPartyRequirement.delete({ where: { id: requirement.id, organisationId: txCtx.organisationId } });
    await recordAuditEvent(tx, txCtx, {
      eventType: "interested_party_requirement.deleted",
      resourceType: "interested_party_requirement",
      resourceId: requirement.id,
      summary: "Interested party requirement deleted.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { summary: requirement.summary },
    });
    return { id: requirement.id };
  });
}

export interface CreateInterestedPartyRequirementInput {
  interestedPartyId: string;
  summary: string;
  sourceReference?: string | null;
  isMandatory?: boolean;
  evaluationDate?: Date | null;
  reviewDate?: Date | null;
  actorUserId: string;
}

export async function createInterestedPartyRequirement(context: OrganisationContext, input: CreateInterestedPartyRequirementInput) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const party = await findTenantInterestedParty(ctx, input.interestedPartyId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const requirement = await tx.interestedPartyRequirement.create({
      data: {
        interestedPartyId: party.id,
        organisationId: txCtx.organisationId,
        summary: input.summary,
        sourceReference: input.sourceReference ?? null,
        isMandatory: input.isMandatory ?? false,
        evaluationDate: input.evaluationDate ?? null,
        reviewDate: input.reviewDate ?? null,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "interested_party_requirement.created",
      resourceType: "interested_party_requirement",
      resourceId: requirement.id,
      summary: `Requirement recorded for interested party "${party.name}".`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { isMandatory: requirement.isMandatory },
    });

    return requirement;
  });
}

/** Loads a requirement, verified in-tenant and (when supplied) attached to the expected party — the nested-parent-substitution guard. */
export async function getInterestedPartyRequirement(context: OrganisationContext, requirementId: string, expectedPartyId?: string) {
  const ctx = toTenantRepositoryContext(context);
  return findTenantInterestedPartyRequirement(ctx, requirementId, expectedPartyId);
}

/** All interested parties for a programme (with their requirements), newest first — read-only, UI02 listing. */
export async function listInterestedParties(context: OrganisationContext, programmeId: string) {
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantEmsProgramme(ctx, programmeId);
  return prisma.interestedParty.findMany({
    where: { organisationId: ctx.organisationId, programmeId: programme.id },
    include: { requirements: { orderBy: { createdAt: "desc" } } },
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Risks and opportunities
// ---------------------------------------------------------------------------

export interface CreateEmsRiskOpportunityInput {
  programmeId: string;
  kind: EmsRiskOpportunityKind;
  category: string;
  description: string;
  consequence?: string | null;
  likelihood?: string | null;
  ratingScaleVersion: string;
  initialRating: Record<string, unknown>;
  ownerMembershipId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  actorUserId: string;
}

export async function createEmsRiskOpportunity(context: OrganisationContext, input: CreateEmsRiskOpportunityInput) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantEmsProgramme(ctx, input.programmeId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const row = await tx.emsRiskOpportunity.create({
      data: {
        programmeId: programme.id,
        organisationId: txCtx.organisationId,
        kind: input.kind,
        category: input.category,
        description: input.description,
        consequence: input.consequence ?? null,
        likelihood: input.likelihood ?? null,
        ratingScaleVersion: input.ratingScaleVersion,
        initialRating: input.initialRating as never,
        ownerMembershipId: input.ownerMembershipId ?? null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "ems_risk_opportunity.created",
      resourceType: "ems_risk_opportunity",
      resourceId: row.id,
      summary: `${input.kind === "RISK" ? "Risk" : "Opportunity"} "${input.category}" registered.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { kind: input.kind, category: input.category, ratingScaleVersion: input.ratingScaleVersion },
    });

    return row;
  });
}

export interface RecordResidualRatingInput {
  residualRating: Record<string, unknown>;
  status?: "OPEN" | "MONITORING" | "CLOSED";
  actorUserId: string;
}

export async function recordResidualRating(context: OrganisationContext, riskOpportunityId: string, input: RecordResidualRatingInput) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const row = assertOwned(ctx, await prisma.emsRiskOpportunity.findFirst({ where: { id: riskOpportunityId } }));

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.emsRiskOpportunity.update({
      where: { id: row.id, organisationId: txCtx.organisationId },
      data: { residualRating: input.residualRating as never, status: input.status ?? undefined },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "ems_risk_opportunity.updated",
      resourceType: "ems_risk_opportunity",
      resourceId: row.id,
      summary: `Residual rating recorded for "${row.category}".`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: row.status },
      after: { status: updated.status },
    });

    return updated;
  });
}

/**
 * Hard-deletes a risk/opportunity register entry — only while it is still
 * OPEN with no residual rating recorded yet (a fresh, disposable draft
 * entry) and not cited by a change assessment. Once a residual rating has
 * been recorded, or the entry has moved to MONITORING/CLOSED, it is
 * governed register history: use `recordResidualRating` with
 * `status: "CLOSED"` instead, which already exists as the archive path.
 */
export async function deleteEmsRiskOpportunity(context: OrganisationContext, riskOpportunityId: string, actorUserId: string) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const row = assertOwned(ctx, await prisma.emsRiskOpportunity.findFirst({ where: { id: riskOpportunityId } }));

  if (row.status !== "OPEN" || row.residualRating !== null) {
    throw new EmsContextError(
      "This risk/opportunity already has a recorded residual rating or has moved on from OPEN. Close it instead of deleting it.",
    );
  }
  if (await isReferencedByChangeAssessment(ctx, "ems_risk_opportunity", row.id)) {
    throw new EmsContextError("This risk/opportunity is cited by a change assessment and cannot be deleted.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.emsRiskOpportunity.delete({ where: { id: row.id, organisationId: txCtx.organisationId } });
    await recordAuditEvent(tx, txCtx, {
      eventType: "ems_risk_opportunity.deleted",
      resourceType: "ems_risk_opportunity",
      resourceId: row.id,
      summary: `${row.kind === "RISK" ? "Risk" : "Opportunity"} "${row.category}" deleted.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { category: row.category, kind: row.kind },
    });
    return { id: row.id };
  });
}

/** All risks/opportunities for a programme, newest first — read-only, UI02 listing. */
export async function listEmsRiskOpportunities(context: OrganisationContext, programmeId: string) {
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantEmsProgramme(ctx, programmeId);
  return prisma.emsRiskOpportunity.findMany({
    where: { organisationId: ctx.organisationId, programmeId: programme.id },
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Environmental policy
// ---------------------------------------------------------------------------

export interface LinkEnvironmentalPolicyInput {
  programmeId: string;
  controlledDocumentRevisionId: string;
  actorUserId: string;
}

/** Links the environmental policy to a controlled-document revision. The revision's content lives entirely in T22's document-control-service — this record adds only the top-management approval this record type specifically requires. */
export async function linkEnvironmentalPolicy(context: OrganisationContext, input: LinkEnvironmentalPolicyInput) {
  requirePermission(context, "ems.policy.manage");
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantEmsProgramme(ctx, input.programmeId);
  const revision = await findTenantControlledDocumentRevision(ctx, input.controlledDocumentRevisionId);
  if (!revision) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const record = await tx.environmentalPolicyRecord.create({
      data: {
        programmeId: programme.id,
        organisationId: txCtx.organisationId,
        controlledDocumentRevisionId: revision.id,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_policy_record.linked",
      resourceType: "environmental_policy_record",
      resourceId: record.id,
      summary: `Environmental policy linked to controlled document revision.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { controlledDocumentRevisionId: revision.id },
    });

    return record;
  });
}

export interface ApproveEnvironmentalPolicyInput {
  actorUserId: string;
  preparedByUserId: string;
  effectiveDate?: Date | null;
  reviewDate?: Date | null;
  /** Whether four-eyes (the author cannot also approve) is enforced — defaults to enabled, same safer-default decision as T22's `approveRevision`. */
  fourEyesEnabled?: boolean;
}

/** Records top-management approval of the environmental policy. Requires `ems.controlled_document.approve` — the same sensitive approval permission as any other controlled-document approval — in addition to `ems.policy.manage`. */
export async function approveEnvironmentalPolicy(context: OrganisationContext, recordId: string, input: ApproveEnvironmentalPolicyInput) {
  requirePermission(context, "ems.policy.manage");
  requirePermission(context, "ems.controlled_document.approve");
  assertFourEyes({
    enabled: input.fourEyesEnabled ?? true,
    actorUserId: input.actorUserId,
    authorUserId: input.preparedByUserId,
  });

  const ctx = toTenantRepositoryContext(context);
  const record = assertOwned(ctx, await prisma.environmentalPolicyRecord.findFirst({ where: { id: recordId } }));

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const approvedAt = new Date();
    const updated = await tx.environmentalPolicyRecord.update({
      where: { id: record.id, organisationId: txCtx.organisationId },
      data: {
        approvedByUserId: input.actorUserId,
        approvedAt,
        effectiveDate: input.effectiveDate ?? approvedAt,
        reviewDate: input.reviewDate ?? null,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_policy_record.approved",
      resourceType: "environmental_policy_record",
      resourceId: record.id,
      summary: "Environmental policy approved by top management.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { approvedAt: approvedAt.toISOString() },
    });

    return updated;
  });
}

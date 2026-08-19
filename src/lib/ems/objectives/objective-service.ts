/**
 * Environmental objectives — versioning and approval (task T50,
 * Docs/PHASE5_OBJECTIVES_ACTIONS_SPEC.md §§1-3). Turns a draft into a
 * versioned, organisation-owned `EnvironmentalObjective` whose content only
 * ever becomes authoritative through an explicit, permission-checked,
 * audited approval — the exact same shape as T44's
 * `ComplianceObligationVersion` state machine.
 *
 * Fixed decisions this module enforces (spec §§1,2,5):
 *  - `ems.objective.manage` drafts/edits/submits a version; only
 *    `ems.objective.approve` (Sustainability Lead default) can move a
 *    version out of IN_REVIEW (approve/reject/return) or decide/cancel an
 *    ACTIVE one — there is no function either permission can call to skip
 *    straight from DRAFT to ACTIVE;
 *  - approval always re-checks the *current*, live-resolved
 *    `OrganisationContext.permissions`, so a revoked/suspended approver is
 *    denied even mid-session;
 *  - self-approval is denied whenever `fourEyesEnabled` (default `true`,
 *    the same interim decision T22/T23/T44 made) is on;
 *  - a version that has left DRAFT/IN_REVIEW is never edited in place: the
 *    migration's `environmental_objective_version_immutable_once_approved`
 *    trigger is defence-in-depth for that rule. Changing an objective's
 *    content once approved only ever happens by
 *    `createSuccessorEnvironmentalObjectiveVersion`, which links back via
 *    `supersedesVersionId` and leaves the predecessor's row untouched;
 *  - the `EnvironmentalObjective.activeVersionId` pointer only ever moves
 *    inside `approveEnvironmentalObjectiveVersion` — no other function in
 *    this module writes that column;
 *  - objective achievement is decided only by `decideObjectiveAchievement`,
 *    a permission-checked, explicit review transition on an ACTIVE version
 *    — no function here (or anywhere else in this module) infers achieved/
 *    not-achieved from linked action completion (spec §1 "completing
 *    actions does not automatically mark an objective achieved"); T52's
 *    action model never calls into this module at all;
 *  - links to policy/aspect/obligation/risk-opportunity context are
 *    recorded via `ObjectiveSourceLink` and never determine priority
 *    automatically (spec §1) — this module only validates same-Organisation
 *    ownership of the linked record.
 */

import type { EnvironmentalObjectiveVersionStatus, ObjectiveSourceLinkType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, assertFourEyes } from "@/lib/rbac/authorize";
import {
  findTenantEnvironmentalObjective,
  findTenantEnvironmentalObjectiveVersion,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

export { TenantOwnershipError };

export class ObjectiveError extends Error {}

const APPROVE_PERMISSION = "ems.objective.approve" as const;
const EDIT_PERMISSION = "ems.objective.manage" as const;

export interface ObjectiveSourceLinkInput {
  linkType: ObjectiveSourceLinkType;
  policyRecordId?: string | null;
  aspectAssessmentId?: string | null;
  obligationVersionId?: string | null;
  riskOpportunityId?: string | null;
}

export interface EnvironmentalObjectiveDraftFields {
  title: string;
  intent: string;
  ownerMembershipId: string;
  baselineDescription: string;
  baselineDate?: Date | null;
  targetValue?: number | string | null;
  targetQualitative?: string | null;
  unit?: string | null;
  targetDate: Date;
  evaluationMethod: string;
  sourceLinks: ObjectiveSourceLinkInput[];
}

export interface CreateEnvironmentalObjectiveInput extends EnvironmentalObjectiveDraftFields {
  actorUserId: string;
}

export interface UpdateEnvironmentalObjectiveVersionDraftInput extends EnvironmentalObjectiveDraftFields {
  actorUserId: string;
}

export interface CreateSuccessorObjectiveVersionInput extends EnvironmentalObjectiveDraftFields {
  actorUserId: string;
  revisionRationale: string;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const versionListInclude = {
  owner: { include: { user: { select: { name: true } } } },
  sourceLinks: {
    include: {
      policyRecord: { select: { id: true } },
      aspectAssessment: { select: { id: true, aspectId: true } },
      obligationVersion: { select: { id: true, title: true } },
      riskOpportunity: { select: { id: true, category: true } },
    },
  },
  approvals: { orderBy: { decidedAt: "desc" as const } },
} as const;

export async function listEnvironmentalObjectives(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.environmentalObjective.findMany({
    where: tenantWhere(ctx, {}),
    include: {
      activeVersion: true,
      versions: { orderBy: { version: "desc" }, include: versionListInclude },
      metricDefinitions: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getEnvironmentalObjectiveVersion(context: OrganisationContext, versionId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantEnvironmentalObjectiveVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  return prisma.environmentalObjectiveVersion.findUnique({
    where: { id: version.id },
    include: {
      objective: true,
      sourceLinks: {
        include: {
          policyRecord: true,
          aspectAssessment: { select: { id: true, aspectId: true } },
          obligationVersion: { select: { id: true, title: true } },
          riskOpportunity: { select: { id: true, category: true } },
        },
      },
      approvals: { orderBy: { decidedAt: "desc" } },
    },
  });
}

// ---------------------------------------------------------------------------
// Draft-content validation shared by create/edit/successor
// ---------------------------------------------------------------------------

async function validateSourceLinks(context: OrganisationContext, links: ObjectiveSourceLinkInput[]) {
  const ctx = toTenantRepositoryContext(context);
  const validated: ObjectiveSourceLinkInput[] = [];
  for (const link of links) {
    const policyRecordId = link.policyRecordId || null;
    const aspectAssessmentId = link.aspectAssessmentId || null;
    const obligationVersionId = link.obligationVersionId || null;
    const riskOpportunityId = link.riskOpportunityId || null;
    const setCount = [policyRecordId, aspectAssessmentId, obligationVersionId, riskOpportunityId].filter(Boolean).length;
    if (setCount !== 1) {
      throw new ObjectiveError("Each source link must identify exactly one policy, aspect assessment, obligation version, or risk/opportunity.");
    }

    if (link.linkType === "POLICY" && policyRecordId) {
      const row = await prisma.environmentalPolicyRecord.findFirst({ where: tenantWhere(ctx, { id: policyRecordId }) });
      if (!row) throw new TenantOwnershipError();
    } else if (link.linkType === "ASPECT_ASSESSMENT" && aspectAssessmentId) {
      const row = await prisma.aspectAssessment.findFirst({ where: tenantWhere(ctx, { id: aspectAssessmentId }) });
      if (!row) throw new TenantOwnershipError();
    } else if (link.linkType === "OBLIGATION_VERSION" && obligationVersionId) {
      const row = await prisma.complianceObligationVersion.findFirst({ where: tenantWhere(ctx, { id: obligationVersionId }) });
      if (!row) throw new TenantOwnershipError();
    } else if (link.linkType === "RISK_OPPORTUNITY" && riskOpportunityId) {
      const row = await prisma.emsRiskOpportunity.findFirst({ where: tenantWhere(ctx, { id: riskOpportunityId }) });
      if (!row) throw new TenantOwnershipError();
    } else {
      throw new ObjectiveError("Source link type does not match the identifying field supplied.");
    }

    validated.push({ linkType: link.linkType, policyRecordId, aspectAssessmentId, obligationVersionId, riskOpportunityId });
  }
  return validated;
}

async function validateOwner(context: OrganisationContext, ownerMembershipId: string) {
  const owner = await prisma.organisationMembership.findFirst({
    where: { id: ownerMembershipId, organisationId: context.organisationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!owner) throw new TenantOwnershipError();
}

function assertRequiredFields(fields: EnvironmentalObjectiveDraftFields) {
  if (!fields.title.trim()) throw new ObjectiveError("Enter a title.");
  if (!fields.intent.trim()) throw new ObjectiveError("Enter an intent.");
  if (!fields.baselineDescription.trim()) throw new ObjectiveError("Enter a baseline description.");
  if (!fields.evaluationMethod.trim()) throw new ObjectiveError("Enter an evaluation method.");
  if (!fields.targetDate) throw new ObjectiveError("Enter a target date.");
  const hasNumericTarget = fields.targetValue !== null && fields.targetValue !== undefined && fields.targetValue !== "";
  const hasQualitativeTarget = Boolean(fields.targetQualitative?.trim());
  if (!hasNumericTarget && !hasQualitativeTarget) {
    throw new ObjectiveError("Enter a numeric target value or a qualitative target.");
  }
  if (hasNumericTarget && hasQualitativeTarget) {
    throw new ObjectiveError("Enter either a numeric target value or a qualitative target, not both.");
  }
  if (hasNumericTarget && !fields.unit?.trim()) {
    throw new ObjectiveError("Enter a unit for the numeric target.");
  }
}

function draftData(fields: EnvironmentalObjectiveDraftFields) {
  return {
    title: fields.title.trim(),
    intent: fields.intent.trim(),
    ownerMembershipId: fields.ownerMembershipId,
    baselineDescription: fields.baselineDescription.trim(),
    baselineDate: fields.baselineDate ?? null,
    targetValue: fields.targetValue !== null && fields.targetValue !== undefined && fields.targetValue !== "" ? fields.targetValue : null,
    targetQualitative: fields.targetQualitative?.trim() || null,
    unit: fields.unit?.trim() || null,
    targetDate: fields.targetDate,
    evaluationMethod: fields.evaluationMethod.trim(),
  };
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/** Creates a new `EnvironmentalObjective` with its first DRAFT version. */
export async function createEnvironmentalObjective(context: OrganisationContext, input: CreateEnvironmentalObjectiveInput) {
  requirePermission(context, EDIT_PERMISSION);
  assertRequiredFields(input);
  await validateOwner(context, input.ownerMembershipId);
  const sourceLinks = await validateSourceLinks(context, input.sourceLinks);
  const ctx = toTenantRepositoryContext(context);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const objective = await tx.environmentalObjective.create({
      data: { organisationId: txCtx.organisationId },
    });

    const version = await tx.environmentalObjectiveVersion.create({
      data: {
        organisationId: txCtx.organisationId,
        objectiveId: objective.id,
        version: 1,
        ...draftData(input),
        preparedByUserId: input.actorUserId,
        sourceLinks: { create: sourceLinks.map((link) => ({ organisationId: txCtx.organisationId, ...link })) },
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_objective_version.created",
      resourceType: "environmental_objective_version",
      resourceId: version.id,
      summary: `Environmental objective drafted: ${input.title}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { objectiveId: objective.id, title: input.title },
    });

    return { objective, version };
  });
}

// ---------------------------------------------------------------------------
// Draft editing (DRAFT only)
// ---------------------------------------------------------------------------

export async function updateEnvironmentalObjectiveVersionDraft(
  context: OrganisationContext,
  versionId: string,
  input: UpdateEnvironmentalObjectiveVersionDraftInput,
) {
  requirePermission(context, EDIT_PERMISSION);
  assertRequiredFields(input);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantEnvironmentalObjectiveVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "DRAFT") throw new ObjectiveError("Only a draft version can be edited.");
  await validateOwner(context, input.ownerMembershipId);
  const sourceLinks = await validateSourceLinks(context, input.sourceLinks);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.objectiveSourceLink.deleteMany({ where: tenantWhere(txCtx, { objectiveVersionId: version.id }) });

    const updated = await tx.environmentalObjectiveVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: {
        ...draftData(input),
        sourceLinks: { create: sourceLinks.map((link) => ({ organisationId: txCtx.organisationId, ...link })) },
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_objective_version.created",
      resourceType: "environmental_objective_version",
      resourceId: version.id,
      summary: "Draft environmental objective version updated.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { title: input.title },
    });

    return updated;
  });
}

export async function submitEnvironmentalObjectiveVersionForReview(context: OrganisationContext, versionId: string, actorUserId: string) {
  requirePermission(context, EDIT_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantEnvironmentalObjectiveVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "DRAFT") throw new ObjectiveError("Only a draft version can be submitted for review.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.environmentalObjectiveVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: { status: "IN_REVIEW" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_objective_version.submitted_for_review",
      resourceType: "environmental_objective_version",
      resourceId: version.id,
      summary: "Environmental objective version submitted for review.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "DRAFT" },
      after: { status: "IN_REVIEW" },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Approval transaction — the only place the active-version pointer moves.
// ---------------------------------------------------------------------------

export interface DecideEnvironmentalObjectiveVersionInput {
  actorUserId: string;
  comment?: string | null;
  /** Whether four-eyes (the drafting user cannot also approve) is enforced. Defaults to enabled — no organisation-level toggle exists yet, the same interim decision T22/T23/T44 made. */
  fourEyesEnabled?: boolean;
}

async function recordApprovalDecision(
  tx: Prisma.TransactionClient,
  txCtx: ReturnType<typeof toTenantRepositoryContext>,
  versionId: string,
  decision: "APPROVED" | "REJECTED" | "RETURNED",
  approverMembershipId: string,
  input: DecideEnvironmentalObjectiveVersionInput,
) {
  await tx.objectiveApproval.create({
    data: {
      organisationId: txCtx.organisationId,
      objectiveVersionId: versionId,
      decision,
      permissionCode: APPROVE_PERMISSION,
      comment: input.comment || null,
      approverMembershipId,
    },
  });
}

/**
 * Approves an IN_REVIEW version, moves it (and the objective's active
 * pointer) straight to ACTIVE, and supersedes whatever version was
 * previously ACTIVE for this objective — all in one transaction.
 */
export async function approveEnvironmentalObjectiveVersion(
  context: OrganisationContext,
  versionId: string,
  input: DecideEnvironmentalObjectiveVersionInput,
) {
  requirePermission(context, APPROVE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantEnvironmentalObjectiveVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "IN_REVIEW") throw new ObjectiveError("Only an in-review version can be approved.");
  assertFourEyes({
    enabled: input.fourEyesEnabled ?? true,
    actorUserId: input.actorUserId,
    authorUserId: version.preparedByUserId,
  });

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const objective = await tx.environmentalObjective.findFirst({ where: tenantWhere(txCtx, { id: version.objectiveId }) });
    if (!objective) throw new TenantOwnershipError();

    if (objective.activeVersionId && objective.activeVersionId !== version.id) {
      const previousActive = await tx.environmentalObjectiveVersion.findFirst({
        where: tenantWhere(txCtx, { id: objective.activeVersionId }),
      });
      if (previousActive) {
        await tx.environmentalObjectiveVersion.update({
          where: { organisationId_id: { organisationId: txCtx.organisationId, id: previousActive.id } },
          data: { status: "SUPERSEDED" },
        });
        await recordAuditEvent(tx, txCtx, {
          eventType: "environmental_objective_version.superseded",
          resourceType: "environmental_objective_version",
          resourceId: previousActive.id,
          summary: "Environmental objective version superseded by a newly approved version.",
          actorUserId: input.actorUserId,
          correlationId: txCtx.correlationId,
          source: "web-app",
          before: { status: previousActive.status },
          after: { status: "SUPERSEDED" },
        });
      }
    }

    const updated = await tx.environmentalObjectiveVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: { status: "ACTIVE", approvedByUserId: input.actorUserId, approvedAt: new Date() },
    });

    await tx.environmentalObjective.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: objective.id } },
      data: { activeVersionId: version.id },
    });

    await recordApprovalDecision(tx, txCtx, version.id, "APPROVED", context.membershipId, input);

    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_objective_version.approved",
      resourceType: "environmental_objective_version",
      resourceId: version.id,
      summary: "Environmental objective version approved and made active.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "IN_REVIEW" },
      after: { status: "ACTIVE" },
    });

    return updated;
  });
}

export async function rejectEnvironmentalObjectiveVersion(
  context: OrganisationContext,
  versionId: string,
  input: DecideEnvironmentalObjectiveVersionInput,
) {
  requirePermission(context, APPROVE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantEnvironmentalObjectiveVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "IN_REVIEW") throw new ObjectiveError("Only an in-review version can be rejected.");
  assertFourEyes({
    enabled: input.fourEyesEnabled ?? true,
    actorUserId: input.actorUserId,
    authorUserId: version.preparedByUserId,
  });

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.environmentalObjectiveVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: { status: "CANCELLED" },
    });
    await recordApprovalDecision(tx, txCtx, version.id, "REJECTED", context.membershipId, input);
    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_objective_version.rejected",
      resourceType: "environmental_objective_version",
      resourceId: version.id,
      summary: "Environmental objective version rejected.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "IN_REVIEW" },
      after: { status: "CANCELLED" },
    });
    return updated;
  });
}

export async function returnEnvironmentalObjectiveVersionForRevision(
  context: OrganisationContext,
  versionId: string,
  input: DecideEnvironmentalObjectiveVersionInput,
) {
  requirePermission(context, APPROVE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantEnvironmentalObjectiveVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "IN_REVIEW") throw new ObjectiveError("Only an in-review version can be returned for revision.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.environmentalObjectiveVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: { status: "DRAFT" },
    });
    await recordApprovalDecision(tx, txCtx, version.id, "RETURNED", context.membershipId, input);
    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_objective_version.returned",
      resourceType: "environmental_objective_version",
      resourceId: version.id,
      summary: "Environmental objective version returned for revision.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "IN_REVIEW" },
      after: { status: "DRAFT" },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Achievement review — the objective review, not action completion, decides
// achieved/not achieved (spec §2).
// ---------------------------------------------------------------------------

export interface DecideObjectiveAchievementInput {
  actorUserId: string;
  achieved: boolean;
  rationale: string;
}

export async function decideObjectiveAchievement(
  context: OrganisationContext,
  versionId: string,
  input: DecideObjectiveAchievementInput,
) {
  requirePermission(context, APPROVE_PERMISSION);
  if (!input.rationale.trim()) throw new ObjectiveError("Enter a rationale for this decision.");
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantEnvironmentalObjectiveVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "ACTIVE") throw new ObjectiveError("Only an active version can have achievement decided.");
  const newStatus: EnvironmentalObjectiveVersionStatus = input.achieved ? "ACHIEVED" : "NOT_ACHIEVED";

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.environmentalObjectiveVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: {
        status: newStatus,
        achievementDecidedByUserId: input.actorUserId,
        achievementDecidedAt: new Date(),
        achievementRationale: input.rationale.trim(),
      },
    });
    await tx.environmentalObjective.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.objectiveId } },
      data: { activeVersionId: null },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_objective_version.achievement_decided",
      resourceType: "environmental_objective_version",
      resourceId: version.id,
      summary: `Environmental objective version marked ${newStatus}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "ACTIVE" },
      after: { status: newStatus },
    });
    return updated;
  });
}

export interface CancelEnvironmentalObjectiveVersionInput {
  actorUserId: string;
  rationale: string;
}

/** Cancels an ACTIVE version — the objective is no longer pursued. Clears the objective's active pointer; it is not automatically replaced. */
export async function cancelEnvironmentalObjectiveVersion(
  context: OrganisationContext,
  versionId: string,
  input: CancelEnvironmentalObjectiveVersionInput,
) {
  requirePermission(context, APPROVE_PERMISSION);
  if (!input.rationale.trim()) throw new ObjectiveError("Enter a rationale for cancelling.");
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantEnvironmentalObjectiveVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "ACTIVE") throw new ObjectiveError("Only an active version can be cancelled.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.environmentalObjectiveVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: { status: "CANCELLED", revisionRationale: input.rationale.trim() },
    });
    await tx.environmentalObjective.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.objectiveId } },
      data: { activeVersionId: null },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_objective_version.cancelled",
      resourceType: "environmental_objective_version",
      resourceId: version.id,
      summary: "Environmental objective version cancelled.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "ACTIVE" },
      after: { status: "CANCELLED" },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Successor versions — the only path to changing an approved/active/
// superseded/achieved/not-achieved/cancelled objective's content.
// ---------------------------------------------------------------------------

export async function createSuccessorEnvironmentalObjectiveVersion(
  context: OrganisationContext,
  objectiveId: string,
  input: CreateSuccessorObjectiveVersionInput,
) {
  requirePermission(context, EDIT_PERMISSION);
  assertRequiredFields(input);
  if (!input.revisionRationale.trim()) throw new ObjectiveError("Enter a revision rationale.");
  const ctx = toTenantRepositoryContext(context);
  const objective = await findTenantEnvironmentalObjective(ctx, objectiveId);
  if (!objective) throw new TenantOwnershipError();
  await validateOwner(context, input.ownerMembershipId);
  const sourceLinks = await validateSourceLinks(context, input.sourceLinks);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const latest = await tx.environmentalObjectiveVersion.findFirst({
      where: tenantWhere(txCtx, { objectiveId: objective.id }),
      orderBy: { version: "desc" },
    });
    if (!latest) throw new ObjectiveError("Objective has no versions to replace.");
    if (latest.status === "DRAFT" || latest.status === "IN_REVIEW") {
      throw new ObjectiveError(`Version ${latest.version} is still ${latest.status} — edit it directly instead of creating a successor.`);
    }

    const successor = await tx.environmentalObjectiveVersion.create({
      data: {
        organisationId: txCtx.organisationId,
        objectiveId: objective.id,
        version: latest.version + 1,
        ...draftData(input),
        preparedByUserId: input.actorUserId,
        revisionRationale: input.revisionRationale.trim(),
        supersedesVersionId: latest.id,
        sourceLinks: { create: sourceLinks.map((link) => ({ organisationId: txCtx.organisationId, ...link })) },
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "environmental_objective_version.created",
      resourceType: "environmental_objective_version",
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

export type { EnvironmentalObjectiveVersionStatus };

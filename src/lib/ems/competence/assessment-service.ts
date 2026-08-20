/**
 * Competence assessment (task T71, Docs/PHASE7_COMPETENCE_MANAGEMENT_REVIEW_SPEC.md
 * §§2-3). The path to COMPETENT for every requirement except one whose
 * active version has `trainingSatisfiesRequirement: true` and verified
 * TRAINING evidence (handled directly in evidence-service.ts).
 *
 * Fixed decisions this module enforces (spec §1-2, T71 acceptance):
 *  - state machine is DRAFT -> COMPLETED -> SUPERSEDED, mirroring the T70
 *    CompetenceRequirementVersion successor convention exactly — a
 *    completed assessment is never edited in place (the migration's
 *    `competence_assessment_immutable_once_completed` trigger is
 *    defence-in-depth); `completeCompetenceAssessment` is the only
 *    transition into COMPLETED, and it supersedes whatever assessment was
 *    previously COMPLETED for the same assignment;
 *  - a COMPLETED assessment with outcome COMPETENT moves the assignment to
 *    COMPETENT and sets `competentUntil` from the assessment's
 *    `reassessmentDueDate` (falls back to the assignment's existing
 *    `competentUntil`, e.g. from evidence, if no reassessment date is set);
 *    NOT_COMPETENT moves the assignment to GAP — this is what makes an
 *    assessment (not attendance) the thing that actually proves competence.
 */

import { prisma } from "@/lib/prisma";
import type { CompetenceAssessmentOutcome } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import {
  findTenantCompetenceAssessment,
  findTenantCompetenceAssignment,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

export { TenantOwnershipError };

export class CompetenceAssessmentError extends Error {}

const MANAGE_PERMISSION = "ems.competence.manage" as const;
const SENSITIVE_VIEW_PERMISSION = "ems.competence.sensitive.view" as const;

export interface CreateCompetenceAssessmentInput {
  assignmentId: string;
  method: string;
  criteria?: string | null;
  actorUserId: string;
}

export async function createCompetenceAssessment(context: OrganisationContext, input: CreateCompetenceAssessmentInput) {
  requirePermission(context, MANAGE_PERMISSION);
  if (!input.method.trim()) throw new CompetenceAssessmentError("Enter an assessment method.");
  const ctx = toTenantRepositoryContext(context);
  const assignment = await findTenantCompetenceAssignment(ctx, input.assignmentId);
  if (!assignment) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const existingDraft = await tx.competenceAssessment.findFirst({
      where: tenantWhere(txCtx, { assignmentId: assignment.id, status: "DRAFT" as const }),
    });
    if (existingDraft) {
      throw new CompetenceAssessmentError("A draft assessment already exists for this assignment.");
    }

    const assessment = await tx.competenceAssessment.create({
      data: {
        organisationId: txCtx.organisationId,
        assignmentId: assignment.id,
        method: input.method.trim(),
        criteria: input.criteria?.trim() || null,
        createdByMembershipId: context.membershipId,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "competence_assessment.created",
      resourceType: "competence_assessment",
      resourceId: assessment.id,
      summary: "Competence assessment drafted.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { assignmentId: assignment.id },
    });

    return assessment;
  });
}

export interface CompleteCompetenceAssessmentInput {
  assessorUserId: string;
  outcome: CompetenceAssessmentOutcome;
  rationale?: string | null;
  reassessmentDueDate?: Date | null;
  actorUserId: string;
}

export async function completeCompetenceAssessment(
  context: OrganisationContext,
  assessmentId: string,
  input: CompleteCompetenceAssessmentInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const assessment = await findTenantCompetenceAssessment(ctx, assessmentId);
  if (!assessment) throw new TenantOwnershipError();
  if (assessment.status !== "DRAFT") throw new CompetenceAssessmentError("Only a draft assessment can be completed.");

  const assignment = await findTenantCompetenceAssignment(ctx, assessment.assignmentId);
  if (!assignment) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const previousCompleted = await tx.competenceAssessment.findFirst({
      where: tenantWhere(txCtx, { assignmentId: assignment.id, status: "COMPLETED" as const }),
    });
    if (previousCompleted) {
      await tx.competenceAssessment.update({
        where: { organisationId_id: { organisationId: txCtx.organisationId, id: previousCompleted.id } },
        data: { status: "SUPERSEDED" },
      });
    }

    const updated = await tx.competenceAssessment.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: assessment.id } },
      data: {
        status: "COMPLETED",
        assessorUserId: input.assessorUserId,
        assessedAt: new Date(),
        outcome: input.outcome,
        rationale: input.rationale?.trim() || null,
        reassessmentDueDate: input.reassessmentDueDate ?? null,
        supersedesAssessmentId: previousCompleted?.id ?? null,
      },
    });

    const nowCompetent = input.outcome === "COMPETENT";
    await tx.competenceAssignment.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: assignment.id } },
      data: nowCompetent
        ? {
            status: "COMPETENT",
            competentUntil: input.reassessmentDueDate ?? assignment.competentUntil ?? null,
            gapNote: null,
            gapSince: null,
          }
        : {
            status: "GAP",
            gapSince: new Date(),
            gapNote: "Competence assessment outcome: not competent.",
          },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "competence_assessment.completed",
      resourceType: "competence_assessment",
      resourceId: assessment.id,
      summary: `Competence assessment completed: ${input.outcome}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "DRAFT" as const },
      after: { status: "COMPLETED", outcome: input.outcome },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "competence_assignment.status_changed",
      resourceType: "competence_assignment",
      resourceId: assignment.id,
      summary: nowCompetent
        ? "Competence assignment marked competent from assessment outcome."
        : "Competence assignment marked a gap from assessment outcome.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: assignment.status },
      after: { status: nowCompetent ? "COMPETENT" : "GAP" },
    });

    return updated;
  });
}

/** Restricted read — requires `ems.competence.sensitive.view` in addition to the base view permission. */
export async function listCompetenceAssessmentsForAssignment(context: OrganisationContext, assignmentId: string) {
  requirePermission(context, SENSITIVE_VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const assignment = await findTenantCompetenceAssignment(ctx, assignmentId);
  if (!assignment) throw new TenantOwnershipError();
  return prisma.competenceAssessment.findMany({
    where: tenantWhere(ctx, { assignmentId: assignment.id }),
    orderBy: { createdAt: "desc" },
  });
}

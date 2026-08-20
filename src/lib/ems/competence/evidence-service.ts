/**
 * Training/experience/licence evidence capture (task T71,
 * Docs/PHASE7_COMPETENCE_MANAGEMENT_REVIEW_SPEC.md §§1,3,6). Depends on T70
 * (CompetenceAssignment/PersonProfile), T22 (shared evidence storage) and
 * T24 (notifications), all already on this branch.
 *
 * Fixed decisions this module enforces (spec §1, T71 acceptance):
 *  - the underlying file/checksum/classification/retention always lives in
 *    T22's `EvidenceObject`, uploaded through `uploadEvidenceObject` and
 *    linked via `linkEvidence` with resourceType "competence_evidence" —
 *    this module never duplicates T22's storage model, only the
 *    training/qualification/licence-specific metadata (type, issued/expiry
 *    dates, verifier/status);
 *  - "attendance alone does not automatically prove competence unless
 *    policy says so": verifying TRAINING-type evidence only completes the
 *    assignment (moves it straight to COMPETENT) when the exact requirement
 *    version's `trainingSatisfiesRequirement` flag is true. Every other
 *    evidence type, and TRAINING evidence when the flag is false, only
 *    advances the assignment to EVIDENCE_SUBMITTED — a `CompetenceAssessment`
 *    (assessment-service.ts) is required to reach COMPETENT;
 *  - reading evidence detail (type/dates/verifier — training/licence detail
 *    about a named person) requires `ems.competence.sensitive.view` in
 *    addition to `ems.competence.view`, mirroring the
 *    `getPersonSensitiveProfile` read-gate pattern (person-service.ts)
 *    exactly ("sensitive person/training/licence data has dedicated
 *    permissions" — spec §1/§6). Writing only requires
 *    `ems.competence.manage`, the same asymmetry as
 *    `setPersonSensitiveProfile`.
 */

import { prisma } from "@/lib/prisma";
import type { EvidenceClassification, RetentionCategory, CompetenceEvidenceType } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import {
  findTenantCompetenceAssignment,
  findTenantCompetenceEvidence,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { uploadEvidenceObject, linkEvidence } from "@/lib/documents/evidence-service";

export { TenantOwnershipError };

export class CompetenceEvidenceError extends Error {}

const MANAGE_PERMISSION = "ems.competence.manage" as const;
const SENSITIVE_VIEW_PERMISSION = "ems.competence.sensitive.view" as const;

export interface SubmitCompetenceEvidenceInput {
  assignmentId: string;
  evidenceType: CompetenceEvidenceType;
  issuedDate?: Date | null;
  expiryDate?: Date | null;
  file: { fileName: string; mimeType: string; bytes: Buffer };
  classification?: EvidenceClassification;
  retentionCategory?: RetentionCategory;
  retentionUntil?: Date | null;
  actorUserId: string;
}

/**
 * Stores the evidence file (T22), records the CompetenceEvidence metadata
 * row, links the two, and — unless the assignment is already COMPETENT —
 * advances the assignment to EVIDENCE_SUBMITTED. Submitting evidence never
 * by itself completes the assignment; see `verifyCompetenceEvidence` and
 * assessment-service.ts for the paths that do.
 */
export async function submitCompetenceEvidence(context: OrganisationContext, input: SubmitCompetenceEvidenceInput) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const assignment = await findTenantCompetenceAssignment(ctx, input.assignmentId);
  if (!assignment) throw new TenantOwnershipError();

  const evidenceObject = await uploadEvidenceObject(context, {
    fileName: input.file.fileName,
    mimeType: input.file.mimeType,
    bytes: input.file.bytes,
    classification: input.classification,
    retentionCategory: input.retentionCategory,
    retentionUntil: input.retentionUntil ?? null,
    uploadedByUserId: input.actorUserId,
  });

  const evidence = await runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const created = await tx.competenceEvidence.create({
      data: {
        organisationId: txCtx.organisationId,
        assignmentId: assignment.id,
        personId: assignment.personId,
        evidenceType: input.evidenceType,
        issuedDate: input.issuedDate ?? null,
        expiryDate: input.expiryDate ?? null,
        submittedByMembershipId: context.membershipId,
      },
    });

    if (assignment.status !== "COMPETENT") {
      await tx.competenceAssignment.update({
        where: { organisationId_id: { organisationId: txCtx.organisationId, id: assignment.id } },
        data: { status: "EVIDENCE_SUBMITTED" },
      });
    }

    await recordAuditEvent(tx, txCtx, {
      eventType: "competence_evidence.submitted",
      resourceType: "competence_evidence",
      resourceId: created.id,
      summary: `${input.evidenceType} evidence submitted.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { assignmentId: assignment.id, evidenceType: input.evidenceType },
    });

    return created;
  });

  await linkEvidence(context, {
    evidenceId: evidenceObject.id,
    resourceType: "competence_evidence",
    resourceId: evidence.id,
    purpose: input.evidenceType,
    linkedByUserId: input.actorUserId,
  });

  return evidence;
}

/**
 * Verifies submitted evidence. Only when the evidence is TRAINING type and
 * the exact requirement version's `trainingSatisfiesRequirement` is true
 * does this move the assignment straight to COMPETENT — otherwise the
 * assignment stays at EVIDENCE_SUBMITTED pending an assessment.
 */
export async function verifyCompetenceEvidence(context: OrganisationContext, evidenceId: string, actorUserId: string) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const evidence = await findTenantCompetenceEvidence(ctx, evidenceId);
  if (!evidence) throw new TenantOwnershipError();
  if (evidence.status !== "SUBMITTED") throw new CompetenceEvidenceError("Only submitted evidence can be verified.");

  const assignment = await findTenantCompetenceAssignment(ctx, evidence.assignmentId);
  if (!assignment) throw new TenantOwnershipError();
  const requirementVersion = await prisma.competenceRequirementVersion.findFirst({
    where: tenantWhere(ctx, { id: assignment.requirementVersionId }),
  });
  if (!requirementVersion) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.competenceEvidence.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: evidence.id } },
      data: { status: "VERIFIED", verifiedByMembershipId: context.membershipId, verifiedAt: new Date() },
    });

    const trainingProvesCompetence =
      evidence.evidenceType === "TRAINING" && requirementVersion.trainingSatisfiesRequirement;
    if (trainingProvesCompetence && assignment.status !== "COMPETENT") {
      await tx.competenceAssignment.update({
        where: { organisationId_id: { organisationId: txCtx.organisationId, id: assignment.id } },
        data: {
          status: "COMPETENT",
          competentUntil: evidence.expiryDate ?? null,
          gapNote: null,
          gapSince: null,
        },
      });
      await recordAuditEvent(tx, txCtx, {
        eventType: "competence_assignment.status_changed",
        resourceType: "competence_assignment",
        resourceId: assignment.id,
        summary: "Competence assignment marked competent from verified training evidence (policy allows).",
        actorUserId,
        correlationId: txCtx.correlationId,
        source: "web-app",
        before: { status: assignment.status },
        after: { status: "COMPETENT" },
      });
    }

    await recordAuditEvent(tx, txCtx, {
      eventType: "competence_evidence.verified",
      resourceType: "competence_evidence",
      resourceId: evidence.id,
      summary: "Competence evidence verified.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
    });

    return updated;
  });
}

export async function rejectCompetenceEvidence(
  context: OrganisationContext,
  evidenceId: string,
  reason: string,
  actorUserId: string,
) {
  requirePermission(context, MANAGE_PERMISSION);
  if (!reason?.trim()) throw new CompetenceEvidenceError("Enter a rejection reason.");
  const ctx = toTenantRepositoryContext(context);
  const evidence = await findTenantCompetenceEvidence(ctx, evidenceId);
  if (!evidence) throw new TenantOwnershipError();
  if (evidence.status !== "SUBMITTED") throw new CompetenceEvidenceError("Only submitted evidence can be rejected.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.competenceEvidence.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: evidence.id } },
      data: {
        status: "REJECTED",
        rejectionReason: reason.trim(),
        verifiedByMembershipId: context.membershipId,
        verifiedAt: new Date(),
      },
    });

    // If this was the only outstanding evidence, revert the assignment from
    // EVIDENCE_SUBMITTED back to IN_PROGRESS rather than leaving it parked
    // on evidence that no longer stands.
    const assignment = await tx.competenceAssignment.findFirst({
      where: tenantWhere(txCtx, { id: evidence.assignmentId }),
    });
    if (assignment && assignment.status === "EVIDENCE_SUBMITTED") {
      const remaining = await tx.competenceEvidence.count({
        where: tenantWhere(txCtx, { assignmentId: assignment.id, status: { in: ["SUBMITTED" as const, "VERIFIED" as const] } }),
      });
      if (remaining === 0) {
        await tx.competenceAssignment.update({
          where: { organisationId_id: { organisationId: txCtx.organisationId, id: assignment.id } },
          data: { status: "IN_PROGRESS" },
        });
      }
    }

    await recordAuditEvent(tx, txCtx, {
      eventType: "competence_evidence.rejected",
      resourceType: "competence_evidence",
      resourceId: evidence.id,
      summary: "Competence evidence rejected.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
    });

    return updated;
  });
}

/** Restricted read — requires `ems.competence.sensitive.view` in addition to the base view permission. */
export async function listCompetenceEvidenceForAssignment(context: OrganisationContext, assignmentId: string) {
  requirePermission(context, SENSITIVE_VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const assignment = await findTenantCompetenceAssignment(ctx, assignmentId);
  if (!assignment) throw new TenantOwnershipError();
  return prisma.competenceEvidence.findMany({
    where: tenantWhere(ctx, { assignmentId: assignment.id }),
    orderBy: { submittedAt: "desc" },
  });
}

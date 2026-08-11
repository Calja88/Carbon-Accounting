/**
 * EMS change assessment lifecycle service (task T23,
 * Docs/PHASE2_EMS_FOUNDATION_SPEC.md §3 "Context, interested parties, risk
 * and change").
 *
 * State machine (spec §2):
 *   ChangeAssessment: DRAFT -> REVIEW -> APPROVED -> IMPLEMENTED -> EFFECTIVENESS_REVIEWED
 *
 * `affectedRefs` is a generic `{ resourceType, resourceId }[]` (see
 * `EmsResourceRef` in types.ts) rather than a hard foreign key to
 * aspects/obligations/controls/competence records, because those models
 * belong to later phases (T30+/T40+/T70+) this task must not implement. Each
 * ref is still validated here against an explicit allow list of resource
 * types that exist today, and same-Organisation ownership of the target is
 * checked before the reference is stored — "no generic polymorphic link may
 * skip target validation" (Phase 2 spec §3), applied to this reference list
 * the same way it applies to EvidenceLink.
 */

import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import {
  findTenantEmsProgramme,
  findTenantChangeAssessment,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { TenantOwnershipError, assertOwned } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import type { EmsResourceRef } from "./types";

export { TenantOwnershipError };

export class ChangeAssessmentError extends Error {}

/** Every resource type a `ChangeAssessment.affectedRefs` entry may reference. Extend this array, never the schema, as later phases add referenceable record types. */
export const CHANGE_ASSESSMENT_AFFECTED_RESOURCE_TYPES = [
  "ems_scope_version",
  "context_issue",
  "interested_party",
  "environmental_policy_record",
] as const;
export type ChangeAssessmentAffectedResourceType = (typeof CHANGE_ASSESSMENT_AFFECTED_RESOURCE_TYPES)[number];

export function isKnownChangeAssessmentResourceType(value: string): value is ChangeAssessmentAffectedResourceType {
  return (CHANGE_ASSESSMENT_AFFECTED_RESOURCE_TYPES as readonly string[]).includes(value);
}

async function assertAffectedRefsOwned(ctx: TenantRepositoryContext, refs: EmsResourceRef[]): Promise<void> {
  for (const ref of refs) {
    if (!isKnownChangeAssessmentResourceType(ref.resourceType)) {
      throw new ChangeAssessmentError(`Change assessments cannot reference resource type "${ref.resourceType}".`);
    }
    switch (ref.resourceType) {
      case "ems_scope_version":
        assertOwned(ctx, await prisma.emsScopeVersion.findFirst({ where: { id: ref.resourceId } }));
        break;
      case "context_issue":
        assertOwned(ctx, await prisma.contextIssue.findFirst({ where: { id: ref.resourceId } }));
        break;
      case "interested_party":
        assertOwned(ctx, await prisma.interestedParty.findFirst({ where: { id: ref.resourceId } }));
        break;
      case "environmental_policy_record":
        assertOwned(ctx, await prisma.environmentalPolicyRecord.findFirst({ where: { id: ref.resourceId } }));
        break;
    }
  }
}

export interface CreateChangeAssessmentInput {
  programmeId: string;
  proposedChange: string;
  triggerType: string;
  triggerDate?: Date | null;
  affectedRefs?: EmsResourceRef[];
  actorUserId: string;
}

export async function createChangeAssessment(context: OrganisationContext, input: CreateChangeAssessmentInput) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantEmsProgramme(ctx, input.programmeId);

  if (input.affectedRefs?.length) {
    await assertAffectedRefsOwned(ctx, input.affectedRefs);
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const assessment = await tx.changeAssessment.create({
      data: {
        programmeId: programme.id,
        organisationId: txCtx.organisationId,
        proposedChange: input.proposedChange,
        triggerType: input.triggerType,
        triggerDate: input.triggerDate ?? null,
        affectedRefs: (input.affectedRefs ?? []) as never,
        preparedByUserId: input.actorUserId,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "change_assessment.created",
      resourceType: "change_assessment",
      resourceId: assessment.id,
      summary: `Change assessment created: "${input.proposedChange}".`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { triggerType: input.triggerType },
    });

    return assessment;
  });
}

async function transitionChangeAssessmentStatus(
  context: OrganisationContext,
  assessmentId: string,
  options: {
    from: ("DRAFT" | "REVIEW" | "APPROVED" | "IMPLEMENTED" | "EFFECTIVENESS_REVIEWED")[];
    to: "DRAFT" | "REVIEW" | "APPROVED" | "IMPLEMENTED" | "EFFECTIVENESS_REVIEWED";
    eventType:
      | "change_assessment.reviewed"
      | "change_assessment.approved"
      | "change_assessment.implemented"
      | "change_assessment.effectiveness_reviewed";
    summary: string;
    actorUserId: string;
    extraData?: Record<string, unknown>;
  },
) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const assessment = await findTenantChangeAssessment(ctx, assessmentId);
  if (!options.from.includes(assessment.status)) {
    throw new ChangeAssessmentError(
      `Change assessment must be ${options.from.join(" or ")} to move to ${options.to} (it is ${assessment.status}).`,
    );
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.changeAssessment.update({
      where: { id: assessment.id, organisationId: txCtx.organisationId },
      data: { status: options.to, ...options.extraData },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: options.eventType,
      resourceType: "change_assessment",
      resourceId: assessment.id,
      summary: options.summary,
      actorUserId: options.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: assessment.status },
      after: { status: options.to },
    });

    return updated;
  });
}

export async function submitChangeAssessmentForReview(context: OrganisationContext, assessmentId: string, assessmentNotes: string, actorUserId: string) {
  return transitionChangeAssessmentStatus(context, assessmentId, {
    from: ["DRAFT"],
    to: "REVIEW",
    eventType: "change_assessment.reviewed",
    summary: "Change assessment submitted for review.",
    actorUserId,
    extraData: { assessment: assessmentNotes },
  });
}

export async function approveChangeAssessment(context: OrganisationContext, assessmentId: string, decision: string, actorUserId: string) {
  return transitionChangeAssessmentStatus(context, assessmentId, {
    from: ["REVIEW"],
    to: "APPROVED",
    eventType: "change_assessment.approved",
    summary: "Change assessment approved.",
    actorUserId,
    extraData: { decision, approvedByUserId: actorUserId, approvedAt: new Date() },
  });
}

export async function recordChangeImplementation(context: OrganisationContext, assessmentId: string, actorUserId: string) {
  return transitionChangeAssessmentStatus(context, assessmentId, {
    from: ["APPROVED"],
    to: "IMPLEMENTED",
    eventType: "change_assessment.implemented",
    summary: "Change implementation recorded.",
    actorUserId,
    extraData: { implementedAt: new Date() },
  });
}

export async function recordChangeEffectivenessReview(context: OrganisationContext, assessmentId: string, review: string, actorUserId: string) {
  return transitionChangeAssessmentStatus(context, assessmentId, {
    from: ["IMPLEMENTED"],
    to: "EFFECTIVENESS_REVIEWED",
    eventType: "change_assessment.effectiveness_reviewed",
    summary: "Change effectiveness reviewed.",
    actorUserId,
    extraData: { effectivenessReview: review, effectivenessReviewedAt: new Date() },
  });
}

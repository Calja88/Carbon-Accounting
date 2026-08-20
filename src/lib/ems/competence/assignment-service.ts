/**
 * Competence assignments (task T70, Docs/PHASE7_COMPETENCE_MANAGEMENT_REVIEW_SPEC.md
 * §§2-3). Links one exact `CompetenceRequirementVersion` to one
 * `PersonProfile` — the person/requirement mapping half of T70; evidence,
 * assessment and expiry are T71 and are not implemented here.
 *
 * Fixed decisions this module enforces (spec §2, T70 acceptance):
 *  - only an ACTIVE requirement version can be assigned — assigning a
 *    draft/approved-but-not-yet-active version would let a person be
 *    "required" to meet content that was never made live;
 *  - `status` is limited to REQUIRED/IN_PROGRESS/GAP (the schema
 *    comment on `CompetenceAssignmentStatus` explains why the fuller
 *    EVIDENCE_SUBMITTED/COMPETENT/EXPIRED states are deferred to T71);
 *  - a revised requirement version never changes an existing assignment's
 *    `requirementVersionId` (T70 acceptance: "requirement revision does
 *    not alter historical assignment") — this module never writes that
 *    column after creation; a new version needs a new assignment via
 *    `assignCompetenceRequirement`.
 */

import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, assertEntityAccess, assertSiteAccess } from "@/lib/rbac/authorize";
import {
  findTenantCompetenceAssignment,
  findTenantCompetenceRequirementVersion,
  findTenantPersonProfile,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

export { TenantOwnershipError };

export class CompetenceAssignmentError extends Error {}

const MANAGE_PERMISSION = "ems.competence.manage" as const;
const VIEW_PERMISSION = "ems.competence.view" as const;

/** Mirrors `accessiblePersonProfileFilter` (person-service.ts): a RESTRICTED member is denied for a person with no Entity/Site at all — deny by default, not everything. */
function assertPersonInScope(context: OrganisationContext, person: { entityId: string | null; siteId: string | null }) {
  if (person.siteId) {
    assertSiteAccess(context, person.siteId);
  } else if (person.entityId) {
    assertEntityAccess(context, person.entityId);
  } else if (context.access.mode === "RESTRICTED") {
    throw new TenantOwnershipError();
  }
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export interface AssignCompetenceRequirementInput {
  requirementVersionId: string;
  personId: string;
  dueDate?: Date | null;
  actorUserId: string;
}

export async function assignCompetenceRequirement(context: OrganisationContext, input: AssignCompetenceRequirementInput) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);

  const version = await findTenantCompetenceRequirementVersion(ctx, input.requirementVersionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "ACTIVE") throw new CompetenceAssignmentError("Only an active requirement version can be assigned.");

  const person = await findTenantPersonProfile(ctx, input.personId);
  if (!person.isActive) throw new CompetenceAssignmentError("Cannot assign a competence requirement to an inactive person.");
  await assertPersonInScope(context, person);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const existing = await tx.competenceAssignment.findFirst({
      where: tenantWhere(txCtx, { requirementVersionId: version.id, personId: person.id }),
    });
    if (existing) throw new CompetenceAssignmentError("This person is already assigned this requirement version.");

    const assignment = await tx.competenceAssignment.create({
      data: {
        organisationId: txCtx.organisationId,
        requirementVersionId: version.id,
        personId: person.id,
        dueDate: input.dueDate ?? null,
        assignedByMembershipId: context.membershipId,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "competence_assignment.created",
      resourceType: "competence_assignment",
      resourceId: assignment.id,
      summary: "Competence requirement assigned to a person.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { requirementVersionId: version.id, personId: person.id },
    });

    return assignment;
  });
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

export async function startCompetenceAssignment(context: OrganisationContext, assignmentId: string, actorUserId: string) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const assignment = await findTenantCompetenceAssignment(ctx, assignmentId);
  if (!assignment) throw new TenantOwnershipError();
  if (assignment.status !== "REQUIRED") throw new CompetenceAssignmentError("Only a required assignment can be started.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.competenceAssignment.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: assignment.id } },
      data: { status: "IN_PROGRESS" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "competence_assignment.status_changed",
      resourceType: "competence_assignment",
      resourceId: assignment.id,
      summary: "Competence assignment moved to in-progress.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "REQUIRED" },
      after: { status: "IN_PROGRESS" },
    });
    return updated;
  });
}

export interface MarkCompetenceAssignmentGapInput {
  note?: string | null;
  actorUserId: string;
}

export async function markCompetenceAssignmentGap(
  context: OrganisationContext,
  assignmentId: string,
  input: MarkCompetenceAssignmentGapInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const assignment = await findTenantCompetenceAssignment(ctx, assignmentId);
  if (!assignment) throw new TenantOwnershipError();
  if (assignment.status === "GAP") throw new CompetenceAssignmentError("Assignment is already a gap.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.competenceAssignment.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: assignment.id } },
      data: { status: "GAP", gapSince: new Date(), gapNote: input.note?.trim() || null },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "competence_assignment.status_changed",
      resourceType: "competence_assignment",
      resourceId: assignment.id,
      summary: "Competence assignment marked as a gap.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: assignment.status },
      after: { status: "GAP" },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listCompetenceAssignmentsForPerson(context: OrganisationContext, personId: string) {
  requirePermission(context, VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const person = await findTenantPersonProfile(ctx, personId);
  await assertPersonInScope(context, person);
  return prisma.competenceAssignment.findMany({
    where: tenantWhere(ctx, { personId: person.id }),
    include: { requirementVersion: { include: { requirement: true } } },
    orderBy: { assignedAt: "desc" },
  });
}

export async function listCompetenceAssignmentsForRequirementVersion(context: OrganisationContext, requirementVersionId: string) {
  requirePermission(context, VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantCompetenceRequirementVersion(ctx, requirementVersionId);
  if (!version) throw new TenantOwnershipError();
  return prisma.competenceAssignment.findMany({
    where: tenantWhere(ctx, { requirementVersionId: version.id }),
    include: { person: true },
    orderBy: { assignedAt: "desc" },
  });
}

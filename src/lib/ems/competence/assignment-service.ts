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

/**
 * Withdraws a competence assignment — the exit for a person who no longer
 * holds the role, process or control the requirement was raised against.
 *
 * A competence assignment is PERSONAL_RESTRICTED, and its evidence and
 * assessments hang off it (`CompetenceEvidence` cascades, but
 * `CompetenceAssessment` records are completed competence judgements about a
 * named person). Deleting the row would erase that person's competence
 * history, so `WITHDRAWN` is a terminal status instead: the obligation ends,
 * the record and everything under it stays readable, and the assignment
 * drops out of gap and expiry sweeps.
 */
export async function withdrawCompetenceAssignment(
  context: OrganisationContext,
  assignmentId: string,
  reason: string,
  actorUserId: string,
) {
  requirePermission(context, MANAGE_PERMISSION);
  if (!reason?.trim()) throw new CompetenceAssignmentError("Record why the assignment is being withdrawn.");
  const ctx = toTenantRepositoryContext(context);
  const assignment = await findTenantCompetenceAssignment(ctx, assignmentId);
  if (!assignment) throw new TenantOwnershipError();
  if (assignment.status === "WITHDRAWN") throw new CompetenceAssignmentError("This assignment is already withdrawn.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.competenceAssignment.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: assignment.id } },
      data: {
        status: "WITHDRAWN",
        gapNote: reason.trim(),
        gapSince: null,
        // The requirement no longer applies, so a future expiry sweep must
        // not resurrect this row as EXPIRED.
        competentUntil: null,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "competence_assignment.withdrawn",
      resourceType: "competence_assignment",
      resourceId: assignment.id,
      summary: `Competence assignment withdrawn: ${reason.trim()}`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: assignment.status },
      after: { status: "WITHDRAWN" },
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

/** Mirrors `accessiblePersonProfileFilter` (person-service.ts) / `accessiblePersonFilter` (gap-service.ts) exactly. */
function accessiblePersonFilter(context: OrganisationContext) {
  if (context.access.mode === "ORGANISATION_WIDE") return {};
  return {
    OR: [
      { siteId: { in: [...context.access.siteIds] } },
      { entityId: { in: [...context.access.entityIds] } },
    ],
  };
}

export interface ListCompetenceAssignmentsFilter {
  entityId?: string;
  siteId?: string;
  personId?: string;
}

/**
 * Tenant/site-scoped assignment list across every person — the UI09
 * "assignment list" read, built the same way as `listCompetenceGaps`
 * (gap-service.ts) rather than adding a new persisted model.
 */
export async function listCompetenceAssignments(context: OrganisationContext, filter: ListCompetenceAssignmentsFilter = {}) {
  requirePermission(context, VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  return prisma.competenceAssignment.findMany({
    where: tenantWhere(ctx, {
      person: {
        ...accessiblePersonFilter(context),
        ...(filter.entityId ? { entityId: filter.entityId } : {}),
        ...(filter.siteId ? { siteId: filter.siteId } : {}),
      },
      ...(filter.personId ? { personId: filter.personId } : {}),
    }),
    include: {
      person: { select: { id: true, displayName: true, membership: { select: { user: { select: { name: true } } } } } },
      requirementVersion: { select: { id: true, title: true, version: true, requirementId: true } },
    },
    orderBy: { assignedAt: "desc" },
  });
}

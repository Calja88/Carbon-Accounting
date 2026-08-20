/**
 * Incident notification/reportability assessments (task T62,
 * Docs/PHASE6_AUDIT_INCIDENT_CAPA_SPEC.md §§4-5,8). Every assessment is
 * entered by a named, competent human reviewer (`reviewerMembershipId`) with
 * a rationale — this module never sets `decision` itself, which is what
 * makes "no automatic legal-reportability conclusion" true here rather than
 * merely asserted elsewhere (spec §4: "Never automatic legal advice.").
 */

import { prisma } from "@/lib/prisma";
import type { IncidentNotificationDecision } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, hasPermission } from "@/lib/rbac/authorize";
import { findTenantEnvironmentalIncident, toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { IncidentError, INCIDENT_MANAGE_PERMISSION, INCIDENT_RESTRICTED_VIEW_PERMISSION } from "./incident-service";

export { TenantOwnershipError, IncidentError };

function assertIncidentReadAccess(context: OrganisationContext, incident: { restricted: boolean; reporterMembershipId: string }): void {
  if (!incident.restricted) return;
  if (context.membershipId === incident.reporterMembershipId) return;
  if (hasPermission(context, INCIDENT_RESTRICTED_VIEW_PERMISSION)) return;
  throw new TenantOwnershipError();
}

export interface RecordIncidentNotificationAssessmentInput {
  authorityOrParty: string;
  dueTrigger?: string | null;
  decision: IncidentNotificationDecision;
  rationale: string;
  reviewerMembershipId: string;
  actorUserId: string;
}

/**
 * Records one notification/reportability assessment against an incident.
 * `decision` is always the caller's explicit choice — this function performs
 * no inference of its own (spec acceptance: "no automatic legal-reportability
 * conclusion"); it only validates that a competent reviewer and rationale
 * were supplied, per spec §4/§8 "requires a competent reviewer/rationale".
 */
export async function recordIncidentNotificationAssessment(
  context: OrganisationContext,
  incidentId: string,
  input: RecordIncidentNotificationAssessmentInput,
) {
  requirePermission(context, INCIDENT_MANAGE_PERMISSION);
  if (!input.authorityOrParty.trim()) throw new IncidentError("Enter the authority or party.");
  if (!input.rationale.trim()) throw new IncidentError("Enter the rationale for this decision.");
  if (!input.reviewerMembershipId.trim()) throw new IncidentError("Choose a competent reviewer.");

  const ctx = toTenantRepositoryContext(context);
  const incident = await findTenantEnvironmentalIncident(ctx, incidentId);
  if (!incident) throw new TenantOwnershipError();
  assertIncidentReadAccess(context, incident);

  const reviewer = await prisma.organisationMembership.findFirst({
    where: { id: input.reviewerMembershipId, organisationId: ctx.organisationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!reviewer) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const assessment = await tx.incidentNotificationAssessment.create({
      data: {
        organisationId: txCtx.organisationId,
        incidentId: incident.id,
        authorityOrParty: input.authorityOrParty.trim(),
        dueTrigger: input.dueTrigger?.trim() || null,
        decision: input.decision,
        rationale: input.rationale.trim(),
        reviewerMembershipId: input.reviewerMembershipId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "incident_notification_assessment.recorded",
      resourceType: "environmental_incident",
      resourceId: incident.id,
      summary: `Notification assessment recorded for "${input.authorityOrParty}": ${input.decision}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { authorityOrParty: input.authorityOrParty, decision: input.decision },
    });
    return assessment;
  });
}

export async function listIncidentNotificationAssessments(context: OrganisationContext, incidentId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const incident = await findTenantEnvironmentalIncident(ctx, incidentId);
  if (!incident) throw new TenantOwnershipError();
  assertIncidentReadAccess(context, incident);
  return prisma.incidentNotificationAssessment.findMany({
    where: tenantWhere(ctx, { incidentId: incident.id }),
    orderBy: { assessedAt: "asc" },
  });
}

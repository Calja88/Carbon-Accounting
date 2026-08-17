import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission, PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { listComplianceObligations } from "@/lib/ems/legal/obligation-service";
import { ObligationWorkspace } from "./obligation-forms";

export const dynamic = "force-dynamic";

export default async function ComplianceObligationsPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const ctx = toTenantRepositoryContext(context);

  const [obligations, applicableAssessments, entities, sites, aspects, controls, members, changeEvents] = await Promise.all([
    listComplianceObligations(context),
    prisma.applicabilityAssessment.findMany({
      where: tenantWhere(ctx, { status: "APPLICABLE" as const }),
      include: { instrument: { select: { title: true } }, otherRequirementSource: { select: { title: true } } },
      orderBy: { assessedAt: "desc" },
    }),
    prisma.entity.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    prisma.site.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    prisma.environmentalAspect.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    prisma.operationalControl.findMany({ where: tenantWhere(ctx, { status: "ACTIVE" as const }), orderBy: { title: "asc" } }),
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.legalChangeEvent.findMany({
      where: { status: { in: ["TRIAGED", "REVIEW_REQUIRED"] } },
      include: { sourceInstrument: { select: { title: true } } },
      orderBy: { detectedAt: "desc" },
      take: 100,
    }),
  ]);

  const memberOptions = members.map((member) => ({ id: member.id, name: member.user.name ?? member.id }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Compliance obligations</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Turn an applicable legal source into a versioned compliance obligation. Only an obligation version approved by
          someone holding the compliance-obligation approval permission — the Sustainability Lead role by default —
          becomes this organisation&apos;s active obligation. Approved versions are immutable; changing an obligation&apos;s
          content always creates a new successor draft, and every draft, approval, rejection, return, and retirement is
          recorded in the audit trail.
        </p>
      </div>

      <ObligationWorkspace
        applicableAssessments={applicableAssessments.map((assessment) => ({
          id: assessment.id,
          instrumentTitle: assessment.instrument?.title ?? assessment.otherRequirementSource?.title ?? "Manual other-requirement source",
        }))}
        obligations={obligations.map((obligation) => ({
          id: obligation.id,
          activeVersionId: obligation.activeVersionId,
          versions: obligation.versions.map((version) => ({
            id: version.id,
            obligationId: obligation.id,
            version: version.version,
            status: version.status,
            title: version.title,
            requirementSummary: version.requirementSummary,
            instrumentTitle: version.instrument?.title ?? version.otherRequirementSource?.title ?? "Manual other-requirement source",
            applicabilityAssessmentId: version.applicabilityAssessmentId,
            ownerName: version.owner.user.name ?? version.ownerMembershipId,
            frequency: version.frequency,
            effectiveFrom: version.effectiveFrom ? version.effectiveFrom.toISOString() : null,
            reviewDueDate: version.reviewDueDate ? version.reviewDueDate.toISOString() : null,
            approvedByUserId: version.approvedByUserId,
            approvedAt: version.approvedAt ? version.approvedAt.toISOString() : null,
            supersedesVersionId: version.supersedesVersionId,
            scopes: version.scopes.map((scope) => ({
              id: scope.id,
              label: scope.entity?.name ?? scope.site?.name ?? scope.aspect?.name ?? "Unknown scope",
              kind: (scope.entityId ? "entity" : scope.siteId ? "site" : "aspect") as "entity" | "site" | "aspect",
            })),
            approvals: version.approvals.map((approval) => ({
              id: approval.id,
              decision: approval.decision,
              comment: approval.comment,
              decidedAt: approval.decidedAt.toISOString(),
            })),
          })),
        }))}
        entities={entities.map((entity) => ({ id: entity.id, name: entity.name }))}
        sites={sites.map((site) => ({ id: site.id, name: site.name }))}
        aspects={aspects.map((aspect) => ({ id: aspect.id, name: aspect.name }))}
        controls={controls.map((control) => ({ id: control.id, name: control.title }))}
        members={memberOptions}
        changeEvents={changeEvents.map((event) => ({ id: event.id, instrumentTitle: event.sourceInstrument.title }))}
        canEdit={hasPermission(context, "ems.compliance_obligation.edit")}
        canApprove={hasPermission(context, "ems.compliance_obligation.approve")}
      />
    </div>
  );
}

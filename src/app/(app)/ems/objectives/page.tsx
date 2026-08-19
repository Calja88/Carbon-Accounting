import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission, PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { listEnvironmentalObjectives } from "@/lib/ems/objectives/objective-service";
import { ObjectiveWorkspace } from "./objective-forms";

export const dynamic = "force-dynamic";

export default async function EnvironmentalObjectivesPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const ctx = toTenantRepositoryContext(context);

  const [objectives, members, policyRecords, aspectAssessments, obligationVersions, riskOpportunities] = await Promise.all([
    listEnvironmentalObjectives(context),
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.environmentalPolicyRecord.findMany({ where: tenantWhere(ctx, {}) }),
    prisma.aspectAssessment.findMany({ where: tenantWhere(ctx, {}), include: { aspect: { select: { name: true } } } }),
    prisma.complianceObligationVersion.findMany({ where: tenantWhere(ctx, {}), select: { id: true, title: true } }),
    prisma.emsRiskOpportunity.findMany({ where: tenantWhere(ctx, {}), select: { id: true, category: true, description: true } }),
  ]);

  const memberOptions = members.map((member) => ({ id: member.id, name: member.user.name ?? member.id }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Environmental objectives</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Draft objectives linked to policy, significant aspects, obligations, and risks/opportunities. Only a version
          approved by someone holding the objective-approval permission — the Sustainability Lead role by default —
          becomes this organisation&apos;s active objective. Objective achievement is always an explicit review decision;
          completing a linked action never marks an objective achieved. Approved versions are immutable; changing an
          objective&apos;s content always creates a new successor draft, and every draft, approval, rejection, return, and
          achievement decision is recorded in the audit trail.
        </p>
      </div>

      <ObjectiveWorkspace
        objectives={objectives.map((objective) => ({
          id: objective.id,
          activeVersionId: objective.activeVersionId,
          versions: objective.versions.map((version) => ({
            id: version.id,
            objectiveId: objective.id,
            version: version.version,
            status: version.status,
            title: version.title,
            intent: version.intent,
            ownerName: version.owner.user.name ?? version.ownerMembershipId,
            baselineDescription: version.baselineDescription,
            targetValue: version.targetValue ? version.targetValue.toString() : null,
            targetQualitative: version.targetQualitative,
            unit: version.unit,
            targetDate: version.targetDate.toISOString(),
            evaluationMethod: version.evaluationMethod,
            approvedByUserId: version.approvedByUserId,
            approvedAt: version.approvedAt ? version.approvedAt.toISOString() : null,
            achievementDecidedAt: version.achievementDecidedAt ? version.achievementDecidedAt.toISOString() : null,
            supersedesVersionId: version.supersedesVersionId,
            sourceLinks: version.sourceLinks.map((link) => ({
              id: link.id,
              linkType: link.linkType,
              label:
                link.policyRecord?.id ??
                link.aspectAssessment?.id ??
                link.obligationVersion?.title ??
                link.riskOpportunity?.category ??
                "Unknown link",
            })),
            approvals: version.approvals.map((approval) => ({
              id: approval.id,
              decision: approval.decision,
              comment: approval.comment,
              decidedAt: approval.decidedAt.toISOString(),
            })),
          })),
          metricDefinitions: objective.metricDefinitions.map((definition) => ({ id: definition.id, activeVersionId: definition.activeVersionId })),
        }))}
        members={memberOptions}
        policyRecords={policyRecords.map((record) => ({ id: record.id, name: record.id }))}
        aspectAssessments={aspectAssessments.map((assessment) => ({ id: assessment.id, name: assessment.aspect.name }))}
        obligationVersions={obligationVersions.map((version) => ({ id: version.id, name: version.title }))}
        riskOpportunities={riskOpportunities.map((row) => ({ id: row.id, name: `${row.category}: ${row.description}` }))}
        canEdit={hasPermission(context, "ems.objective.manage")}
        canApprove={hasPermission(context, "ems.objective.approve")}
      />
    </div>
  );
}

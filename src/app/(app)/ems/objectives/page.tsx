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

  const [objectives, members, policyRecords, aspectAssessments, obligationVersions, riskOpportunities, programmesByObjective] =
    await Promise.all([
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
      // Cross-link (spec: objective -> action programme). Counted here rather
      // than in objective-service.ts, which stays action-programme-agnostic —
      // T52's action model never reads from/writes to the objective module.
      prisma.actionProgramme.groupBy({
        by: ["objectiveId"],
        where: tenantWhere(ctx, { objectiveId: { not: null } }),
        _count: { _all: true },
      }),
    ]);

  const programmeCountByObjectiveId = new Map(
    programmesByObjective
      .filter((row): row is typeof row & { objectiveId: string } => row.objectiveId !== null)
      .map((row) => [row.objectiveId, row._count._all]),
  );

  const memberOptions = members.map((member) => ({ id: member.id, name: member.user.name ?? member.id }));
  const aspectNameByAssessmentId = new Map(aspectAssessments.map((assessment) => [assessment.id, assessment.aspect.name]));
  const riskLabelById = new Map(riskOpportunities.map((row) => [row.id, `${row.category}: ${row.description}`]));

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
        <p className="mt-2 text-sm">
          <a href="/ems/notifications" className="text-slate-500 underline underline-offset-2 hover:text-slate-900">
            View my reminders
          </a>
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
                (link.aspectAssessment ? aspectNameByAssessmentId.get(link.aspectAssessment.id) ?? link.aspectAssessment.id : null) ??
                link.obligationVersion?.title ??
                (link.riskOpportunity ? riskLabelById.get(link.riskOpportunity.id) ?? link.riskOpportunity.category : null) ??
                "Unknown link",
              href:
                link.linkType === "ASPECT_ASSESSMENT"
                  ? "/ems/aspects"
                  : link.linkType === "OBLIGATION_VERSION"
                    ? "/ems/legal/obligations"
                    : link.linkType === "POLICY" || link.linkType === "RISK_OPPORTUNITY"
                      ? "/ems/programme"
                      : null,
            })),
            approvals: version.approvals.map((approval) => ({
              id: approval.id,
              decision: approval.decision,
              comment: approval.comment,
              decidedAt: approval.decidedAt.toISOString(),
            })),
          })),
          metricDefinitions: objective.metricDefinitions.map((definition) => ({
            id: definition.id,
            activeVersionId: definition.activeVersionId,
            latestVersion: definition.versions[0]
              ? {
                  id: definition.versions[0].id,
                  name: definition.versions[0].name,
                  sourceType: definition.versions[0].sourceType,
                  unit: definition.versions[0].unit,
                  frequency: definition.versions[0].frequency,
                  status: definition.versions[0].status,
                }
              : null,
          })),
          actionProgrammeCount: programmeCountByObjectiveId.get(objective.id) ?? 0,
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

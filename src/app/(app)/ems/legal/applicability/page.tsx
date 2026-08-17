import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission, PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { listActivityProcesses } from "@/lib/ems/aspects/process-service";
import { listEnvironmentalAspects } from "@/lib/ems/aspects/aspect-service";
import { listAssessableLegalChangeEvents, listApplicabilityAssessments } from "@/lib/ems/legal/applicability-service";
import { ApplicabilityWorkspace } from "./applicability-forms";

export const dynamic = "force-dynamic";

export default async function ApplicabilityPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const ctx = toTenantRepositoryContext(context);

  const [changeEvents, assessments, processRows, aspectRows, entities, sites, members] = await Promise.all([
    listAssessableLegalChangeEvents(context),
    listApplicabilityAssessments(context),
    listActivityProcesses(context),
    listEnvironmentalAspects(context),
    prisma.entity.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    prisma.site.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  const assessmentIds = assessments.map((assessment) => assessment.id);
  const evidenceLinks = assessmentIds.length === 0
    ? []
    : await prisma.evidenceLink.findMany({
        where: { organisationId: context.organisationId, resourceType: "applicability_assessment", resourceId: { in: assessmentIds } },
        include: { evidence: { select: { id: true, filename: true } } },
        orderBy: { linkedAt: "desc" },
      });
  const evidenceByAssessment = new Map<string, Array<{ id: string; filename: string }>>();
  for (const link of evidenceLinks) {
    const current = evidenceByAssessment.get(link.resourceId) ?? [];
    current.push(link.evidence);
    evidenceByAssessment.set(link.resourceId, current);
  }

  const decidedAssessmentsByInstrument = new Map<string, string[]>();
  for (const assessment of assessments) {
    if (assessment.status === "APPLICABLE" || assessment.status === "NOT_APPLICABLE" || assessment.status === "UNCERTAIN") {
      const current = decidedAssessmentsByInstrument.get(assessment.instrumentId) ?? [];
      current.push(assessment.id);
      decidedAssessmentsByInstrument.set(assessment.instrumentId, current);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Legal applicability workflow</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Record a competent, reviewed judgement on whether a legal instrument applies to this organisation&apos;s
          entities, sites, processes, or aspects. Detecting a legal change is source evidence only — it never decides
          applicability. A decision requires a rationale, evidence, a reviewer, and a next-review date, and a
          NOT_APPLICABLE decision stays visible as reviewable history rather than being deleted.
        </p>
      </div>

      <ApplicabilityWorkspace
        changeEvents={changeEvents.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          detectedAt: event.detectedAt.toISOString(),
          instrumentId: event.sourceInstrument.id,
          instrumentTitle: event.sourceInstrument.title,
          affectedInstrumentId: event.affectedInstrument?.id ?? null,
          affectedInstrumentTitle: event.affectedInstrument?.title ?? null,
          organisationAssessmentCount: event.organisationAssessments.length,
        }))}
        assessments={assessments.map((assessment) => ({
          id: assessment.id,
          status: assessment.status,
          proposedDecision: assessment.proposedDecision,
          rationale: assessment.rationale,
          instrumentId: assessment.instrumentId,
          instrumentTitle: assessment.instrument.title,
          changeEventId: assessment.changeEventId,
          assessedAt: assessment.assessedAt.toISOString(),
          reviewedAt: assessment.reviewedAt ? assessment.reviewedAt.toISOString() : null,
          nextReviewAt: assessment.nextReviewAt ? assessment.nextReviewAt.toISOString() : null,
          supersedesAssessmentId: assessment.supersedesAssessmentId,
          scopes: assessment.scopes.map((scope) => ({
            id: scope.id,
            label: scope.entity?.name ?? scope.site?.name ?? scope.process?.name ?? scope.aspect?.name ?? "Unknown scope",
            kind: scope.entityId ? "entity" : scope.siteId ? "site" : scope.processId ? "process" : "aspect",
          })),
          evidence: evidenceByAssessment.get(assessment.id) ?? [],
          hasSuccessorEligible: (decidedAssessmentsByInstrument.get(assessment.instrumentId) ?? []).includes(assessment.id),
        }))}
        entities={entities.map((entity) => ({ id: entity.id, name: entity.name }))}
        sites={sites.map((site) => ({ id: site.id, name: site.name }))}
        processes={processRows
          .filter((process) => process.status !== "ARCHIVED" && process.status !== "SUPERSEDED")
          .map((process) => ({ id: process.id, name: process.name }))}
        aspects={aspectRows.map((aspect) => ({ id: aspect.id, name: aspect.name }))}
        members={members.map((member) => ({ id: member.id, name: member.user.name ?? member.id }))}
        canAssess={hasPermission(context, "ems.applicability.assess")}
        canReview={hasPermission(context, "ems.applicability.review")}
      />
    </div>
  );
}

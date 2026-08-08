import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { checkCanEditAssessment, getLcaActor } from "@/lib/lca/permissions";
import { GoalScopeForm } from "./goal-scope-form";

export const dynamic = "force-dynamic";

export default async function GoalScopePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [assessment, users, methodologies, actor] = await Promise.all([
    prisma.lcaAssessment.findUnique({ where: { id } }),
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.lcaMethodologyProfile.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    getLcaActor(),
  ]);

  if (!assessment) notFound();

  const permission = checkCanEditAssessment(actor, assessment.status);

  return (
    <GoalScopeForm
      assessment={{
        id: assessment.id,
        title: assessment.title,
        goal: assessment.goal,
        intendedApplication: assessment.intendedApplication,
        intendedAudience: assessment.intendedAudience,
        comparativeAssertionDisclosed: assessment.comparativeAssertionDisclosed,
        scopeDescription: assessment.scopeDescription,
        boundary: assessment.boundary,
        boundaryNotes: assessment.boundaryNotes,
        includedStages: assessment.includedStages,
        periodStart: assessment.periodStart ? assessment.periodStart.toISOString().slice(0, 10) : null,
        periodEnd: assessment.periodEnd ? assessment.periodEnd.toISOString().slice(0, 10) : null,
        ownerUserId: assessment.ownerUserId,
        methodologyProfileId: assessment.methodologyProfileId,
        methodologyNotes: assessment.methodologyNotes,
        functionalUnitDescription: assessment.functionalUnitDescription,
        functionalUnitQuantity: assessment.functionalUnitQuantity.toString(),
        functionalUnitUnit: assessment.functionalUnitUnit,
        isDeclaredUnit: assessment.isDeclaredUnit,
        declaredUnitDescription: assessment.declaredUnitDescription,
        referenceFlowDescription: assessment.referenceFlowDescription,
        referenceFlowQuantity: assessment.referenceFlowQuantity.toString(),
        referenceFlowUnit: assessment.referenceFlowUnit,
        modelledOutputQuantity: assessment.modelledOutputQuantity.toString(),
        modelledOutputUnit: assessment.modelledOutputUnit,
        modelledOutputDescription: assessment.modelledOutputDescription,
        usePhaseLifetimeYears: assessment.usePhaseLifetimeYears?.toString() ?? null,
        usePhaseAssumptions: assessment.usePhaseAssumptions,
        completenessNotes: assessment.completenessNotes,
        limitations: assessment.limitations,
        interpretation: assessment.interpretation,
      }}
      users={users}
      methodologies={methodologies.map((m) => ({ id: m.id, label: `${m.name} ${m.version}` }))}
      readOnly={!permission.ok}
      readOnlyReason={permission.ok ? null : permission.reason}
    />
  );
}

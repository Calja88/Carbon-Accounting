import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { checkCanEditAssessment, getLcaContext } from "@/lib/lca/permissions";
import { requireAssessmentInScope } from "@/lib/repositories/lca-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { GoalScopeForm } from "./goal-scope-form";

export const dynamic = "force-dynamic";

export default async function GoalScopePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getLcaContext();
  if (!context) notFound();

  let assessment;
  try {
    assessment = await requireAssessmentInScope(context, id);
  } catch (err) {
    if (err instanceof TenantOwnershipError || err instanceof PermissionDeniedError) notFound();
    throw err;
  }

  const [users, methodologies] = await Promise.all([
    // User is a global identity (spec §3), so candidate owners are limited to
    // this Organisation's active members — not every user on the platform.
    prisma.user.findMany({
      where: { memberships: { some: { organisationId: context.organisationId, status: "ACTIVE" } } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.lcaMethodologyProfile.findMany({
      // Archived profiles stay resolvable for assessments that already use
      // them, but must not be offered for a new selection.
      where: { archivedAt: null, OR: [{ organisationId: context.organisationId }, { organisationId: null }] },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
  ]);

  const permission = checkCanEditAssessment(context, assessment.status);

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

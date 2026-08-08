import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { GoalScopeForm } from "./goal-scope-form";

function isoDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function GoalScopePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // The project layout above has already authorized this study.
  const goal = await prisma.lcaGoalScope.findUnique({
    where: { projectId: id },
    include: { confirmedBy: { select: { name: true } } },
  });
  const project = await prisma.lcaProject.findUnique({ where: { id }, select: { id: true } });
  if (!project) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Goal and scope</h2>
        <p className="mt-1 text-sm text-slate-500">
          The methodological choices the rest of the study rests on. Each question explains what it is for and why it
          matters; none of them is answered for you, because a goal-and-scope decision made silently by software is a
          decision nobody can defend later.
        </p>
      </div>

      <GoalScopeForm
        projectId={id}
        values={{
          purpose: goal?.purpose ?? "",
          intendedApplication: goal?.intendedApplication ?? "",
          intendedAudience: goal?.intendedAudience ?? "",
          comparativeAssertion: goal?.comparativeAssertion ?? false,
          functionalUnitDescription: goal?.functionalUnitDescription ?? "",
          functionalUnitQuantity: goal?.functionalUnitQuantity ? String(Number(goal.functionalUnitQuantity)) : "",
          functionalUnitUnit: goal?.functionalUnitUnit ?? "",
          referenceFlowDescription: goal?.referenceFlowDescription ?? "",
          referenceFlowQuantity: goal?.referenceFlowQuantity ? String(Number(goal.referenceFlowQuantity)) : "",
          referenceFlowUnit: goal?.referenceFlowUnit ?? "",
          systemBoundaryType: goal?.systemBoundaryType ?? "CRADLE_TO_GATE",
          systemBoundaryNotes: goal?.systemBoundaryNotes ?? "",
          geography: goal?.geography ?? "",
          timePeriodStart: isoDate(goal?.timePeriodStart ?? null),
          timePeriodEnd: isoDate(goal?.timePeriodEnd ?? null),
          technologyDescription: goal?.technologyDescription ?? "",
          cutOffCriteria: goal?.cutOffCriteria ?? "",
          exclusions: goal?.exclusions ?? "",
          allocationMethod: goal?.allocationMethod ?? "NOT_APPLICABLE",
          allocationRationale: goal?.allocationRationale ?? "",
          impactCategories: (goal?.impactCategories ?? ["Climate change (GWP100, kgCO2e)"]).join("\n"),
          dataQualityRequirements: goal?.dataQualityRequirements ?? "",
          limitations: goal?.limitations ?? "",
          criticalReviewStatus: goal?.criticalReviewStatus ?? "NOT_REVIEWED",
          criticalReviewNotes: goal?.criticalReviewNotes ?? "",
          confirmedAt: goal?.confirmedAt?.toISOString() ?? null,
          confirmedBy: goal?.confirmedBy?.name ?? null,
        }}
      />
    </div>
  );
}

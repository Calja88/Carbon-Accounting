import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAssessmentHeader } from "@/lib/lca/assessment-service";
import { isCalculationStale, runTotals } from "@/lib/lca/calculation-service";
import { runValidation } from "@/lib/lca/validation-service";
import { formatKgPrecise } from "@/components/charts/palette";
import { Badge } from "@/components/ui/badge";
import { BackLink, Notice, StatusBadge } from "@/components/lca/ui";
import { BOUNDARY_LABELS } from "@/lib/lca/labels";
import { AssessmentNav } from "./assessment-nav";
import { RunCalculationButton } from "./run-calculation-button";

export const dynamic = "force-dynamic";

export default async function AssessmentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const assessment = await getAssessmentHeader(id);
  if (!assessment) notFound();

  const [staleness, validation, counts, run] = await Promise.all([
    isCalculationStale(id),
    runValidation(id),
    Promise.all([
      prisma.lcaInventoryItem.count({ where: { assessmentId: id } }),
      prisma.lcaAssumption.count({ where: { assessmentId: id } }),
      prisma.lcaExclusion.count({ where: { assessmentId: id } }),
      prisma.lcaEvidence.count({ where: { assessmentId: id } }),
      prisma.lcaAssessment.count({ where: { baselineAssessmentId: id } }),
    ]),
    assessment.lastCalculationRunId
      ? prisma.lcaCalculationRun.findUnique({ where: { id: assessment.lastCalculationRunId } })
      : null,
  ]);

  const [inventoryCount, assumptionCount, exclusionCount, evidenceCount, scenarioCount] = counts;
  const totals = run ? runTotals(run) : null;

  // Grouped for the tab bar's two-row layout at >=1024px and the <select>
  // picker below it — same 13 destinations, same relative order, only
  // grouping headers added (see docs/ui-overhaul-plan.md §5/§14 Phase 7).
  const navItems = [
    { segment: "", label: "Overview", group: null },
    { segment: "goal-scope", label: "Goal & scope", group: "Setup" },
    { segment: "model", label: "Lifecycle model", group: "Setup" },
    { segment: "inventory", label: "Inventory & BOM", badge: inventoryCount, badgeTone: "neutral" as const, group: "Setup" },
    { segment: "results", label: "Results", group: "Analysis" },
    { segment: "data-quality", label: "Data quality", group: "Analysis" },
    { segment: "scenarios", label: "Scenarios", badge: scenarioCount, badgeTone: "neutral" as const, group: "Analysis" },
    {
      segment: "registers",
      label: "Assumptions & exclusions",
      badge: assumptionCount + exclusionCount,
      badgeTone: "neutral" as const,
      group: "Governance",
    },
    { segment: "evidence", label: "Evidence", badge: evidenceCount, badgeTone: "neutral" as const, group: "Governance" },
    { segment: "review", label: "Review", badge: validation.errorCount, badgeTone: "danger" as const, group: "Governance" },
    { segment: "versions", label: "Versions", group: "Governance" },
    { segment: "audit", label: "Audit trail", group: "Governance" },
    { segment: "report", label: "Report", group: "Output" },
  ];

  return (
    <div className="space-y-5">
      <div className="no-print space-y-4">
        <BackLink href="/assessments">All assessments</BackLink>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span className="font-mono normal-case">{assessment.reference}</span>
              <span aria-hidden="true">·</span>
              <Link href={`/products/${assessment.productVersion.productId}`} className="hover:text-slate-800">
                {assessment.productVersion.product.name}
              </Link>
              <span aria-hidden="true">·</span>
              <span className="normal-case">{assessment.productVersion.versionLabel}</span>
              {assessment.isScenario && <Badge tone="info">Scenario</Badge>}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{assessment.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <StatusBadge status={assessment.status} />
              <span>{BOUNDARY_LABELS[assessment.boundary]}</span>
              <span aria-hidden="true">·</span>
              <span>{assessment.entity.name}</span>
              {assessment.owner && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Owner: {assessment.owner.name}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>Version {assessment.version}</span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            {totals ? (
              <div className="text-right">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {assessment.isDeclaredUnit ? "Per declared unit" : "Per functional unit"}
                </div>
                <div className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
                  {formatKgPrecise(totals.headlinePerFunctionalUnitKgCo2e)}
                  <span className="ml-1 text-sm font-normal text-slate-500">kgCO2e</span>
                </div>
              </div>
            ) : (
              <div className="text-right text-sm text-slate-500">Not yet calculated</div>
            )}
            <RunCalculationButton assessmentId={id} stale={staleness.stale} />
          </div>
        </div>

        {assessment.isScenario && assessment.baselineAssessment && (
          <Notice tone="info" title="This is a scenario">
            An independent copy of{" "}
            <Link href={`/assessments/${assessment.baselineAssessment.id}`} className="font-medium underline">
              {assessment.baselineAssessment.reference} {assessment.baselineAssessment.title}
            </Link>
            . Changes here cannot affect the baseline.
          </Notice>
        )}

        {staleness.stale && (
          <Notice tone="warning" title="Results are out of date">
            {staleness.reason} Any figure shown until you re-run the calculation describes an earlier version of the model.
          </Notice>
        )}

        {assessment.status === "SUPERSEDED" && (
          <Notice tone="info" title="Superseded">
            This assessment has been replaced by a later revision and is read-only. It remains available so anything
            issued from it can still be traced.
          </Notice>
        )}

        <AssessmentNav assessmentId={id} items={navItems} />
      </div>

      {children}
    </div>
  );
}

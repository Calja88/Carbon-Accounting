import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getLatestRun, loadAssessment, resultsToAnalysisRows, runTotals } from "@/lib/lca/calculation-service";
import { analyseContributions, summariseDataQuality } from "@/lib/lca/analysis";
import { runValidation } from "@/lib/lca/validation-service";
import { buildReadinessReport } from "@/lib/lca/readiness-service";
import { toMethodologyConfig } from "@/lib/lca/methodology";
import { LIFECYCLE_STAGE_ORDER, BOUNDARY_LABELS, STAGE_LABELS } from "@/lib/lca/labels";
import { formatKgPrecise } from "@/components/charts/palette";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldList, Notice, PlaceholderFactorWarning, ReadinessBadge, SectionCard, Stat } from "@/components/lca/ui";
import { LifecycleFlow, type FlowStage } from "@/components/lca/lifecycle-flow";

export const dynamic = "force-dynamic";

export default async function AssessmentOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const assessment = await loadAssessment(id);
  if (!assessment) notFound();

  const [run, validation, readiness, scenarioCount] = await Promise.all([
    getLatestRun(id),
    runValidation(id),
    buildReadinessReport(id),
    prisma.lcaAssessment.count({ where: { baselineAssessmentId: id } }),
  ]);

  const rows = run ? resultsToAnalysisRows(run.results) : [];
  const totals = run ? runTotals(run) : null;
  const contributions = run ? analyseContributions(rows) : null;
  const dataQuality = run ? summariseDataQuality(rows) : null;
  const methodology = toMethodologyConfig(assessment.methodologyProfile);

  const includedProcesses = assessment.processes.filter((p) => p.isIncluded);
  const flowStages: FlowStage[] = LIFECYCLE_STAGE_ORDER.map((stage) => {
    const stageProcesses = includedProcesses.filter((p) => p.stage === stage);
    const stageItems = assessment.inventoryItems.filter(
      (item) => !item.isExcluded && stageProcesses.some((p) => p.id === item.processId),
    );
    const contribution = contributions?.byStage.find((s) => s.key === stage);
    return {
      stage,
      kgCo2e: contribution?.kgCo2e ?? 0,
      percent: contribution?.percent ?? 0,
      processCount: stageProcesses.length,
      itemCount: stageItems.length,
      inBoundary: assessment.includedStages.includes(stage),
      modelled: stageProcesses.length > 0,
    };
  });

  const unitLabel = assessment.isDeclaredUnit ? "declared unit" : "functional unit";

  return (
    <div className="space-y-6">
      {dataQuality && <PlaceholderFactorWarning percent={dataQuality.placeholderFactorPercent} />}

      {!run && (
        <Notice tone="info" title="Not calculated yet">
          Build the lifecycle model and inventory, then run the calculation. Until then this assessment has no figures,
          and the validation checks that depend on results cannot run.
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <Stat
              label={`Per ${unitLabel}`}
              value={totals ? formatKgPrecise(totals.headlinePerFunctionalUnitKgCo2e) : "—"}
              unit="kgCO2e"
              caption={assessment.functionalUnitDescription ?? "Functional unit not yet described"}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <Stat
              label="Total model emissions"
              value={totals ? formatKgPrecise(totals.headlineModelKgCo2e) : "—"}
              unit="kgCO2e"
              caption={
                totals
                  ? `${formatKgPrecise(totals.functionalUnitsInModel)} ${unitLabel}s in the model`
                  : "Awaiting a calculation run"
              }
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <Stat
              label="Inventory"
              value={String(assessment.inventoryItems.filter((i) => !i.isExcluded).length)}
              caption={`${includedProcesses.length} process(es) across ${new Set(includedProcesses.map((p) => p.stage)).size} stage(s)`}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <Stat
              label="Validation"
              value={String(validation.errorCount)}
              unit={validation.errorCount === 1 ? "error" : "errors"}
              tone={validation.errorCount > 0 ? "default" : "muted"}
              caption={`${validation.warningCount} warning(s), ${validation.advisoryCount} advisory`}
            />
          </CardContent>
        </Card>
      </div>

      <SectionCard
        title="Lifecycle at a glance"
        description="The path this product takes, and where its emissions sit along it."
      >
        <LifecycleFlow stages={flowStages} />
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Verification readiness"
          description="What an independent reviewer would find today, area by area."
          actions={<ReadinessBadge state={readiness.overall} />}
        >
          <p className="text-sm text-slate-600">{readiness.overallExplanation}</p>
          <ul className="mt-3 space-y-2">
            {readiness.areas.map((area) => (
              <li key={area.area} className="flex items-start justify-between gap-3 text-sm">
                <span className="text-slate-700">{area.label}</span>
                <ReadinessBadge state={area.state} />
              </li>
            ))}
          </ul>
          <Link
            href={`/assessments/${id}/review`}
            className="mt-4 inline-block text-sm font-medium text-brand-700 hover:text-brand-800"
          >
            Open the review centre →
          </Link>
        </SectionCard>

        <SectionCard title="Goal, scope and methodology" description="The decisions every figure in this assessment rests on.">
          <FieldList
            items={[
              { label: "Goal", value: assessment.goal },
              { label: "Boundary", value: `${BOUNDARY_LABELS[assessment.boundary]}${assessment.boundaryNotes ? ` — ${assessment.boundaryNotes}` : ""}` },
              {
                label: assessment.isDeclaredUnit ? "Declared unit" : "Functional unit",
                value: assessment.functionalUnitDescription,
              },
              {
                label: "Assessment period",
                value:
                  assessment.periodStart && assessment.periodEnd
                    ? `${assessment.periodStart.toISOString().slice(0, 10)} to ${assessment.periodEnd.toISOString().slice(0, 10)}`
                    : null,
              },
              { label: "Methodology", value: assessment.methodologyProfile ? `${methodology.name} ${methodology.version}` : null },
              { label: "GWP basis", value: methodology.gwpBasis },
              { label: "Allocation default", value: methodology.defaultAllocationMethod.replace(/_/g, " ").toLowerCase() },
              { label: "Recycling treatment", value: methodology.recyclingMethod.replace(/_/g, " ").toLowerCase() },
              {
                label: "Stages in scope",
                value: assessment.includedStages.length > 0 ? assessment.includedStages.map((s) => STAGE_LABELS[s]).join(", ") : null,
              },
            ]}
          />
          <Link
            href={`/assessments/${id}/goal-scope`}
            className="mt-3 inline-block text-sm font-medium text-brand-700 hover:text-brand-800"
          >
            Edit goal and scope →
          </Link>
        </SectionCard>
      </div>

      {contributions && contributions.hotspots.length > 0 && (
        <SectionCard
          title="Largest contributors"
          description="Where the footprint actually comes from — the first place to look for both a reduction and a data-quality improvement."
          actions={
            <Link href={`/assessments/${id}/results`} className="text-sm font-medium text-brand-700 hover:text-brand-800">
              Full results →
            </Link>
          }
        >
          <ol className="space-y-2">
            {contributions.hotspots.slice(0, 5).map((hotspot, index) => (
              <li key={hotspot.key} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  <span className="mr-2 text-slate-400">{index + 1}</span>
                  <span className="font-medium text-slate-800">{hotspot.label}</span>
                  {hotspot.sublabel && <span className="ml-2 text-xs text-slate-500">{hotspot.sublabel}</span>}
                </span>
                <span className="shrink-0 tabular-nums text-slate-600">
                  {formatKgPrecise(hotspot.perFunctionalUnitKgCo2e)} kgCO2e
                  <span className="ml-2 text-xs text-slate-500">{hotspot.percent.toFixed(1)}%</span>
                </span>
              </li>
            ))}
          </ol>
        </SectionCard>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Where to go next</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: `/assessments/${id}/model`, label: "Lifecycle model", description: "Processes, nesting and multi-output allocation." },
            { href: `/assessments/${id}/inventory`, label: "Inventory & BOM", description: "Materials, energy, freight, waste and their factors." },
            { href: `/assessments/${id}/results`, label: "Results", description: "Contributions, hotspots and the carbon classes." },
            { href: `/assessments/${id}/data-quality`, label: "Data quality", description: "Coverage, pedigree scores, uncertainty and sensitivity." },
            { href: `/assessments/${id}/scenarios`, label: `Scenarios (${scenarioCount})`, description: "Independent copies for testing changes." },
            { href: `/assessments/${id}/report`, label: "Report", description: "The full assessment report, ready to print or share." },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg border border-slate-200 px-4 py-3 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <div className="text-sm font-medium text-slate-900">{link.label}</div>
              <div className="mt-0.5 text-xs text-slate-500">{link.description}</div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

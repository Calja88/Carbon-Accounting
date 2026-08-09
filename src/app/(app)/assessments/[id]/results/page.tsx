import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { getLatestRun, loadAssessment, resultsToAnalysisRows, runTotals } from "@/lib/lca/calculation-service";
import { analyseContributions, summariseDataQuality } from "@/lib/lca/analysis";
import { LIFECYCLE_STAGE_ORDER, CLASSIFICATION_LABELS, STAGE_LABELS } from "@/lib/lca/labels";
import { toMethodologyConfig } from "@/lib/lca/methodology";
import {
  CLASSIFICATION_COLORS,
  DATA_TYPE_COLORS,
  LIFECYCLE_STAGE_COLORS,
  formatKgPrecise,
} from "@/components/charts/palette";
import { ContributionBarChart, ProportionBar } from "@/components/charts/contribution-bar-chart";
import { StackedBarChart } from "@/components/charts/stacked-bar-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, EmptyState, Notice, PageHeading, PlaceholderFactorWarning, SectionCard, Stat, Td } from "@/components/lca/ui";
import { LifecycleFlow, type FlowStage } from "@/components/lca/lifecycle-flow";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [assessment, run] = await Promise.all([loadAssessment(id), getLatestRun(id)]);
  if (!assessment) notFound();

  if (!run) {
    return (
      <EmptyState
        title="Nothing calculated yet"
        description="Build the lifecycle model and inventory, then run the calculation. Results, contributions and hotspots all come from a stored run, so the figures on this page and in the exports can never disagree."
        action={
          <Link href={`/assessments/${id}/inventory`} className="text-sm font-medium text-brand-700 hover:text-brand-800">
            Go to the inventory →
          </Link>
        }
      />
    );
  }

  const rows = resultsToAnalysisRows(run.results);
  const totals = runTotals(run);
  const contributions = analyseContributions(rows);
  const dataQuality = summariseDataQuality(rows);
  const methodology = toMethodologyConfig(assessment.methodologyProfile);
  const unitLabel = assessment.isDeclaredUnit ? "declared unit" : "functional unit";

  const includedProcesses = assessment.processes.filter((p) => p.isIncluded);
  const flowStages: FlowStage[] = LIFECYCLE_STAGE_ORDER.map((stage) => {
    const stageProcesses = includedProcesses.filter((p) => p.stage === stage);
    const contribution = contributions.byStage.find((s) => s.key === stage);
    return {
      stage,
      kgCo2e: contribution?.kgCo2e ?? 0,
      percent: contribution?.percent ?? 0,
      processCount: stageProcesses.length,
      itemCount: assessment.inventoryItems.filter((i) => !i.isExcluded && stageProcesses.some((p) => p.id === i.processId)).length,
      inBoundary: assessment.includedStages.includes(stage),
      modelled: stageProcesses.length > 0,
    };
  });

  const classificationRows = [
    { key: "FOSSIL", model: totals.model.fossil, perFu: totals.perFunctionalUnit.fossil, inHeadline: true },
    {
      key: "BIOGENIC",
      model: totals.model.biogenicEmissions,
      perFu: totals.perFunctionalUnit.biogenicEmissions,
      inHeadline: methodology.biogenicTreatment === "INCLUDED_IN_TOTAL",
    },
    {
      key: "BIOGENIC_REMOVAL",
      model: totals.model.biogenicRemovals,
      perFu: totals.perFunctionalUnit.biogenicRemovals,
      inHeadline: methodology.biogenicTreatment === "INCLUDED_IN_TOTAL",
    },
    { key: "TECHNOLOGICAL_REMOVAL", model: totals.model.technologicalRemovals, perFu: totals.perFunctionalUnit.technologicalRemovals, inHeadline: false },
    { key: "STORED_CARBON", model: totals.model.storedCarbon, perFu: totals.perFunctionalUnit.storedCarbon, inHeadline: false },
    { key: "AVOIDED_BURDEN", model: totals.model.avoidedBurden, perFu: totals.perFunctionalUnit.avoidedBurden, inHeadline: true },
    { key: "OFFSET", model: totals.model.offsets, perFu: totals.perFunctionalUnit.offsets, inHeadline: false },
  ].filter((row) => row.model !== 0);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Results"
        description={`From the calculation run of ${run.runAt.toISOString().slice(0, 16).replace("T", " ")} on engine ${run.engineVersion}. Every figure here traces back to a result line with its own arithmetic.`}
        actions={
          <div className="flex gap-2">
            <a href={`/api/lca/assessments/${id}/calculation-register.csv`}>
              <Button size="sm" variant="secondary">
                <Download className="h-4 w-4" />
                Calculation register
              </Button>
            </a>
            <a href={`/api/lca/assessments/${id}/export.json`}>
              <Button size="sm" variant="secondary">
                <Download className="h-4 w-4" />
                Structured export
              </Button>
            </a>
          </div>
        }
      />

      <PlaceholderFactorWarning percent={dataQuality.placeholderFactorPercent} />

      {!totals.functionalUnitResolved && (
        <Notice tone="danger" title="Per-functional-unit figures unavailable">
          {totals.functionalUnitNote}
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <Stat
              label={`Product carbon footprint per ${unitLabel}`}
              value={formatKgPrecise(totals.headlinePerFunctionalUnitKgCo2e)}
              unit="kgCO2e"
              caption={assessment.functionalUnitDescription ?? "Unit not described"}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <Stat
              label="Total model emissions"
              value={formatKgPrecise(totals.headlineModelKgCo2e)}
              unit="kgCO2e"
              caption={`Over ${formatKgPrecise(totals.functionalUnitsInModel)} ${unitLabel}s`}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <Stat
              label={`Including biogenic, per ${unitLabel}`}
              value={formatKgPrecise(totals.includingBiogenicPerFunctionalUnitKgCo2e)}
              unit="kgCO2e"
              caption={
                methodology.biogenicTreatment === "INCLUDED_IN_TOTAL"
                  ? "Same as the headline — biogenic is in the total under this methodology"
                  : "Reported alongside; biogenic is not in the headline under this methodology"
              }
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <Stat
              label="Result lines"
              value={String(run.results.length)}
              caption={`${contributions.byProcess.length} process(es), ${contributions.byItem.length} inventory line(s)`}
            />
          </CardContent>
        </Card>
      </div>

      <SectionCard title="Lifecycle contribution" description="Where the footprint sits along the product's life.">
        <LifecycleFlow stages={flowStages} />
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="By lifecycle stage" description="Shares are against gross emissions, so credits cannot push the total past 100%.">
          <ContributionBarChart
            bars={contributions.byStage.map((c) => ({
              key: c.key,
              label: c.label,
              value: c.perFunctionalUnitKgCo2e,
              percent: c.percent,
              color: LIFECYCLE_STAGE_COLORS[c.key],
            }))}
            unitLabel={`kgCO2e / ${unitLabel}`}
          />
        </SectionCard>

        <SectionCard title="By process" description="Including nested processes, each carrying its own allocation.">
          <ContributionBarChart
            bars={contributions.byProcess.map((c) => ({
              key: c.key,
              label: c.label,
              sublabel: c.sublabel,
              value: c.perFunctionalUnitKgCo2e,
              percent: c.percent,
            }))}
            maxBars={12}
            unitLabel={`kgCO2e / ${unitLabel}`}
          />
        </SectionCard>

        <SectionCard title="By material" description="Material and packaging lines, grouped by the material they are made of.">
          <ContributionBarChart
            bars={contributions.byMaterial.map((c) => ({
              key: c.key,
              label: c.label,
              value: c.perFunctionalUnitKgCo2e,
              percent: c.percent,
            }))}
            maxBars={12}
            emptyMessage="No material lines yet."
            unitLabel={`kgCO2e / ${unitLabel}`}
          />
        </SectionCard>

        <SectionCard
          title="By supplier"
          description="Where a supplier is recorded. Lines with no supplier are grouped together rather than hidden."
        >
          <ContributionBarChart
            bars={contributions.bySupplier.map((c) => ({
              key: c.key,
              label: c.label,
              value: c.perFunctionalUnitKgCo2e,
              percent: c.percent,
            }))}
            maxBars={12}
            unitLabel={`kgCO2e / ${unitLabel}`}
          />
        </SectionCard>
      </div>

      <SectionCard
        title="Hotspots"
        description="The largest individual lines. The first place to look for a reduction, and the first place to improve data quality."
      >
        <ContributionBarChart
          bars={contributions.hotspots.map((c) => ({
            key: c.key,
            label: c.label,
            sublabel: c.sublabel,
            value: c.perFunctionalUnitKgCo2e,
            percent: c.percent,
          }))}
          unitLabel={`kgCO2e / ${unitLabel}`}
        />
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Carbon classes"
          description="Gross emissions, removals, stored carbon and credits are tracked separately. None of them is netted into another without that being visible here."
        >
          <DataTable
            headers={["Class", { label: "Model total", align: "right" }, { label: `Per ${unitLabel}`, align: "right" }, "In the headline?"]}
          >
            {classificationRows.map((row) => (
              <tr key={row.key}>
                <Td>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: CLASSIFICATION_COLORS[row.key] }}
                    />
                    {CLASSIFICATION_LABELS[row.key as keyof typeof CLASSIFICATION_LABELS]}
                  </span>
                </Td>
                <Td align="right">{formatKgPrecise(row.model)}</Td>
                <Td align="right">{formatKgPrecise(row.perFu)}</Td>
                <Td className="text-xs">{row.inHeadline ? "Yes" : "No — reported separately"}</Td>
              </tr>
            ))}
          </DataTable>
          {totals.model.offsets !== 0 && (
            <Notice tone="info">
              Offsets are disclosed but never subtracted from the product footprint. A purchased credit does not reduce
              the emissions this product caused.
            </Notice>
          )}
        </SectionCard>

        <SectionCard
          title="Primary and secondary data"
          description="Share of the footprint by the kind of data behind it."
        >
          <ProportionBar
            segments={dataQuality.coverage
              .filter((c) => c.dataType !== "MISSING_QUALITY")
              .map((c) => ({
                key: String(c.dataType),
                label: c.label,
                percent: c.percent,
                color: DATA_TYPE_COLORS[String(c.dataType)] ?? "#cbd5e1",
                detail: `${c.lineCount} line(s)`,
              }))}
          />
          <Link
            href={`/assessments/${id}/data-quality`}
            className="mt-4 inline-block text-sm font-medium text-brand-700 hover:text-brand-800"
          >
            Full data quality and uncertainty →
          </Link>
        </SectionCard>
      </div>

      <SectionCard
        title="Stage totals by process"
        description="Every process on one scale, so their sizes are directly comparable."
      >
        <StackedBarChart
          rows={contributions.byProcess.slice(0, 15).map((c) => ({
            label: c.label,
            sublabel: c.sublabel,
            segments: [
              {
                label: c.label,
                value: Math.max(0, c.kgCo2e),
                color: LIFECYCLE_STAGE_COLORS[
                  LIFECYCLE_STAGE_ORDER.find((stage) => STAGE_LABELS[stage] === c.sublabel) ?? "OTHER"
                ],
              },
            ],
          }))}
          legend={LIFECYCLE_STAGE_ORDER.filter((stage) =>
            contributions.byProcess.some((c) => c.sublabel === STAGE_LABELS[stage]),
          ).map((stage) => ({ label: STAGE_LABELS[stage], color: LIFECYCLE_STAGE_COLORS[stage] }))}
          emptyMessage="No process results for this run."
        />
      </SectionCard>

      <SectionCard
        title="All result lines"
        description="Every figure the run produced. Open any line for the full activity → conversion → factor → allocation → result trail."
      >
        <DataTable
          headers={[
            "Stage",
            "Process",
            "Line",
            { label: "Activity", align: "right" },
            "Factor",
            { label: "kgCO2e", align: "right" },
            { label: `Per ${unitLabel}`, align: "right" },
            "",
          ]}
        >
          {run.results.map((result) => (
            <tr key={result.id} className="hover:bg-slate-50">
              <Td className="text-xs">{STAGE_LABELS[result.stage]}</Td>
              <Td className="text-xs">{result.processName}</Td>
              <Td className="font-medium text-slate-900">{result.itemName}</Td>
              <Td align="right">
                {result.normalizedValue.toString()} {result.normalizedUnit}
              </Td>
              <Td className="text-xs">
                {result.factorValue.toString()} kgCO2e/{result.factorUnit}
                <span className="block text-slate-500">{result.factorSource}</span>
              </Td>
              <Td align="right">{formatKgPrecise(Number(result.allocatedKgCo2e))}</Td>
              <Td align="right">{formatKgPrecise(Number(result.perFunctionalUnitKgCo2e))}</Td>
              <Td align="right">
                <Link href={`/assessments/${id}/results/${result.id}`} className="text-xs font-medium text-brand-700 hover:text-brand-800">
                  How?
                </Link>
              </Td>
            </tr>
          ))}
        </DataTable>
      </SectionCard>
    </div>
  );
}

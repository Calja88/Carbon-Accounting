import { notFound } from "next/navigation";
import { getLatestRun, loadAssessment, resultsToAnalysisRows, runTotals } from "@/lib/lca/calculation-service";
import {
  qualityScoreToIndicator,
  sensitivityAnalysis,
  summariseDataQuality,
  summariseUncertainty,
} from "@/lib/lca/analysis";
import { toMethodologyConfig } from "@/lib/lca/methodology";
import { getLcaContext } from "@/lib/lca/permissions";
import { requireAssessmentInScope } from "@/lib/repositories/lca-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { DATA_TYPE_COLORS, formatKgPrecise } from "@/components/charts/palette";
import { ContributionBarChart, ProportionBar } from "@/components/charts/contribution-bar-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, EmptyState, Notice, PageHeading, SectionCard, Stat, Td } from "@/components/lca/ui";
import { DATA_TYPE_SHORT, STAGE_LABELS } from "@/lib/lca/labels";

export const dynamic = "force-dynamic";

export default async function DataQualityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getLcaContext();
  if (!context) notFound();
  try {
    await requireAssessmentInScope(context, id);
  } catch (err) {
    if (err instanceof TenantOwnershipError || err instanceof PermissionDeniedError) notFound();
    throw err;
  }

  const [assessment, run] = await Promise.all([loadAssessment(id), getLatestRun(id)]);
  if (!assessment) notFound();

  if (!run) {
    return (
      <EmptyState
        title="Nothing calculated yet"
        description="Data quality is weighted by each line's share of the footprint, so it needs a calculation run to be meaningful."
      />
    );
  }

  const rows = resultsToAnalysisRows(run.results);
  const totals = runTotals(run);
  const dataQuality = summariseDataQuality(rows);
  const uncertainty = summariseUncertainty(rows);
  const sensitivity = sensitivityAnalysis(rows, 10, 10);
  const methodology = toMethodologyConfig(assessment.methodologyProfile);
  const indicator = qualityScoreToIndicator(dataQuality.footprintWeightedScore);

  const scoredItems = assessment.inventoryItems.filter((item) => !item.isExcluded);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Data quality and uncertainty"
        description="How good the data behind the footprint is, where it is weakest, and how much the answer could move."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <Stat
              label="Footprint-weighted quality"
              value={dataQuality.footprintWeightedScore !== null ? dataQuality.footprintWeightedScore.toFixed(2) : "—"}
              caption={
                <>
                  1 is best, 5 is worst. <Badge tone={indicator.tone}>{indicator.label}</Badge>
                </>
              }
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <Stat
              label="Unweighted mean"
              value={dataQuality.simpleMeanScore !== null ? dataQuality.simpleMeanScore.toFixed(2) : "—"}
              caption={`${dataQuality.scoredLineCount} of ${dataQuality.totalLineCount} result line(s) scored`}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <Stat
              label="Footprint left unscored"
              value={dataQuality.unscoredEmissionsPercent.toFixed(1)}
              unit="%"
              caption="Emissions sitting on lines with no data-quality scores"
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <Stat
              label="Indicative uncertainty"
              value={uncertainty.combinedPercent !== null ? `±${uncertainty.combinedPercent.toFixed(1)}` : "—"}
              unit={uncertainty.combinedPercent !== null ? "%" : undefined}
              caption={`Covering ${uncertainty.coveragePercent.toFixed(1)}% of emissions`}
            />
          </CardContent>
        </Card>
      </div>

      {methodology.minimumDataQualityScore !== null &&
        dataQuality.footprintWeightedScore !== null &&
        dataQuality.footprintWeightedScore > methodology.minimumDataQualityScore && (
          <Notice tone="warning" title="Below the methodology's data-quality requirement">
            This assessment&apos;s methodology asks for a weighted score of {methodology.minimumDataQualityScore} or
            better. The current score is {dataQuality.footprintWeightedScore.toFixed(2)}. Improving the largest
            contributors moves it fastest.
          </Notice>
        )}

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Data type coverage"
          description="Share of the footprint by the kind of data behind it, weighted by emissions rather than by line count."
        >
          <ProportionBar
            segments={dataQuality.coverage.map((c) => ({
              key: String(c.dataType),
              label: c.label,
              percent: c.percent,
              color: DATA_TYPE_COLORS[String(c.dataType)] ?? "#cbd5e1",
              detail: `${c.lineCount} line(s)`,
            }))}
          />
          <p className="mt-3 text-xs text-slate-500">
            &quot;No data-quality scores recorded&quot; overlaps the other categories: it counts emissions on lines that
            have a data type but no pedigree scores.
          </p>
        </SectionCard>

        <SectionCard
          title="Uncertainty"
          description="Line-level uncertainties combined into an indicative range for the total."
        >
          {uncertainty.combinedPercent === null ? (
            <p className="text-sm text-slate-500">
              No line carries a quantified uncertainty yet, so no range can be produced. Record uncertainty on the largest
              contributors first — they dominate the combined figure.
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Lower" value={formatKgPrecise(uncertainty.lowerKgCo2e ?? 0)} unit="kgCO2e" />
                <Stat label="Central" value={formatKgPrecise(uncertainty.totalKgCo2e)} unit="kgCO2e" />
                <Stat label="Upper" value={formatKgPrecise(uncertainty.upperKgCo2e ?? 0)} unit="kgCO2e" />
              </div>
              <p className="mt-4 text-sm text-slate-600">{uncertainty.method}</p>
              <Notice tone="warning" title="Read this range carefully">
                {uncertainty.caveat}
              </Notice>
            </>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Sensitivity"
        description={`If one line moved by ${sensitivity.testedChangePercent}% and everything else stayed still, this is what would happen to the total. Deterministic and one-at-a-time — it makes no claim about how likely any of these moves is.`}
      >
        <ContributionBarChart
          bars={sensitivity.entries.map((entry) => ({
            key: entry.key,
            label: entry.label,
            sublabel: entry.sublabel,
            value: entry.deltaKgCo2e,
            percent: Math.abs(entry.deltaTotalPercent),
          }))}
          emptyMessage="No lines to test."
          unitLabel="kgCO2e change in the total"
        />
        <DataTable
          headers={[
            "Line",
            { label: "Current", align: "right" },
            { label: "Share", align: "right" },
            { label: `Effect of +${sensitivity.testedChangePercent}%`, align: "right" },
            { label: "New total", align: "right" },
          ]}
        >
          {sensitivity.entries.map((entry) => (
            <tr key={entry.key}>
              <Td className="font-medium text-slate-900">
                {entry.label}
                {entry.sublabel && <span className="mt-0.5 block text-xs font-normal text-slate-500">{entry.sublabel}</span>}
              </Td>
              <Td align="right">{formatKgPrecise(entry.kgCo2e)}</Td>
              <Td align="right">{entry.percentOfTotal.toFixed(1)}%</Td>
              <Td align="right">
                +{formatKgPrecise(entry.deltaKgCo2e)}
                <span className="ml-1 text-xs text-slate-500">({entry.deltaTotalPercent.toFixed(2)}%)</span>
              </Td>
              <Td align="right">{formatKgPrecise(entry.newTotalKgCo2e)}</Td>
            </tr>
          ))}
        </DataTable>
        <Notice tone="info" title="Monte Carlo has not been run">
          Every inventory line already holds the distribution inputs a Monte Carlo analysis would need, and the engine is
          a pure function that could be run repeatedly over sampled inputs. That simulation is not implemented, and
          nothing on this page should be read as if it were: the range above is an indicative combination, not a
          probability distribution.
        </Notice>
      </SectionCard>

      <SectionCard
        title="Quality line by line"
        description="Every included inventory line, its pedigree scores, and its share of the footprint. Sort your effort by the last column."
      >
        <DataTable
          headers={[
            "Line",
            "Stage",
            "Data type",
            { label: "T", align: "right" },
            { label: "G", align: "right" },
            { label: "Tech", align: "right" },
            { label: "C", align: "right" },
            { label: "R", align: "right" },
            { label: "Mean", align: "right" },
            { label: "Uncertainty", align: "right" },
            { label: "Share of footprint", align: "right" },
          ]}
          caption="T temporal · G geographical · Tech technological · C completeness · R reliability. 1 is best, 5 is worst."
        >
          {scoredItems.map((item) => {
            const itemRows = rows.filter((r) => r.inventoryItemId === item.id);
            const kg = itemRows.reduce((sum, r) => sum + Number(r.allocatedKgCo2e), 0);
            const share = dataQuality.coverage.reduce((sum, c) => sum + c.kgCo2e, 0);
            const scores = [
              item.temporalScore,
              item.geographicalScore,
              item.technologicalScore,
              item.completenessScore,
              item.reliabilityScore,
            ];
            const present = scores.filter((s): s is number => s !== null);
            const mean = present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null;
            const process = assessment.processes.find((p) => p.id === item.processId);

            return (
              <tr key={item.id} className={present.length === 0 ? "bg-amber-50/50" : undefined}>
                <Td className="font-medium text-slate-900">{item.name}</Td>
                <Td className="text-xs">{process ? STAGE_LABELS[process.stage] : "—"}</Td>
                <Td className="text-xs">{DATA_TYPE_SHORT[item.dataType]}</Td>
                {scores.map((score, index) => (
                  <Td key={index} align="right">
                    {score ?? <span className="text-slate-300">—</span>}
                  </Td>
                ))}
                <Td align="right">{mean !== null ? mean.toFixed(1) : <span className="text-amber-700">Not scored</span>}</Td>
                <Td align="right">{item.uncertaintyPercent ? `±${item.uncertaintyPercent.toString()}%` : <span className="text-slate-300">—</span>}</Td>
                <Td align="right">{share > 0 ? `${((kg / share) * 100).toFixed(1)}%` : "—"}</Td>
              </tr>
            );
          })}
        </DataTable>
      </SectionCard>

      <SectionCard title="Placeholder factors" description="Lines still priced from illustrative values rather than published ones.">
        {dataQuality.placeholderFactorPercent === 0 ? (
          <p className="text-sm text-slate-600">
            No line in this assessment uses a placeholder factor. Every figure comes from a factor with a recorded source.
          </p>
        ) : (
          <Notice tone="danger" title={`${dataQuality.placeholderFactorPercent.toFixed(1)}% of the footprint uses placeholder factors`}>
            The affected lines are listed in the results table with a warning marker. Import a real factor set through
            Admin → Emission factors and reassign them. Until then this assessment cannot be marked ready for
            verification.
          </Notice>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Headline for reference: {formatKgPrecise(totals.headlinePerFunctionalUnitKgCo2e)} kgCO2e per functional unit.
        </p>
      </SectionCard>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { buildAssessmentReport } from "@/lib/lca/report-service";
import { LIFECYCLE_STAGE_ORDER, ALLOCATION_LABELS, ASSURANCE_LABELS, BOUNDARY_LABELS, CLASSIFICATION_LABELS, DATA_TYPE_LABELS, MATERIALITY_LABELS, STAGE_LABELS } from "@/lib/lca/labels";
import { DATA_TYPE_COLORS, LIFECYCLE_STAGE_COLORS, formatKgPrecise } from "@/components/charts/palette";
import { ContributionBarChart, ProportionBar } from "@/components/charts/contribution-bar-chart";
import { LifecycleFlow, type FlowStage } from "@/components/lca/lifecycle-flow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, FieldList, Notice, Td } from "@/components/lca/ui";
import { PrintButton } from "../../../reports/print-button";

export const dynamic = "force-dynamic";

function Section({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid border-t border-slate-200 pt-6">
      <h2 className="text-lg font-semibold tracking-tight text-slate-900">
        <span className="mr-2 text-slate-400">{number}</span>
        {title}
      </h2>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

export default async function AssessmentReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let report;
  try {
    report = await buildAssessmentReport(id);
  } catch {
    notFound();
  }

  const {
    assessment,
    methodology,
    totals,
    contributions,
    dataQuality,
    uncertainty,
    sensitivity,
    validation,
    readiness,
    assumptions,
    exclusions,
    evidence,
    verifications,
    corporateLinks,
    scenarios,
    versions,
    factorSources,
  } = report;

  const unitLabel = assessment.isDeclaredUnit ? "declared unit" : "functional unit";
  const includedProcesses = assessment.processes.filter((p) => p.isIncluded);
  const flowStages: FlowStage[] = LIFECYCLE_STAGE_ORDER.map((stage) => {
    const stageProcesses = includedProcesses.filter((p) => p.stage === stage);
    const contribution = contributions?.byStage.find((s) => s.key === stage);
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link href={`/assessments/${id}`} className="text-sm text-slate-500 hover:text-slate-800">
          ← Back to the assessment
        </Link>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/lca/assessments/${id}/calculation-register.csv`}>
            <Button size="sm" variant="secondary">
              <Download className="h-4 w-4" />
              Calculation register (CSV)
            </Button>
          </a>
          <a href={`/api/lca/assessments/${id}/export.json`}>
            <Button size="sm" variant="secondary">
              <Download className="h-4 w-4" />
              Structured export (JSON)
            </Button>
          </a>
          <a href={`/api/lca/assessments/${id}/pact.json`}>
            <Button size="sm" variant="secondary">
              <Download className="h-4 w-4" />
              Exchange document
            </Button>
          </a>
          <PrintButton />
        </div>
      </div>

      <div className="no-print">
        <Notice tone="info" title="Producing a PDF">
          Use Print and choose &quot;Save as PDF&quot;. This page is laid out for print — navigation and controls are
          hidden, and sections avoid breaking across pages.
        </Notice>
      </div>

      {/* Cover */}
      <div className="border-b border-slate-200 pb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {report.entityName} · Product carbon footprint assessment
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
          {report.productName}
          <span className="ml-2 text-xl font-normal text-slate-500">{report.productVersionLabel}</span>
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {assessment.reference} · {assessment.title}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {BOUNDARY_LABELS[assessment.boundary]} · {report.statusLabel} · version {assessment.version} · generated{" "}
          {new Date(report.generatedAt).toLocaleString("en-GB")}
        </p>
        {report.staleness.stale && (
          <div className="mt-3">
            <Notice tone="warning" title="Figures are out of date">
              {report.staleness.reason}
            </Notice>
          </div>
        )}
      </div>

      {dataQuality && dataQuality.placeholderFactorPercent > 0 && (
        <Notice tone="danger" title="Not fit for reporting">
          {dataQuality.placeholderFactorPercent.toFixed(1)}% of this footprint is priced from placeholder emission
          factors, which are illustrative magnitudes rather than published values. This report must not be used
          externally until they are replaced.
        </Notice>
      )}

      <Section number="1" title="Executive summary">
        {report.executiveSummary.map((paragraph, index) => (
          <p key={index} className="text-sm leading-relaxed text-slate-700">
            {paragraph}
          </p>
        ))}
      </Section>

      <Section number="2" title="Product">
        <FieldList
          items={[
            { label: "Product", value: report.productName },
            { label: "SKU", value: report.productSku },
            { label: "Version", value: report.productVersionLabel },
            { label: "Category", value: assessment.productVersion.product.category },
            { label: "Description", value: assessment.productVersion.product.description },
            { label: "Operating unit", value: report.entityName },
            {
              label: "Manufacturing locations",
              value:
                report.manufacturingLocations.length > 0
                  ? report.manufacturingLocations
                      .map((l) => `${l.name}${l.country ? ` (${l.country})` : ""}${l.siteName ? ` — internal site ${l.siteName}` : ""}`)
                      .join("; ")
                  : null,
            },
          ]}
        />
      </Section>

      <Section number="3" title="Goal and scope">
        <FieldList
          items={[
            { label: "Goal", value: assessment.goal },
            { label: "Intended application", value: assessment.intendedApplication },
            { label: "Intended audience", value: assessment.intendedAudience },
            {
              label: "Comparative assertion",
              value: assessment.comparativeAssertionDisclosed
                ? "This assessment supports a comparative claim disclosed outside the organisation."
                : "No comparative claim is made from this assessment.",
            },
            { label: "Scope", value: assessment.scopeDescription },
            { label: "Assessment owner", value: assessment.owner?.name },
            {
              label: "Assessment period",
              value:
                assessment.periodStart && assessment.periodEnd
                  ? `${assessment.periodStart.toISOString().slice(0, 10)} to ${assessment.periodEnd.toISOString().slice(0, 10)}`
                  : null,
            },
          ]}
        />
      </Section>

      <Section number="4" title={assessment.isDeclaredUnit ? "Declared unit and reference flow" : "Functional unit and reference flow"}>
        <FieldList
          items={[
            {
              label: assessment.isDeclaredUnit ? "Declared unit" : "Functional unit",
              value: assessment.functionalUnitDescription
                ? `${assessment.functionalUnitQuantity.toString()} ${assessment.functionalUnitUnit ?? ""} — ${assessment.functionalUnitDescription}`
                : null,
            },
            { label: "Declared unit note", value: assessment.declaredUnitDescription },
            {
              label: "Reference flow",
              value: assessment.referenceFlowDescription
                ? `${assessment.referenceFlowQuantity.toString()} ${assessment.referenceFlowUnit ?? ""} — ${assessment.referenceFlowDescription}`
                : `${assessment.referenceFlowQuantity.toString()} ${assessment.referenceFlowUnit ?? ""}`,
            },
            {
              label: "Modelled output",
              value: `${assessment.modelledOutputQuantity.toString()} ${assessment.modelledOutputUnit ?? ""}${assessment.modelledOutputDescription ? ` — ${assessment.modelledOutputDescription}` : ""}`,
              hint: "What the entered inventory represents",
            },
            {
              label: `${unitLabel}s in the model`,
              value: totals ? formatKgPrecise(totals.functionalUnitsInModel) : null,
            },
            { label: "Assumed product lifetime", value: assessment.usePhaseLifetimeYears ? `${assessment.usePhaseLifetimeYears.toString()} years` : null },
            { label: "Use-phase assumptions", value: assessment.usePhaseAssumptions },
          ]}
        />
      </Section>

      <Section number="5" title="System boundary">
        <FieldList
          items={[
            { label: "Boundary", value: BOUNDARY_LABELS[assessment.boundary] },
            { label: "Boundary notes", value: assessment.boundaryNotes },
            {
              label: "Stages in scope",
              value: assessment.includedStages.length > 0 ? assessment.includedStages.map((s) => STAGE_LABELS[s]).join(", ") : null,
            },
            { label: "Completeness notes", value: assessment.completenessNotes },
          ]}
        />
        <LifecycleFlow stages={flowStages} />
      </Section>

      <Section number="6" title="Lifecycle system">
        <DataTable headers={["Stage", "Process", "Sits inside", "Allocation", { label: "Inventory lines", align: "right" }, "Included"]}>
          {assessment.processes.map((process) => {
            const parent = assessment.processes.find((p) => p.id === process.parentProcessId);
            const lineCount = assessment.inventoryItems.filter((i) => i.processId === process.id).length;
            return (
              <tr key={process.id}>
                <Td className="text-xs">{STAGE_LABELS[process.stage]}</Td>
                <Td className="font-medium text-slate-900">
                  {process.name}
                  {process.description && <span className="mt-0.5 block text-xs font-normal text-slate-500">{process.description}</span>}
                </Td>
                <Td className="text-xs">{parent?.name ?? "—"}</Td>
                <Td className="text-xs">
                  {ALLOCATION_LABELS[process.allocationMethod]}
                  {process.allocationMethod !== "NONE" && (
                    <span className="block text-slate-500">{process.allocationPercent.toString()}% to this product</span>
                  )}
                </Td>
                <Td align="right">{lineCount}</Td>
                <Td className="text-xs">{process.isIncluded ? "Yes" : "No"}</Td>
              </tr>
            );
          })}
        </DataTable>
      </Section>

      <Section number="7" title="Inventory and data sources">
        <DataTable
          headers={["Line", "Process", { label: "Quantity", align: "right" }, "Data type", "Source", "Supplier", "Geography"]}
        >
          {assessment.inventoryItems.map((item) => {
            const process = assessment.processes.find((p) => p.id === item.processId);
            return (
              <tr key={item.id} className={item.isExcluded ? "text-slate-400" : undefined}>
                <Td className="font-medium text-slate-900">
                  {item.name}
                  {item.isExcluded && <Badge tone="warning" className="ml-2">Excluded</Badge>}
                </Td>
                <Td className="text-xs">{process?.name}</Td>
                <Td align="right">
                  {item.quantity.toString()} {item.unit}
                </Td>
                <Td className="text-xs">{DATA_TYPE_LABELS[item.dataType]}</Td>
                <Td className="text-xs">{item.dataSource ?? "—"}</Td>
                <Td className="text-xs">{item.supplier?.name ?? "—"}</Td>
                <Td className="text-xs">{item.geography ?? "—"}</Td>
              </tr>
            );
          })}
        </DataTable>

        <h3 className="pt-2 text-sm font-semibold text-slate-900">Emission factor sources used</h3>
        <DataTable headers={["Source", "Version", { label: "Result lines", align: "right" }, "Placeholder"]}>
          {factorSources.map((source) => (
            <tr key={`${source.source}-${source.version}`}>
              <Td>{source.source}</Td>
              <Td className="text-xs">{source.version}</Td>
              <Td align="right">{source.count}</Td>
              <Td className="text-xs">{source.isPlaceholder ? "Yes — illustrative only" : "No"}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section number="8" title="Methodology">
        <FieldList
          items={[
            { label: "Profile", value: `${methodology.name} ${methodology.version}` },
            { label: "GWP basis", value: methodology.gwpBasis },
            { label: "Default allocation", value: ALLOCATION_LABELS[methodology.defaultAllocationMethod] },
            { label: "Allocation rules", value: methodology.allocationRules },
            { label: "Recycling treatment", value: methodology.recyclingMethod.replace(/_/g, " ").toLowerCase() },
            { label: "Recycling rules", value: methodology.recyclingRules },
            { label: "Electricity", value: methodology.electricityApproach.replace(/_/g, " ").toLowerCase() },
            { label: "Electricity rules", value: methodology.electricityRules },
            { label: "Biogenic carbon", value: methodology.biogenicTreatment.replace(/_/g, " ").toLowerCase() },
            { label: "Biogenic rules", value: methodology.biogenicRules },
            { label: "Removals", value: methodology.removalsRules },
            { label: "Offsets", value: `${methodology.offsetTreatment.replace(/_/g, " ").toLowerCase()}. ${methodology.offsetRules ?? ""}` },
            { label: "Cut-off", value: `${methodology.cutOffThresholdPercent !== null ? `${methodology.cutOffThresholdPercent}% threshold. ` : ""}${methodology.cutOffRules ?? ""}` },
            { label: "Factor hierarchy", value: methodology.factorHierarchy.join(" → ") },
            { label: "Data quality requirements", value: methodology.dataQualityRequirements },
            { label: "Standards referenced", value: methodology.standardsReferenced.join("; ") },
            { label: "Assessment-specific notes", value: assessment.methodologyNotes },
          ]}
        />
        <Notice tone="info">
          Referencing a standard describes the approach this assessment followed. It is not a claim of conformity or
          certification — only an independent verifier can give that.
        </Notice>
      </Section>

      {totals && contributions && (
        <>
          <Section number="9" title="Results">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Per {unitLabel}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                  {formatKgPrecise(totals.headlinePerFunctionalUnitKgCo2e)} <span className="text-sm font-normal text-slate-500">kgCO2e</span>
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Total model emissions</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                  {formatKgPrecise(totals.headlineModelKgCo2e)} <span className="text-sm font-normal text-slate-500">kgCO2e</span>
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Including biogenic, per {unitLabel}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                  {formatKgPrecise(totals.includingBiogenicPerFunctionalUnitKgCo2e)}{" "}
                  <span className="text-sm font-normal text-slate-500">kgCO2e</span>
                </div>
              </div>
            </div>

            <h3 className="pt-2 text-sm font-semibold text-slate-900">Carbon classes</h3>
            <DataTable headers={["Class", { label: "Model total", align: "right" }, { label: `Per ${unitLabel}`, align: "right" }]}>
              {(
                [
                  ["FOSSIL", totals.model.fossil, totals.perFunctionalUnit.fossil],
                  ["BIOGENIC", totals.model.biogenicEmissions, totals.perFunctionalUnit.biogenicEmissions],
                  ["BIOGENIC_REMOVAL", totals.model.biogenicRemovals, totals.perFunctionalUnit.biogenicRemovals],
                  ["TECHNOLOGICAL_REMOVAL", totals.model.technologicalRemovals, totals.perFunctionalUnit.technologicalRemovals],
                  ["STORED_CARBON", totals.model.storedCarbon, totals.perFunctionalUnit.storedCarbon],
                  ["AVOIDED_BURDEN", totals.model.avoidedBurden, totals.perFunctionalUnit.avoidedBurden],
                  ["OFFSET", totals.model.offsets, totals.perFunctionalUnit.offsets],
                ] as [string, number, number][]
              )
                .filter(([, model]) => model !== 0)
                .map(([key, model, perFu]) => (
                  <tr key={key}>
                    <Td>{CLASSIFICATION_LABELS[key as keyof typeof CLASSIFICATION_LABELS]}</Td>
                    <Td align="right">{formatKgPrecise(model)}</Td>
                    <Td align="right">{formatKgPrecise(perFu)}</Td>
                  </tr>
                ))}
            </DataTable>

            <h3 className="pt-2 text-sm font-semibold text-slate-900">Contribution by lifecycle stage</h3>
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
          </Section>

          <Section number="10" title="Hotspots">
            <p className="text-sm text-slate-700">
              The largest individual contributions. These are where a reduction has most effect, and where a reviewer
              will look hardest at the data.
            </p>
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
          </Section>
        </>
      )}

      {dataQuality && (
        <Section number="11" title="Data quality">
          <FieldList
            items={[
              {
                label: "Footprint-weighted score",
                value: dataQuality.footprintWeightedScore !== null ? `${dataQuality.footprintWeightedScore.toFixed(2)} (1 best, 5 worst)` : null,
              },
              { label: "Unweighted mean", value: dataQuality.simpleMeanScore !== null ? dataQuality.simpleMeanScore.toFixed(2) : null },
              { label: "Lines scored", value: `${dataQuality.scoredLineCount} of ${dataQuality.totalLineCount}` },
              { label: "Footprint on unscored lines", value: `${dataQuality.unscoredEmissionsPercent.toFixed(1)}%` },
            ]}
          />
          <ProportionBar
            segments={dataQuality.coverage.map((c) => ({
              key: String(c.dataType),
              label: c.label,
              percent: c.percent,
              color: DATA_TYPE_COLORS[String(c.dataType)] ?? "#cbd5e1",
              detail: `${c.lineCount} line(s)`,
            }))}
          />
        </Section>
      )}

      {(uncertainty || sensitivity) && (
        <Section number="12" title="Uncertainty, sensitivity and scenarios">
          {uncertainty && (
            <>
              <FieldList
                items={[
                  {
                    label: "Indicative range",
                    value:
                      uncertainty.combinedPercent !== null
                        ? `±${uncertainty.combinedPercent.toFixed(1)}% (${formatKgPrecise(uncertainty.lowerKgCo2e ?? 0)} to ${formatKgPrecise(uncertainty.upperKgCo2e ?? 0)} kgCO2e)`
                        : "No line-level uncertainty recorded",
                  },
                  { label: "Coverage", value: `${uncertainty.coveragePercent.toFixed(1)}% of emissions` },
                  { label: "Method", value: uncertainty.method },
                ]}
              />
              <Notice tone="warning">{uncertainty.caveat}</Notice>
            </>
          )}

          {sensitivity && sensitivity.entries.length > 0 && (
            <>
              <h3 className="pt-2 text-sm font-semibold text-slate-900">Sensitivity</h3>
              <p className="text-sm text-slate-700">{sensitivity.method}</p>
              <DataTable
                headers={["Line", { label: "Current", align: "right" }, { label: "Effect on the total", align: "right" }]}
              >
                {sensitivity.entries.map((entry) => (
                  <tr key={entry.key}>
                    <Td>{entry.label}</Td>
                    <Td align="right">{formatKgPrecise(entry.kgCo2e)}</Td>
                    <Td align="right">{entry.deltaTotalPercent.toFixed(2)}%</Td>
                  </tr>
                ))}
              </DataTable>
            </>
          )}

          {scenarios.length > 0 && (
            <>
              <h3 className="pt-2 text-sm font-semibold text-slate-900">Scenarios</h3>
              <DataTable
                headers={["Scenario", "What it changes", { label: `Baseline per ${unitLabel}`, align: "right" }, { label: "Scenario", align: "right" }, { label: "Reduction", align: "right" }]}
              >
                {scenarios.map((scenario) => (
                  <tr key={scenario.id}>
                    <Td className="font-medium text-slate-900">{scenario.title}</Td>
                    <Td className="text-xs">{scenario.description ?? "—"}</Td>
                    <Td align="right">{scenario.comparison ? formatKgPrecise(scenario.comparison.baselinePerFunctionalUnit) : "—"}</Td>
                    <Td align="right">{scenario.comparison ? formatKgPrecise(scenario.comparison.scenarioPerFunctionalUnit) : "—"}</Td>
                    <Td align="right">
                      {scenario.comparison?.perFunctionalUnitPercentReduction !== null && scenario.comparison
                        ? `${scenario.comparison.perFunctionalUnitPercentReduction?.toFixed(1)}%`
                        : "—"}
                    </Td>
                  </tr>
                ))}
              </DataTable>
            </>
          )}
        </Section>
      )}

      <Section number="13" title="Assumptions">
        {assumptions.length === 0 ? (
          <p className="text-sm text-slate-600">No assumptions are recorded for this assessment.</p>
        ) : (
          <DataTable headers={["Assumption", "Category", "Rationale", "Source", "Materiality", "Approved"]}>
            {assumptions.map((assumption) => (
              <tr key={assumption.id}>
                <Td className="font-medium text-slate-900">{assumption.assumption}</Td>
                <Td className="text-xs">{assumption.category}</Td>
                <Td className="text-xs">{assumption.rationale}</Td>
                <Td className="text-xs">{assumption.source ?? "—"}</Td>
                <Td className="text-xs">{MATERIALITY_LABELS[assumption.materiality]}</Td>
                <Td className="text-xs">
                  {assumption.approvedAt ? `${assumption.approvedBy?.name} · ${assumption.approvedAt.toISOString().slice(0, 10)}` : "Not approved"}
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <Section number="14" title="Exclusions">
        {exclusions.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing has been excluded from this assessment.</p>
        ) : (
          <DataTable headers={["Excluded", "Rationale", "Estimated relevance", { label: "Share", align: "right" }, "Approved"]}>
            {exclusions.map((exclusion) => (
              <tr key={exclusion.id}>
                <Td className="font-medium text-slate-900">{exclusion.excludedItem}</Td>
                <Td className="text-xs">{exclusion.rationale}</Td>
                <Td className="text-xs">{exclusion.estimatedRelevance}</Td>
                <Td align="right">{exclusion.estimatedPercentOfTotal ? `${exclusion.estimatedPercentOfTotal.toString()}%` : "—"}</Td>
                <Td className="text-xs">
                  {exclusion.approvedAt ? `${exclusion.approvedBy?.name} · ${exclusion.approvedAt.toISOString().slice(0, 10)}` : "Not approved"}
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      {corporateLinks.length > 0 && (
        <Section number="15" title="Corporate data citations">
          <p className="text-sm text-slate-700">
            Where this assessment drew on the organisation&apos;s corporate greenhouse gas inventory. These are
            citations, not transfers: the corporate inventory keeps its full absolute figure and this product footprint
            keeps its own, so nothing is double-counted in either direction.
          </p>
          <DataTable headers={["Inventory line", "Corporate record", "Site", { label: "Attribution", align: "right" }, "Basis"]}>
            {corporateLinks.map((link) => (
              <tr key={link.id}>
                <Td className="font-medium text-slate-900">{link.inventoryItem.name}</Td>
                <Td className="text-xs">
                  {link.activityEntry
                    ? `${link.activityEntry.activityDataPoint.code} ${link.activityEntry.activityDataPoint.dataPointName} (${link.activityEntry.rawValue.toString()} ${link.activityEntry.rawUnit})`
                    : link.linkType.replace(/_/g, " ").toLowerCase()}
                </Td>
                <Td className="text-xs">{link.site?.name ?? "—"}</Td>
                <Td align="right">{link.allocationPercent.toString()}%</Td>
                <Td className="text-xs">{link.allocationBasis ?? "—"}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}

      <Section number={corporateLinks.length > 0 ? "16" : "15"} title="Limitations">
        <ul className="ml-4 list-disc space-y-2 text-sm text-slate-700">
          {report.limitations.map((limitation, index) => (
            <li key={index}>{limitation}</li>
          ))}
          {assessment.limitations && <li>{assessment.limitations}</li>}
        </ul>
      </Section>

      <Section number={corporateLinks.length > 0 ? "17" : "16"} title="Interpretation">
        {assessment.interpretation ? (
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{assessment.interpretation}</p>
        ) : (
          <p className="text-sm text-slate-500">No interpretation has been written for this assessment.</p>
        )}
      </Section>

      <Section number={corporateLinks.length > 0 ? "18" : "17"} title="Review and verification">
        <FieldList
          items={[
            { label: "Readiness", value: `${readiness.overall.replace(/_/g, " ").toLowerCase()} — ${readiness.overallExplanation}` },
            {
              label: "Validation",
              value: `${validation.errorCount} error(s), ${validation.warningCount} warning(s), ${validation.advisoryCount} advisory item(s)`,
            },
            { label: "Status", value: report.statusLabel },
          ]}
        />
        {verifications.length === 0 ? (
          <Notice tone="info">
            This assessment has not been independently verified. Nothing in this report is a certification or a claim of
            conformity with any standard.
          </Notice>
        ) : (
          <DataTable headers={["Organisation", "Verifier", "Date", "Type", "Scope", "Statement", "Conclusion"]}>
            {verifications.map((verification) => (
              <tr key={verification.id}>
                <Td className="font-medium text-slate-900">{verification.organisation}</Td>
                <Td>{verification.verifierName}</Td>
                <Td className="text-xs">{verification.verificationDate.toISOString().slice(0, 10)}</Td>
                <Td className="text-xs">{ASSURANCE_LABELS[verification.assuranceType]}</Td>
                <Td className="text-xs">{verification.scopeOfVerification}</Td>
                <Td className="text-xs">{verification.statementReference ?? "—"}</Td>
                <Td className="text-xs">{verification.conclusion ?? "—"}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <Section number={corporateLinks.length > 0 ? "19" : "18"} title="Appendix A — Calculation register">
        <p className="text-sm text-slate-700">
          Every result line with its own arithmetic. The full-precision version, including conversion factors, factor
          versions and provenance, is available as a CSV export.
        </p>
        {report.run ? (
          <DataTable
            headers={["Stage", "Line", { label: "Activity", align: "right" }, "Factor", "Calculation", { label: "kgCO2e", align: "right" }]}
          >
            {report.run.results.map((result) => (
              <tr key={result.id}>
                <Td className="text-xs">{STAGE_LABELS[result.stage]}</Td>
                <Td className="font-medium text-slate-900">{result.itemName}</Td>
                <Td align="right">
                  {result.normalizedValue.toString()} {result.normalizedUnit}
                </Td>
                <Td className="text-xs">
                  {result.factorValue.toString()} kgCO2e/{result.factorUnit}
                  <span className="block text-slate-500">
                    {result.factorSource} ({result.factorVersion})
                  </span>
                </Td>
                <Td className="font-mono text-[11px]">{result.formula}</Td>
                <Td align="right">{formatKgPrecise(Number(result.allocatedKgCo2e))}</Td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <p className="text-sm text-slate-500">No calculation run to report.</p>
        )}
      </Section>

      <Section number={corporateLinks.length > 0 ? "20" : "19"} title="Appendix B — Evidence and versions">
        <h3 className="text-sm font-semibold text-slate-900">Evidence held</h3>
        {evidence.length === 0 ? (
          <p className="text-sm text-slate-500">No evidence attached.</p>
        ) : (
          <DataTable headers={["Title", "Kind", "Checksum", "Added"]}>
            {evidence.map((item) => (
              <tr key={item.id}>
                <Td className="font-medium text-slate-900">{item.title}</Td>
                <Td className="text-xs">{item.kind === "UPLOADED_FILE" ? (item.fileName ?? "File") : "Link"}</Td>
                <Td className="font-mono text-[10px]">{item.checksumSha256 ? `${item.checksumSha256.slice(0, 16)}…` : "—"}</Td>
                <Td className="text-xs">
                  {item.uploadedAt.toISOString().slice(0, 10)} · {item.uploadedBy?.name}
                </Td>
              </tr>
            ))}
          </DataTable>
        )}

        <h3 className="pt-3 text-sm font-semibold text-slate-900">Versions issued</h3>
        {versions.length === 0 ? (
          <p className="text-sm text-slate-500">No version has been issued.</p>
        ) : (
          <DataTable headers={["Version", "Label", "Status", "Issued"]}>
            {versions.map((version) => (
              <tr key={version.id}>
                <Td>Version {version.version}</Td>
                <Td>{version.label ?? "—"}</Td>
                <Td className="text-xs">{version.status.replace(/_/g, " ").toLowerCase()}</Td>
                <Td className="text-xs">
                  {version.issuedAt ? version.issuedAt.toISOString().slice(0, 10) : "—"}
                  {version.issuedByName ? ` · ${version.issuedByName}` : ""}
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      <div className="border-t border-slate-200 pt-6 text-xs leading-relaxed text-slate-500">
        Produced by the {report.entityName} carbon accounting platform on{" "}
        {new Date(report.generatedAt).toLocaleString("en-GB")}. This is an internal assessment report. Nothing in it is a
        certification, a verification opinion, or a claim of conformity with any standard; where an independent
        verification exists, its conclusions are the verifier&apos;s and are reproduced above as they were given.
      </div>
    </div>
  );
}

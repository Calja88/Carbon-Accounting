import Link from "next/link";
import { notFound } from "next/navigation";
import { getResult } from "@/lib/lca/calculation-service";
import { getLcaContext } from "@/lib/lca/permissions";
import { CLASSIFICATION_LABELS, DATA_TYPE_LABELS, FACTOR_BOUNDARY_LABELS, FACTOR_MODE_LABELS, STAGE_LABELS } from "@/lib/lca/labels";
import { formatKgPrecise } from "@/components/charts/palette";
import { BackLink, FieldList, Notice, PageHeading, SectionCard } from "@/components/lca/ui";
import type { ProvenanceStep } from "@/lib/lca/engine/types";

export const dynamic = "force-dynamic";

/**
 * "How was this calculated?" — the whole trail behind one figure, in the order
 * the engine applied it. Everything shown here was snapshotted at calculation
 * time, so it still reads correctly even if the factor library, the
 * methodology or the inventory has moved on since.
 */
export default async function ResultProvenancePage({
  params,
}: {
  params: Promise<{ id: string; resultId: string }>;
}) {
  const { id, resultId } = await params;
  const context = await getLcaContext();
  if (!context) notFound();
  const result = await getResult(context, resultId, id);
  if (!result || result.assessmentId !== id) notFound();

  const steps = (result.provenance as unknown as ProvenanceStep[]) ?? [];
  const isHistorical = result.run.id !== result.assessment.lastCalculationRunId;

  return (
    <div className="space-y-6">
      <BackLink href={`/assessments/${id}/results`}>Back to results</BackLink>

      <PageHeading
        eyebrow={`${STAGE_LABELS[result.stage]} · ${result.processName}`}
        title={result.itemName}
        description={`${formatKgPrecise(Number(result.allocatedKgCo2e))} kgCO2e allocated to this product, ${formatKgPrecise(Number(result.perFunctionalUnitKgCo2e))} kgCO2e per functional unit.`}
      />

      {isHistorical && (
        <Notice tone="info" title="From an earlier calculation run">
          This figure comes from the run of {result.run.runAt.toISOString().slice(0, 16).replace("T", " ")}, which is not
          the assessment&apos;s current run. It is shown exactly as it was calculated then.
        </Notice>
      )}

      {result.isPlaceholderFactor && (
        <Notice tone="danger" title="Priced from a placeholder factor">
          The factor behind this figure is an illustrative placeholder, not a published value. Replace it before this
          number is used for anything.
        </Notice>
      )}

      <SectionCard
        title="How this figure was calculated"
        description="Activity data, through unit conversion, factor, methodology, adjustment and allocation, to the result."
      >
        <ol className="space-y-0">
          {steps.map((step, index) => (
            <li key={step.step} className="relative flex gap-4 pb-6 last:pb-0">
              <div className="flex flex-col items-center">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                  {step.step}
                </span>
                {index < steps.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200" aria-hidden="true" />}
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="text-sm font-semibold text-slate-900">{step.label}</div>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{step.detail}</p>
                {step.value && (
                  <p className="mt-1.5 rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-800">{step.value}</p>
                )}
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Formula as applied</div>
          <p className="mt-1 font-mono text-sm text-slate-800">{result.formula}</p>
        </div>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Factor as it was at calculation time" description="Snapshotted onto the result row, not looked up now.">
          <FieldList
            items={[
              { label: "Value", value: `${result.factorValue.toString()} kgCO2e per ${result.factorUnit}` },
              { label: "Source", value: result.factorSource },
              { label: "Version", value: result.factorVersion },
              { label: "What it covers", value: FACTOR_BOUNDARY_LABELS[result.factorBoundary] },
              { label: "Geography", value: result.factorGeography },
              { label: "Reference year", value: result.factorYear },
              { label: "GWP basis", value: result.factorGwpBasis },
              { label: "How it was chosen", value: FACTOR_MODE_LABELS[result.factorSelectionMode] },
              {
                label: "Library record",
                value: result.emissionFactor ? (
                  <span>
                    {result.emissionFactor.category}
                    {result.emissionFactor.subtypeKey ? ` · ${result.emissionFactor.subtypeKey}` : ""}
                    <span className="block text-xs text-slate-500">
                      {result.emissionFactor.factorSet.publisher} — {result.emissionFactor.factorSet.name}
                    </span>
                  </span>
                ) : (
                  "Not a library factor"
                ),
              },
            ]}
          />
        </SectionCard>

        <SectionCard title="This result line" description="The figures behind the arithmetic above.">
          <FieldList
            items={[
              { label: "Activity", value: `${result.activityValue.toString()} ${result.activityUnit}` },
              { label: "Conversion factor", value: result.conversionFactor.toString() },
              { label: "Normalised activity", value: `${result.normalizedValue.toString()} ${result.normalizedUnit}` },
              { label: "Adjustment factor", value: result.adjustmentFactor.toString() },
              {
                label: "Allocation",
                value: `${result.allocationMethod.replace(/_/g, " ").toLowerCase()} — × ${result.allocationFactor.toString()}`,
              },
              { label: "Gross", value: `${result.grossKgCo2e.toString()} kgCO2e` },
              { label: "Allocated to this product", value: `${result.allocatedKgCo2e.toString()} kgCO2e` },
              { label: "Per functional unit", value: `${result.perFunctionalUnitKgCo2e.toString()} kgCO2e` },
              { label: "Carbon class", value: CLASSIFICATION_LABELS[result.classification] },
              { label: "Data type", value: DATA_TYPE_LABELS[result.dataType] },
              { label: "Data quality score", value: result.dataQualityScore ? `${result.dataQualityScore.toString()} (1 best, 5 worst)` : null },
              { label: "Uncertainty", value: result.uncertaintyPercent ? `±${result.uncertaintyPercent.toString()}%` : null },
              {
                label: "Calculation run",
                value: `${result.run.runAt.toISOString().slice(0, 16).replace("T", " ")} · engine ${result.run.engineVersion}${result.run.runBy ? ` · ${result.run.runBy.name}` : ""}`,
              },
            ]}
          />
          {result.inventoryItemId && (
            <Link
              href={`/assessments/${id}/inventory/${result.inventoryItemId}`}
              className="mt-3 inline-block text-sm font-medium text-blue-700 hover:text-blue-800"
            >
              Open the inventory line →
            </Link>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

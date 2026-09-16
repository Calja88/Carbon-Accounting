import Link from "next/link";
import { notFound } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getLatestRun } from "@/lib/lca/calculation-service";
import { canEditLcaData, getLcaContext } from "@/lib/lca/permissions";
import { requireAssessmentInScope } from "@/lib/repositories/lca-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { formatKgPrecise } from "@/components/charts/palette";
import { ContributionBarChart } from "@/components/charts/contribution-bar-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, Notice, PageHeading, SectionCard, Stat, StatusBadge, Td } from "@/components/lca/ui";
import { LcaScenario } from "@/components/board/lca-scenario";
import { getScenarioPageModel, listAuthorizedScenarioIds } from "@/lib/board/live-lca";
import { CreateScenarioForm } from "./scenario-forms";
import { recalculateScenarioAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function ScenariosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getLcaContext();
  if (!context) notFound();
  try {
    await requireAssessmentInScope(context, id);
  } catch (err) {
    if (err instanceof TenantOwnershipError || err instanceof PermissionDeniedError) notFound();
    throw err;
  }

  const [assessment, baselineRun, scenarioIds] = await Promise.all([
    prisma.lcaAssessment.findUnique({ where: { id } }),
    getLatestRun(id),
    // Checkpoint B corrective handoff §3: authorised child-scenario ids
    // only — never a raw baselineAssessmentId filter with no tenant/Entity
    // access scoping.
    listAuthorizedScenarioIds(context, id),
  ]);
  if (!assessment) notFound();

  const canEdit = canEditLcaData(context);

  // Every scenario card's data — title, description, status, inventory
  // count, comparison detail — comes from ONE authorised resolution
  // (getScenarioPageModel) per scenario. A scenario the caller cannot
  // fully resolve (denied, foreign, structurally invalid) yields `null`
  // and is skipped entirely below — no raw record ever backs a card that
  // authorization didn't clear.
  const pageModels = await Promise.all(scenarioIds.map((scenarioId) => getScenarioPageModel(context, scenarioId)));
  const comparisons = pageModels.filter((m): m is NonNullable<typeof m> => m !== null);

  const suggestedReference = `${assessment.reference}-S${scenarioIds.length + 1}`;

  return (
    <div className="space-y-6">
      <PageHeading
        title="Scenarios"
        description="Independent copies of this assessment for testing a change. A scenario never writes back into the baseline — the comparison is between two separate calculated results."
        actions={canEdit ? <CreateScenarioForm assessmentId={id} suggestedReference={suggestedReference} /> : null}
      />

      {!baselineRun && (
        <Notice tone="warning" title="Calculate the baseline first">
          A scenario is only meaningful against a calculated baseline. Run the calculation on this assessment before
          comparing anything to it.
        </Notice>
      )}

      {comparisons.length === 0 ? (
        <EmptyState
          title="No scenarios yet"
          description="Create one to test a change — a different material, a supplier with a lower footprint, a shorter freight route — without touching the assessment itself."
        />
      ) : (
        comparisons.map(({ scenarioId, title, description, status, inventoryItemCount, hasRun, legacyComparison, board }) => (
          <SectionCard
            key={scenarioId}
            title={title}
            description={description ?? "No description recorded."}
            actions={
              <div className="flex items-center gap-2">
                <StatusBadge status={status} />
                <Link href={`/assessments/${scenarioId}`}>
                  <Button size="sm" variant="secondary">
                    Open scenario
                  </Button>
                </Link>
                {canEdit && (
                  <form action={recalculateScenarioAction}>
                    <input type="hidden" name="scenarioId" value={scenarioId} />
                    <input type="hidden" name="baselineId" value={id} />
                    <Button type="submit" size="sm" variant="ghost">
                      <RefreshCw className="h-3.5 w-3.5" />
                      Recalculate
                    </Button>
                  </form>
                )}
              </div>
            }
          >
            <div className="mb-5">
              <LcaScenario model={board} />
            </div>
            {!hasRun ? (
              <Notice tone="warning">This scenario has not been calculated yet.</Notice>
            ) : !baselineRun ? (
              <Notice tone="warning">The baseline has no calculated result to compare against.</Notice>
            ) : !board.comparable ? (
              <Notice tone="warning">{board.reason ?? "This scenario is not comparable to the baseline right now."}</Notice>
            ) : !legacyComparison ? (
              <Notice tone="warning">This scenario cannot be verified as comparable right now — the percentage and contribution breakdown are withheld.</Notice>
            ) : (
              (() => {
                const comparison = legacyComparison;
                return (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat label="Baseline" value={formatKgPrecise(comparison.baselinePerFunctionalUnit)} unit="kgCO2e / unit" />
                  <Stat label="Scenario" value={formatKgPrecise(comparison.scenarioPerFunctionalUnit)} unit="kgCO2e / unit" />
                  <Stat
                    label="Absolute reduction"
                    value={formatKgPrecise(comparison.perFunctionalUnitReduction)}
                    unit="kgCO2e / unit"
                    tone={comparison.perFunctionalUnitReduction > 0 ? "negative" : "default"}
                  />
                  <Stat
                    label="Percentage reduction"
                    value={
                      comparison.perFunctionalUnitPercentReduction !== null
                        ? comparison.perFunctionalUnitPercentReduction.toFixed(1)
                        : "—"
                    }
                    unit="%"
                    tone={(comparison.perFunctionalUnitPercentReduction ?? 0) > 0 ? "negative" : "default"}
                  />
                </div>

                <div className="mt-5 grid gap-6 lg:grid-cols-2">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-800">What drove the change, by stage</h4>
                    <p className="mt-1 text-xs text-slate-500">
                      A negative bar is a reduction against the baseline. Shares are of the total change.
                    </p>
                    <div className="mt-3">
                      <ContributionBarChart
                        bars={comparison.driversByStage
                          .filter((d) => Math.abs(d.deltaKgCo2e) > 0)
                          .map((d) => ({
                            key: d.key,
                            label: d.label,
                            value: d.deltaKgCo2e,
                            percent: Math.abs(d.shareOfChangePercent),
                          }))}
                        emptyMessage="No stage-level difference between the scenario and the baseline."
                      />
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-800">What drove the change, line by line</h4>
                    <p className="mt-1 text-xs text-slate-500">The individual lines that moved.</p>
                    <div className="mt-3">
                      <ContributionBarChart
                        bars={comparison.driversByItem
                          .filter((d) => Math.abs(d.deltaKgCo2e) > 0)
                          .slice(0, 10)
                          .map((d) => ({
                            key: d.key,
                            label: d.label,
                            sublabel: d.sublabel,
                            value: d.deltaKgCo2e,
                            percent: Math.abs(d.shareOfChangePercent),
                          }))}
                        emptyMessage="No line-level difference between the scenario and the baseline."
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-5">
                  <DataTable
                    headers={[
                      "Line",
                      { label: "Baseline", align: "right" },
                      { label: "Scenario", align: "right" },
                      { label: "Change", align: "right" },
                      { label: "Share of change", align: "right" },
                    ]}
                  >
                    {comparison.driversByItem
                      .filter((d) => Math.abs(d.deltaKgCo2e) > 0)
                      .map((driver) => (
                        <tr key={driver.key}>
                          <Td className="font-medium text-slate-900">
                            {driver.label}
                            {driver.sublabel && <span className="mt-0.5 block text-xs font-normal text-slate-500">{driver.sublabel}</span>}
                          </Td>
                          <Td align="right">{formatKgPrecise(driver.baselineKgCo2e)}</Td>
                          <Td align="right">{formatKgPrecise(driver.scenarioKgCo2e)}</Td>
                          <Td align="right">
                            <span className={driver.deltaKgCo2e < 0 ? "text-emerald-700" : "text-slate-900"}>
                              {driver.deltaKgCo2e > 0 ? "+" : ""}
                              {formatKgPrecise(driver.deltaKgCo2e)}
                            </span>
                          </Td>
                          <Td align="right">{driver.shareOfChangePercent.toFixed(1)}%</Td>
                        </tr>
                      ))}
                  </DataTable>
                </div>

                <p className="mt-4 text-xs text-slate-500">
                  Scenario model total {formatKgPrecise(comparison.scenarioTotalKgCo2e)} kgCO2e across{" "}
                  {inventoryItemCount} inventory line(s).{" "}
                  <Badge tone="info">Baseline data untouched</Badge>
                </p>
              </>
                );
              })()
            )}
          </SectionCard>
        ))
      )}
    </div>
  );
}

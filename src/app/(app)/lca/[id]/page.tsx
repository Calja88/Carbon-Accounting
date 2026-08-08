import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Calculator, CheckCircle2 } from "lucide-react";
import { getAiAvailability } from "@/lib/ai";
import { assessGoalScopeCompleteness, getLcaProject, latestResultFor, runLcaCalculation } from "@/lib/lca/service";
import { runSensitivityAnalysis } from "@/lib/lca/scenarios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SystemBoundaryDiagram } from "@/components/lca/system-boundary-diagram";
import { calculateProjectAction, addAssumptionAction, resolveFindingAction } from "../actions";
import { LcaReviewPanel } from "./review-panel";

const BAND_TONES: Record<string, "success" | "info" | "warning" | "neutral"> = {
  HIGH: "success",
  MEDIUM: "info",
  LOW: "warning",
  UNKNOWN: "neutral",
};

export default async function LcaResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Authorization is enforced by the layout above this page.
  const project = await getLcaProject(id);
  if (!project) notFound();

  const [run, stored, availability] = await Promise.all([
    runLcaCalculation(project),
    latestResultFor(id, null),
    getAiAvailability(),
  ]);

  const completeness = assessGoalScopeCompleteness(project);
  const sensitivity = runSensitivityAnalysis(run.input, 10).slice(0, 8);

  const stageContribution = new Map(run.hotspots.byStage.map((s) => [s.key, s]));

  return (
    <div className="space-y-6">
      {/* --- Headline ---------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent>
            <div className="text-sm font-medium text-slate-600">Product carbon footprint</div>
            <div className="mt-1 text-4xl font-semibold leading-none text-slate-900">
              {run.result.totalKgCo2e.toFixed(3)}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              kgCO2e per {run.result.functionalUnitLabel ?? "functional unit (not yet defined)"}
            </div>
            <form action={calculateProjectAction} className="mt-4">
              <input type="hidden" name="projectId" value={id} />
              <Button type="submit" size="sm">
                <Calculator className="h-4 w-4" />
                Calculate and save a result
              </Button>
            </form>
            {stored && (
              <p className="mt-2 text-xs text-slate-400">
                Last saved run {new Date(stored.calculatedAt).toLocaleString("en-GB")}
                {stored.calculatedBy ? ` by ${stored.calculatedBy.name}` : ""} — {Number(stored.totalKgCo2e).toFixed(3)}{" "}
                kgCO2e. Saved runs freeze the full drill-down so a figure stays explainable after the inventory moves on.
              </p>
            )}
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
              Calculated deterministically from this platform&apos;s approved emission factors ({run.result.engineVersion}).
              Structured to support alignment with recognised LCA principles including ISO 14040/14044 — not verified,
              certified or critically reviewed.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-2">
          <Card>
            <CardContent>
              <div className="text-sm font-medium text-slate-600">Flows calculated</div>
              <div className="mt-2 text-3xl font-semibold text-slate-900">{run.result.calculatedFlowCount}</div>
              <div className="text-xs text-slate-400">inventory flows with a mapped factor</div>
            </CardContent>
          </Card>
          <Card className={run.result.unmappedFlowCount > 0 ? "border-amber-200 bg-amber-50/40" : undefined}>
            <CardContent>
              <div className="text-sm font-medium text-slate-600">Flows without a figure</div>
              <div className="mt-2 text-3xl font-semibold text-slate-900">{run.result.unmappedFlowCount}</div>
              <div className="text-xs text-slate-500">
                {run.result.unmappedFlowCount > 0 ? "not zero — unknown, and excluded from the total" : "none"}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="text-sm font-medium text-slate-600">Data quality</div>
              <div className="mt-2">
                <Badge tone={BAND_TONES[run.dataQuality.weightedBand] ?? "neutral"}>
                  {run.dataQuality.weightedBand}
                </Badge>
              </div>
              <div className="mt-2 text-xs text-slate-500">
                {run.dataQuality.primaryDataSharePercent !== null
                  ? `${run.dataQuality.primaryDataSharePercent.toFixed(0)}% of the calculated footprint from primary data`
                  : "Primary/secondary split not recorded"}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {!completeness.confirmed && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="text-sm text-amber-900">
              <p className="font-medium">
                Goal and scope hasn&apos;t been confirmed yet ({completeness.answered} of {completeness.total} fields
                recorded).
              </p>
              <p className="mt-1 text-amber-800">
                Results before the methodology is settled are working figures, not a study.{" "}
                {completeness.missing.length > 0 && (
                  <>Still to record: {completeness.missing.map((m) => m.label).join(", ")}. </>
                )}
                <Link href={`/lca/${id}/goal-scope`} className="font-medium underline">
                  Open the goal &amp; scope wizard
                </Link>
                .
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* --- System boundary --------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Product system and stage contributions</CardTitle>
        </CardHeader>
        <CardContent>
          <SystemBoundaryDiagram
            stages={project.stages.map((stage) => {
              const contribution = stageContribution.get(stage.id);
              return {
                id: stage.id,
                name: stage.name,
                included: stage.included,
                exclusionReason: stage.exclusionReason,
                processCount: stage.processes.length,
                kgCo2e: contribution?.kgCo2e ?? null,
                percentOfTotal: contribution?.percentOfTotal ?? null,
              };
            })}
          />
        </CardContent>
      </Card>

      {/* --- Hotspots ----------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Hotspots</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!run.hotspots.coverageIsMeaningful && run.result.calculatedFlowCount > 0 && (
              <p className="rounded-lg bg-amber-50/60 p-3 text-sm text-amber-900">
                A large share of the inventory has no figure yet, so this ranking is provisional. Map the remaining
                flows to factors before drawing conclusions from it.
              </p>
            )}
            <HotspotList title="By process" items={run.hotspots.byProcess.slice(0, 6)} />
            <HotspotList title="By flow type" items={run.hotspots.byFlowType.slice(0, 6)} />
            {run.hotspots.byMaterial.length > 0 && (
              <HotspotList title="By material" items={run.hotspots.byMaterial.slice(0, 6)} />
            )}
            {run.hotspots.byFactorSource.length > 0 && (
              <HotspotList title="By factor source" items={run.hotspots.byFactorSource.slice(0, 5)} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sensitivity — which inputs matter most</CardTitle>
          </CardHeader>
          <CardContent>
            {sensitivity.length === 0 ? (
              <p className="text-sm text-slate-500">
                Nothing to test yet — sensitivity needs at least one flow with a factor mapped.
              </p>
            ) : (
              <>
                <p className="text-sm text-slate-500">
                  Each flow&apos;s quantity is increased by 10% on its own and the study re-run through the same
                  deterministic engine. Elasticity is the percentage change in the total per 1% change in that flow.
                </p>
                <table className="mt-3 w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="py-2 pr-4">Flow</th>
                      <th className="py-2 pr-4 text-right">Total at +10%</th>
                      <th className="py-2 text-right">Elasticity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sensitivity.map((s) => (
                      <tr key={s.flowId} className="border-b border-slate-100">
                        <td className="py-2 pr-4 text-slate-800">{s.flowName}</td>
                        <td className="py-2 pr-4 text-right tabular-nums text-slate-600">
                          {s.perturbedKgCo2e.toFixed(4)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-slate-700">
                          {s.elasticity === null ? "—" : s.elasticity.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* --- Drill-down --------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Full drill-down — stage, process, flow, factor, equation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {run.result.stages
            .filter((s) => s.included)
            .map((stage) => (
              <details key={stage.stageId} className="rounded-lg border border-slate-200 p-3" open={stage.kgCo2e > 0}>
                <summary className="cursor-pointer select-none text-sm font-medium text-slate-800">
                  {stage.name} — {stage.kgCo2e.toFixed(4)} kgCO2e
                  {stage.unmappedFlowCount > 0 ? ` · ${stage.unmappedFlowCount} flow(s) without a figure` : ""}
                </summary>
                <div className="mt-3 space-y-3">
                  {stage.processes.length === 0 && <p className="text-sm text-slate-500">No processes yet.</p>}
                  {stage.processes.map((process) => (
                    <div key={process.processId}>
                      <p className="text-sm font-medium text-slate-700">
                        {process.name} — {process.kgCo2e.toFixed(4)} kgCO2e
                      </p>
                      <div className="mt-1 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                              <th className="py-1.5 pr-3">Flow</th>
                              <th className="py-1.5 pr-3">Activity data</th>
                              <th className="py-1.5 pr-3">Factor &amp; source</th>
                              <th className="py-1.5 pr-3">Equation</th>
                              <th className="py-1.5 text-right">kgCO2e</th>
                            </tr>
                          </thead>
                          <tbody>
                            {process.flows.map((flow) => (
                              <tr key={flow.flowId} className="border-b border-slate-100 align-top">
                                <td className="py-1.5 pr-3 text-slate-800">
                                  {flow.name}
                                  <span className="block text-xs text-slate-400">
                                    {flow.direction.toLowerCase()} · {flow.flowType.toLowerCase()}
                                  </span>
                                </td>
                                <td className="py-1.5 pr-3 tabular-nums text-slate-600">
                                  {flow.activityQuantity} {flow.activityUnit}
                                </td>
                                <td className="py-1.5 pr-3 text-slate-600">
                                  {flow.factor ? (
                                    <>
                                      {flow.factor.value} kgCO2e/{flow.factor.unit}
                                      <span className="block text-xs text-slate-400">
                                        {flow.factor.source}, vintage {flow.factor.vintage}, {flow.factor.region} · factor
                                        id {flow.factor.id}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-slate-400">no factor mapped</span>
                                  )}
                                </td>
                                <td className="py-1.5 pr-3 text-xs text-slate-500">
                                  {flow.equation ?? flow.statusReason ?? "—"}
                                </td>
                                <td className="py-1.5 text-right tabular-nums text-slate-800">
                                  {flow.kgCo2e === null ? "—" : flow.kgCo2e.toFixed(4)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ))}
        </CardContent>
      </Card>

      {run.result.gaps.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader>
            <CardTitle>Gaps — flows that produced no figure</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-slate-500">
              These are excluded from the total. They are unknown, not zero, and the total above should be read as
              incomplete until they are resolved.
            </p>
            {run.result.gaps.map((gap) => (
              <div key={gap.flowId} className="rounded-lg bg-amber-50/60 p-3">
                <p className="text-sm font-medium text-amber-900">
                  {gap.name} <Badge tone="warning">{gap.status.replace(/_/g, " ").toLowerCase()}</Badge>
                </p>
                <p className="mt-0.5 text-sm text-amber-800">{gap.reason}</p>
              </div>
            ))}
            <Link href={`/lca/${id}/inventory`} className="inline-block text-sm font-medium text-blue-700 hover:text-blue-800">
              Go to the inventory to map factors →
            </Link>
          </CardContent>
        </Card>
      )}

      {/* --- Data quality ------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Data quality assessment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-700">{run.dataQuality.explanation}</p>
          <p className="text-xs text-slate-400">
            Five dimensions scored 1 (best) to 5 (worst) per flow — source reliability, completeness, temporal,
            geographical and technological relevance — weighted by each flow&apos;s share of the footprint. This is this
            platform&apos;s own transparent scheme, not an implementation of any published pedigree matrix, and an
            unscored dimension is reported as unknown rather than assumed good.
          </p>
          {run.dataQuality.flows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-4">Flow</th>
                    <th className="py-2 pr-4">Band</th>
                    <th className="py-2 pr-4 text-right">Mean score</th>
                    <th className="py-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {run.dataQuality.flows.map((flow) => (
                    <tr key={flow.flowId} className="border-b border-slate-100">
                      <td className="py-2 pr-4 text-slate-800">{flow.name}</td>
                      <td className="py-2 pr-4">
                        <Badge tone={BAND_TONES[flow.band] ?? "neutral"}>{flow.band}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-slate-600">
                        {flow.averageScore === null ? "—" : flow.averageScore.toFixed(2)}
                      </td>
                      <td className="py-2 text-slate-500">{flow.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- AI review, assumptions, findings ----------------------------- */}
      <LcaReviewPanel projectId={id} aiAvailable={availability.available} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Assumptions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {project.assumptions.length === 0 && (
              <p className="text-sm text-slate-500">
                None recorded. An assumption written down is one a reviewer can challenge; one that isn&apos;t is a
                silent decision.
              </p>
            )}
            {project.assumptions.map((a) => (
              <div key={a.id} className="rounded-lg bg-slate-50 p-3">
                <p className="text-sm font-medium text-slate-900">
                  {a.topic} {a.aiAssisted && <Badge tone="info">AI-assisted wording</Badge>}
                </p>
                <p className="mt-0.5 text-sm text-slate-700">{a.statement}</p>
                {a.rationale && <p className="mt-1 text-xs text-slate-500">{a.rationale}</p>}
              </div>
            ))}

            <form action={addAssumptionAction} className="space-y-2 border-t border-slate-100 pt-3">
              <input type="hidden" name="projectId" value={id} />
              <input
                name="topic"
                required
                placeholder="Topic, e.g. Recycled content"
                className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <textarea
                name="statement"
                required
                rows={2}
                placeholder="The assumption itself"
                className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <textarea
                name="rationale"
                rows={2}
                placeholder="Why (optional)"
                className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" name="aiAssisted" className="h-4 w-4 rounded border-slate-300" />
                The wording came from an AI suggestion
              </label>
              <Button type="submit" variant="secondary" size="sm">
                Record assumption
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Review findings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {project.reviewFindings.length === 0 && (
              <p className="text-sm text-slate-500">No findings recorded against this study.</p>
            )}
            {project.reviewFindings.map((f) => (
              <div key={f.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={f.source === "AI" ? "info" : "neutral"}>
                    {f.source === "AI" ? "Raised by AI" : "Raised by a person"}
                  </Badge>
                  <Badge tone={f.severity === "HIGH" ? "danger" : f.severity === "MEDIUM" ? "warning" : "neutral"}>
                    {f.severity.toLowerCase()}
                  </Badge>
                  <Badge tone={f.status === "RESOLVED" ? "success" : "neutral"}>{f.status.toLowerCase()}</Badge>
                </div>
                <p className="mt-2 text-sm text-slate-700">{f.finding}</p>
                {f.suggestion && <p className="mt-1 text-sm text-slate-600">{f.suggestion}</p>}
                {f.status !== "RESOLVED" && (
                  <form action={resolveFindingAction} className="mt-2">
                    <input type="hidden" name="projectId" value={id} />
                    <input type="hidden" name="findingId" value={f.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      <CheckCircle2 className="h-4 w-4" />
                      Mark resolved
                    </Button>
                  </form>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function HotspotList({ title, items }: { title: string; items: { key: string; label: string; kgCo2e: number; percentOfTotal: number }[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item.key} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-slate-700">{item.label}</span>
            <span className="shrink-0 tabular-nums text-slate-600">
              {item.kgCo2e.toFixed(4)} kg · {item.percentOfTotal.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

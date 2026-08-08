import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { getAiAvailability } from "@/lib/ai";
import { getLcaProject, scenarioOverridesFor, toCalculationInput } from "@/lib/lca/service";
import { calculateLca } from "@/lib/lca/calc";
import { compareScenario, runScenario } from "@/lib/lca/scenarios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createScenarioAction, saveScenarioOverrideAction } from "../../actions";
import { ScenarioInterpretation } from "./scenario-interpretation";

export default async function ScenariosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [project, availability] = await Promise.all([getLcaProject(id), getAiAvailability()]);
  if (!project) notFound();

  const baselineInput = toCalculationInput(project);
  const baseline = calculateLca(baselineInput);

  // Every scenario goes through the same engine as the baseline — there is no
  // separate scenario maths that could drift from the real calculation.
  const comparisons = await Promise.all(
    project.scenarios.map(async (scenario) => {
      const overrides = await scenarioOverridesFor(scenario.id);
      const result = runScenario(baselineInput, overrides);
      return { scenario, comparison: compareScenario(scenario.name, baseline, result), overrides };
    }),
  );

  const allFlows = project.stages.flatMap((stage) =>
    stage.processes.flatMap((process) =>
      process.flows.map((flow) => ({
        id: flow.id,
        label: `${stage.name} → ${process.name} → ${flow.name}`,
        unit: flow.unit,
        quantity: Number(flow.quantity),
      })),
    ),
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Scenarios and sensitivity</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          What-if variants of the baseline inventory — a different supplier, renewable electricity, more recycled
          content, a shorter transport leg, a different waste route. Each one is recalculated by the same deterministic
          engine, so a scenario figure and a baseline figure are always comparable.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <div className="text-sm font-medium text-slate-600">Baseline</div>
            <div className="text-2xl font-semibold tabular-nums text-slate-900">
              {baseline.totalKgCo2e.toFixed(4)} kgCO2e
            </div>
            <div className="text-xs text-slate-500">
              per {baseline.functionalUnitLabel ?? "functional unit (not yet defined)"}
            </div>
          </div>
          {baseline.unmappedFlowCount > 0 && (
            <p className="text-sm text-amber-800">
              {baseline.unmappedFlowCount} flow{baseline.unmappedFlowCount === 1 ? "" : "s"} in the baseline still have
              no factor. Scenario differences will be understated until they do.
            </p>
          )}
        </CardContent>
      </Card>

      {comparisons.map(({ scenario, comparison, overrides }) => (
        <Card key={scenario.id}>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {scenario.name} {scenario.isBaseline && <Badge tone="neutral">baseline</Badge>}
            </CardTitle>
            <div className="text-right">
              <div className="text-lg font-semibold tabular-nums text-slate-900">
                {comparison.scenarioKgCo2e.toFixed(4)} kgCO2e
              </div>
              <div className="text-sm tabular-nums text-slate-600">
                {comparison.deltaKgCo2e >= 0 ? "+" : ""}
                {comparison.deltaKgCo2e.toFixed(4)} kg
                {comparison.deltaPercent !== null
                  ? ` (${comparison.deltaPercent >= 0 ? "+" : ""}${comparison.deltaPercent.toFixed(2)}%)`
                  : " (no baseline to compare against)"}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {scenario.description && <p className="text-sm text-slate-600">{scenario.description}</p>}

            {comparison.coverageChanged && (
              <p className="rounded-lg bg-amber-50/60 p-3 text-sm text-amber-900">
                This scenario doesn&apos;t cover the same set of flows as the baseline, so part of the difference is a
                coverage difference rather than a real change. Say so if you quote this figure.
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Baseline versus scenario emissions by life cycle stage</caption>
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-4">Stage</th>
                    <th className="py-2 pr-4 text-right">Baseline</th>
                    <th className="py-2 pr-4 text-right">Scenario</th>
                    <th className="py-2 text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.byStage.map((row) => (
                    <tr key={row.stageId} className="border-b border-slate-100">
                      <td className="py-2 pr-4 text-slate-800">{row.name}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-slate-600">{row.baselineKgCo2e.toFixed(4)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-slate-600">{row.scenarioKgCo2e.toFixed(4)}</td>
                      <td className="py-2 text-right tabular-nums text-slate-800">
                        {row.deltaKgCo2e >= 0 ? "+" : ""}
                        {row.deltaKgCo2e.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ScenarioInterpretation projectId={id} scenarioId={scenario.id} aiAvailable={availability.available} />

            <details className="rounded-lg border border-slate-200 p-3">
              <summary className="cursor-pointer select-none text-sm font-medium text-slate-700">
                Overrides ({overrides.length})
              </summary>
              <div className="mt-3 space-y-3">
                {overrides.map((o) => {
                  const flow = allFlows.find((f) => f.id === o.flowId);
                  return (
                    <p key={o.flowId} className="text-sm text-slate-600">
                      <span className="font-medium">{flow?.label ?? o.flowId}</span>:{" "}
                      {o.excluded
                        ? "excluded from this scenario"
                        : [
                            o.quantity !== null && o.quantity !== undefined ? `quantity → ${o.quantity}` : null,
                            o.transportDistanceKm !== null && o.transportDistanceKm !== undefined
                              ? `distance → ${o.transportDistanceKm} km`
                              : null,
                            o.factor ? `factor → ${o.factor.category} (${o.factor.value} kgCO2e/${o.factor.unit})` : null,
                          ]
                            .filter(Boolean)
                            .join(", ") || "no change"}
                    </p>
                  );
                })}

                <form action={saveScenarioOverrideAction} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_8rem_8rem_auto]">
                  <input type="hidden" name="projectId" value={id} />
                  <input type="hidden" name="scenarioId" value={scenario.id} />
                  <div>
                    <Label htmlFor={`flow-${scenario.id}`} className="text-xs">
                      Flow
                    </Label>
                    <Select id={`flow-${scenario.id}`} name="flowId" required className="mt-1">
                      {allFlows.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label} ({f.quantity} {f.unit})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`qty-${scenario.id}`} className="text-xs">
                      New quantity
                    </Label>
                    <Input id={`qty-${scenario.id}`} name="overrideQuantity" type="number" step="any" min="0" className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor={`dist-${scenario.id}`} className="text-xs">
                      New distance (km)
                    </Label>
                    <Input
                      id={`dist-${scenario.id}`}
                      name="overrideTransportDistanceKm"
                      type="number"
                      step="any"
                      min="0"
                      className="mt-1"
                    />
                  </div>
                  <div className="self-end">
                    <Button type="submit" variant="secondary" size="sm">
                      Set override
                    </Button>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-4">
                    <input type="checkbox" name="excluded" className="h-4 w-4 rounded border-slate-300" />
                    Exclude this flow from the scenario entirely
                  </label>
                  <p className="text-xs text-slate-400 sm:col-span-4">
                    Leaving every field blank and unticked removes the override for that flow rather than storing an
                    empty one.
                  </p>
                </form>
              </div>
            </details>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>New scenario</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createScenarioAction} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <input type="hidden" name="projectId" value={id} />
            <Input name="name" required placeholder="e.g. Renewable electricity" />
            <Input name="description" placeholder="What changes, and on what basis" />
            <Button type="submit" variant="secondary" size="sm">
              <Plus className="h-4 w-4" />
              Create
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

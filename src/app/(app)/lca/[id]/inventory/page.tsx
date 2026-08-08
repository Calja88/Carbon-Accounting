import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { getAiAvailability } from "@/lib/ai";
import { getLcaProject } from "@/lib/lca/service";
import { FLOW_TYPE_LABELS } from "@/lib/lca/stages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteFlowAction } from "../../actions";
import { AddFlowForm, FactorMapper } from "./flow-editor";

export default async function InventoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [project, availability] = await Promise.all([getLcaProject(id), getAiAvailability()]);
  if (!project) notFound();

  const includedStages = project.stages.filter((s) => s.included);
  const hasProcesses = includedStages.some((s) => s.processes.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Life cycle inventory</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Every material, energy, fuel, water, transport, waste and emission flow, with where the figure came from and
          how good it is. Each flow is mapped to a factor from this platform&apos;s approved catalogue — the AI can rank
          the candidates, but the value always comes from the catalogue and the calculation is always the engine&apos;s.
        </p>
      </div>

      {!hasProcesses && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent>
            <p className="text-sm text-amber-900">
              There are no unit processes to attach flows to yet.{" "}
              <Link href={`/lca/${id}/boundary`} className="font-medium underline">
                Add processes on the system boundary tab
              </Link>{" "}
              first.
            </p>
          </CardContent>
        </Card>
      )}

      {includedStages.map((stage) => (
        <Card key={stage.id}>
          <CardHeader>
            <CardTitle>{stage.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {stage.processes.length === 0 && (
              <p className="text-sm text-slate-500">No processes in this stage yet.</p>
            )}

            {stage.processes.map((process) => (
              <div key={process.id} className="space-y-3 border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">{process.name}</h3>
                  <p className="text-xs text-slate-500">
                    {process.flows.length} flow{process.flows.length === 1 ? "" : "s"}
                    {process.geography ? ` · ${process.geography}` : ""}
                    {process.referenceYear ? ` · ${process.referenceYear}` : ""}
                  </p>
                </div>

                {process.flows.map((flow) => (
                  <div key={flow.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-slate-900">{flow.name}</span>
                          <Badge tone="neutral">{FLOW_TYPE_LABELS[flow.flowType] ?? flow.flowType}</Badge>
                          <Badge tone="neutral">{flow.direction.toLowerCase()}</Badge>
                          {flow.dataType && <Badge tone="info">{flow.dataType.toLowerCase()} data</Badge>}
                        </div>
                        <p className="mt-1 text-sm tabular-nums text-slate-700">
                          {Number(flow.quantity)} {flow.unit}
                          {flow.perFunctionalUnit ? " per functional unit" : " per reference flow"}
                          {Number(flow.allocationPercent) !== 100 ? ` · ${Number(flow.allocationPercent)}% allocated` : ""}
                          {flow.transportMassTonnes !== null && flow.transportDistanceKm !== null
                            ? ` · ${Number(flow.transportMassTonnes)} t × ${Number(flow.transportDistanceKm)} km`
                            : ""}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Source: {flow.dataSource ?? "not recorded"}
                          {flow.geography ? ` · ${flow.geography}` : ""}
                          {flow.referenceYear ? ` · ${flow.referenceYear}` : ""}
                          {flow.supplierName ? ` · ${flow.supplierName}` : ""}
                          {" · DQ (rel/comp/temp/geo/tech): "}
                          {[flow.dqReliability, flow.dqCompleteness, flow.dqTemporal, flow.dqGeographical, flow.dqTechnological]
                            .map((v) => (v === null ? "—" : v))
                            .join("/")}
                        </p>
                        {flow.notes && <p className="mt-1 text-xs text-slate-500">{flow.notes}</p>}
                      </div>
                      <form action={deleteFlowAction}>
                        <input type="hidden" name="projectId" value={id} />
                        <input type="hidden" name="flowId" value={flow.id} />
                        <Button type="submit" variant="ghost" size="sm" aria-label={`Delete ${flow.name}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </form>
                    </div>

                    <FactorMapper
                      projectId={id}
                      aiAvailable={availability.available}
                      flow={{
                        id: flow.id,
                        name: flow.name,
                        unit: flow.unit,
                        hasFactor: Boolean(flow.emissionFactor),
                        factorLabel: flow.emissionFactor
                          ? `${flow.emissionFactor.category}${flow.emissionFactor.subtypeKey ? ` / ${flow.emissionFactor.subtypeKey}` : ""} — ${Number(flow.emissionFactor.co2eFactor)} kgCO2e/${flow.emissionFactor.unit} (${flow.emissionFactor.factorSet.publisher} ${flow.emissionFactor.factorSet.vintageYear})`
                          : null,
                        aiAssisted: flow.aiAssisted,
                      }}
                    />
                  </div>
                ))}

                <AddFlowForm projectId={id} processId={process.id} />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {project.stages.some((s) => !s.included) && (
        <Card>
          <CardHeader>
            <CardTitle>Stages outside the boundary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-slate-500">
              Flows can&apos;t be added to an excluded stage. If one of these should carry data, include it on the system
              boundary tab and record why the boundary changed.
            </p>
            <ul className="space-y-1 text-sm text-slate-600">
              {project.stages
                .filter((s) => !s.included)
                .map((s) => (
                  <li key={s.id}>
                    <span className="font-medium">{s.name}</span> — {s.exclusionReason ?? "no reason recorded"}
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

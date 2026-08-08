import { notFound } from "next/navigation";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { getLcaProject, runLcaCalculation } from "@/lib/lca/service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SystemBoundaryDiagram } from "@/components/lca/system-boundary-diagram";
import { addProcessAction, addStageAction, deleteProcessAction, resyncStagesAction, updateStageAction } from "../../actions";

export default async function BoundaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const project = await getLcaProject(id);
  if (!project) notFound();

  const run = await runLcaCalculation(project);
  const contribution = new Map(run.hotspots.byStage.map((s) => [s.key, s]));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">System boundary</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          The life cycle stages in the study and the unit processes inside them. Excluded stages stay visible with their
          reason recorded — what a study leaves out is part of the study.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Product system</CardTitle>
        </CardHeader>
        <CardContent>
          <SystemBoundaryDiagram
            stages={project.stages.map((stage) => {
              const c = contribution.get(stage.id);
              return {
                id: stage.id,
                name: stage.name,
                included: stage.included,
                exclusionReason: stage.exclusionReason,
                processCount: stage.processes.length,
                kgCo2e: c?.kgCo2e ?? null,
                percentOfTotal: c?.percentOfTotal ?? null,
              };
            })}
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <form action={resyncStagesAction}>
          <input type="hidden" name="projectId" value={id} />
          <Button type="submit" variant="secondary" size="sm">
            <RefreshCw className="h-4 w-4" />
            Re-sync stages with the declared boundary
          </Button>
        </form>
        <p className="text-xs text-slate-400">
          Adds any missing stages and resets which are in or out of the boundary. Names, reasons and processes you have
          edited are left alone, and nothing is deleted.
        </p>
      </div>

      {project.stages.map((stage) => (
        <Card key={stage.id}>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {stage.name}{" "}
              {stage.included ? <Badge tone="success">in boundary</Badge> : <Badge tone="neutral">excluded</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {stage.description && <p className="text-sm text-slate-500">{stage.description}</p>}

            <form action={updateStageAction} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
              <input type="hidden" name="projectId" value={id} />
              <input type="hidden" name="stageId" value={stage.id} />
              <div className="space-y-2">
                <div>
                  <Label htmlFor={`name-${stage.id}`}>Stage name</Label>
                  <Input id={`name-${stage.id}`} name="name" defaultValue={stage.name} className="mt-1" />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="included" defaultChecked={stage.included} className="h-4 w-4 rounded border-slate-300" />
                  Inside the system boundary
                </label>
                <div>
                  <Label htmlFor={`reason-${stage.id}`}>If excluded, why?</Label>
                  <Input
                    id={`reason-${stage.id}`}
                    name="exclusionReason"
                    defaultValue={stage.exclusionReason ?? ""}
                    placeholder="e.g. Outside the cradle-to-gate boundary declared for this study"
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="self-end">
                <Button type="submit" variant="secondary" size="sm">
                  Save stage
                </Button>
              </div>
            </form>

            <div className="border-t border-slate-100 pt-3">
              <h3 className="text-sm font-medium text-slate-800">Unit processes</h3>
              {stage.processes.length === 0 && (
                <p className="mt-1 text-sm text-slate-500">
                  No processes yet. A process is a step you can attach inventory flows to — &ldquo;injection
                  moulding&rdquo;, &ldquo;antenna etching&rdquo;, &ldquo;supplier-to-factory transport&rdquo;.
                </p>
              )}
              <ul className="mt-2 space-y-1">
                {stage.processes.map((process) => (
                  <li key={process.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{process.name}</p>
                      <p className="text-xs text-slate-500">
                        {process.flows.length} flow{process.flows.length === 1 ? "" : "s"}
                        {process.geography ? ` · ${process.geography}` : ""}
                        {process.referenceYear ? ` · ${process.referenceYear}` : ""}
                      </p>
                    </div>
                    <form action={deleteProcessAction}>
                      <input type="hidden" name="projectId" value={id} />
                      <input type="hidden" name="processId" value={process.id} />
                      <Button type="submit" variant="ghost" size="sm" aria-label={`Delete ${process.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>

              <form action={addProcessAction} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_8rem_auto]">
                <input type="hidden" name="projectId" value={id} />
                <input type="hidden" name="stageId" value={stage.id} />
                <Input name="name" required placeholder="Process name" />
                <Input name="geography" placeholder="Geography (optional)" />
                <Input name="referenceYear" type="number" min="1990" max="2100" placeholder="Year" />
                <Button type="submit" variant="secondary" size="sm">
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Add a stage</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={addStageAction} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input type="hidden" name="projectId" value={id} />
            <Input name="name" required placeholder="Stage name" />
            <Input name="description" placeholder="Description (optional)" />
            <Button type="submit" variant="secondary" size="sm">
              <Plus className="h-4 w-4" />
              Add stage
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

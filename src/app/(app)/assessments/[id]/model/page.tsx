import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { loadModel } from "@/lib/lca/model-service";
import { toEngineAssessment, loadAssessmentOrThrow } from "@/lib/lca/calculation-service";
import { resolveAllocations } from "@/lib/lca/engine/allocation";
import { checkCanEditAssessment, getLcaActor } from "@/lib/lca/permissions";
import { ALLOCATION_LABELS, LIFECYCLE_STAGE_ORDER, STAGE_DESCRIPTIONS, STAGE_LABELS } from "@/lib/lca/labels";
import { Badge } from "@/components/ui/badge";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { EmptyState, Notice, PageHeading, SectionCard } from "@/components/lca/ui";
import { ProcessForm, ProcessOutputForm } from "./model-forms";
import { deleteProcessAction, deleteProcessOutputAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [model, actor] = await Promise.all([loadModel(id), getLcaActor()]);
  if (!model) notFound();

  const permission = checkCanEditAssessment(actor, model.status);
  const canEdit = permission.ok;

  // The allocation factors shown here are the same ones the engine will use —
  // computed by the same function, not re-derived for display.
  const loaded = await loadAssessmentOrThrow(id);
  const allocations = resolveAllocations(toEngineAssessment(loaded).processes);

  const itemCounts = await prisma.lcaInventoryItem.groupBy({
    by: ["processId"],
    where: { assessmentId: id },
    _count: { _all: true },
  });
  const itemCountByProcess = new Map(itemCounts.map((c) => [c.processId, c._count._all]));

  const parentOptions = model.processes.map((p) => ({ id: p.id, name: p.name, stage: p.stage }));
  const stagesPresent = LIFECYCLE_STAGE_ORDER.filter(
    (stage) => model.processes.some((p) => p.stage === stage) || model.includedStages.includes(stage),
  );

  return (
    <div className="space-y-6">
      <PageHeading
        title="Lifecycle model"
        description="The processes that make up the product's life, nested as deeply as the model needs, with allocation applied wherever a process makes more than one thing."
        actions={canEdit ? <ProcessForm assessmentId={id} parentOptions={parentOptions} /> : null}
      />

      {!canEdit && <Notice tone="info">{permission.reason}</Notice>}

      {model.processes.length === 0 && (
        <EmptyState
          title="The model is empty"
          description="Add the processes that make up this product's life. A boundary chosen on the goal and scope page creates a starting skeleton — you can add, nest and remove processes freely."
        />
      )}

      {stagesPresent.map((stage) => {
        const stageProcesses = model.processes.filter((p) => p.stage === stage);
        const inBoundary = model.includedStages.includes(stage);

        return (
          <SectionCard
            key={stage}
            title={STAGE_LABELS[stage]}
            description={STAGE_DESCRIPTIONS[stage]}
            actions={
              inBoundary ? (
                <Badge tone="info">In scope</Badge>
              ) : (
                <Badge tone="neutral">Outside the declared boundary</Badge>
              )
            }
          >
            {stageProcesses.length === 0 ? (
              <p className="text-sm text-slate-500">
                This stage is inside the declared boundary but has no process yet. Either model it, or take it out of the
                boundary and record why in the exclusions register.
              </p>
            ) : (
              <ul className="space-y-4">
                {stageProcesses.map((process) => {
                  const allocation = allocations.get(process.id);
                  const parent = process.parentProcessId
                    ? model.processes.find((p) => p.id === process.parentProcessId)
                    : null;
                  const itemCount = itemCountByProcess.get(process.id) ?? 0;

                  return (
                    <li key={process.id} className="rounded-lg border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-slate-900">{process.name}</h3>
                            {!process.isIncluded && <Badge tone="warning">Excluded from the model</Badge>}
                            {parent && <Badge tone="neutral">inside {parent.name}</Badge>}
                            {process._count.childProcesses > 0 && (
                              <Badge tone="neutral">{process._count.childProcesses} sub-process(es)</Badge>
                            )}
                          </div>
                          {process.description && <p className="mt-1 text-sm text-slate-600">{process.description}</p>}
                          <p className="mt-1 text-xs text-slate-500">
                            {itemCount} inventory line{itemCount === 1 ? "" : "s"}
                            {process.geography ? ` · ${process.geography}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          {canEdit && (
                            <ProcessForm
                              assessmentId={id}
                              parentOptions={parentOptions}
                              trigger="edit"
                              process={{
                                id: process.id,
                                parentProcessId: process.parentProcessId,
                                stage: process.stage,
                                name: process.name,
                                description: process.description,
                                isIncluded: process.isIncluded,
                                allocationMethod: process.allocationMethod,
                                allocationPercent: process.allocationPercent.toString(),
                                allocationRationale: process.allocationRationale,
                                allocationBasisDescription: process.allocationBasisDescription,
                                geography: process.geography,
                                notes: process.notes,
                              }}
                            />
                          )}
                          {canEdit && itemCount === 0 && process._count.childProcesses === 0 && (
                            <DestructiveActionDialog
                              triggerLabel={`Delete ${process.name}`}
                              triggerIcon={<Trash2 className="h-3.5 w-3.5" />}
                              title={`Delete "${process.name}"?`}
                              description="This process has no inventory lines or sub-processes, so nothing else depends on it. This cannot be undone."
                              formAction={deleteProcessAction}
                            >
                              <input type="hidden" name="assessmentId" value={id} />
                              <input type="hidden" name="processId" value={process.id} />
                            </DestructiveActionDialog>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 rounded-lg bg-slate-50 p-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Allocation</span>
                          <span className="text-sm tabular-nums text-slate-700">
                            {allocation ? `${allocation.effectivePercent.toDecimalPlaces(4).toString()}% to this product` : "—"}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-600">
                          {ALLOCATION_LABELS[process.allocationMethod]}
                          {allocation && allocation.own.basis ? ` — ${allocation.own.basis}` : ""}
                        </p>
                        {allocation?.chain && allocation.chain.includes(" x ") && (
                          <p className="mt-1 text-xs text-slate-500">Cascade: {allocation.chain}</p>
                        )}
                        {allocation?.own.problem && (
                          <p className="mt-2 text-xs font-medium text-red-700">{allocation.own.problem}</p>
                        )}

                        {process.outputs.length > 0 && (
                          <ul className="mt-3 space-y-1">
                            {process.outputs.map((output) => (
                              <li key={output.id} className="flex items-center justify-between gap-2 text-sm">
                                <span className="min-w-0 truncate text-slate-700">
                                  {output.name}
                                  {output.isAssessedProduct && <Badge tone="success" className="ml-2">Assessed product</Badge>}
                                </span>
                                <span className="flex items-center gap-2 shrink-0 text-xs tabular-nums text-slate-500">
                                  {output.massValue && `${output.massValue.toString()} ${output.massUnit ?? ""}`}
                                  {output.physicalValue && `${output.physicalValue.toString()} ${output.physicalUnit ?? ""}`}
                                  {output.economicValue && `${output.economicValue.toString()} ${output.economicCurrency ?? ""}`}
                                  {canEdit && (
                                    <DestructiveActionDialog
                                      triggerLabel={`Remove ${output.name}`}
                                      triggerIcon={<Trash2 className="h-3 w-3" />}
                                      title={`Remove "${output.name}"?`}
                                      description="This co-product will no longer be part of this process's allocation. This cannot be undone."
                                      confirmLabel="Remove"
                                      formAction={deleteProcessOutputAction}
                                    >
                                      <input type="hidden" name="assessmentId" value={id} />
                                      <input type="hidden" name="outputId" value={output.id} />
                                    </DestructiveActionDialog>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {canEdit && (
                          <ProcessOutputForm
                            assessmentId={id}
                            processId={process.id}
                            allocationMethod={process.allocationMethod}
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        );
      })}
    </div>
  );
}

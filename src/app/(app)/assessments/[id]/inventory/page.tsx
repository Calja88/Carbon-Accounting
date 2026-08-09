import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Upload } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { listInventory } from "@/lib/lca/model-service";
import { getLatestRun } from "@/lib/lca/calculation-service";
import { checkCanEditAssessment, getLcaActor } from "@/lib/lca/permissions";
import { D, percentOf, toNumber, ZERO } from "@/lib/lca/decimal";
import { DATA_TYPE_SHORT, FACTOR_MODE_LABELS, ITEM_TYPE_LABELS, STAGE_LABELS } from "@/lib/lca/labels";
import { formatKgPrecise } from "@/components/charts/palette";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, Notice, PageHeading, SectionCard, Td } from "@/components/lca/ui";
import { InventoryItemForm } from "./inventory-forms";
import { InventoryViewTabs } from "./view-tabs";

export const dynamic = "force-dynamic";

export default async function InventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const { view } = await searchParams;
  const bomView = view === "bom";

  const [assessment, items, run, actor] = await Promise.all([
    prisma.lcaAssessment.findUnique({
      where: { id },
      include: { processes: { orderBy: [{ sortOrder: "asc" }] }, entity: true },
    }),
    listInventory(id),
    getLatestRun(id),
    getLcaActor(),
  ]);
  if (!assessment) notFound();

  const suppliers = await prisma.supplier.findMany({
    where: { entityId: assessment.entityId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const permission = checkCanEditAssessment(actor, assessment.status);
  const canEdit = permission.ok;

  // Calculated emissions per line come from the stored run, so the inventory
  // table and the results dashboard can never disagree.
  const emissionsByItem = new Map<string, { kg: number; perFu: number }>();
  let grossTotal = ZERO;
  for (const result of run?.results ?? []) {
    if (!result.inventoryItemId) continue;
    const existing = emissionsByItem.get(result.inventoryItemId) ?? { kg: 0, perFu: 0 };
    emissionsByItem.set(result.inventoryItemId, {
      kg: existing.kg + toNumber(result.allocatedKgCo2e),
      perFu: existing.perFu + toNumber(result.perFunctionalUnitKgCo2e),
    });
    if (D(result.allocatedKgCo2e).gt(ZERO)) grossTotal = grossTotal.plus(D(result.allocatedKgCo2e));
  }

  const displayedItems = bomView
    ? items.filter((item) => item.itemType === "MATERIAL" || item.itemType === "PACKAGING")
    : items;

  const processOptions = assessment.processes.map((p) => ({ id: p.id, name: p.name, stage: p.stage }));

  return (
    <div className="space-y-6">
      <PageHeading
        title={bomView ? "Bill of materials" : "Inventory"}
        description={
          bomView
            ? "The material and packaging lines that make up the product, with their quantities, recycled content, manufacturing loss, assigned factors and calculated contribution."
            : "Every activity-data line the calculation reads: materials, energy, freight, waste, use phase and end of life."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/assessments/${id}/import`}>
              <Button size="sm" variant="secondary">
                <Upload className="h-4 w-4" />
                Import CSV
              </Button>
            </Link>
            {canEdit && assessment.processes.length > 0 && (
              <InventoryItemForm
                assessmentId={id}
                processes={processOptions}
                suppliers={suppliers}
                defaultProcessId={assessment.processes[0]?.id}
              />
            )}
          </div>
        }
      />

      <InventoryViewTabs assessmentId={id} active={bomView ? "bom" : "all"} />

      {!canEdit && <Notice tone="info">{permission.reason}</Notice>}

      {assessment.processes.length === 0 && (
        <Notice tone="warning" title="No processes yet">
          Every inventory line sits in a process. Add processes on the{" "}
          <Link href={`/assessments/${id}/model`} className="font-medium underline">
            lifecycle model
          </Link>{" "}
          page first.
        </Notice>
      )}

      {displayedItems.length === 0 ? (
        <EmptyState
          title={bomView ? "No material or packaging lines yet" : "The inventory is empty"}
          description={
            canEdit
              ? "Add lines one at a time, or import a bill of materials from a spreadsheet — the importer previews every row and reports the ones it cannot use rather than dropping them."
              : "Nothing has been entered yet."
          }
          action={
            <Link href={`/assessments/${id}/import`} className="text-sm font-medium text-brand-700 hover:text-brand-800">
              Import from CSV →
            </Link>
          }
        />
      ) : (
        Array.from(new Set(displayedItems.map((item) => item.processId))).map((processId) => {
          const process = assessment.processes.find((p) => p.id === processId);
          const processItems = displayedItems.filter((item) => item.processId === processId);
          if (!process) return null;

          return (
            <SectionCard
              key={processId}
              title={process.name}
              description={`${STAGE_LABELS[process.stage]} · ${processItems.length} line${processItems.length === 1 ? "" : "s"}`}
            >
              <DataTable
                headers={
                  bomView
                    ? [
                        "Component / part",
                        "Material",
                        "Supplier",
                        { label: "Quantity", align: "right" },
                        { label: "Recycled", align: "right" },
                        { label: "Loss", align: "right" },
                        "Factor",
                        { label: "kgCO2e", align: "right" },
                        { label: "Share", align: "right" },
                      ]
                    : [
                        "Line",
                        "Type",
                        { label: "Quantity", align: "right" },
                        "Data",
                        "Factor",
                        { label: "kgCO2e", align: "right" },
                        { label: "Per unit", align: "right" },
                        { label: "Share", align: "right" },
                        "",
                      ]
                }
              >
                {processItems.map((item) => {
                  const emissions = emissionsByItem.get(item.id);
                  const share = emissions ? toNumber(percentOf(D(emissions.kg), grossTotal)) : 0;
                  const factorLabel = item.emissionFactor
                    ? `${item.emissionFactor.factorSet.publisher} — ${item.emissionFactor.co2eFactor.toString()} kgCO2e/${item.emissionFactor.unit}`
                    : item.supplierPcf
                      ? `${item.supplierPcf.supplier.name} PCF`
                      : item.factorSelectionMode === "MANUAL"
                        ? `${item.manualFactorValue?.toString() ?? "?"} kgCO2e/${item.manualFactorUnit ?? item.unit}`
                        : null;
                  const isPlaceholder = item.emissionFactor?.factorSet.isPlaceholder ?? false;

                  return (
                    <tr key={item.id} className={item.isExcluded ? "bg-slate-50 text-slate-400" : "hover:bg-slate-50"}>
                      {bomView ? (
                        <>
                          <Td>
                            <Link href={`/assessments/${id}/inventory/${item.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                              {item.componentName ? `${item.componentName} — ` : ""}
                              {item.name}
                            </Link>
                            {item.partNumber && <span className="mt-0.5 block font-mono text-xs text-slate-500">{item.partNumber}</span>}
                          </Td>
                          <Td>{item.materialName ?? <span className="text-slate-400">—</span>}</Td>
                          <Td>{item.supplier?.name ?? <span className="text-slate-400">—</span>}</Td>
                          <Td align="right">
                            {item.quantity.toString()} {item.unit}
                          </Td>
                          <Td align="right">{item.recycledContentPercent ? `${item.recycledContentPercent.toString()}%` : "—"}</Td>
                          <Td align="right">{item.wastePercent ? `${item.wastePercent.toString()}%` : "—"}</Td>
                          <Td>
                            {factorLabel ? (
                              <span className="flex items-center gap-1.5 text-xs">
                                {isPlaceholder && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden="true" />}
                                <span className="line-clamp-1">{factorLabel}</span>
                              </span>
                            ) : (
                              <Badge tone="warning">No factor</Badge>
                            )}
                          </Td>
                          <Td align="right">{emissions ? formatKgPrecise(emissions.kg) : "—"}</Td>
                          <Td align="right">{emissions ? `${share.toFixed(1)}%` : "—"}</Td>
                        </>
                      ) : (
                        <>
                          <Td>
                            <Link href={`/assessments/${id}/inventory/${item.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                              {item.name}
                            </Link>
                            <span className="mt-0.5 flex flex-wrap gap-1.5">
                              {item.isExcluded && <Badge tone="warning">Excluded</Badge>}
                              {item._count.transportLegs > 0 && <Badge tone="neutral">{item._count.transportLegs} leg(s)</Badge>}
                              {item._count.endOfLifeRoutes > 0 && <Badge tone="neutral">{item._count.endOfLifeRoutes} route(s)</Badge>}
                              {item._count.evidence > 0 && <Badge tone="info">{item._count.evidence} evidence</Badge>}
                            </span>
                          </Td>
                          <Td className="text-xs">{ITEM_TYPE_LABELS[item.itemType]}</Td>
                          <Td align="right">
                            {item.quantity.toString()} {item.unit}
                          </Td>
                          <Td className="text-xs">{DATA_TYPE_SHORT[item.dataType]}</Td>
                          <Td>
                            {factorLabel ? (
                              <span className="flex items-center gap-1.5 text-xs">
                                {isPlaceholder && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden="true" />}
                                <span className="line-clamp-1" title={factorLabel}>
                                  {factorLabel}
                                </span>
                              </span>
                            ) : (
                              <Badge tone="warning">{FACTOR_MODE_LABELS.NONE}</Badge>
                            )}
                          </Td>
                          <Td align="right">{emissions ? formatKgPrecise(emissions.kg) : "—"}</Td>
                          <Td align="right">{emissions ? formatKgPrecise(emissions.perFu) : "—"}</Td>
                          <Td align="right">{emissions ? `${share.toFixed(1)}%` : "—"}</Td>
                          <Td align="right">
                            <Link
                              href={`/assessments/${id}/inventory/${item.id}`}
                              className="text-xs font-medium text-brand-700 hover:text-brand-800"
                            >
                              Open
                            </Link>
                          </Td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </DataTable>
            </SectionCard>
          );
        })
      )}
    </div>
  );
}

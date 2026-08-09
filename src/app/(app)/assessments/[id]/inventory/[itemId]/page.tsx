import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getInventoryItem } from "@/lib/lca/model-service";
import { getLatestRun } from "@/lib/lca/calculation-service";
import { searchFactors, factorLabel, factorSummary } from "@/lib/lca/factor-library";
import { supplierPcfsForItem, pcfPerUnit } from "@/lib/lca/supplier-service";
import { corporateEntriesForLinking } from "@/lib/lca/registers-service";
import { checkCanEditAssessment, getLcaActor } from "@/lib/lca/permissions";
import { allowsAvoidedBurden, toMethodologyConfig } from "@/lib/lca/methodology";
import {
  CLASSIFICATION_LABELS,
  CORPORATE_LINK_LABELS,
  DATA_TYPE_LABELS,
  EOL_ROUTE_LABELS,
  ITEM_TYPE_LABELS,
  TRANSPORT_MODE_LABELS,
  UNCERTAINTY_LABELS,
} from "@/lib/lca/labels";
import { formatKgPrecise } from "@/components/charts/palette";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BackLink, DataTable, FieldList, Notice, PageHeading, SectionCard, Td } from "@/components/lca/ui";
import { InventoryItemForm } from "../inventory-forms";
import {
  CorporateLinkForm,
  EndOfLifeRouteForm,
  FactorAssignmentForm,
  TransportLegForm,
} from "./item-forms";
import {
  deleteCorporateLinkAction,
  deleteEndOfLifeRouteAction,
  deleteInventoryItemAction,
  deleteTransportLegAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function InventoryItemPage({ params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const [item, actor] = await Promise.all([getInventoryItem(itemId), getLcaActor()]);
  if (!item || item.assessmentId !== id) notFound();

  const permission = checkCanEditAssessment(actor, item.assessment.status);
  const canEdit = permission.ok;
  const methodology = toMethodologyConfig(item.assessment.methodologyProfile);

  const [run, factorOptions, recycledOptions, supplierPcfs, processes, suppliers, corporateEntries, sites] = await Promise.all([
    getLatestRun(id),
    searchFactors({ itemType: item.itemType, compatibleWithUnit: item.unit }),
    searchFactors({ category: "lca_material_recycled", compatibleWithUnit: item.unit }),
    supplierPcfsForItem(item.assessment.entityId, item.unit),
    prisma.lcaProcess.findMany({ where: { assessmentId: id }, orderBy: [{ sortOrder: "asc" }] }),
    prisma.supplier.findMany({ where: { entityId: item.assessment.entityId }, orderBy: { name: "asc" } }),
    corporateEntriesForLinking({ take: 60 }),
    prisma.site.findMany({ include: { entity: true }, orderBy: [{ entity: { name: "asc" } }, { name: "asc" }] }),
  ]);

  const [freightFactors, eolFactors] = await Promise.all([
    searchFactors({ itemType: "TRANSPORT" }),
    searchFactors({ itemType: "END_OF_LIFE", compatibleWithUnit: item.unit }),
  ]);

  const results = (run?.results ?? []).filter((r) => r.inventoryItemId === itemId);
  const eolTotalPercent = item.endOfLifeRoutes.reduce((sum, r) => sum + Number(r.percent), 0);

  const toOption = (factor: (typeof factorOptions)[number]) => ({
    id: factor.id,
    label: factorLabel(factor),
    summary: factorSummary(factor),
    isPlaceholder: factor.factorSet.isPlaceholder,
  });

  return (
    <div className="space-y-6">
      <BackLink href={`/assessments/${id}/inventory`}>Back to inventory</BackLink>

      <PageHeading
        eyebrow={`${ITEM_TYPE_LABELS[item.itemType]} · ${item.process.name}`}
        title={item.name}
        description={item.description}
        actions={
          <div className="flex items-center gap-2">
            {canEdit && (
              <InventoryItemForm
                assessmentId={id}
                processes={processes.map((p) => ({ id: p.id, name: p.name, stage: p.stage }))}
                suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
                trigger="edit"
                item={{
                  id: item.id,
                  processId: item.processId,
                  itemType: item.itemType,
                  name: item.name,
                  description: item.description,
                  componentName: item.componentName,
                  partNumber: item.partNumber,
                  materialName: item.materialName,
                  supplierId: item.supplierId,
                  quantity: item.quantity.toString(),
                  unit: item.unit,
                  adjustmentFactor: item.adjustmentFactor.toString(),
                  adjustmentRationale: item.adjustmentRationale,
                  recycledContentPercent: item.recycledContentPercent?.toString() ?? null,
                  wastePercent: item.wastePercent?.toString() ?? null,
                  dataType: item.dataType,
                  dataSource: item.dataSource,
                  geography: item.geography,
                  classification: item.classification,
                  biogenicUptakePerUnit: item.biogenicUptakePerUnit?.toString() ?? null,
                  storedCarbonPerUnit: item.storedCarbonPerUnit?.toString() ?? null,
                  temporalScore: item.temporalScore,
                  geographicalScore: item.geographicalScore,
                  technologicalScore: item.technologicalScore,
                  completenessScore: item.completenessScore,
                  reliabilityScore: item.reliabilityScore,
                  uncertaintyStatus: item.uncertaintyStatus,
                  uncertaintyPercent: item.uncertaintyPercent?.toString() ?? null,
                  uncertaintyLower: item.uncertaintyLower?.toString() ?? null,
                  uncertaintyUpper: item.uncertaintyUpper?.toString() ?? null,
                  uncertaintyNotes: item.uncertaintyNotes,
                  isExcluded: item.isExcluded,
                  exclusionReason: item.exclusionReason,
                  notes: item.notes,
                }}
              />
            )}
            {canEdit && (
              <form action={deleteInventoryItemAction}>
                <input type="hidden" name="assessmentId" value={id} />
                <input type="hidden" name="itemId" value={item.id} />
                <Button type="submit" size="sm" variant="ghost">
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </form>
            )}
          </div>
        }
      />

      {!canEdit && <Notice tone="info">{permission.reason}</Notice>}
      {item.isExcluded && (
        <Notice tone="warning" title="Excluded from the model">
          {item.exclusionReason ?? "No reason recorded — the validation engine treats this as an error."}
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Activity data" description="What was entered, and where it came from.">
          <FieldList
            items={[
              { label: "Quantity", value: `${item.quantity.toString()} ${item.unit}` },
              {
                label: "Normalised",
                // Read from the last run's result rows rather than stored on the
                // item: the conversion is an output of a calculation, and giving
                // it a second home is how the two drift apart.
                value:
                  results.length > 0
                    ? results
                        .filter((r) => !r.transportLegId && !r.endOfLifeRouteId)
                        .map((r) => `${r.normalizedValue.toString()} ${r.normalizedUnit}`)
                        .join(", ") || null
                    : null,
                hint: "As converted by the last calculation run",
              },
              {
                label: "Adjustment",
                value: item.adjustmentFactor.equals(1) ? "None" : `× ${item.adjustmentFactor.toString()}${item.adjustmentRationale ? ` — ${item.adjustmentRationale}` : ""}`,
              },
              { label: "Data type", value: DATA_TYPE_LABELS[item.dataType] },
              { label: "Data source", value: item.dataSource },
              { label: "Supplier", value: item.supplier?.name },
              { label: "Geography", value: item.geography },
              { label: "Component / part", value: [item.componentName, item.partNumber].filter(Boolean).join(" · ") || null },
              { label: "Material", value: item.materialName },
              { label: "Recycled content", value: item.recycledContentPercent ? `${item.recycledContentPercent.toString()}%` : null },
              { label: "Manufacturing loss", value: item.wastePercent ? `${item.wastePercent.toString()}%` : null },
              { label: "Classification", value: CLASSIFICATION_LABELS[item.classification] },
              { label: "Biogenic uptake per unit", value: item.biogenicUptakePerUnit ? `${item.biogenicUptakePerUnit.toString()} kgCO2e` : null },
              { label: "Stored carbon per unit", value: item.storedCarbonPerUnit ? `${item.storedCarbonPerUnit.toString()} kgCO2e` : null },
              { label: "Notes", value: item.notes },
            ]}
          />
        </SectionCard>

        <SectionCard title="Data quality and uncertainty" description="Pedigree scores on a 1 (best) to 5 (worst) scale.">
          <FieldList
            items={[
              { label: "Temporal", value: item.temporalScore ?? null },
              { label: "Geographical", value: item.geographicalScore ?? null },
              { label: "Technological", value: item.technologicalScore ?? null },
              { label: "Completeness", value: item.completenessScore ?? null },
              { label: "Reliability", value: item.reliabilityScore ?? null },
              { label: "Uncertainty status", value: UNCERTAINTY_LABELS[item.uncertaintyStatus] },
              { label: "Uncertainty", value: item.uncertaintyPercent ? `±${item.uncertaintyPercent.toString()}%` : null },
              {
                label: "Range",
                value:
                  item.uncertaintyLower || item.uncertaintyUpper
                    ? `${item.uncertaintyLower?.toString() ?? "?"} to ${item.uncertaintyUpper?.toString() ?? "?"}`
                    : null,
              },
              { label: "Uncertainty notes", value: item.uncertaintyNotes },
            ]}
          />
        </SectionCard>
      </div>

      <SectionCard
        title="Emission factor"
        description="What this line is priced at, where that figure comes from, and what it covers."
      >
        <FactorAssignmentForm
          assessmentId={id}
          inventoryItemId={item.id}
          itemUnit={item.unit}
          currentMode={item.factorSelectionMode}
          currentFactorId={item.emissionFactorId}
          currentRecycledFactorId={item.recycledEmissionFactorId}
          currentSupplierPcfId={item.supplierPcfId}
          manual={{
            value: item.manualFactorValue?.toString() ?? null,
            unit: item.manualFactorUnit,
            source: item.manualFactorSource,
            version: item.manualFactorVersion,
            boundary: item.manualFactorBoundary,
            geography: item.manualFactorGeography,
            year: item.manualFactorYear,
            gwpBasis: item.manualFactorGwpBasis,
            rationale: item.manualFactorRationale,
          }}
          factorOptions={factorOptions.map(toOption)}
          recycledFactorOptions={recycledOptions.map(toOption)}
          supplierPcfOptions={supplierPcfs.map((pcf) => ({
            id: pcf.id,
            label: `${pcf.supplier.name} — ${pcf.productName}`,
            summary: `${pcfPerUnit(pcf)} kgCO2e per ${pcf.declaredUnitUnit} · ${pcf.boundary.replace(/_/g, " ").toLowerCase()} · ${pcf.verificationStatus.replace(/_/g, " ").toLowerCase()}`,
          }))}
          hasRecycledContent={Boolean(item.recycledContentPercent && Number(item.recycledContentPercent) > 0)}
          disabled={!canEdit}
        />
      </SectionCard>

      {item.itemType === "TRANSPORT" && (
        <SectionCard
          title="Transport legs"
          description="Each movement is calculated on its own, so a multimodal journey shows its arithmetic leg by leg."
          actions={
            <TransportLegForm
              assessmentId={id}
              inventoryItemId={item.id}
              factorOptions={freightFactors.map(toOption)}
              disabled={!canEdit}
            />
          }
        >
          {item.transportLegs.length === 0 ? (
            <p className="text-sm text-slate-500">No legs recorded yet — a transport line with no legs produces no figure.</p>
          ) : (
            <DataTable headers={["Leg", "Mode", "Route", { label: "Mass", align: "right" }, { label: "Distance", align: "right" }, "Factor", "Assumptions", ""]}>
              {item.transportLegs.map((leg) => (
                <tr key={leg.id}>
                  <Td>{leg.sequence + 1}</Td>
                  <Td>{leg.modeDescription ?? TRANSPORT_MODE_LABELS[leg.mode]}</Td>
                  <Td>
                    {leg.originName || leg.destinationName ? `${leg.originName ?? "?"} → ${leg.destinationName ?? "?"}` : "—"}
                    {leg.includesReturnTrip && <Badge tone="neutral" className="ml-2">Return included</Badge>}
                  </Td>
                  <Td align="right">
                    {leg.massValue.toString()} {leg.massUnit}
                  </Td>
                  <Td align="right">
                    {leg.distanceValue.toString()} {leg.distanceUnit}
                    {leg.loadFactorPercent && <span className="block text-xs text-slate-500">{leg.loadFactorPercent.toString()}% of vehicle</span>}
                  </Td>
                  <Td className="text-xs">
                    {leg.emissionFactor
                      ? `${leg.emissionFactor.co2eFactor.toString()} kgCO2e/${leg.emissionFactor.unit}`
                      : leg.manualFactorValue
                        ? `${leg.manualFactorValue.toString()} kgCO2e/${leg.manualFactorUnit ?? "?"}`
                        : "None"}
                  </Td>
                  <Td className="text-xs">{leg.assumptions ?? <span className="text-slate-400">—</span>}</Td>
                  <Td align="right">
                    {canEdit && (
                      <form action={deleteTransportLegAction}>
                        <input type="hidden" name="assessmentId" value={id} />
                        <input type="hidden" name="legId" value={leg.id} />
                        <Button type="submit" variant="ghost" size="sm" aria-label="Remove leg">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </DataTable>
          )}
        </SectionCard>
      )}

      {(item.itemType === "END_OF_LIFE" || item.itemType === "WASTE" || item.endOfLifeRoutes.length > 0) && (
        <SectionCard
          title="End-of-life routes"
          description="How this material's mass is split at end of life. The shares must total exactly 100% — an unstated remainder is a silent exclusion."
          actions={
            <EndOfLifeRouteForm
              assessmentId={id}
              inventoryItemId={item.id}
              factorOptions={eolFactors.map(toOption)}
              currentTotalPercent={eolTotalPercent}
              allowsCredits={allowsAvoidedBurden(methodology)}
              disabled={!canEdit}
            />
          }
        >
          {item.endOfLifeRoutes.length === 0 ? (
            <p className="text-sm text-slate-500">No routes recorded yet.</p>
          ) : (
            <>
              {Math.abs(eolTotalPercent - 100) > 0.000001 && (
                <Notice tone="danger" title={`Routes total ${eolTotalPercent}%`}>
                  Route shares must add up to exactly 100% so every kilogram is accounted for once.
                </Notice>
              )}
              <DataTable
                headers={[{ label: "Route", align: "left" }, { label: "Share", align: "right" }, "Treatment factor", "Recovery credit", "Assumptions", ""]}
              >
                {item.endOfLifeRoutes.map((route) => (
                  <tr key={route.id}>
                    <Td>{route.routeDescription ?? EOL_ROUTE_LABELS[route.route]}</Td>
                    <Td align="right">{route.percent.toString()}%</Td>
                    <Td className="text-xs">
                      {route.emissionFactor
                        ? `${route.emissionFactor.co2eFactor.toString()} kgCO2e/${route.emissionFactor.unit}`
                        : route.manualFactorValue
                          ? `${route.manualFactorValue.toString()} kgCO2e/${route.manualFactorUnit ?? "?"}`
                          : "None"}
                    </Td>
                    <Td className="text-xs">
                      {route.avoidedFactorValue ? (
                        <>
                          {route.avoidedFactorValue.toString()} kgCO2e/{route.avoidedFactorUnit ?? "kg"}
                          {route.recoveryRatePercent && ` at ${route.recoveryRatePercent.toString()}% recovery`}
                          {!allowsAvoidedBurden(methodology) && (
                            <Badge tone="warning" className="ml-2">
                              Not applied under this methodology
                            </Badge>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </Td>
                    <Td className="text-xs">{route.recoveryAssumptions ?? <span className="text-slate-400">—</span>}</Td>
                    <Td align="right">
                      {canEdit && (
                        <form action={deleteEndOfLifeRouteAction}>
                          <input type="hidden" name="assessmentId" value={id} />
                          <input type="hidden" name="routeId" value={route.id} />
                          <Button type="submit" variant="ghost" size="sm" aria-label="Remove route">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </form>
                      )}
                    </Td>
                  </tr>
                ))}
              </DataTable>
            </>
          )}
        </SectionCard>
      )}

      <SectionCard
        title="Corporate data citations"
        description="Where this line's data came from in the corporate inventory. A citation, not a transfer — both figures stay complete in their own right."
        actions={
          <CorporateLinkForm
            assessmentId={id}
            inventoryItemId={item.id}
            entries={corporateEntries.map((entry) => ({
              id: entry.id,
              label: `${entry.activityDataPoint.code} ${entry.activityDataPoint.dataPointName} — ${entry.site.name}, ${entry.periodStart.toISOString().slice(0, 7)} (${entry.rawValue.toString()} ${entry.rawUnit})`,
            }))}
            sites={sites.map((site) => ({ id: site.id, label: `${site.entity.name} — ${site.name}` }))}
            disabled={!canEdit}
          />
        }
      >
        {item.corporateLinks.length === 0 ? (
          <p className="text-sm text-slate-500">No corporate records cited for this line.</p>
        ) : (
          <DataTable headers={["Kind", "Record", "Site", { label: "Attribution", align: "right" }, "Basis", ""]}>
            {item.corporateLinks.map((link) => (
              <tr key={link.id}>
                <Td>{CORPORATE_LINK_LABELS[link.linkType]}</Td>
                <Td className="text-xs">
                  {link.activityEntry
                    ? `${link.activityEntry.activityDataPoint.code} ${link.activityEntry.activityDataPoint.dataPointName} (${link.activityEntry.rawValue.toString()} ${link.activityEntry.rawUnit})`
                    : "—"}
                </Td>
                <Td>{link.site?.name ?? link.activityEntry?.site.name ?? "—"}</Td>
                <Td align="right">{link.allocationPercent.toString()}%</Td>
                <Td className="text-xs">{link.allocationBasis ?? <span className="text-slate-400">Not recorded</span>}</Td>
                <Td align="right">
                  {canEdit && (
                    <form action={deleteCorporateLinkAction}>
                      <input type="hidden" name="assessmentId" value={id} />
                      <input type="hidden" name="linkId" value={link.id} />
                      <Button type="submit" variant="ghost" size="sm" aria-label="Remove citation">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      <SectionCard
        title="Calculated results for this line"
        description="From the last calculation run. Open any line to see the full arithmetic behind it."
      >
        {results.length === 0 ? (
          <p className="text-sm text-slate-500">
            No results yet — either the assessment has not been calculated, or this line could not be calculated. The
            review page lists why.
          </p>
        ) : (
          <DataTable
            headers={["Result line", "Class", { label: "Activity", align: "right" }, "Factor", { label: "kgCO2e", align: "right" }, { label: "Per unit", align: "right" }, ""]}
          >
            {results.map((result) => (
              <tr key={result.id}>
                <Td className="font-medium text-slate-900">{result.itemName}</Td>
                <Td className="text-xs">{CLASSIFICATION_LABELS[result.classification]}</Td>
                <Td align="right">
                  {result.normalizedValue.toString()} {result.normalizedUnit}
                </Td>
                <Td className="text-xs">
                  {result.factorValue.toString()} kgCO2e/{result.factorUnit}
                  <span className="block text-slate-500">{result.factorSource}</span>
                </Td>
                <Td align="right">{formatKgPrecise(Number(result.allocatedKgCo2e))}</Td>
                <Td align="right">{formatKgPrecise(Number(result.perFunctionalUnitKgCo2e))}</Td>
                <Td align="right">
                  <Link
                    href={`/assessments/${id}/results/${result.id}`}
                    className="text-xs font-medium text-brand-700 hover:text-brand-800"
                  >
                    How was this calculated?
                  </Link>
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      {item.evidence.length > 0 && (
        <SectionCard title="Evidence" description="Source documents attached to this line.">
          <ul className="space-y-2">
            {item.evidence.map((evidence) => (
              <li key={evidence.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-800">{evidence.title}</span>
                <span className="text-xs text-slate-500">
                  {evidence.uploadedBy?.name} · {evidence.uploadedAt.toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

/**
 * Writes to the lifecycle model: processes, their co-product outputs,
 * inventory items, transport legs and end-of-life routes.
 *
 * Every mutation here goes through the audit trail. That is the point of
 * routing them through a service rather than calling Prisma from each server
 * action: a change to a quantity, a factor or an allocation is exactly the
 * kind of change a reviewer needs to be able to see afterwards.
 */

import {
  LcaAllocationMethod,
  LcaDataType,
  LcaEmissionClassification,
  LcaEndOfLifeRouteType,
  LcaFactorBoundary,
  LcaFactorSelectionMode,
  LcaItemType,
  LcaLifecycleStage,
  LcaTransportMode,
  LcaUncertaintyStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "./audit-service";
import { STAGE_LABELS } from "./labels";

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------

export interface UpsertProcessInput {
  id?: string | null;
  assessmentId: string;
  parentProcessId?: string | null;
  stage: LcaLifecycleStage;
  name: string;
  description?: string | null;
  isIncluded: boolean;
  allocationMethod: LcaAllocationMethod;
  allocationPercent?: string | null;
  allocationRationale?: string | null;
  allocationBasisDescription?: string | null;
  geography?: string | null;
  notes?: string | null;
  actorUserId: string;
}

export async function upsertProcess(input: UpsertProcessInput) {
  const data = {
    parentProcessId: input.parentProcessId || null,
    stage: input.stage,
    name: input.name,
    description: input.description || null,
    isIncluded: input.isIncluded,
    allocationMethod: input.allocationMethod,
    allocationPercent: input.allocationPercent ?? "100",
    allocationRationale: input.allocationRationale || null,
    allocationBasisDescription: input.allocationBasisDescription || null,
    geography: input.geography || null,
    notes: input.notes || null,
  };

  if (input.id) {
    const before = await prisma.lcaProcess.findUniqueOrThrow({ where: { id: input.id } });
    const updated = await prisma.lcaProcess.update({ where: { id: input.id }, data });

    const allocationChanged =
      before.allocationMethod !== updated.allocationMethod ||
      !before.allocationPercent.equals(updated.allocationPercent);

    await recordAuditEvent({
      assessmentId: input.assessmentId,
      entityType: allocationChanged ? "allocation" : "process",
      entityId: updated.id,
      action: "updated",
      actorUserId: input.actorUserId,
      summary: allocationChanged
        ? `Allocation on "${updated.name}" changed from ${before.allocationMethod.toLowerCase()} ${before.allocationPercent.toString()}% to ${updated.allocationMethod.toLowerCase()} ${updated.allocationPercent.toString()}%${updated.allocationRationale ? `: ${updated.allocationRationale}` : "."}`
        : `Process "${updated.name}" updated${before.isIncluded !== updated.isIncluded ? `, and is now ${updated.isIncluded ? "included in" : "excluded from"} the model` : ""}.`,
      before: {
        name: before.name,
        stage: before.stage,
        isIncluded: before.isIncluded,
        allocationMethod: before.allocationMethod,
        allocationPercent: before.allocationPercent.toString(),
      },
      after: {
        name: updated.name,
        stage: updated.stage,
        isIncluded: updated.isIncluded,
        allocationMethod: updated.allocationMethod,
        allocationPercent: updated.allocationPercent.toString(),
      },
    });

    return updated;
  }

  const lastOrder = await prisma.lcaProcess.aggregate({
    where: { assessmentId: input.assessmentId },
    _max: { sortOrder: true },
  });

  const created = await prisma.lcaProcess.create({
    data: { ...data, assessmentId: input.assessmentId, sortOrder: (lastOrder._max.sortOrder ?? 0) + 10 },
  });

  await recordAuditEvent({
    assessmentId: input.assessmentId,
    entityType: "process",
    entityId: created.id,
    action: "created",
    actorUserId: input.actorUserId,
    summary: `Process "${created.name}" added to the ${STAGE_LABELS[created.stage].toLowerCase()} stage.`,
    after: { name: created.name, stage: created.stage, allocationMethod: created.allocationMethod },
  });

  return created;
}

export async function deleteProcess(processId: string, actorUserId: string) {
  const process = await prisma.lcaProcess.findUniqueOrThrow({
    where: { id: processId },
    include: { _count: { select: { inventoryItems: true, childProcesses: true } } },
  });

  if (process._count.inventoryItems > 0) {
    throw new Error(
      `"${process.name}" still holds ${process._count.inventoryItems} inventory line(s). Move or remove them first — deleting the process would take its data with it.`,
    );
  }
  if (process._count.childProcesses > 0) {
    throw new Error(`"${process.name}" has sub-processes. Remove or reassign those first.`);
  }

  await prisma.lcaProcess.delete({ where: { id: processId } });

  await recordAuditEvent({
    assessmentId: process.assessmentId,
    entityType: "process",
    entityId: processId,
    action: "deleted",
    actorUserId,
    summary: `Process "${process.name}" removed from the model.`,
    before: { name: process.name, stage: process.stage },
  });
}

export interface UpsertProcessOutputInput {
  id?: string | null;
  processId: string;
  assessmentId: string;
  name: string;
  isAssessedProduct: boolean;
  massValue?: string | null;
  massUnit?: string | null;
  physicalValue?: string | null;
  physicalUnit?: string | null;
  economicValue?: string | null;
  economicCurrency?: string | null;
  notes?: string | null;
  actorUserId: string;
}

export async function upsertProcessOutput(input: UpsertProcessOutputInput) {
  const data = {
    name: input.name,
    isAssessedProduct: input.isAssessedProduct,
    massValue: input.massValue || null,
    massUnit: input.massUnit || null,
    physicalValue: input.physicalValue || null,
    physicalUnit: input.physicalUnit || null,
    economicValue: input.economicValue || null,
    economicCurrency: input.economicCurrency || null,
    notes: input.notes || null,
  };

  const output = input.id
    ? await prisma.lcaProcessOutput.update({ where: { id: input.id }, data })
    : await prisma.lcaProcessOutput.create({ data: { ...data, processId: input.processId } });

  await recordAuditEvent({
    assessmentId: input.assessmentId,
    entityType: "process_output",
    entityId: output.id,
    action: input.id ? "updated" : "created",
    actorUserId: input.actorUserId,
    summary: `Co-product "${output.name}"${output.isAssessedProduct ? " (the assessed product)" : ""} ${input.id ? "updated" : "recorded"} — the allocation split is derived from these outputs.`,
    after: data,
  });

  return output;
}

export async function deleteProcessOutput(outputId: string, assessmentId: string, actorUserId: string) {
  const output = await prisma.lcaProcessOutput.findUniqueOrThrow({ where: { id: outputId } });
  await prisma.lcaProcessOutput.delete({ where: { id: outputId } });
  await recordAuditEvent({
    assessmentId,
    entityType: "process_output",
    entityId: outputId,
    action: "deleted",
    actorUserId,
    summary: `Co-product "${output.name}" removed. The allocation split will be recalculated from the remaining outputs.`,
    before: { name: output.name, isAssessedProduct: output.isAssessedProduct },
  });
}

// ---------------------------------------------------------------------------
// Inventory items
// ---------------------------------------------------------------------------

export interface UpsertInventoryItemInput {
  id?: string | null;
  assessmentId: string;
  processId: string;
  itemType: LcaItemType;
  name: string;
  description?: string | null;
  componentName?: string | null;
  partNumber?: string | null;
  materialName?: string | null;
  supplierId?: string | null;
  quantity: string;
  unit: string;
  adjustmentFactor?: string | null;
  adjustmentRationale?: string | null;
  recycledContentPercent?: string | null;
  wastePercent?: string | null;
  dataType: LcaDataType;
  dataSource?: string | null;
  geography?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  classification: LcaEmissionClassification;
  biogenicUptakePerUnit?: string | null;
  storedCarbonPerUnit?: string | null;
  temporalScore?: number | null;
  geographicalScore?: number | null;
  technologicalScore?: number | null;
  completenessScore?: number | null;
  reliabilityScore?: number | null;
  uncertaintyStatus?: LcaUncertaintyStatus;
  uncertaintyPercent?: string | null;
  uncertaintyLower?: string | null;
  uncertaintyUpper?: string | null;
  uncertaintyNotes?: string | null;
  isExcluded?: boolean;
  exclusionReason?: string | null;
  notes?: string | null;
  actorUserId: string;
}

export async function upsertInventoryItem(input: UpsertInventoryItemInput) {
  const data = {
    processId: input.processId,
    itemType: input.itemType,
    name: input.name,
    description: input.description || null,
    componentName: input.componentName || null,
    partNumber: input.partNumber || null,
    materialName: input.materialName || null,
    supplierId: input.supplierId || null,
    quantity: input.quantity,
    unit: input.unit,
    adjustmentFactor: input.adjustmentFactor || "1",
    adjustmentRationale: input.adjustmentRationale || null,
    recycledContentPercent: input.recycledContentPercent || null,
    wastePercent: input.wastePercent || null,
    dataType: input.dataType,
    dataSource: input.dataSource || null,
    geography: input.geography || null,
    periodStart: input.periodStart ?? null,
    periodEnd: input.periodEnd ?? null,
    classification: input.classification,
    biogenicUptakePerUnit: input.biogenicUptakePerUnit || null,
    storedCarbonPerUnit: input.storedCarbonPerUnit || null,
    temporalScore: input.temporalScore ?? null,
    geographicalScore: input.geographicalScore ?? null,
    technologicalScore: input.technologicalScore ?? null,
    completenessScore: input.completenessScore ?? null,
    reliabilityScore: input.reliabilityScore ?? null,
    uncertaintyStatus: input.uncertaintyStatus ?? LcaUncertaintyStatus.NOT_ASSESSED,
    uncertaintyPercent: input.uncertaintyPercent || null,
    uncertaintyLower: input.uncertaintyLower || null,
    uncertaintyUpper: input.uncertaintyUpper || null,
    uncertaintyNotes: input.uncertaintyNotes || null,
    isExcluded: input.isExcluded ?? false,
    exclusionReason: input.exclusionReason || null,
    notes: input.notes || null,
  } satisfies Partial<Prisma.LcaInventoryItemUncheckedCreateInput>;

  if (input.id) {
    const before = await prisma.lcaInventoryItem.findUniqueOrThrow({ where: { id: input.id } });
    const updated = await prisma.lcaInventoryItem.update({ where: { id: input.id }, data });

    const quantityChanged = !before.quantity.equals(updated.quantity) || before.unit !== updated.unit;
    const exclusionChanged = before.isExcluded !== updated.isExcluded;

    await recordAuditEvent({
      assessmentId: input.assessmentId,
      entityType: exclusionChanged ? "exclusion" : "inventory_item",
      entityId: updated.id,
      action: "updated",
      actorUserId: input.actorUserId,
      summary: exclusionChanged
        ? `"${updated.name}" ${updated.isExcluded ? `excluded from the model${updated.exclusionReason ? `: ${updated.exclusionReason}` : " with no reason recorded"}` : "brought back into the model"}.`
        : quantityChanged
          ? `"${updated.name}" quantity changed from ${before.quantity.toString()} ${before.unit} to ${updated.quantity.toString()} ${updated.unit}.`
          : `"${updated.name}" updated.`,
      before: {
        name: before.name,
        quantity: before.quantity.toString(),
        unit: before.unit,
        dataType: before.dataType,
        isExcluded: before.isExcluded,
      },
      after: {
        name: updated.name,
        quantity: updated.quantity.toString(),
        unit: updated.unit,
        dataType: updated.dataType,
        isExcluded: updated.isExcluded,
      },
    });

    return updated;
  }

  const lastOrder = await prisma.lcaInventoryItem.aggregate({
    where: { assessmentId: input.assessmentId },
    _max: { sortOrder: true },
  });

  const created = await prisma.lcaInventoryItem.create({
    data: {
      ...data,
      assessmentId: input.assessmentId,
      sortOrder: (lastOrder._max.sortOrder ?? 0) + 10,
      factorSelectionMode: LcaFactorSelectionMode.NONE,
    },
  });

  await recordAuditEvent({
    assessmentId: input.assessmentId,
    entityType: "inventory_item",
    entityId: created.id,
    action: "created",
    actorUserId: input.actorUserId,
    summary: `"${created.name}" added: ${created.quantity.toString()} ${created.unit} (${created.dataType.replace(/_/g, " ").toLowerCase()} data).`,
    after: { name: created.name, quantity: created.quantity.toString(), unit: created.unit, dataType: created.dataType },
  });

  return created;
}

export async function deleteInventoryItem(itemId: string, actorUserId: string) {
  const item = await prisma.lcaInventoryItem.findUniqueOrThrow({ where: { id: itemId } });

  // Result rows from historical runs reference this item; keep the runs intact
  // by unlinking rather than cascading a delete through the audit trail.
  await prisma.$transaction(async (tx) => {
    await tx.lcaCalculationResult.updateMany({ where: { inventoryItemId: itemId }, data: { inventoryItemId: null } });
    await tx.lcaEvidence.updateMany({ where: { inventoryItemId: itemId }, data: { inventoryItemId: null } });
    await tx.lcaAssumption.updateMany({ where: { inventoryItemId: itemId }, data: { inventoryItemId: null } });
    await tx.lcaInventoryItem.delete({ where: { id: itemId } });
  });

  await recordAuditEvent({
    assessmentId: item.assessmentId,
    entityType: "inventory_item",
    entityId: itemId,
    action: "deleted",
    actorUserId,
    summary: `"${item.name}" removed from the inventory (was ${item.quantity.toString()} ${item.unit}). Earlier calculation runs keep their result lines.`,
    before: { name: item.name, quantity: item.quantity.toString(), unit: item.unit },
  });
}

// ---------------------------------------------------------------------------
// Factor assignment
// ---------------------------------------------------------------------------

export interface AssignFactorInput {
  inventoryItemId: string;
  assessmentId: string;
  mode: LcaFactorSelectionMode;
  emissionFactorId?: string | null;
  recycledEmissionFactorId?: string | null;
  supplierPcfId?: string | null;
  manualFactorValue?: string | null;
  manualFactorUnit?: string | null;
  manualFactorSource?: string | null;
  manualFactorVersion?: string | null;
  manualFactorBoundary?: LcaFactorBoundary | null;
  manualFactorGeography?: string | null;
  manualFactorYear?: number | null;
  manualFactorGwpBasis?: string | null;
  manualFactorRationale?: string | null;
  actorUserId: string;
}

export async function assignFactor(input: AssignFactorInput) {
  const before = await prisma.lcaInventoryItem.findUniqueOrThrow({
    where: { id: input.inventoryItemId },
    include: { emissionFactor: { include: { factorSet: true } }, supplierPcf: { include: { supplier: true } } },
  });

  const updated = await prisma.lcaInventoryItem.update({
    where: { id: input.inventoryItemId },
    data: {
      factorSelectionMode: input.mode,
      emissionFactorId: input.mode === LcaFactorSelectionMode.LIBRARY_FACTOR ? input.emissionFactorId || null : null,
      recycledEmissionFactorId: input.recycledEmissionFactorId || null,
      supplierPcfId: input.mode === LcaFactorSelectionMode.SUPPLIER_PCF ? input.supplierPcfId || null : null,
      manualFactorValue: input.mode === LcaFactorSelectionMode.MANUAL ? input.manualFactorValue || null : null,
      manualFactorUnit: input.mode === LcaFactorSelectionMode.MANUAL ? input.manualFactorUnit || null : null,
      manualFactorSource: input.mode === LcaFactorSelectionMode.MANUAL ? input.manualFactorSource || null : null,
      manualFactorVersion: input.mode === LcaFactorSelectionMode.MANUAL ? input.manualFactorVersion || null : null,
      manualFactorBoundary: input.mode === LcaFactorSelectionMode.MANUAL ? input.manualFactorBoundary ?? null : null,
      manualFactorGeography: input.mode === LcaFactorSelectionMode.MANUAL ? input.manualFactorGeography || null : null,
      manualFactorYear: input.mode === LcaFactorSelectionMode.MANUAL ? input.manualFactorYear ?? null : null,
      manualFactorGwpBasis: input.mode === LcaFactorSelectionMode.MANUAL ? input.manualFactorGwpBasis || null : null,
      manualFactorRationale: input.mode === LcaFactorSelectionMode.MANUAL ? input.manualFactorRationale || null : null,
    },
    include: { emissionFactor: { include: { factorSet: true } }, supplierPcf: { include: { supplier: true } } },
  });

  const describe = (item: typeof before) => {
    switch (item.factorSelectionMode) {
      case LcaFactorSelectionMode.LIBRARY_FACTOR:
        return item.emissionFactor
          ? `${item.emissionFactor.factorSet.publisher} — ${item.emissionFactor.factorSet.name} (${item.emissionFactor.co2eFactor.toString()} kgCO2e/${item.emissionFactor.unit})`
          : "a library factor";
      case LcaFactorSelectionMode.SUPPLIER_PCF:
        return item.supplierPcf ? `${item.supplierPcf.supplier.name}'s PCF for ${item.supplierPcf.productName}` : "a supplier PCF";
      case LcaFactorSelectionMode.MANUAL:
        return `a manually entered factor of ${item.manualFactorValue?.toString() ?? "?"} kgCO2e/${item.manualFactorUnit ?? "?"} from ${item.manualFactorSource ?? "an unrecorded source"}`;
      default:
        return "no factor";
    }
  };

  await recordAuditEvent({
    assessmentId: input.assessmentId,
    entityType: "factor_assignment",
    entityId: input.inventoryItemId,
    action: "updated",
    actorUserId: input.actorUserId,
    summary: `Factor for "${updated.name}" changed from ${describe(before)} to ${describe(updated)}.`,
    before: { mode: before.factorSelectionMode, description: describe(before) },
    after: { mode: updated.factorSelectionMode, description: describe(updated) },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Transport legs
// ---------------------------------------------------------------------------

export interface UpsertTransportLegInput {
  id?: string | null;
  inventoryItemId: string;
  assessmentId: string;
  sequence: number;
  mode: LcaTransportMode;
  modeDescription?: string | null;
  originName?: string | null;
  destinationName?: string | null;
  distanceValue: string;
  distanceUnit: string;
  massValue: string;
  massUnit: string;
  loadFactorPercent?: string | null;
  includesReturnTrip: boolean;
  emissionFactorId?: string | null;
  manualFactorValue?: string | null;
  manualFactorUnit?: string | null;
  manualFactorSource?: string | null;
  assumptions?: string | null;
  notes?: string | null;
  actorUserId: string;
}

export async function upsertTransportLeg(input: UpsertTransportLegInput) {
  const data = {
    sequence: input.sequence,
    mode: input.mode,
    modeDescription: input.modeDescription || null,
    originName: input.originName || null,
    destinationName: input.destinationName || null,
    distanceValue: input.distanceValue,
    distanceUnit: input.distanceUnit,
    massValue: input.massValue,
    massUnit: input.massUnit,
    loadFactorPercent: input.loadFactorPercent || null,
    includesReturnTrip: input.includesReturnTrip,
    emissionFactorId: input.emissionFactorId || null,
    manualFactorValue: input.manualFactorValue || null,
    manualFactorUnit: input.manualFactorUnit || null,
    manualFactorSource: input.manualFactorSource || null,
    assumptions: input.assumptions || null,
    notes: input.notes || null,
  };

  const leg = input.id
    ? await prisma.lcaTransportLeg.update({ where: { id: input.id }, data })
    : await prisma.lcaTransportLeg.create({ data: { ...data, inventoryItemId: input.inventoryItemId } });

  await recordAuditEvent({
    assessmentId: input.assessmentId,
    entityType: "transport_leg",
    entityId: leg.id,
    action: input.id ? "updated" : "created",
    actorUserId: input.actorUserId,
    summary: `Transport leg ${leg.sequence + 1} (${leg.mode.replace(/_/g, " ").toLowerCase()}) ${input.id ? "updated" : "added"}: ${leg.massValue.toString()} ${leg.massUnit} over ${leg.distanceValue.toString()} ${leg.distanceUnit}${leg.includesReturnTrip ? ", return trip included" : ""}.`,
    after: data,
  });

  return leg;
}

export async function deleteTransportLeg(legId: string, assessmentId: string, actorUserId: string) {
  const leg = await prisma.lcaTransportLeg.findUniqueOrThrow({ where: { id: legId } });
  await prisma.$transaction(async (tx) => {
    await tx.lcaCalculationResult.updateMany({ where: { transportLegId: legId }, data: { transportLegId: null } });
    await tx.lcaTransportLeg.delete({ where: { id: legId } });
  });
  await recordAuditEvent({
    assessmentId,
    entityType: "transport_leg",
    entityId: legId,
    action: "deleted",
    actorUserId,
    summary: `Transport leg ${leg.sequence + 1} (${leg.mode.replace(/_/g, " ").toLowerCase()}) removed.`,
    before: { mode: leg.mode, distance: `${leg.distanceValue.toString()} ${leg.distanceUnit}` },
  });
}

// ---------------------------------------------------------------------------
// End-of-life routes
// ---------------------------------------------------------------------------

export interface UpsertEndOfLifeRouteInput {
  id?: string | null;
  inventoryItemId: string;
  assessmentId: string;
  route: LcaEndOfLifeRouteType;
  routeDescription?: string | null;
  percent: string;
  emissionFactorId?: string | null;
  manualFactorValue?: string | null;
  manualFactorUnit?: string | null;
  manualFactorSource?: string | null;
  recoveryRatePercent?: string | null;
  avoidedFactorValue?: string | null;
  avoidedFactorUnit?: string | null;
  avoidedFactorSource?: string | null;
  recoveryAssumptions?: string | null;
  notes?: string | null;
  actorUserId: string;
}

export async function upsertEndOfLifeRoute(input: UpsertEndOfLifeRouteInput) {
  const data = {
    route: input.route,
    routeDescription: input.routeDescription || null,
    percent: input.percent,
    emissionFactorId: input.emissionFactorId || null,
    manualFactorValue: input.manualFactorValue || null,
    manualFactorUnit: input.manualFactorUnit || null,
    manualFactorSource: input.manualFactorSource || null,
    recoveryRatePercent: input.recoveryRatePercent || null,
    avoidedFactorValue: input.avoidedFactorValue || null,
    avoidedFactorUnit: input.avoidedFactorUnit || null,
    avoidedFactorSource: input.avoidedFactorSource || null,
    recoveryAssumptions: input.recoveryAssumptions || null,
    notes: input.notes || null,
  };

  const route = input.id
    ? await prisma.lcaEndOfLifeRoute.update({ where: { id: input.id }, data })
    : await prisma.lcaEndOfLifeRoute.create({ data: { ...data, inventoryItemId: input.inventoryItemId } });

  await recordAuditEvent({
    assessmentId: input.assessmentId,
    entityType: "end_of_life_route",
    entityId: route.id,
    action: input.id ? "updated" : "created",
    actorUserId: input.actorUserId,
    summary: `End-of-life route ${route.route.replace(/_/g, " ").toLowerCase()} ${input.id ? "updated" : "added"} at ${route.percent.toString()}%${route.avoidedFactorValue ? ", with a recovery credit that applies only under an avoided-burden methodology" : ""}.`,
    after: data,
  });

  return route;
}

export async function deleteEndOfLifeRoute(routeId: string, assessmentId: string, actorUserId: string) {
  const route = await prisma.lcaEndOfLifeRoute.findUniqueOrThrow({ where: { id: routeId } });
  await prisma.$transaction(async (tx) => {
    await tx.lcaCalculationResult.updateMany({ where: { endOfLifeRouteId: routeId }, data: { endOfLifeRouteId: null } });
    await tx.lcaEndOfLifeRoute.delete({ where: { id: routeId } });
  });
  await recordAuditEvent({
    assessmentId,
    entityType: "end_of_life_route",
    entityId: routeId,
    action: "deleted",
    actorUserId,
    summary: `End-of-life route ${route.route.replace(/_/g, " ").toLowerCase()} (${route.percent.toString()}%) removed. Remaining route percentages must still total 100%.`,
    before: { route: route.route, percent: route.percent.toString() },
  });
}

// ---------------------------------------------------------------------------
// Reading the model
// ---------------------------------------------------------------------------

const modelInclude = {
  processes: {
    include: {
      outputs: { orderBy: { sortOrder: "asc" } },
      _count: { select: { inventoryItems: true, childProcesses: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  },
} satisfies Prisma.LcaAssessmentInclude;

export async function loadModel(assessmentId: string) {
  return prisma.lcaAssessment.findUnique({ where: { id: assessmentId }, include: modelInclude });
}

export async function getInventoryItem(itemId: string) {
  return prisma.lcaInventoryItem.findUnique({
    where: { id: itemId },
    include: {
      assessment: { include: { entity: true, methodologyProfile: true } },
      process: true,
      supplier: true,
      emissionFactor: { include: { factorSet: true } },
      recycledEmissionFactor: { include: { factorSet: true } },
      supplierPcf: { include: { supplier: true } },
      transportLegs: { include: { emissionFactor: { include: { factorSet: true } } }, orderBy: { sequence: "asc" } },
      endOfLifeRoutes: { include: { emissionFactor: { include: { factorSet: true } } } },
      corporateLinks: {
        include: {
          site: { include: { entity: true } },
          activityEntry: { include: { activityDataPoint: true, site: true } },
        },
      },
      evidence: { include: { uploadedBy: true } },
      assumptions: true,
    },
  });
}

export type InventoryItemDetail = NonNullable<Awaited<ReturnType<typeof getInventoryItem>>>;

export async function listInventory(assessmentId: string) {
  return prisma.lcaInventoryItem.findMany({
    where: { assessmentId },
    include: {
      process: true,
      supplier: true,
      emissionFactor: { include: { factorSet: true } },
      supplierPcf: { include: { supplier: true } },
      _count: { select: { transportLegs: true, endOfLifeRoutes: true, evidence: true } },
    },
    orderBy: [{ process: { sortOrder: "asc" } }, { sortOrder: "asc" }],
  });
}

export type InventoryListItem = Awaited<ReturnType<typeof listInventory>>[number];

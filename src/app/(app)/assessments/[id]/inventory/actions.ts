"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  LcaCorporateLinkType,
  LcaDataType,
  LcaEmissionClassification,
  LcaEndOfLifeRouteType,
  LcaFactorBoundary,
  LcaFactorSelectionMode,
  LcaItemType,
  LcaTransportMode,
  LcaUncertaintyStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  assignFactor,
  deleteEndOfLifeRoute,
  deleteInventoryItem,
  deleteTransportLeg,
  upsertEndOfLifeRoute,
  upsertInventoryItem,
  upsertTransportLeg,
} from "@/lib/lca/model-service";
import { createCorporateLink, deleteCorporateLink } from "@/lib/lca/registers-service";
import { applySupplierPcfToItem } from "@/lib/lca/supplier-service";
import { checkCanEditAssessment, getLcaActor } from "@/lib/lca/permissions";
import { areUnitsCompatible, findUnit } from "@/lib/lca/units";
import type { AssessmentFormState } from "@/lib/lca/form-state";


async function guard(assessmentId: string) {
  const actor = await getLcaActor();
  const assessment = await prisma.lcaAssessment.findUnique({ where: { id: assessmentId } });
  if (!assessment) return { error: "That assessment no longer exists.", actor: null };
  const permission = checkCanEditAssessment(actor, assessment.status);
  if (!permission.ok) return { error: permission.reason, actor: null };
  return { error: null, actor: actor! };
}

function optionalScore(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
}

// ---------------------------------------------------------------------------
// Inventory items
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  assessmentId: z.string().min(1),
  itemId: z.string().optional(),
  processId: z.string().min(1, "Choose the process this line belongs to."),
  itemType: z.enum(LcaItemType),
  name: z.string().min(1, "Give the line a name."),
  description: z.string().optional(),
  componentName: z.string().optional(),
  partNumber: z.string().optional(),
  materialName: z.string().optional(),
  supplierId: z.string().optional(),
  quantity: z.string().min(1, "Enter a quantity."),
  unit: z.string().min(1, "Enter a unit."),
  adjustmentFactor: z.string().optional(),
  adjustmentRationale: z.string().optional(),
  recycledContentPercent: z.string().optional(),
  wastePercent: z.string().optional(),
  dataType: z.enum(LcaDataType),
  dataSource: z.string().optional(),
  geography: z.string().optional(),
  classification: z.enum(LcaEmissionClassification),
  biogenicUptakePerUnit: z.string().optional(),
  storedCarbonPerUnit: z.string().optional(),
  uncertaintyStatus: z.enum(LcaUncertaintyStatus).optional(),
  uncertaintyPercent: z.string().optional(),
  uncertaintyLower: z.string().optional(),
  uncertaintyUpper: z.string().optional(),
  uncertaintyNotes: z.string().optional(),
  isExcluded: z.string().optional(),
  exclusionReason: z.string().optional(),
  notes: z.string().optional(),
});

export async function saveInventoryItemAction(
  _prev: AssessmentFormState,
  formData: FormData,
): Promise<AssessmentFormState> {
  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  const check = await guard(data.assessmentId);
  if (check.error) return { error: check.error, success: false };

  if (!Number.isFinite(Number(data.quantity))) {
    return { error: `"${data.quantity}" is not a number.`, success: false };
  }
  if (!findUnit(data.unit)) {
    return {
      error: `"${data.unit}" is not a unit this platform can convert. Use a recognised unit, or convert the figure first and record the conversion as an assumption.`,
      success: false,
    };
  }
  if (data.isExcluded === "on" && !data.exclusionReason?.trim()) {
    return { error: "An excluded line needs a reason — an undocumented exclusion is indistinguishable from an omission.", success: false };
  }

  const item = await upsertInventoryItem({
    id: data.itemId || null,
    assessmentId: data.assessmentId,
    processId: data.processId,
    itemType: data.itemType,
    name: data.name,
    description: data.description,
    componentName: data.componentName,
    partNumber: data.partNumber,
    materialName: data.materialName,
    supplierId: data.supplierId,
    quantity: data.quantity,
    unit: data.unit,
    adjustmentFactor: data.adjustmentFactor?.trim() || "1",
    adjustmentRationale: data.adjustmentRationale,
    recycledContentPercent: data.recycledContentPercent?.trim() || null,
    wastePercent: data.wastePercent?.trim() || null,
    dataType: data.dataType,
    dataSource: data.dataSource,
    geography: data.geography,
    classification: data.classification,
    biogenicUptakePerUnit: data.biogenicUptakePerUnit?.trim() || null,
    storedCarbonPerUnit: data.storedCarbonPerUnit?.trim() || null,
    temporalScore: optionalScore(formData.get("temporalScore")),
    geographicalScore: optionalScore(formData.get("geographicalScore")),
    technologicalScore: optionalScore(formData.get("technologicalScore")),
    completenessScore: optionalScore(formData.get("completenessScore")),
    reliabilityScore: optionalScore(formData.get("reliabilityScore")),
    uncertaintyStatus: data.uncertaintyStatus,
    uncertaintyPercent: data.uncertaintyPercent?.trim() || null,
    uncertaintyLower: data.uncertaintyLower?.trim() || null,
    uncertaintyUpper: data.uncertaintyUpper?.trim() || null,
    uncertaintyNotes: data.uncertaintyNotes,
    isExcluded: data.isExcluded === "on",
    exclusionReason: data.exclusionReason,
    notes: data.notes,
    actorUserId: check.actor!.id,
  });

  revalidatePath(`/assessments/${data.assessmentId}`, "layout");
  return { error: null, success: true, message: `Saved "${item.name}".` };
}

export async function deleteInventoryItemAction(formData: FormData): Promise<void> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const check = await guard(assessmentId);
  if (check.error || !itemId) return;

  await deleteInventoryItem(itemId, check.actor!.id);
  revalidatePath(`/assessments/${assessmentId}`, "layout");
}

// ---------------------------------------------------------------------------
// Factor assignment
// ---------------------------------------------------------------------------

const factorSchema = z.object({
  assessmentId: z.string().min(1),
  inventoryItemId: z.string().min(1),
  mode: z.enum(LcaFactorSelectionMode),
  emissionFactorId: z.string().optional(),
  recycledEmissionFactorId: z.string().optional(),
  supplierPcfId: z.string().optional(),
  manualFactorValue: z.string().optional(),
  manualFactorUnit: z.string().optional(),
  manualFactorSource: z.string().optional(),
  manualFactorVersion: z.string().optional(),
  manualFactorBoundary: z.string().optional(),
  manualFactorGeography: z.string().optional(),
  manualFactorYear: z.string().optional(),
  manualFactorGwpBasis: z.string().optional(),
  manualFactorRationale: z.string().optional(),
});

export async function assignFactorAction(
  _prev: AssessmentFormState,
  formData: FormData,
): Promise<AssessmentFormState> {
  const parsed = factorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  const check = await guard(data.assessmentId);
  if (check.error) return { error: check.error, success: false };

  const item = await prisma.lcaInventoryItem.findUnique({ where: { id: data.inventoryItemId } });
  if (!item) return { error: "That inventory line no longer exists.", success: false };

  if (data.mode === LcaFactorSelectionMode.LIBRARY_FACTOR) {
    if (!data.emissionFactorId) return { error: "Choose a factor from the library.", success: false };
    const factor = await prisma.emissionFactor.findUnique({ where: { id: data.emissionFactorId } });
    if (!factor) return { error: "That factor no longer exists.", success: false };
    if (!areUnitsCompatible(factor.unit, item.unit)) {
      return {
        error: `That factor is expressed per ${factor.unit}, which cannot be applied to a quantity in ${item.unit}.`,
        success: false,
      };
    }
  }

  if (data.mode === LcaFactorSelectionMode.SUPPLIER_PCF) {
    if (!data.supplierPcfId) return { error: "Choose a supplier PCF.", success: false };
    await applySupplierPcfToItem(data.inventoryItemId, data.supplierPcfId, check.actor!.id);
    revalidatePath(`/assessments/${data.assessmentId}`, "layout");
    return { error: null, success: true, message: "Supplier PCF applied in place of the generic factor." };
  }

  if (data.mode === LcaFactorSelectionMode.MANUAL) {
    const value = Number(data.manualFactorValue);
    if (!Number.isFinite(value) || value < 0) {
      return { error: "Enter a factor value of zero or more.", success: false };
    }
    if (!data.manualFactorSource?.trim()) {
      return {
        error: "A manually entered factor needs a source. An unsourced factor cannot be traced back to anything, and the validation engine treats it as an error.",
        success: false,
      };
    }
    const unit = data.manualFactorUnit?.trim() || item.unit;
    if (!findUnit(unit)) return { error: `"${unit}" is not a unit this platform recognises.`, success: false };
    if (!areUnitsCompatible(unit, item.unit)) {
      return { error: `A factor per ${unit} cannot be applied to a quantity in ${item.unit}.`, success: false };
    }
  }

  await assignFactor({
    inventoryItemId: data.inventoryItemId,
    assessmentId: data.assessmentId,
    mode: data.mode,
    emissionFactorId: data.emissionFactorId,
    recycledEmissionFactorId: data.recycledEmissionFactorId,
    manualFactorValue: data.manualFactorValue,
    manualFactorUnit: data.manualFactorUnit?.trim() || item.unit,
    manualFactorSource: data.manualFactorSource,
    manualFactorVersion: data.manualFactorVersion,
    manualFactorBoundary: (data.manualFactorBoundary || null) as LcaFactorBoundary | null,
    manualFactorGeography: data.manualFactorGeography,
    manualFactorYear: data.manualFactorYear ? Number(data.manualFactorYear) : null,
    manualFactorGwpBasis: data.manualFactorGwpBasis,
    manualFactorRationale: data.manualFactorRationale,
    actorUserId: check.actor!.id,
  });

  revalidatePath(`/assessments/${data.assessmentId}`, "layout");
  return { error: null, success: true, message: "Factor assigned." };
}

// ---------------------------------------------------------------------------
// Transport legs
// ---------------------------------------------------------------------------

const legSchema = z.object({
  assessmentId: z.string().min(1),
  inventoryItemId: z.string().min(1),
  legId: z.string().optional(),
  sequence: z.string().optional(),
  mode: z.enum(LcaTransportMode),
  modeDescription: z.string().optional(),
  originName: z.string().optional(),
  destinationName: z.string().optional(),
  distanceValue: z.string().min(1, "Enter the distance."),
  distanceUnit: z.string().min(1),
  massValue: z.string().min(1, "Enter the consignment mass."),
  massUnit: z.string().min(1),
  loadFactorPercent: z.string().optional(),
  includesReturnTrip: z.string().optional(),
  emissionFactorId: z.string().optional(),
  manualFactorValue: z.string().optional(),
  manualFactorUnit: z.string().optional(),
  manualFactorSource: z.string().optional(),
  assumptions: z.string().optional(),
  notes: z.string().optional(),
});

export async function saveTransportLegAction(
  _prev: AssessmentFormState,
  formData: FormData,
): Promise<AssessmentFormState> {
  const parsed = legSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  const check = await guard(data.assessmentId);
  if (check.error) return { error: check.error, success: false };

  if (!findUnit(data.distanceUnit)) return { error: `"${data.distanceUnit}" is not a distance unit this platform recognises.`, success: false };
  if (!findUnit(data.massUnit)) return { error: `"${data.massUnit}" is not a mass unit this platform recognises.`, success: false };
  if (Number(data.distanceValue) <= 0) return { error: "The distance must be greater than zero.", success: false };
  if (Number(data.massValue) <= 0) return { error: "The consignment mass must be greater than zero.", success: false };
  if (data.manualFactorValue?.trim() && !data.manualFactorSource?.trim()) {
    return { error: "A manually entered freight factor needs a source.", success: false };
  }
  if (!data.emissionFactorId && !data.manualFactorValue?.trim()) {
    return { error: "Choose a freight factor from the library, or enter a sourced one.", success: false };
  }

  const existingCount = await prisma.lcaTransportLeg.count({ where: { inventoryItemId: data.inventoryItemId } });

  await upsertTransportLeg({
    id: data.legId || null,
    inventoryItemId: data.inventoryItemId,
    assessmentId: data.assessmentId,
    sequence: data.sequence ? Number(data.sequence) : existingCount,
    mode: data.mode,
    modeDescription: data.modeDescription,
    originName: data.originName,
    destinationName: data.destinationName,
    distanceValue: data.distanceValue,
    distanceUnit: data.distanceUnit,
    massValue: data.massValue,
    massUnit: data.massUnit,
    loadFactorPercent: data.loadFactorPercent?.trim() || null,
    includesReturnTrip: data.includesReturnTrip === "on",
    emissionFactorId: data.emissionFactorId,
    manualFactorValue: data.manualFactorValue?.trim() || null,
    manualFactorUnit: data.manualFactorUnit?.trim() || null,
    manualFactorSource: data.manualFactorSource,
    assumptions: data.assumptions,
    notes: data.notes,
    actorUserId: check.actor!.id,
  });

  revalidatePath(`/assessments/${data.assessmentId}`, "layout");
  return { error: null, success: true, message: "Transport leg saved." };
}

export async function deleteTransportLegAction(formData: FormData): Promise<void> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const legId = String(formData.get("legId") ?? "");
  const check = await guard(assessmentId);
  if (check.error || !legId) return;

  await deleteTransportLeg(legId, assessmentId, check.actor!.id);
  revalidatePath(`/assessments/${assessmentId}`, "layout");
}

// ---------------------------------------------------------------------------
// End-of-life routes
// ---------------------------------------------------------------------------

const routeSchema = z.object({
  assessmentId: z.string().min(1),
  inventoryItemId: z.string().min(1),
  routeId: z.string().optional(),
  route: z.enum(LcaEndOfLifeRouteType),
  routeDescription: z.string().optional(),
  percent: z.string().min(1, "Enter the share of mass following this route."),
  emissionFactorId: z.string().optional(),
  manualFactorValue: z.string().optional(),
  manualFactorUnit: z.string().optional(),
  manualFactorSource: z.string().optional(),
  recoveryRatePercent: z.string().optional(),
  avoidedFactorValue: z.string().optional(),
  avoidedFactorUnit: z.string().optional(),
  avoidedFactorSource: z.string().optional(),
  recoveryAssumptions: z.string().optional(),
  notes: z.string().optional(),
});

export async function saveEndOfLifeRouteAction(
  _prev: AssessmentFormState,
  formData: FormData,
): Promise<AssessmentFormState> {
  const parsed = routeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  const check = await guard(data.assessmentId);
  if (check.error) return { error: check.error, success: false };

  const percent = Number(data.percent);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    return { error: "The route share must be a percentage above 0 and no more than 100.", success: false };
  }
  if (data.avoidedFactorValue?.trim() && !data.avoidedFactorSource?.trim()) {
    return { error: "A recovery credit needs a source for the avoided factor.", success: false };
  }
  if (!data.emissionFactorId && !data.manualFactorValue?.trim()) {
    return { error: "Choose an end-of-life factor from the library, or enter a sourced one.", success: false };
  }

  await upsertEndOfLifeRoute({
    id: data.routeId || null,
    inventoryItemId: data.inventoryItemId,
    assessmentId: data.assessmentId,
    route: data.route,
    routeDescription: data.routeDescription,
    percent: data.percent,
    emissionFactorId: data.emissionFactorId,
    manualFactorValue: data.manualFactorValue?.trim() || null,
    manualFactorUnit: data.manualFactorUnit?.trim() || null,
    manualFactorSource: data.manualFactorSource,
    recoveryRatePercent: data.recoveryRatePercent?.trim() || null,
    avoidedFactorValue: data.avoidedFactorValue?.trim() || null,
    avoidedFactorUnit: data.avoidedFactorUnit?.trim() || null,
    avoidedFactorSource: data.avoidedFactorSource,
    recoveryAssumptions: data.recoveryAssumptions,
    notes: data.notes,
    actorUserId: check.actor!.id,
  });

  // The 100% check belongs to the validation engine rather than this form: a
  // modeller has to be able to add routes one at a time without being blocked
  // while the set is temporarily incomplete.
  const routes = await prisma.lcaEndOfLifeRoute.findMany({ where: { inventoryItemId: data.inventoryItemId } });
  const total = routes.reduce((sum, r) => sum + Number(r.percent), 0);

  revalidatePath(`/assessments/${data.assessmentId}`, "layout");
  return {
    error: null,
    success: true,
    message:
      Math.abs(total - 100) < 0.000001
        ? "Route saved. The routes now account for exactly 100% of the mass."
        : `Route saved. The routes currently total ${total}% — they must reach exactly 100% before the assessment can be marked ready for verification.`,
  };
}

export async function deleteEndOfLifeRouteAction(formData: FormData): Promise<void> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const routeId = String(formData.get("routeId") ?? "");
  const check = await guard(assessmentId);
  if (check.error || !routeId) return;

  await deleteEndOfLifeRoute(routeId, assessmentId, check.actor!.id);
  revalidatePath(`/assessments/${assessmentId}`, "layout");
}

// ---------------------------------------------------------------------------
// Corporate data links
// ---------------------------------------------------------------------------

const corporateLinkSchema = z.object({
  assessmentId: z.string().min(1),
  inventoryItemId: z.string().min(1),
  linkType: z.enum(LcaCorporateLinkType),
  activityEntryId: z.string().optional(),
  siteId: z.string().optional(),
  supplierName: z.string().optional(),
  allocationPercent: z.string().min(1),
  allocationBasis: z.string().optional(),
  notes: z.string().optional(),
});

export async function createCorporateLinkAction(
  _prev: AssessmentFormState,
  formData: FormData,
): Promise<AssessmentFormState> {
  const parsed = corporateLinkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  const check = await guard(data.assessmentId);
  if (check.error) return { error: check.error, success: false };

  const percent = Number(data.allocationPercent);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    return { error: "The attribution share must be a percentage above 0 and no more than 100.", success: false };
  }
  if (!data.allocationBasis?.trim()) {
    return { error: "Record how the attribution share was arrived at — that reasoning is what a reviewer checks.", success: false };
  }

  await createCorporateLink({
    assessmentId: data.assessmentId,
    inventoryItemId: data.inventoryItemId,
    linkType: data.linkType,
    activityEntryId: data.activityEntryId || null,
    siteId: data.siteId || null,
    supplierName: data.supplierName || null,
    allocationPercent: data.allocationPercent,
    allocationBasis: data.allocationBasis,
    notes: data.notes,
    actorUserId: check.actor!.id,
  });

  revalidatePath(`/assessments/${data.assessmentId}`, "layout");
  return {
    error: null,
    success: true,
    message: "Corporate record cited. This is a reference only — no emissions move between the corporate inventory and this product footprint.",
  };
}

export async function deleteCorporateLinkAction(formData: FormData): Promise<void> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const linkId = String(formData.get("linkId") ?? "");
  const check = await guard(assessmentId);
  if (check.error || !linkId) return;

  await deleteCorporateLink(linkId, assessmentId, check.actor!.id);
  revalidatePath(`/assessments/${assessmentId}`, "layout");
}

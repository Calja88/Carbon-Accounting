"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { LcaAssuranceType, LcaBoundary, LcaPcfVerificationStatus } from "@prisma/client";
import { createSupplier, createSupplierPcf, importPactDocument } from "@/lib/lca/supplier-service";
import { canManageSuppliers, getLcaContext } from "@/lib/lca/permissions";
import { findUnit } from "@/lib/lca/units";
import type { SupplierFormState } from "@/lib/lca/form-state";


const supplierSchema = z.object({
  entityId: z.string().min(1, "Choose the operating unit."),
  name: z.string().min(1, "Give the supplier a name."),
  identifier: z.string().optional(),
  country: z.string().optional(),
  contact: z.string().optional(),
  notes: z.string().optional(),
});

export async function createSupplierAction(
  _prev: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const context = await getLcaContext();
  if (!canManageSuppliers(context)) return { error: "Your permissions do not allow adding suppliers.", success: false };

  const parsed = supplierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }

  await createSupplier(context!, { ...parsed.data, actorUserId: context!.userId });
  revalidatePath("/suppliers");
  return { error: null, success: true, message: "Supplier added." };
}

const pcfSchema = z.object({
  entityId: z.string().min(1),
  supplierId: z.string().min(1, "Choose the supplier."),
  productName: z.string().min(1, "Name the supplier's product."),
  productIdentifier: z.string().optional(),
  productCategory: z.string().optional(),
  pcfValue: z.string().min(1, "Enter the footprint value."),
  pcfBiogenicValue: z.string().optional(),
  declaredUnitQuantity: z.string().min(1),
  declaredUnitUnit: z.string().min(1, "Enter the declared unit."),
  declaredUnitDescription: z.string().optional(),
  boundary: z.enum(LcaBoundary),
  boundaryNotes: z.string().optional(),
  methodology: z.string().optional(),
  methodologyVersion: z.string().optional(),
  gwpBasis: z.string().optional(),
  reportingPeriodStart: z.string().optional(),
  reportingPeriodEnd: z.string().optional(),
  geography: z.string().optional(),
  verificationStatus: z.enum(LcaPcfVerificationStatus),
  verifierName: z.string().optional(),
  verificationDate: z.string().optional(),
  assuranceType: z.enum(LcaAssuranceType).optional(),
  primaryDataSharePercent: z.string().optional(),
  uncertaintyPercent: z.string().optional(),
  notes: z.string().optional(),
});

function optionalScore(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
}

export async function createSupplierPcfAction(
  _prev: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const context = await getLcaContext();
  if (!canManageSuppliers(context)) return { error: "Your permissions do not allow recording supplier footprints.", success: false };

  const parsed = pcfSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  if (!Number.isFinite(Number(data.pcfValue))) {
    return { error: `"${data.pcfValue}" is not a number.`, success: false };
  }
  if (!findUnit(data.declaredUnitUnit)) {
    return {
      error: `"${data.declaredUnitUnit}" is not a unit this platform can convert, so the figure could not be applied to an inventory line.`,
      success: false,
    };
  }
  if (Number(data.declaredUnitQuantity) <= 0) {
    return { error: "The declared unit quantity must be greater than zero.", success: false };
  }
  if (data.verificationStatus === LcaPcfVerificationStatus.THIRD_PARTY_VERIFIED && !data.verifierName?.trim()) {
    return { error: "A third-party verified footprint needs the verifier's name.", success: false };
  }

  await createSupplierPcf(context!, {
    entityId: data.entityId,
    supplierId: data.supplierId,
    productName: data.productName,
    productIdentifier: data.productIdentifier,
    productCategory: data.productCategory,
    pcfValue: data.pcfValue,
    pcfBiogenicValue: data.pcfBiogenicValue?.trim() || null,
    declaredUnitQuantity: data.declaredUnitQuantity,
    declaredUnitUnit: data.declaredUnitUnit,
    declaredUnitDescription: data.declaredUnitDescription,
    boundary: data.boundary,
    boundaryNotes: data.boundaryNotes,
    methodology: data.methodology,
    methodologyVersion: data.methodologyVersion,
    gwpBasis: data.gwpBasis,
    reportingPeriodStart: data.reportingPeriodStart ? new Date(data.reportingPeriodStart) : null,
    reportingPeriodEnd: data.reportingPeriodEnd ? new Date(data.reportingPeriodEnd) : null,
    geography: data.geography,
    verificationStatus: data.verificationStatus,
    verifierName: data.verifierName,
    verificationDate: data.verificationDate ? new Date(data.verificationDate) : null,
    primaryDataSharePercent: data.primaryDataSharePercent?.trim() || null,
    uncertaintyPercent: data.uncertaintyPercent?.trim() || null,
    temporalScore: optionalScore(formData.get("temporalScore")),
    geographicalScore: optionalScore(formData.get("geographicalScore")),
    technologicalScore: optionalScore(formData.get("technologicalScore")),
    completenessScore: optionalScore(formData.get("completenessScore")),
    reliabilityScore: optionalScore(formData.get("reliabilityScore")),
    notes: data.notes,
    actorUserId: context!.userId,
  });

  revalidatePath("/suppliers");
  return { error: null, success: true, message: "Supplier footprint recorded. It can now replace a generic factor on any inventory line with a compatible unit." };
}

export async function importPactDocumentAction(
  _prev: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const context = await getLcaContext();
  if (!canManageSuppliers(context)) return { error: "Your permissions do not allow importing supplier footprints.", success: false };

  const entityId = String(formData.get("entityId") ?? "");
  const supplierId = String(formData.get("supplierId") ?? "") || null;
  const file = formData.get("file");
  const pasted = String(formData.get("document") ?? "").trim();

  let raw: string;
  if (file instanceof File && file.size > 0) {
    raw = await file.text();
  } else if (pasted) {
    raw = pasted;
  } else {
    return { error: "Upload a document or paste its JSON.", success: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "That is not valid JSON.", success: false };
  }

  const result = await importPactDocument(context!, { entityId, supplierId, document: parsed, actorUserId: context!.userId });

  if (!result.ok) {
    return {
      error: `The document could not be imported: ${result.errors.join("; ")}`,
      success: false,
      warnings: result.warnings,
    };
  }

  revalidatePath("/suppliers");
  return {
    error: null,
    success: true,
    message: `Imported ${result.pcf?.productName} from ${result.pcf?.companyName}. The document has been kept verbatim on the record.`,
    warnings: result.warnings,
  };
}

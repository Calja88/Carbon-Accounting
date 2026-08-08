/**
 * Suppliers and supplier product carbon footprints.
 *
 * A supplier PCF is the highest-quality input a product assessment can have:
 * the supplier's own measured figure for the thing you actually bought, rather
 * than an industry average for something like it. This module holds them with
 * everything that makes one usable — declared unit, boundary, methodology,
 * period, verification status, data quality — because a PCF without those is
 * a number nobody can place.
 *
 * Supplier PCFs can be applied to inventory items in place of a generic
 * secondary factor; the factor resolver in calculation-service converts one
 * into a per-unit figure like any other factor, so the substitution flows
 * through the same provenance and audit trail.
 */

import { LcaBoundary, LcaFactorSelectionMode, LcaPcfVerificationStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { D, toNumber } from "./decimal";
import { areUnitsCompatible } from "./units";
import { recordAuditEvent } from "./audit-service";
import { fromPactFootprint, type PactImportResult } from "./pact/adapter";

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function listSuppliers(entityId?: string) {
  return prisma.supplier.findMany({
    where: entityId ? { entityId } : {},
    include: {
      entity: true,
      _count: { select: { productPcfs: true, inventoryItems: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function getSupplier(supplierId: string) {
  return prisma.supplier.findUnique({
    where: { id: supplierId },
    include: {
      entity: true,
      productPcfs: {
        include: { evidence: true, _count: { select: { inventoryItems: true } } },
        orderBy: { updatedAt: "desc" },
      },
    },
  });
}

export interface CreateSupplierInput {
  entityId: string;
  name: string;
  identifier?: string | null;
  country?: string | null;
  contact?: string | null;
  notes?: string | null;
  actorUserId: string;
}

export async function createSupplier(input: CreateSupplierInput) {
  const supplier = await prisma.supplier.create({
    data: {
      entityId: input.entityId,
      name: input.name,
      identifier: input.identifier ?? null,
      country: input.country ?? null,
      contact: input.contact ?? null,
      notes: input.notes ?? null,
    },
  });

  await recordAuditEvent({
    entityType: "supplier",
    entityId: supplier.id,
    action: "created",
    actorUserId: input.actorUserId,
    summary: `Supplier "${supplier.name}" added.`,
    after: { name: supplier.name, identifier: supplier.identifier, country: supplier.country },
  });

  return supplier;
}

/**
 * The corporate side records suppliers as free text on activity entries and
 * supplier-specific factor sets. This surfaces where a product-side supplier
 * matches one of those, so the two views of the same counterparty can be seen
 * together without merging any figures.
 */
export async function corporateRecordsForSupplier(supplierName: string) {
  const [factorSets, entryCount] = await Promise.all([
    prisma.emissionFactorSet.findMany({
      where: { sourceType: "SUPPLIER_SPECIFIC", supplierName: { equals: supplierName, mode: "insensitive" } },
      select: { id: true, name: true, vintageYear: true, _count: { select: { factors: true } } },
    }),
    prisma.activityEntry.count({ where: { supplierName: { equals: supplierName, mode: "insensitive" } } }),
  ]);
  return { factorSets, corporateActivityEntryCount: entryCount };
}

// ---------------------------------------------------------------------------
// Supplier PCFs
// ---------------------------------------------------------------------------

export interface CreateSupplierPcfInput {
  entityId: string;
  supplierId: string;
  productName: string;
  productIdentifier?: string | null;
  productCategory?: string | null;
  pcfValue: string | number;
  pcfBiogenicValue?: string | number | null;
  declaredUnitQuantity: string | number;
  declaredUnitUnit: string;
  declaredUnitDescription?: string | null;
  boundary: LcaBoundary;
  boundaryNotes?: string | null;
  methodology?: string | null;
  methodologyVersion?: string | null;
  gwpBasis?: string | null;
  reportingPeriodStart?: Date | null;
  reportingPeriodEnd?: Date | null;
  geography?: string | null;
  verificationStatus?: LcaPcfVerificationStatus;
  verifierName?: string | null;
  verificationDate?: Date | null;
  primaryDataSharePercent?: string | number | null;
  temporalScore?: number | null;
  geographicalScore?: number | null;
  technologicalScore?: number | null;
  completenessScore?: number | null;
  reliabilityScore?: number | null;
  uncertaintyPercent?: string | number | null;
  sourceFormat?: string | null;
  sourcePayload?: unknown;
  notes?: string | null;
  actorUserId: string;
}

export async function createSupplierPcf(input: CreateSupplierPcfInput) {
  const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: input.supplierId } });

  const pcf = await prisma.lcaSupplierPcf.create({
    data: {
      entityId: input.entityId,
      supplierId: input.supplierId,
      productName: input.productName,
      productIdentifier: input.productIdentifier ?? null,
      productCategory: input.productCategory ?? null,
      pcfValue: String(input.pcfValue),
      pcfBiogenicValue: input.pcfBiogenicValue !== null && input.pcfBiogenicValue !== undefined ? String(input.pcfBiogenicValue) : null,
      declaredUnitQuantity: String(input.declaredUnitQuantity),
      declaredUnitUnit: input.declaredUnitUnit,
      declaredUnitDescription: input.declaredUnitDescription ?? null,
      boundary: input.boundary,
      boundaryNotes: input.boundaryNotes ?? null,
      methodology: input.methodology ?? null,
      methodologyVersion: input.methodologyVersion ?? null,
      gwpBasis: input.gwpBasis ?? null,
      reportingPeriodStart: input.reportingPeriodStart ?? null,
      reportingPeriodEnd: input.reportingPeriodEnd ?? null,
      geography: input.geography ?? null,
      verificationStatus: input.verificationStatus ?? LcaPcfVerificationStatus.UNVERIFIED,
      verifierName: input.verifierName ?? null,
      verificationDate: input.verificationDate ?? null,
      primaryDataSharePercent: input.primaryDataSharePercent !== null && input.primaryDataSharePercent !== undefined ? String(input.primaryDataSharePercent) : null,
      temporalScore: input.temporalScore ?? null,
      geographicalScore: input.geographicalScore ?? null,
      technologicalScore: input.technologicalScore ?? null,
      completenessScore: input.completenessScore ?? null,
      reliabilityScore: input.reliabilityScore ?? null,
      uncertaintyPercent: input.uncertaintyPercent !== null && input.uncertaintyPercent !== undefined ? String(input.uncertaintyPercent) : null,
      sourceFormat: input.sourceFormat ?? null,
      sourcePayload: input.sourcePayload ? (JSON.parse(JSON.stringify(input.sourcePayload)) as Prisma.InputJsonValue) : Prisma.JsonNull,
      notes: input.notes ?? null,
    },
  });

  await recordAuditEvent({
    entityType: "supplier_pcf",
    entityId: pcf.id,
    action: "created",
    actorUserId: input.actorUserId,
    summary: `Supplier PCF recorded: ${supplier.name} — ${pcf.productName}, ${pcf.pcfValue.toString()} kgCO2e per ${pcf.declaredUnitQuantity.toString()} ${pcf.declaredUnitUnit} (${pcf.boundary.replace(/_/g, " ").toLowerCase()}, ${pcf.verificationStatus.replace(/_/g, " ").toLowerCase()}).`,
    after: {
      productName: pcf.productName,
      pcfValue: pcf.pcfValue.toString(),
      declaredUnit: `${pcf.declaredUnitQuantity.toString()} ${pcf.declaredUnitUnit}`,
      boundary: pcf.boundary,
      verificationStatus: pcf.verificationStatus,
      sourceFormat: pcf.sourceFormat,
    },
  });

  return pcf;
}

export async function listSupplierPcfs(entityId?: string) {
  return prisma.lcaSupplierPcf.findMany({
    where: entityId ? { entityId } : {},
    include: { supplier: true, _count: { select: { inventoryItems: true, evidence: true } } },
    orderBy: [{ supplier: { name: "asc" } }, { productName: "asc" }],
  });
}

export async function getSupplierPcf(pcfId: string) {
  return prisma.lcaSupplierPcf.findUnique({
    where: { id: pcfId },
    include: {
      supplier: true,
      entity: true,
      evidence: { include: { uploadedBy: true } },
      inventoryItems: {
        include: { assessment: { select: { id: true, reference: true, title: true } } },
      },
    },
  });
}

/**
 * Supplier PCFs a given inventory item could legitimately use: same entity,
 * and a declared unit the item's own quantity can be converted into.
 */
export async function supplierPcfsForItem(entityId: string, itemUnit: string) {
  const candidates = await prisma.lcaSupplierPcf.findMany({
    where: { entityId },
    include: { supplier: true },
    orderBy: [{ supplier: { name: "asc" } }, { productName: "asc" }],
  });
  return candidates.filter((pcf) => areUnitsCompatible(pcf.declaredUnitUnit, itemUnit));
}

/** kgCO2e per one declared unit — the figure the engine actually applies. */
export function pcfPerUnit(pcf: { pcfValue: Prisma.Decimal; declaredUnitQuantity: Prisma.Decimal }): number {
  const quantity = D(pcf.declaredUnitQuantity);
  if (quantity.isZero()) return toNumber(pcf.pcfValue);
  return toNumber(D(pcf.pcfValue).div(quantity));
}

/**
 * Replaces an item's generic secondary factor with a supplier's own figure.
 * The item's data type moves to supplier-specific at the same time, so the
 * data-quality coverage breakdown reflects the improvement automatically.
 */
export async function applySupplierPcfToItem(
  inventoryItemId: string,
  supplierPcfId: string,
  actorUserId: string,
) {
  const [item, pcf] = await Promise.all([
    prisma.lcaInventoryItem.findUniqueOrThrow({
      where: { id: inventoryItemId },
      include: { emissionFactor: { include: { factorSet: true } } },
    }),
    prisma.lcaSupplierPcf.findUniqueOrThrow({ where: { id: supplierPcfId }, include: { supplier: true } }),
  ]);

  if (!areUnitsCompatible(pcf.declaredUnitUnit, item.unit)) {
    throw new Error(
      `This supplier PCF is declared per ${pcf.declaredUnitUnit}, which cannot be applied to a quantity in ${item.unit}.`,
    );
  }

  const previousSource = item.emissionFactor
    ? `${item.emissionFactor.factorSet.publisher} — ${item.emissionFactor.factorSet.name}`
    : item.manualFactorSource ?? "no factor";

  const updated = await prisma.lcaInventoryItem.update({
    where: { id: inventoryItemId },
    data: {
      factorSelectionMode: LcaFactorSelectionMode.SUPPLIER_PCF,
      supplierPcfId,
      supplierId: pcf.supplierId,
      dataType: "SUPPLIER_SPECIFIC",
    },
  });

  await recordAuditEvent({
    assessmentId: item.assessmentId,
    entityType: "factor_assignment",
    entityId: inventoryItemId,
    action: "supplier_pcf_applied",
    actorUserId,
    summary: `"${item.name}" now uses ${pcf.supplier.name}'s own footprint for ${pcf.productName} (${pcfPerUnit(pcf)} kgCO2e per ${pcf.declaredUnitUnit}) in place of ${previousSource}.`,
    before: { factorSelectionMode: item.factorSelectionMode, source: previousSource, dataType: item.dataType },
    after: { factorSelectionMode: "SUPPLIER_PCF", supplierPcfId, dataType: "SUPPLIER_SPECIFIC" },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// PACT-aligned exchange
// ---------------------------------------------------------------------------

export interface ImportPactDocumentInput {
  entityId: string;
  /** An existing supplier, or null to create one from the document's company name. */
  supplierId: string | null;
  document: unknown;
  actorUserId: string;
}

export interface ImportPactOutcome extends PactImportResult {
  supplierPcfId: string | null;
  supplierId: string | null;
}

/**
 * Imports a PACT-aligned document as a supplier PCF. Validation failures are
 * reported in full rather than partially applied, and the original document is
 * kept on the record so a reviewer can always see what the supplier actually
 * sent.
 */
export async function importPactDocument(input: ImportPactDocumentInput): Promise<ImportPactOutcome> {
  const result = fromPactFootprint(input.document);
  if (!result.ok || !result.pcf) {
    return { ...result, supplierPcfId: null, supplierId: null };
  }

  let supplierId = input.supplierId;
  if (!supplierId) {
    const existing = await prisma.supplier.findFirst({
      where: { entityId: input.entityId, name: { equals: result.pcf.companyName, mode: "insensitive" } },
    });
    if (existing) {
      supplierId = existing.id;
    } else {
      const created = await createSupplier({
        entityId: input.entityId,
        name: result.pcf.companyName,
        notes: "Created automatically from an imported product footprint document.",
        actorUserId: input.actorUserId,
      });
      supplierId = created.id;
    }
  }

  const pcf = await createSupplierPcf({
    entityId: input.entityId,
    supplierId,
    productName: result.pcf.productName,
    productIdentifier: result.pcf.productIdentifier,
    productCategory: result.pcf.productCategory,
    pcfValue: result.pcf.pcfValue,
    pcfBiogenicValue: result.pcf.pcfBiogenicValue,
    declaredUnitQuantity: result.pcf.declaredUnitQuantity,
    declaredUnitUnit: result.pcf.declaredUnitUnit,
    declaredUnitDescription: result.pcf.declaredUnitDescription,
    boundary: result.pcf.boundary,
    boundaryNotes: result.pcf.boundaryNotes,
    methodology: result.pcf.methodology,
    methodologyVersion: result.pcf.methodologyVersion,
    gwpBasis: result.pcf.gwpBasis,
    reportingPeriodStart: result.pcf.reportingPeriodStart,
    reportingPeriodEnd: result.pcf.reportingPeriodEnd,
    geography: result.pcf.geography,
    verificationStatus: result.pcf.verificationStatus,
    verifierName: result.pcf.verifierName,
    verificationDate: result.pcf.verificationDate,
    primaryDataSharePercent: result.pcf.primaryDataSharePercent,
    temporalScore: result.pcf.temporalScore,
    geographicalScore: result.pcf.geographicalScore,
    technologicalScore: result.pcf.technologicalScore,
    completenessScore: result.pcf.completenessScore,
    reliabilityScore: result.pcf.reliabilityScore,
    sourceFormat: "PACT-aligned product footprint document",
    sourcePayload: result.raw,
    notes: result.pcf.notes,
    actorUserId: input.actorUserId,
  });

  return { ...result, supplierPcfId: pcf.id, supplierId };
}

export type SupplierPcfWithSupplier = Prisma.LcaSupplierPcfGetPayload<{ include: { supplier: true } }>;

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LcaProductStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/lca/audit-service";
import { canEditLcaData, getLcaContext } from "@/lib/lca/permissions";
import { assertEntityAccess } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { requireProductInScope } from "@/lib/repositories/lca-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import type { ProductFormState } from "@/lib/lca/form-state";


const productSchema = z.object({
  entityId: z.string().min(1, "Choose which operating unit owns this product."),
  name: z.string().min(1, "Give the product a name."),
  sku: z.string().min(1, "Give the product an SKU or internal code."),
  description: z.string().optional(),
  category: z.string().optional(),
  firstVersionLabel: z.string().min(1, "Name the first version, e.g. \"Rev A\"."),
});

export async function createProductAction(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const context = await getLcaContext();
  if (!canEditLcaData(context)) {
    return { error: "Your permissions do not allow creating products.", success: false };
  }

  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  assertEntityAccess(context!, data.entityId);
  const ctx = toTenantRepositoryContext(context!);
  const entity = await prisma.entity.findFirst({ where: tenantWhere(ctx, { id: data.entityId }) });
  if (!entity) throw new TenantOwnershipError();

  const duplicate = await prisma.product.findFirst({
    where: { entityId: data.entityId, sku: data.sku },
  });
  if (duplicate) {
    return { error: `A product with SKU "${data.sku}" already exists for this operating unit.`, success: false };
  }

  const product = await prisma.product.create({
    data: {
      entityId: data.entityId,
      organisationId: context!.organisationId,
      name: data.name,
      sku: data.sku,
      description: data.description || null,
      category: data.category || null,
      versions: { create: { versionLabel: data.firstVersionLabel } },
    },
  });

  await recordAuditEvent({
    entityType: "product",
    entityId: product.id,
    action: "created",
    actorUserId: context!.userId,
    summary: `Product "${product.name}" (${product.sku}) created with first version "${data.firstVersionLabel}".`,
    after: { name: product.name, sku: product.sku, category: product.category },
  });

  revalidatePath("/products");
  redirect(`/products/${product.id}`);
}

const updateProductSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1, "Give the product a name."),
  sku: z.string().min(1, "Give the product an SKU or internal code."),
  description: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(LcaProductStatus),
  notes: z.string().optional(),
});

export async function updateProductAction(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const context = await getLcaContext();
  if (!canEditLcaData(context)) {
    return { error: "Your permissions do not allow editing products.", success: false };
  }

  const parsed = updateProductSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  let before;
  try {
    before = await requireProductInScope(context!, data.productId);
  } catch (err) {
    if (err instanceof TenantOwnershipError) return { error: "That product no longer exists.", success: false };
    throw err;
  }

  const updated = await prisma.product.update({
    where: { id: data.productId },
    data: {
      name: data.name,
      sku: data.sku,
      description: data.description || null,
      category: data.category || null,
      status: data.status,
      notes: data.notes || null,
    },
  });

  await recordAuditEvent({
    entityType: "product",
    entityId: updated.id,
    action: "updated",
    actorUserId: context!.userId,
    summary: `Product "${updated.name}" updated${before.status !== updated.status ? `, status now ${updated.status.toLowerCase()}` : ""}.`,
    before: { name: before.name, sku: before.sku, status: before.status },
    after: { name: updated.name, sku: updated.sku, status: updated.status },
  });

  revalidatePath(`/products/${data.productId}`);
  return { error: null, success: true };
}

const versionSchema = z.object({
  productId: z.string().min(1),
  versionLabel: z.string().min(1, "Name the version, e.g. \"Rev B\"."),
  description: z.string().optional(),
  effectiveFrom: z.string().optional(),
});

export async function createProductVersionAction(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const context = await getLcaContext();
  if (!canEditLcaData(context)) {
    return { error: "Your permissions do not allow adding product versions.", success: false };
  }

  const parsed = versionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  try {
    await requireProductInScope(context!, data.productId);
  } catch (err) {
    if (err instanceof TenantOwnershipError) return { error: "That product no longer exists.", success: false };
    throw err;
  }

  const existing = await prisma.productVersion.findFirst({
    where: { productId: data.productId, versionLabel: data.versionLabel },
  });
  if (existing) {
    return { error: `This product already has a version called "${data.versionLabel}".`, success: false };
  }

  const version = await prisma.productVersion.create({
    data: {
      productId: data.productId,
      versionLabel: data.versionLabel,
      description: data.description || null,
      effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : null,
    },
  });

  await recordAuditEvent({
    entityType: "product_version",
    entityId: version.id,
    action: "created",
    actorUserId: context!.userId,
    summary: `Product version "${version.versionLabel}" created. A design change usually means a new assessment rather than an edit to an existing one.`,
    after: { versionLabel: version.versionLabel },
  });

  revalidatePath(`/products/${data.productId}`);
  return { error: null, success: true };
}

const locationSchema = z.object({
  productId: z.string().min(1),
  productVersionId: z.string().min(1),
  name: z.string().min(1, "Name the manufacturing location."),
  country: z.string().optional(),
  siteId: z.string().optional(),
  isPrimary: z.string().optional(),
  notes: z.string().optional(),
});

export async function addManufacturingLocationAction(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const context = await getLcaContext();
  if (!canEditLcaData(context)) {
    return { error: "Your permissions do not allow editing products.", success: false };
  }

  const parsed = locationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  const product = await requireProductInScope(context!, data.productId);
  const productVersion = await prisma.productVersion.findUnique({ where: { id: data.productVersionId } });
  if (!productVersion || productVersion.productId !== product.id) throw new TenantOwnershipError();

  if (data.siteId) {
    const ctx = toTenantRepositoryContext(context!);
    const site = await prisma.site.findFirst({ where: tenantWhere(ctx, { id: data.siteId }) });
    if (!site) throw new TenantOwnershipError();
  }

  const location = await prisma.productManufacturingLocation.create({
    data: {
      productVersionId: data.productVersionId,
      name: data.name,
      country: data.country || null,
      siteId: data.siteId || null,
      isPrimary: data.isPrimary === "on",
      notes: data.notes || null,
    },
  });

  await recordAuditEvent({
    entityType: "product_version",
    entityId: data.productVersionId,
    action: "updated",
    actorUserId: context!.userId,
    summary: `Manufacturing location "${location.name}" added${data.siteId ? ", linked to an internal site so its corporate energy records can be cited" : ""}.`,
    after: { name: location.name, country: location.country, siteId: location.siteId },
  });

  revalidatePath(`/products/${data.productId}`);
  return { error: null, success: true };
}

export async function deleteManufacturingLocationAction(formData: FormData): Promise<void> {
  const context = await getLcaContext();
  if (!canEditLcaData(context)) return;

  const locationId = String(formData.get("locationId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  if (!locationId) return;

  await requireProductInScope(context!, productId);
  const location = await prisma.productManufacturingLocation.findUnique({
    where: { id: locationId },
    include: { productVersion: true },
  });
  if (!location || location.productVersion.productId !== productId) return;

  await prisma.productManufacturingLocation.delete({ where: { id: locationId } });

  await recordAuditEvent({
    entityType: "product_version",
    entityId: location.productVersionId,
    action: "updated",
    actorUserId: context!.userId,
    summary: `Manufacturing location "${location.name}" removed.`,
    before: { name: location.name },
  });

  revalidatePath(`/products/${productId}`);
}

const retireVersionSchema = z.object({
  productId: z.string().min(1),
  productVersionId: z.string().min(1),
  reason: z.string().trim().min(1, "Record why the version is being retired.").max(2000),
});

/**
 * Retires a product version.
 *
 * A `ProductVersion` is never deleted: assessments reference it, and an
 * issued `LcaAssessmentVersion` is a frozen snapshot of an assessment made
 * against exactly this version. `isActive` is the flag the product page
 * already filters on, so clearing it withdraws the version from selection
 * for new assessments while every existing assessment keeps resolving.
 *
 * Refused while assessments still reference the version, so retiring can
 * never leave a live assessment pointing at a withdrawn product version.
 */
export async function retireProductVersionAction(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const context = await getLcaContext();
  if (!canEditLcaData(context)) {
    return { error: "Your permissions do not allow retiring product versions.", success: false };
  }

  const parsed = retireVersionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  try {
    await requireProductInScope(context!, data.productId);
  } catch (err) {
    if (err instanceof TenantOwnershipError) return { error: "That product no longer exists.", success: false };
    throw err;
  }

  // Nested-parent substitution guard: the version must belong to the product
  // the caller was just proven to own, not merely exist.
  const version = await prisma.productVersion.findFirst({
    where: { id: data.productVersionId, productId: data.productId },
  });
  if (!version) return { error: "That product version no longer exists.", success: false };
  if (!version.isActive) return { error: "That product version is already retired.", success: false };

  const assessmentCount = await prisma.lcaAssessment.count({
    where: { productVersionId: version.id, organisationId: context!.organisationId },
  });
  if (assessmentCount > 0) {
    return {
      error: `${assessmentCount} assessment(s) are built on "${version.versionLabel}". Retire it only once they are moved or superseded.`,
      success: false,
    };
  }

  const retired = await prisma.productVersion.update({
    where: { id: version.id },
    data: { isActive: false, effectiveTo: version.effectiveTo ?? new Date() },
  });

  await recordAuditEvent({
    entityType: "product_version",
    entityId: retired.id,
    action: "retired",
    actorUserId: context!.userId,
    summary: `Product version "${retired.versionLabel}" retired: ${data.reason.trim()}.`,
    before: { isActive: true, effectiveTo: version.effectiveTo },
    after: { isActive: false, effectiveTo: retired.effectiveTo },
  });

  revalidatePath(`/products/${data.productId}`);
  return { error: null, success: true, message: "Product version retired." };
}

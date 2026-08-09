"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LcaProductStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/lca/audit-service";
import { canEditLcaData, getLcaActor } from "@/lib/lca/permissions";
import type { ProductFormState } from "@/lib/lca/form-state";
import type { DeleteActionState } from "@/components/ui/delete-button";


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
  const actor = await getLcaActor();
  if (!canEditLcaData(actor)) {
    return { error: "Your role does not allow creating products.", success: false };
  }

  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  const duplicate = await prisma.product.findFirst({
    where: { entityId: data.entityId, sku: data.sku },
  });
  if (duplicate) {
    return { error: `A product with SKU "${data.sku}" already exists for this operating unit.`, success: false };
  }

  const product = await prisma.product.create({
    data: {
      entityId: data.entityId,
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
    actorUserId: actor?.id,
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
  const actor = await getLcaActor();
  if (!canEditLcaData(actor)) {
    return { error: "Your role does not allow editing products.", success: false };
  }

  const parsed = updateProductSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

  const before = await prisma.product.findUnique({ where: { id: data.productId } });
  if (!before) return { error: "That product no longer exists.", success: false };

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
    actorUserId: actor?.id,
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
  const actor = await getLcaActor();
  if (!canEditLcaData(actor)) {
    return { error: "Your role does not allow adding product versions.", success: false };
  }

  const parsed = versionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

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
    actorUserId: actor?.id,
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
  const actor = await getLcaActor();
  if (!canEditLcaData(actor)) {
    return { error: "Your role does not allow editing products.", success: false };
  }

  const parsed = locationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again.", success: false };
  }
  const data = parsed.data;

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
    actorUserId: actor?.id,
    summary: `Manufacturing location "${location.name}" added${data.siteId ? ", linked to an internal site so its corporate energy records can be cited" : ""}.`,
    after: { name: location.name, country: location.country, siteId: location.siteId },
  });

  revalidatePath(`/products/${data.productId}`);
  return { error: null, success: true };
}

/**
 * Deletes a product and its versions/manufacturing locations. Refused when
 * any version has an assessment against it — an assessment is an
 * authoritative record and must be dealt with (deleted or moved) first
 * rather than silently cascaded away (G6).
 */
export async function deleteProductAction(_prev: DeleteActionState, formData: FormData): Promise<DeleteActionState> {
  const actor = await getLcaActor();
  if (!canEditLcaData(actor)) return { error: "Your role does not allow deleting products.", success: false, message: null };

  const productId = String(formData.get("productId") ?? "");
  if (!productId) return { error: "Missing product.", success: false, message: null };

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { versions: { select: { _count: { select: { assessments: true } } } } },
  });
  if (!product) return { error: "That product no longer exists.", success: false, message: null };

  const assessmentCount = product.versions.reduce((sum, v) => sum + v._count.assessments, 0);
  if (assessmentCount > 0) {
    return {
      error: `This product has ${assessmentCount} assessment(s) against it. Delete those assessments first before deleting the product.`,
      success: false,
      message: null,
    };
  }

  await prisma.product.delete({ where: { id: productId } });

  await recordAuditEvent({
    entityType: "product",
    entityId: productId,
    action: "deleted",
    actorUserId: actor?.id,
    summary: `Product "${product.name}" (${product.sku}) deleted — it had no assessments against it.`,
    before: { name: product.name, sku: product.sku },
  });

  revalidatePath("/products");
  return { error: null, success: true, message: "Product deleted." };
}

export async function deleteManufacturingLocationAction(formData: FormData): Promise<void> {
  const actor = await getLcaActor();
  if (!canEditLcaData(actor)) return;

  const locationId = String(formData.get("locationId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  if (!locationId) return;

  const location = await prisma.productManufacturingLocation.findUnique({ where: { id: locationId } });
  if (!location) return;

  await prisma.productManufacturingLocation.delete({ where: { id: locationId } });

  await recordAuditEvent({
    entityType: "product_version",
    entityId: location.productVersionId,
    action: "updated",
    actorUserId: actor?.id,
    summary: `Manufacturing location "${location.name}" removed.`,
    before: { name: location.name },
  });

  revalidatePath(`/products/${productId}`);
}

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { requirePermission, PermissionDeniedError } from "@/lib/rbac/authorize";
import { parseFactorFile, validateFactorRows, RowIssue } from "@/lib/factor-import";
import { commitFactorImport } from "@/lib/factor-sets-service";
import { FactorSourceType } from "@prisma/client";

const schema = z.object({
  name: z.string().min(1, "Enter a name for this factor set."),
  publisher: z.string().min(1, "Enter a publisher."),
  sourceType: z.enum(["OFFICIAL_DEFRA_DESNZ", "EEIO_SPEND_BASED", "SUPPLIER_SPECIFIC"]),
  supplierName: z.string().optional(),
  vintageYear: z.coerce.number().int().min(2000).max(2100),
  effectiveFrom: z.string().min(1, "Enter an effective-from date."),
  effectiveTo: z.string().optional(),
  sourceUrl: z.string().optional(),
  notes: z.string().optional(),
  supersedesSetId: z.string().optional(),
});

export interface UploadFactorSetState {
  error: string | null;
  success: boolean;
  createdSetId: string | null;
  rowErrors: RowIssue[];
  rowWarnings: RowIssue[];
  importedCount: number;
  backfillRecalculated: number;
  backfillChecked: number;
}

const initialLikeState = {
  createdSetId: null,
  rowErrors: [],
  rowWarnings: [],
  importedCount: 0,
  backfillRecalculated: 0,
  backfillChecked: 0,
};

export async function uploadFactorSetAction(
  _prevState: UploadFactorSetState,
  formData: FormData,
): Promise<UploadFactorSetState> {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "carbon.factor.manage");
  } catch (err) {
    if (err instanceof OrganisationAccessError) {
      return { error: "You must be signed in.", success: false, ...initialLikeState };
    }
    if (err instanceof PermissionDeniedError) {
      return { error: "You don't have permission to manage emission factors.", success: false, ...initialLikeState };
    }
    throw err;
  }

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input.", success: false, ...initialLikeState };
  }
  const data = parsed.data;

  if (data.sourceType === "SUPPLIER_SPECIFIC" && !data.supplierName?.trim()) {
    return { error: "Supplier-specific sets need a supplier name.", success: false, ...initialLikeState };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a .csv or .xlsx file to upload.", success: false, ...initialLikeState };
  }

  let rawRows;
  try {
    const buffer = await file.arrayBuffer();
    rawRows = await parseFactorFile(buffer, file.name);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not read that file.",
      success: false,
      ...initialLikeState,
    };
  }

  if (rawRows.length === 0) {
    return { error: "That file has no data rows.", success: false, ...initialLikeState };
  }

  const { valid, errors, warnings } = validateFactorRows(rawRows);

  if (errors.length > 0) {
    return {
      error: `${errors.length} row${errors.length === 1 ? "" : "s"} failed validation — fix the file and re-upload. Nothing was imported.`,
      success: false,
      createdSetId: null,
      rowErrors: errors,
      rowWarnings: warnings,
      importedCount: 0,
      backfillRecalculated: 0,
      backfillChecked: 0,
    };
  }

  try {
    const { factorSet, backfill } = await commitFactorImport(context, {
      name: data.name,
      publisher: data.publisher,
      sourceType: data.sourceType as FactorSourceType,
      supplierName: data.supplierName || null,
      vintageYear: data.vintageYear,
      effectiveFrom: new Date(data.effectiveFrom),
      effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
      sourceUrl: data.sourceUrl || null,
      notes: data.notes || null,
      sourceFileName: file.name,
      importedByUserId: context.userId,
      supersedesSetId: data.supersedesSetId || null,
      rows: valid,
    });

    revalidatePath("/admin/factors");

    return {
      error: null,
      success: true,
      createdSetId: factorSet.id,
      rowErrors: [],
      rowWarnings: warnings,
      importedCount: valid.length,
      backfillRecalculated: backfill.recalculated,
      backfillChecked: backfill.checked,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Something went wrong committing the import.",
      success: false,
      ...initialLikeState,
    };
  }
}

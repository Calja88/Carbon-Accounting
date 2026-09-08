"use server";

import { revalidatePath } from "next/cache";
import {
  parseInventoryFile,
  validateInventoryRows,
  type DuplicateStrategy,
  type PreparedInventoryRow,
} from "@/lib/lca/import/inventory-import";
import { buildImportContext, commitInventoryImport } from "@/lib/lca/import/inventory-import-service";
import { checkCanEditAssessment, getLcaContext, type OrganisationContext } from "@/lib/lca/permissions";
import { requireAssessmentInScope } from "@/lib/repositories/lca-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { emptyImportState, type ImportState } from "@/lib/lca/form-state";


async function guard(assessmentId: string): Promise<{ error: string; orgContext: null } | { error: null; orgContext: OrganisationContext }> {
  const orgContext = await getLcaContext();
  if (!orgContext) return { error: "You must be signed in.", orgContext: null };
  let assessment;
  try {
    assessment = await requireAssessmentInScope(orgContext, assessmentId);
  } catch (err) {
    if (err instanceof TenantOwnershipError) return { error: "That assessment no longer exists.", orgContext: null };
    throw err;
  }
  const permission = checkCanEditAssessment(orgContext, assessment.status);
  if (!permission.ok) return { error: permission.reason, orgContext: null };
  return { error: null, orgContext };
}

/**
 * Step one: parse and check the file, and show the importer exactly what would
 * happen. Nothing is written here — every row comes back with a status,
 * including the ones that failed, so no row can go missing silently.
 */
export async function previewImportAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const check = await guard(assessmentId);
  if (check.error) return { ...emptyImportState, error: check.error };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ...emptyImportState, error: "Choose a CSV or Excel file to import." };
  }

  let rows;
  try {
    rows = await parseInventoryFile(await file.arrayBuffer(), file.name);
  } catch (error) {
    return { ...emptyImportState, error: error instanceof Error ? error.message : "That file could not be read." };
  }

  if (rows.length === 0) {
    return { ...emptyImportState, error: "That file has no data rows. Check the header row matches the template." };
  }

  const context = await buildImportContext(assessmentId);
  const preview = validateInventoryRows(rows, context);

  return { error: null, preview, fileName: file.name, committed: null };
}

/**
 * Step two: write the rows the importer confirmed, with their chosen handling
 * for duplicates. The prepared rows travel back from the preview so what gets
 * written is exactly what was shown.
 */
export async function commitImportAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const check = await guard(assessmentId);
  if (check.error) return { ...emptyImportState, error: check.error };

  const fileName = String(formData.get("fileName") ?? "uploaded file");
  const duplicateStrategy = String(formData.get("duplicateStrategy") ?? "skip") as DuplicateStrategy;
  const payload = String(formData.get("rows") ?? "");

  let rows: PreparedInventoryRow[];
  try {
    rows = JSON.parse(payload) as PreparedInventoryRow[];
  } catch {
    return { ...emptyImportState, error: "The preview could not be read back. Upload the file again." };
  }

  if (rows.length === 0) {
    return { ...emptyImportState, error: "There are no importable rows to write." };
  }

  const outcome = await commitInventoryImport(check.orgContext!, {
    assessmentId,
    rows,
    duplicateStrategy,
    actorUserId: check.orgContext!.userId,
    fileName,
  });

  revalidatePath(`/assessments/${assessmentId}`, "layout");
  return { error: null, preview: null, fileName, committed: outcome };
}

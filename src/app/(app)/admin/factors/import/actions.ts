"use server";

import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { logEvent } from "@/lib/observability/logger";
import { previewUkGovFactorImport } from "@/lib/factors/import/factor-import-service";
import type { DatasetMetadata, FactorCandidate, ImportMessage, ParsedFactorFile } from "@/lib/factors/import/types";

/** Rows shown per group. A preview is a review aid, not a spreadsheet viewer;
 * the counts above the tables remain the full figures. */
const ROWS_PER_GROUP = 100;
const SUPPORTED = /\.(csv|xlsx|xlsm)$/i;
const MAX_BYTES = 10 * 1024 * 1024;

export interface PreviewRow {
  sheet: string;
  rowNumber: number;
  categoryPath: string;
  activity: string;
  rawUnit: string;
  canonicalUnit: string | null;
  factorValue: string | null;
  factorUnit: string | null;
  gas: string | null;
  kind: string | null;
  rawFactorValue?: string;
  rawGas?: string;
  rawKind?: string;
  identity: string;
  messages: ImportMessage[];
}

export interface PreviewGroup {
  rows: PreviewRow[];
  total: number;
}

export interface FactorImportPreviewState {
  error: string | null;
  preview: {
    sourceFileName: string;
    metadata: DatasetMetadata;
    proposedName: string;
    sheets: ParsedFactorFile["sheets"];
    totalRowsScanned: number;
    counts: { accepted: number; warning: number; rejected: number; duplicate: number };
    messages: ImportMessage[];
    existingDatasetChecked: boolean;
    validationPassed: boolean;
    commitAllowed: false;
    commitBlockedReasons: string[];
    accepted: PreviewGroup;
    warning: PreviewGroup;
    rejected: PreviewGroup;
    duplicate: PreviewGroup;
  } | null;
}

// A "use server" module may only export async functions. The initial state is
// a plain object, so it lives with the component that seeds useActionState —
// exporting it from here made Next.js reject the whole module at evaluation,
// taking the route down with it rather than surfacing anything in the UI.
const fail = (error: string): FactorImportPreviewState => ({ error, preview: null });

function toPreviewRow(row: FactorCandidate): PreviewRow {
  return {
    sheet: row.source.sheet,
    rowNumber: row.source.rowNumber,
    categoryPath: row.categoryPath,
    activity: row.activity,
    rawUnit: row.rawUnit,
    canonicalUnit: row.canonicalUnit,
    factorValue: row.factorValue,
    factorUnit: row.factorUnit,
    gas: row.gas,
    kind: row.kind,
    rawFactorValue: row.source.fields.value ?? "",
    rawGas: row.source.fields.gas ?? "",
    rawKind: row.source.fields.level1 ?? row.source.fields.kind ?? "",
    identity: row.identity.slice(0, 12),
    messages: row.messages,
  };
}

const group = (rows: FactorCandidate[]): PreviewGroup => ({
  rows: rows.slice(0, ROWS_PER_GROUP).map(toPreviewRow),
  total: rows.length,
});

/**
 * Phase 3-ii preview. Reads the uploaded file in memory, runs the Phase 3-i
 * engine and returns what it found. It writes nothing: no factor set, no
 * factor row, no recalculation. Commit stays disabled by construction —
 * this action has no commit branch to reach.
 */
export async function previewFactorImportAction(
  _prevState: FactorImportPreviewState,
  formData: FormData,
): Promise<FactorImportPreviewState> {
  let context;
  try {
    context = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) return fail("You must be signed in.");
    throw err;
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fail("Choose a .csv, .xlsx or .xlsm file to preview.");
  }
  if (!SUPPORTED.test(file.name)) {
    return fail("Unsupported file type. Upload a .csv, .xlsx or .xlsm file.");
  }
  if (file.size > MAX_BYTES) {
    return fail("That file is larger than the 10 MiB preview limit.");
  }

  const year = Number(formData.get("year"));
  const existingFactorSetId = String(formData.get("existingFactorSetId") ?? "").trim();

  let preview;
  try {
    preview = await previewUkGovFactorImport(context, {
      buffer: await file.arrayBuffer(),
      sourceFileName: file.name,
      metadata: {
        publisher: String(formData.get("publisher") ?? "").trim() || null,
        year: Number.isInteger(year) && year > 0 ? year : null,
        release: String(formData.get("release") ?? "").trim() || null,
      },
      ...(existingFactorSetId ? { existingFactorSetId } : {}),
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      return fail("You don't have permission to manage emission factors.");
    }
    // The file's contents are never logged — only that parsing failed, and where.
    logEvent({
      level: "error",
      message: "factor_import_preview_failed",
      organisationId: context.organisationId,
      fields: { reason: err instanceof Error ? err.message : "unknown" },
    });
    return fail("That file could not be read. Check it is a valid, unencrypted spreadsheet or CSV and try again.");
  }

  return {
    error: null,
    preview: {
      sourceFileName: preview.sourceFileName,
      metadata: preview.metadata,
      proposedName: preview.proposedFactorSet.name,
      sheets: preview.sheets,
      totalRowsScanned: preview.totalRowsScanned,
      counts: {
        accepted: preview.counts.accepted,
        warning: preview.counts.warning,
        rejected: preview.counts.rejected,
        duplicate: preview.counts.duplicate,
      },
      messages: preview.messages,
      existingDatasetChecked: preview.existingDatasetChecked,
      validationPassed: preview.validationPassed,
      commitAllowed: preview.commitAllowed,
      commitBlockedReasons: preview.commitBlockedReasons,
      accepted: group(preview.acceptedRows),
      warning: group(preview.warningRows),
      rejected: group(preview.rejectedRows),
      duplicate: group(preview.duplicateRows),
    },
  };
}

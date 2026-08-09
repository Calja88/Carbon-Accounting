"use server";

import fs from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/admin";
import { parseLciCsv, validateLciRows, RejectedRow } from "@/lib/lci-import";
import { buildLciImportPreview, commitLciImport } from "@/lib/lci-import-service";
import { STAGED_FILES } from "./staged-files";

async function loadAndValidate(fileKey: string) {
  const file = STAGED_FILES[fileKey];
  if (!file) throw new Error(`Unknown staged file "${fileKey}".`);
  // The path is statically scoped to data/lci-import/ (see staged-files.ts) —
  // ignored from Turbopack's output-file tracing per its own suggested fix,
  // since these are small reference CSVs already committed to the repo, not
  // user-supplied paths.
  const text = await fs.readFile(path.join(process.cwd(), /* turbopackIgnore: true */ file.path), "utf-8");
  const rawRows = parseLciCsv(text);
  const { importable, rejected, counts } = validateLciRows(rawRows);
  return { fileName: path.basename(file.path), importable, rejected, counts };
}

export interface LciPreviewState {
  error: string | null;
  fileKey: string | null;
  fileName: string | null;
  sourceVersion: string | null;
  governanceBlockReason: string | null;
  counts: {
    total: number;
    importable: number;
    toImport: number;
    duplicates: number;
    rejectedMissingValue: number;
    rejectedOther: number;
  } | null;
  sampleRejected: RejectedRow[];
  zeroValueSampleCount: number;
}

const EMPTY_PREVIEW: LciPreviewState = {
  error: null,
  fileKey: null,
  fileName: null,
  sourceVersion: null,
  governanceBlockReason: null,
  counts: null,
  sampleRejected: [],
  zeroValueSampleCount: 0,
};

export async function previewLciImportAction(_prev: LciPreviewState, formData: FormData): Promise<LciPreviewState> {
  const session = await requireAdminSession();
  if (!session) return { ...EMPTY_PREVIEW, error: "Admins only." };

  const fileKey = String(formData.get("fileKey") ?? "");
  if (!STAGED_FILES[fileKey]) return { ...EMPTY_PREVIEW, error: "Choose a file to preview." };

  try {
    const { fileName, importable, rejected, counts } = await loadAndValidate(fileKey);
    const preview = await buildLciImportPreview(fileName, importable, rejected, counts);

    return {
      error: null,
      fileKey,
      fileName,
      sourceVersion: preview.sourceVersion,
      governanceBlockReason: preview.governanceBlockReason,
      counts: preview.counts,
      sampleRejected: rejected.slice(0, 15),
      zeroValueSampleCount: importable.filter((r) => r.isLegitimateZero).length,
    };
  } catch (err) {
    return { ...EMPTY_PREVIEW, error: err instanceof Error ? err.message : "Could not read/validate that file." };
  }
}

export interface LciCommitState {
  error: string | null;
  success: boolean;
  factorSetId: string | null;
  importedCount: number;
  duplicateCount: number;
  rejectedCount: number;
}

const EMPTY_COMMIT: LciCommitState = { error: null, success: false, factorSetId: null, importedCount: 0, duplicateCount: 0, rejectedCount: 0 };

export async function commitLciImportAction(_prev: LciCommitState, formData: FormData): Promise<LciCommitState> {
  const session = await requireAdminSession();
  if (!session) return { ...EMPTY_COMMIT, error: "Admins only." };

  const fileKey = String(formData.get("fileKey") ?? "");
  if (!STAGED_FILES[fileKey]) return { ...EMPTY_COMMIT, error: "No file selected." };

  try {
    const { fileName, importable, rejected, counts } = await loadAndValidate(fileKey);
    const preview = await buildLciImportPreview(fileName, importable, rejected, counts);

    if (preview.governanceBlockReason) {
      return { ...EMPTY_COMMIT, error: preview.governanceBlockReason };
    }

    const result = await commitLciImport({
      fileName,
      importedByUserId: session.user.id,
      rows: preview.toImport,
      duplicateCount: preview.duplicates.length,
      rejected,
    });

    revalidatePath("/admin/lci-sources");
    revalidatePath("/admin/factors");

    return {
      error: null,
      success: true,
      factorSetId: result.factorSet?.id ?? null,
      importedCount: result.importedCount,
      duplicateCount: result.duplicateCount,
      rejectedCount: result.rejectedCount,
    };
  } catch (err) {
    return { ...EMPTY_COMMIT, error: err instanceof Error ? err.message : "Something went wrong committing the import." };
  }
}

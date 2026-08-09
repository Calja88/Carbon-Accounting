"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createActivityEntryWithCalculations } from "@/lib/entries-service";
import {
  TRAVEL_SUBTYPE_LABELS,
  TRAVEL_SUBTYPE_UNITS,
  aggregateRows,
  autoDetectColumns,
  parseExpenseInFile,
  prepareExpenseInRows,
  type ColumnMapping,
  type ColumnRole,
} from "@/lib/expensein-import";
import { INITIAL_PREVIEW_STATE, type PreviewState } from "./types";

const TRAVEL_SUBTYPES = ["rail", "flight_domestic", "flight_short_haul", "flight_long_haul", "hotel"] as const;

function fail(state: PreviewState, error: string): PreviewState {
  return { ...state, error };
}

function readMappingOverrides(formData: FormData, autoMapping: ColumnMapping): ColumnMapping {
  const roles: ColumnRole[] = ["date", "category", "quantity", "description"];
  const mapping = { ...autoMapping };
  for (const role of roles) {
    const raw = formData.get(`col_${role}`);
    if (typeof raw === "string" && raw !== "") {
      const n = Number(raw);
      mapping[role] = Number.isInteger(n) && n >= 0 ? n : null;
    } else if (typeof raw === "string" && raw === "") {
      mapping[role] = null;
    }
  }
  return mapping;
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Step 1 — parse and preview. Writes nothing: the importer sees exactly
 * which entries would be created, and which rows are being skipped and
 * why, before anything lands in the database.
 */
export async function previewExpenseInAction(
  _prevState: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const session = await auth();
  if (!session?.user) return fail(INITIAL_PREVIEW_STATE, "You must be signed in.");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fail(INITIAL_PREVIEW_STATE, "Choose an ExpenseIn export (.csv or .xlsx) to preview.");
  }

  const distanceUnit = formData.get("distanceUnit") === "km" ? "km" : "miles";

  let sheet;
  try {
    sheet = await parseExpenseInFile(await file.arrayBuffer(), file.name);
  } catch (err) {
    return fail(INITIAL_PREVIEW_STATE, err instanceof Error ? err.message : "Could not read that file.");
  }

  if (sheet.headers.length === 0 || sheet.rows.length === 0) {
    return fail(INITIAL_PREVIEW_STATE, "That file has no data rows — check you exported completed expenses from ExpenseIn.");
  }

  const autoMapping = autoDetectColumns(sheet.headers);
  const mapping = readMappingOverrides(formData, autoMapping);

  const base: PreviewState = {
    ...INITIAL_PREVIEW_STATE,
    stage: "preview",
    headers: sheet.headers,
    mapping,
    distanceUnit,
    totalDataRows: sheet.rows.length,
  };

  const result = prepareExpenseInRows(sheet, { mapping, distanceUnit });
  if (result.fatalError) {
    return { ...base, error: result.fatalError };
  }

  const aggregated = aggregateRows(result.prepared);

  return {
    ...base,
    rows: aggregated.map((a) => ({
      periodLabel: monthLabel(a.periodStart),
      periodStartIso: a.periodStart.toISOString(),
      subtype: a.subtype,
      subtypeLabel: TRAVEL_SUBTYPE_LABELS[a.subtype],
      value: a.value,
      unit: a.unit,
      rowCount: a.rowCount,
    })),
    skipped: result.skipped,
  };
}

const commitRowSchema = z.object({
  periodStartIso: z.string().min(1),
  subtype: z.enum(TRAVEL_SUBTYPES),
  value: z.number().positive(),
  rowCount: z.number().int().nonnegative(),
});

/**
 * Step 2 — commit the previewed aggregate rows. Re-validated server-side
 * (subtype against the enum, value positive, date parseable) rather than
 * trusted from the client, and routed through the normal
 * createActivityEntryWithCalculations pipeline so these entries get the
 * same plausibility check, calculation and audit trail as hand-entered ones.
 */
export async function commitExpenseInAction(
  prevState: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const session = await auth();
  if (!session?.user) return fail(prevState, "You must be signed in.");

  const siteId = formData.get("siteId");
  if (typeof siteId !== "string" || !siteId) return fail(prevState, "Missing site.");

  const payloadRaw = formData.get("rowsJson");
  if (typeof payloadRaw !== "string" || !payloadRaw) return fail(prevState, "Nothing to import — run a preview first.");

  let parsedRows: z.infer<typeof commitRowSchema>[];
  try {
    parsedRows = z.array(commitRowSchema).parse(JSON.parse(payloadRaw));
  } catch {
    return fail(prevState, "The previewed rows could not be read back. Re-run the preview and try again.");
  }
  if (parsedRows.length === 0) return fail(prevState, "Nothing to import — no rows matched a business-travel type.");

  const dataPoint = await prisma.activityDataPoint.findUnique({
    where: { code: "S3-06" },
    include: { factorOptions: true },
  });
  if (!dataPoint) return fail(prevState, "Business travel data point (S3-06) is not configured.");

  let importedCount = 0;
  let awaitingFactorCount = 0;
  let flaggedCount = 0;

  for (const row of parsedRows) {
    const option = dataPoint.factorOptions.find((o) => o.subtypeKey === row.subtype);
    if (!option) return fail(prevState, `No travel-type option configured for "${row.subtype}".`);

    const periodStart = new Date(row.periodStartIso);
    if (Number.isNaN(periodStart.getTime())) return fail(prevState, "A previewed row had an unreadable period.");
    const periodEnd = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0));

    const { entry, calculations } = await createActivityEntryWithCalculations({
      activityDataPointId: dataPoint.id,
      siteId,
      periodStart,
      periodEnd,
      rawValue: row.value,
      rawUnit: TRAVEL_SUBTYPE_UNITS[row.subtype],
      factorOptionId: option.id,
      enteredByUserId: session.user.id,
      notes: `Imported from ExpenseIn — ${row.rowCount} expense line${row.rowCount === 1 ? "" : "s"} aggregated for ${monthLabel(periodStart)}.`,
    });

    importedCount++;
    if (entry.status === "FLAGGED") flaggedCount++;
    else if (calculations.length === 0) awaitingFactorCount++;
  }

  revalidatePath(`/data/entry/${siteId}`);
  revalidatePath("/");

  return {
    ...prevState,
    stage: "done",
    error: null,
    importedCount,
    awaitingFactorCount,
    flaggedCount,
  };
}

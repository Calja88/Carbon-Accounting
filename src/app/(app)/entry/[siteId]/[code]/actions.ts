"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createActivityEntryWithCalculations } from "@/lib/entries-service";
import { resolvePeriod } from "@/lib/period";

const schema = z.object({
  siteId: z.string().min(1),
  code: z.string().min(1),
  periodInput: z.string().min(1),
  rawValue: z.coerce.number().positive("Enter a value greater than zero."),
  rawUnit: z.string().min(1),
  factorOptionId: z.string().optional(),
  supplierName: z.string().optional(),
  notes: z.string().optional(),
});

export interface EntryFormState {
  error: string | null;
  success: boolean;
  flagged: boolean;
  flagReason: string | null;
  awaitingFactor: boolean;
}

export async function submitEntryAction(
  _prevState: EntryFormState,
  formData: FormData,
): Promise<EntryFormState> {
  const session = await auth();
  if (!session?.user) {
    return { error: "You must be signed in.", success: false, flagged: false, flagReason: null, awaitingFactor: false };
  }

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
      success: false,
      flagged: false,
      flagReason: null,
      awaitingFactor: false,
    };
  }
  const data = parsed.data;

  const dataPoint = await prisma.activityDataPoint.findUnique({ where: { code: data.code } });
  if (!dataPoint) {
    return { error: "Unknown data point.", success: false, flagged: false, flagReason: null, awaitingFactor: false };
  }

  const { periodStart, periodEnd } = resolvePeriod(dataPoint.frequency, data.periodInput);

  try {
    const { entry, calculations, plausibility } = await createActivityEntryWithCalculations({
      activityDataPointId: dataPoint.id,
      siteId: data.siteId,
      periodStart,
      periodEnd,
      rawValue: data.rawValue,
      rawUnit: data.rawUnit,
      factorOptionId: data.factorOptionId || null,
      supplierName: data.supplierName || null,
      enteredByUserId: session.user.id,
      notes: data.notes || undefined,
    });

    revalidatePath(`/entry/${data.siteId}`);
    revalidatePath("/");

    return {
      error: null,
      success: true,
      flagged: entry.status === "FLAGGED",
      flagReason: plausibility.reason,
      // entry.status here predates the calculation attempt (see
      // entries-service.runCalculationsForEntry) — an empty calculations
      // array on an otherwise-unflagged entry means it's now AWAITING_FACTOR.
      awaitingFactor: calculations.length === 0 && entry.status !== "FLAGGED",
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Something went wrong.",
      success: false,
      flagged: false,
      flagReason: null,
      awaitingFactor: false,
    };
  }
}

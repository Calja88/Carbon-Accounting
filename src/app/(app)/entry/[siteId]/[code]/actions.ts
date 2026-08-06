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
  notes: z.string().optional(),
});

export interface EntryFormState {
  error: string | null;
  success: boolean;
  flagged: boolean;
  flagReason: string | null;
}

export async function submitEntryAction(
  _prevState: EntryFormState,
  formData: FormData,
): Promise<EntryFormState> {
  const session = await auth();
  if (!session?.user) {
    return { error: "You must be signed in.", success: false, flagged: false, flagReason: null };
  }

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input.", success: false, flagged: false, flagReason: null };
  }
  const data = parsed.data;

  const dataPoint = await prisma.activityDataPoint.findUnique({ where: { code: data.code } });
  if (!dataPoint) {
    return { error: "Unknown data point.", success: false, flagged: false, flagReason: null };
  }

  const { periodStart, periodEnd } = resolvePeriod(dataPoint.frequency, data.periodInput);

  try {
    const { entry, plausibility } = await createActivityEntryWithCalculations({
      activityDataPointId: dataPoint.id,
      siteId: data.siteId,
      periodStart,
      periodEnd,
      rawValue: data.rawValue,
      rawUnit: data.rawUnit,
      factorOptionId: data.factorOptionId || null,
      enteredByUserId: session.user.id,
      notes: data.notes || undefined,
    });

    revalidatePath(`/entry/${data.siteId}`);
    revalidatePath("/");

    return { error: null, success: true, flagged: entry.status === "FLAGGED", flagReason: plausibility.reason };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong.", success: false, flagged: false, flagReason: null };
  }
}

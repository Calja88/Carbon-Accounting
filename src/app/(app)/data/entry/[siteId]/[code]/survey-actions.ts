"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createCommutingSurvey } from "@/lib/entries-service";
import { resolvePeriod } from "@/lib/period";

const schema = z.object({
  siteId: z.string().min(1),
  code: z.string().min(1),
  periodInput: z.string().min(1),
  headcount: z.coerce.number().int().positive("Enter the number of employees this survey represents."),
  commutingDaysInPeriod: z.coerce.number().int().positive("Enter how many commuting days this period covers."),
});

export interface SurveyFormState {
  error: string | null;
  success: boolean;
}

export async function submitSurveyAction(_prevState: SurveyFormState, formData: FormData): Promise<SurveyFormState> {
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in.", success: false };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input.", success: false };
  }
  const data = parsed.data;

  const dataPoint = await prisma.activityDataPoint.findUnique({
    where: { code: data.code },
    include: { factorOptions: true },
  });
  if (!dataPoint) return { error: "Unknown data point.", success: false };

  const { periodStart, periodEnd } = resolvePeriod(dataPoint.frequency, data.periodInput);

  const responses = dataPoint.factorOptions
    .map((option) => {
      const percent = Number(formData.get(`percent_${option.id}`) ?? 0);
      const distance = Number(formData.get(`distance_${option.id}`) ?? 0);
      return { factorOptionId: option.id, percentOfHeadcount: percent, avgOneWayDistanceMiles: distance };
    })
    .filter((r) => r.percentOfHeadcount > 0);

  if (responses.length === 0) {
    return { error: "Enter at least one commuting mode with a non-zero percentage.", success: false };
  }

  try {
    await createCommutingSurvey({
      siteId: data.siteId,
      periodStart,
      periodEnd,
      headcount: data.headcount,
      commutingDaysInPeriod: data.commutingDaysInPeriod,
      enteredByUserId: session.user.id,
      responses,
    });

    revalidatePath(`/data/entry/${data.siteId}`);
    revalidatePath("/");

    return { error: null, success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong.", success: false };
  }
}

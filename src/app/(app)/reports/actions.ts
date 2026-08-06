"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { buildReportPayload } from "@/lib/report-service";

const schema = z.object({
  periodStartMonth: z.string().min(1),
  periodEndMonth: z.string().min(1),
});

export interface GenerateReportState {
  error: string | null;
}

export async function generateReportAction(
  _prevState: GenerateReportState,
  formData: FormData,
): Promise<GenerateReportState> {
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Pick a start and end month." };

  const [startYear, startMonth] = parsed.data.periodStartMonth.split("-").map(Number);
  const [endYear, endMonth] = parsed.data.periodEndMonth.split("-").map(Number);

  const periodStart = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const periodEnd = new Date(Date.UTC(endYear, endMonth, 0)); // last day of end month

  if (periodEnd < periodStart) {
    return { error: "The end period must be after the start period." };
  }

  const payload = await buildReportPayload(periodStart, periodEnd);

  const snapshot = await prisma.reportSnapshot.create({
    data: {
      periodStart,
      periodEnd,
      generatedByUserId: session.user.id,
      payload: JSON.parse(JSON.stringify(payload)),
      calculationLinks: {
        create: payload.calculationIds.map((calculationId) => ({ calculationId })),
      },
    },
  });

  redirect(`/reports/${snapshot.id}`);
}

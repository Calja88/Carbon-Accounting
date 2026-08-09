"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/admin";
import { buildReportPayload, deleteReportSnapshot } from "@/lib/report-service";
import { deriveCategory3Calculations } from "@/lib/entries-service";

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

  let snapshotId: string;
  try {
    // Cat 3 (fuel/energy-related activities) is auto-calculated from Scope
    // 1/2 activity data — derive any newly-calculable rows for this period
    // before building the report (idempotent, see deriveCategory3Calculations).
    await deriveCategory3Calculations(periodStart, periodEnd);

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
    snapshotId = snapshot.id;
  } catch (err) {
    // redirect() (called outside this try block, never inside it) works by
    // throwing internally — a catch-all here must never intercept it, so
    // the redirect happens after this block, not within it.
    return {
      error:
        err instanceof Error
          ? `Could not generate the report: ${err.message}`
          : "Could not generate the report. Nothing was saved — try again, or contact an administrator if this keeps happening.",
    };
  }

  redirect(`/reports/${snapshotId}`);
}

/**
 * Deleting a report snapshot is an admin-only action — this platform's
 * whole premise is that a report is a permanent, reproducible record (see
 * the "Every report is a permanent, versioned snapshot" copy on /reports),
 * so removing one at all is treated the same way the codebase treats
 * emission-factor library administration: a deliberate, restricted action,
 * not a routine one available to anyone who can generate a report.
 */
export async function deleteReportSnapshotAction(formData: FormData): Promise<void> {
  const session = await requireAdminSession();
  if (!session) return;

  const id = String(formData.get("reportSnapshotId") ?? "");
  if (!id) return;

  await deleteReportSnapshot(id);

  revalidatePath("/reports");
  redirect("/reports");
}

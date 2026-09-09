"use server";

import { requireFrozenReportAccess } from "@/lib/rbac/carbon-access";
import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { buildReportPayload } from "@/lib/report-service";
import { deriveCategory3Calculations } from "@/lib/entries-service";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { requirePermission, PermissionDeniedError } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";

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
  let context;
  try {
    context = await requireOrganisationContext();
    requireFrozenReportAccess(context);
  } catch (err) {
    if (err instanceof PermissionDeniedError) return { error: "Report access denied." };
    if (err instanceof OrganisationAccessError) return { error: "You must be signed in." };
    throw err;
  }

  try {
    requirePermission(context, "carbon.report.generate");
  } catch {
    return { error: "You do not have permission to generate reports." };
  }

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Pick a start and end month." };

  const [startYear, startMonth] = parsed.data.periodStartMonth.split("-").map(Number);
  const [endYear, endMonth] = parsed.data.periodEndMonth.split("-").map(Number);

  const periodStart = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const periodEnd = new Date(Date.UTC(endYear, endMonth, 0)); // last day of end month

  if (periodEnd < periodStart) {
    return { error: "The end period must be after the start period." };
  }

  const tenantCtx = toTenantRepositoryContext(context);

  // Cat 3 (fuel/energy-related activities) is auto-calculated from Scope
  // 1/2 activity data — derive any newly-calculable rows for this period
  // before building the report (idempotent, see deriveCategory3Calculations).
  await deriveCategory3Calculations(tenantCtx, periodStart, periodEnd);

  const payload = await buildReportPayload(context, periodStart, periodEnd);

  const snapshot = await prisma.reportSnapshot.create({
    data: {
      organisationId: context.organisationId,
      periodStart,
      periodEnd,
      generatedByUserId: context.userId,
      payload: JSON.parse(JSON.stringify(payload)),
      calculationLinks: {
        create: payload.calculationIds.map((calculationId) => ({ calculationId })),
      },
    },
  });

  redirect(`/reports/${snapshot.id}`);
}

"use server";

import { requireFrozenReportAccess } from "@/lib/rbac/carbon-access";
import { z } from "zod";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { buildReportPayload } from "@/lib/report-service";
import { prepareReportingData } from "@/lib/entries-service";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { requirePermission, PermissionDeniedError } from "@/lib/rbac/authorize";
import { auditActorFor, toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

const schema = z.object({
  periodStartMonth: z.string().min(1),
  periodEndMonth: z.string().min(1),
});

function parsePeriod(formData: FormData): { periodStart: Date; periodEnd: Date } | { error: string } {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Pick a start and end month." };

  const [startYear, startMonth] = parsed.data.periodStartMonth.split("-").map(Number);
  const [endYear, endMonth] = parsed.data.periodEndMonth.split("-").map(Number);

  const periodStart = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const periodEnd = new Date(Date.UTC(endYear, endMonth, 0)); // last day of end month

  if (periodEnd < periodStart) return { error: "The end period must be after the start period." };
  return { periodStart, periodEnd };
}

export interface PrepareReportingDataState {
  error: string | null;
  result: { created: number; skippedNoFactor: number } | null;
}

/**
 * Explicit, separately-triggered preparation step (BD08/Checkpoint-A carried
 * forward): derives any newly-calculable Category 3 rows for the period.
 * Idempotent — safe to run more than once. Report generation itself never
 * calls this; it only reads whatever Category 3 rows already exist.
 */
export async function prepareReportingDataAction(
  _prevState: PrepareReportingDataState,
  formData: FormData,
): Promise<PrepareReportingDataState> {
  let context;
  try {
    context = await requireOrganisationContext();
    requireFrozenReportAccess(context);
  } catch (err) {
    if (err instanceof PermissionDeniedError) return { error: "Report access denied.", result: null };
    if (err instanceof OrganisationAccessError) return { error: "You must be signed in.", result: null };
    throw err;
  }

  const period = parsePeriod(formData);
  if ("error" in period) return { error: period.error, result: null };

  try {
    const result = await prepareReportingData(context, period.periodStart, period.periodEnd);
    return { error: null, result };
  } catch (err) {
    if (err instanceof PermissionDeniedError) return { error: "You do not have permission to prepare reporting data.", result: null };
    throw err;
  }
}

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

  const period = parsePeriod(formData);
  if ("error" in period) return { error: period.error };
  const { periodStart, periodEnd } = period;

  // Read-only with respect to calculation rows: Category 3 preparation is a
  // separate, explicit step (prepareReportingDataAction) — generating a
  // report never derives new calculations as a side effect.
  const payload = await buildReportPayload(context, periodStart, periodEnd);

  // Phase 4-i: the snapshot and its audit event commit together, so an
  // issued report can never exist without the event recording who issued
  // it and over what. The payload itself is not copied into the audit row
  // — the ReportSnapshot is already immutable and durable.
  const ctx = toTenantRepositoryContext(context);
  const snapshot = await prisma.$transaction(async (tx) => {
    const created = await tx.reportSnapshot.create({
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

    await recordAuditEvent(tx, ctx, {
      eventType: "report_snapshot.issued",
      resourceType: "report_snapshot",
      resourceId: created.id,
      summary: `Issued report snapshot v${created.version} for ${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}`,
      ...auditActorFor(ctx),
      correlationId: ctx.correlationId,
      after: {
        version: created.version,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        calculationCount: payload.calculationIds.length,
        scope1TotalKgCo2e: payload.scope1.totalKgCo2e,
        scope2LocationTotalKgCo2e: payload.scope2.locationBasedTotalKgCo2e,
        scope2MarketTotalKgCo2e: payload.scope2.marketBasedTotalKgCo2e,
        scope3TotalKgCo2e: payload.scope3.totalKgCo2e,
        excludedFlaggedCount: payload.excludedFlaggedEntries.length,
        awaitingFactorCount: payload.awaitingFactorEntries.length,
      },
    });

    return created;
  });

  redirect(`/reports/${snapshot.id}`);
}

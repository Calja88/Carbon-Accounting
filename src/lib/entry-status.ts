import { prisma } from "@/lib/prisma";
import { defaultPeriodInputValue, periodInputKindForFrequency, resolvePeriod } from "@/lib/period";
import { formatPeriodLabel } from "@/lib/prompts";
import { ActivityDataPoint } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requireSiteInScope, toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { tenantWhere } from "@/lib/repositories/tenant-scope";

export type QuantityEntryStatus = "submitted" | "flagged" | "missing" | "log" | "awaiting_factor";

export interface SiteDataPointStatus {
  dataPoint: ActivityDataPoint;
  status: QuantityEntryStatus;
  periodLabel: string;
}

export async function getSiteQuantityStatus(
  context: OrganisationContext,
  siteId: string,
): Promise<SiteDataPointStatus[]> {
  await requireSiteInScope(context, siteId);
  const ctx = toTenantRepositoryContext(context);

  const dataPoints = await prisma.activityDataPoint.findMany({
    where: { formType: { in: ["QUANTITY", "SURVEY"] } },
    orderBy: { sortOrder: "asc" },
  });

  const results: SiteDataPointStatus[] = [];

  for (const dp of dataPoints) {
    if (periodInputKindForFrequency(dp.frequency) === "date") {
      // "As occurs" — always actionable, no single current period to check.
      results.push({ dataPoint: dp, status: "log", periodLabel: "As occurs" });
      continue;
    }

    const inputValue = defaultPeriodInputValue(dp.frequency);
    const { periodStart } = resolvePeriod(dp.frequency, inputValue);

    let status: QuantityEntryStatus = "missing";

    if (dp.formType === "SURVEY") {
      const survey = await prisma.commutingSurvey.findFirst({ where: tenantWhere(ctx, { siteId, periodStart }) });
      if (survey) status = "submitted";
    } else {
      const entry = await prisma.activityEntry.findFirst({
        where: tenantWhere(ctx, { activityDataPointId: dp.id, siteId, periodStart }),
        orderBy: { enteredAt: "desc" },
      });
      if (entry) {
        status = entry.status === "FLAGGED" ? "flagged" : entry.status === "AWAITING_FACTOR" ? "awaiting_factor" : "submitted";
      }
    }

    results.push({
      dataPoint: dp,
      status,
      periodLabel: formatPeriodLabel(periodStart, dp.frequency),
    });
  }

  return results;
}

export async function getSiteContractStatus(context: OrganisationContext, siteId: string) {
  await requireSiteInScope(context, siteId);
  const ctx = toTenantRepositoryContext(context);

  const contract = await prisma.siteEnergyContract.findFirst({
    where: tenantWhere(ctx, { siteId, effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] }),
    orderBy: { effectiveFrom: "desc" },
  });
  return contract;
}

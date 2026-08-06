import { prisma } from "@/lib/prisma";
import { defaultPeriodInputValue, periodInputKindForFrequency, resolvePeriod } from "@/lib/period";
import { ActivityDataPoint } from "@prisma/client";

export type QuantityEntryStatus = "submitted" | "flagged" | "missing" | "log";

export interface SiteDataPointStatus {
  dataPoint: ActivityDataPoint;
  status: QuantityEntryStatus;
  periodLabel: string;
}

export async function getSiteQuantityStatus(siteId: string): Promise<SiteDataPointStatus[]> {
  const dataPoints = await prisma.activityDataPoint.findMany({
    where: { formType: "QUANTITY" },
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

    const entry = await prisma.activityEntry.findFirst({
      where: { activityDataPointId: dp.id, siteId, periodStart },
      orderBy: { enteredAt: "desc" },
    });

    let status: QuantityEntryStatus = "missing";
    if (entry) status = entry.status === "FLAGGED" ? "flagged" : "submitted";

    results.push({
      dataPoint: dp,
      status,
      periodLabel: periodStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    });
  }

  return results;
}

export async function getSiteContractStatus(siteId: string) {
  const contract = await prisma.siteEnergyContract.findFirst({
    where: { siteId, effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
    orderBy: { effectiveFrom: "desc" },
  });
  return contract;
}

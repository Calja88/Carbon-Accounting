/**
 * Deterministic data-quality, completeness and anomaly detection.
 *
 * All of this is computed from the database by ordinary code: missing
 * periods, entries held back for review, entries with no factor yet, the
 * data-quality tier mix, month-on-month movements, and sites missing the
 * contract information the Scope 2 market-based figure depends on.
 *
 * The AI layer never finds these. It is given the finished list and asked to
 * explain and prioritise it (see src/lib/ai/services/data-quality.ts), which
 * keeps every number and every count reproducible and auditable — and means
 * the whole feature still works when AI is switched off or unavailable.
 */

import { prisma } from "@/lib/prisma";
import { buildAnalyticsSnapshot } from "@/lib/analytics-service";

export type DataIssueKind = "MISSING_DATA" | "FLAGGED" | "AWAITING_FACTOR" | "DATA_QUALITY" | "ANOMALY" | "CONFIGURATION";
export type DataIssueSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH";

export interface DataIssue {
  kind: DataIssueKind;
  severity: DataIssueSeverity;
  title: string;
  detail: string;
  siteId: string | null;
  siteName: string | null;
  reference: string | null;
}

export interface DataQualityScan {
  periodStart: Date;
  periodEnd: Date;
  issues: DataIssue[];
  counts: Record<DataIssueKind, number>;
  tierMix: { tier: string; percent: number }[];
  totalKgCo2e: number;
}

/** Month-on-month movement worth mentioning. Below the 300% plausibility gate
 *  that blocks an entry — this is advisory, not a hold. */
const ANOMALY_THRESHOLD_PCT = 50;
/** Share of emissions on estimated (Tier 3) data that is worth flagging. */
const TIER3_CONCERN_PCT = 40;

function monthsBetween(start: Date, end: Date): { year: number; month: number; label: string; date: Date }[] {
  const out: { year: number; month: number; label: string; date: Date }[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    out.push({
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth(),
      label: cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
      date: new Date(cursor),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

export async function scanDataQuality(
  periodStart: Date,
  periodEnd: Date,
  allowedSiteIds: string[],
): Promise<DataQualityScan> {
  const issues: DataIssue[] = [];

  const [sites, monthlyDataPoints, entries, analytics] = await Promise.all([
    prisma.site.findMany({
      where: { isActive: true, id: { in: allowedSiteIds } },
      include: { entity: true },
      orderBy: { name: "asc" },
    }),
    prisma.activityDataPoint.findMany({
      where: { formType: "QUANTITY", frequency: { contains: "Month", mode: "insensitive" } },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.activityEntry.findMany({
      where: { siteId: { in: allowedSiteIds }, periodStart: { gte: periodStart, lte: periodEnd } },
      include: { activityDataPoint: true, site: true },
    }),
    buildAnalyticsSnapshot(periodStart, periodEnd),
  ]);

  const months = monthsBetween(periodStart, periodEnd);
  const present = new Set(
    entries.map((e) => `${e.siteId}|${e.activityDataPointId}|${e.periodStart.getUTCFullYear()}-${e.periodStart.getUTCMonth()}`),
  );

  // --- Missing monthly entries -------------------------------------------
  for (const site of sites) {
    for (const dp of monthlyDataPoints) {
      const missing = months.filter((m) => !present.has(`${site.id}|${dp.id}|${m.year}-${m.month}`));
      if (missing.length === 0) continue;
      issues.push({
        kind: "MISSING_DATA",
        severity: missing.length >= months.length ? "HIGH" : "MEDIUM",
        title: `${dp.dataPointName} not recorded at ${site.name}`,
        detail: `${missing.length} of ${months.length} month${months.length === 1 ? "" : "s"} in the period have no entry: ${missing.map((m) => m.label).join(", ")}.`,
        siteId: site.id,
        siteName: site.name,
        reference: dp.code,
      });
    }
  }

  // --- Held back or uncalculated -----------------------------------------
  for (const entry of entries) {
    if (entry.status === "FLAGGED") {
      issues.push({
        kind: "FLAGGED",
        severity: "HIGH",
        title: `${entry.activityDataPoint.dataPointName} flagged for review at ${entry.site.name}`,
        detail: `${entry.plausibilityReason ?? "Flagged on entry."} This entry is excluded from report totals until someone resolves it.`,
        siteId: entry.siteId,
        siteName: entry.site.name,
        reference: entry.id,
      });
    }
    if (entry.status === "AWAITING_FACTOR") {
      issues.push({
        kind: "AWAITING_FACTOR",
        severity: "MEDIUM",
        title: `${entry.activityDataPoint.dataPointName} has no emission factor yet at ${entry.site.name}`,
        detail:
          "The activity data is recorded but no matching emission factor has been imported, so it contributes nothing to the totals. Import a factor set covering this category to bring it in.",
        siteId: entry.siteId,
        siteName: entry.site.name,
        reference: entry.id,
      });
    }
  }

  // --- Tier mix -----------------------------------------------------------
  const tier3 = analytics.dataQuality.find((d) => d.tier === "TIER_3");
  if (tier3 && tier3.percent > TIER3_CONCERN_PCT) {
    issues.push({
      kind: "DATA_QUALITY",
      severity: "MEDIUM",
      title: "A large share of emissions rests on estimated data",
      detail: `${tier3.percent.toFixed(1)}% of calculated emissions this period come from Tier 3 (estimated or extrapolated) data. Moving the largest of those to metered or invoiced sources would improve the inventory most.`,
      siteId: null,
      siteName: null,
      reference: null,
    });
  }

  // --- Month-on-month movement -------------------------------------------
  for (let i = 1; i < analytics.monthly.length; i++) {
    const prev = analytics.monthly[i - 1];
    const curr = analytics.monthly[i];
    if (prev.total <= 0) continue;
    const change = ((curr.total - prev.total) / prev.total) * 100;
    if (Math.abs(change) < ANOMALY_THRESHOLD_PCT) continue;
    issues.push({
      kind: "ANOMALY",
      severity: Math.abs(change) >= 100 ? "MEDIUM" : "LOW",
      title: `Group emissions moved ${change > 0 ? "up" : "down"} ${Math.abs(change).toFixed(0)}% in ${curr.label}`,
      detail: `${prev.label}: ${(prev.total / 1000).toFixed(2)} tCO2e → ${curr.label}: ${(curr.total / 1000).toFixed(2)} tCO2e. Worth checking whether that reflects real activity, a billing period that shifted, or missing data.`,
      siteId: null,
      siteName: null,
      reference: curr.month,
    });
  }

  // --- Configuration gaps -------------------------------------------------
  const contracts = await prisma.siteEnergyContract.findMany({
    where: {
      siteId: { in: allowedSiteIds },
      effectiveFrom: { lte: periodEnd },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }],
    },
    select: { siteId: true },
  });
  const sitesWithContract = new Set(contracts.map((c) => c.siteId));
  for (const site of sites) {
    if (sitesWithContract.has(site.id)) continue;
    issues.push({
      kind: "CONFIGURATION",
      severity: "MEDIUM",
      title: `No electricity supplier or tariff recorded for ${site.name}`,
      detail:
        "Without contract and REGO information the market-based Scope 2 figure falls back to the residual mix, which will understate any renewable electricity the site actually buys.",
      siteId: site.id,
      siteName: site.name,
      reference: "S2-02",
    });
  }

  const counts: Record<DataIssueKind, number> = {
    MISSING_DATA: 0,
    FLAGGED: 0,
    AWAITING_FACTOR: 0,
    DATA_QUALITY: 0,
    ANOMALY: 0,
    CONFIGURATION: 0,
  };
  for (const issue of issues) counts[issue.kind]++;

  const severityRank: Record<DataIssueSeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 };
  issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  return {
    periodStart,
    periodEnd,
    issues,
    counts,
    tierMix: analytics.dataQuality.map((d) => ({ tier: d.tier, percent: d.percent })),
    totalKgCo2e: analytics.group.total,
  };
}

/** Compact rendering for use as AI context. */
export function formatScanForPrompt(scan: DataQualityScan): string {
  const lines = [
    `Total calculated emissions in period: ${(scan.totalKgCo2e / 1000).toFixed(2)} tCO2e.`,
    `Data quality mix: ${scan.tierMix.map((t) => `${t.tier} ${t.percent.toFixed(1)}%`).join(", ")}.`,
    `Issue counts: ${Object.entries(scan.counts).map(([k, v]) => `${k}=${v}`).join(", ")}.`,
    "",
    "ISSUES FOUND BY THIS PLATFORM'S OWN CHECKS (deterministic — you did not find these and must not add to them):",
  ];
  for (const issue of scan.issues.slice(0, 60)) {
    lines.push(`- [${issue.severity}] [${issue.kind}] ${issue.title}${issue.siteName ? ` (site: ${issue.siteName})` : ""}: ${issue.detail}`);
  }
  return lines.join("\n");
}

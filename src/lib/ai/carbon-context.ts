/**
 * Context assembly for the carbon assistant.
 *
 * Everything here is a *deliberate* retrieval: a bounded set of figures the
 * deterministic aggregation layer already produced, plus catalogue metadata,
 * filtered to the actor's authorized scope. The database is never dumped into
 * a prompt — partly for cost and quality, mostly because a prompt is the
 * worst possible place to put data nobody checked the caller could see.
 *
 * Every number in the returned text came from `analytics-service.ts`, the
 * same module the dashboard and the report use. The model is given figures to
 * talk about; it is never asked to produce one.
 */

import { prisma } from "@/lib/prisma";
import { buildAnalyticsSnapshot } from "@/lib/analytics-service";
import { formatRangeLabel } from "@/lib/report-period";
import { AiActor } from "./authorization";
import type { OrganisationContext } from "@/lib/organisation/context";

function t(kg: number): string {
  return `${(kg / 1000).toFixed(2)} tCO2e`;
}

function pct(value: number | null): string {
  if (value === null) return "no prior-year figure";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}% vs the same period last year`;
}

export type DataCompletenessStatus = "NO_DATA" | "PARTIAL_DATA" | "COMPLETE";

export interface DataCompleteness {
  status: DataCompletenessStatus;
  currentEntryCount: number;
  previousEntryCount: number;
  /** The line put in front of the model — deliberately the only place this policy lives. */
  note: string;
}

/**
 * Distinguishes a true zero from missing or partial current-period data,
 * from activity-entry counts alone — never from the calculated emissions
 * total, which is exactly what a period with no data and a period with
 * genuinely zero emissions have in common. Pure and DB-free so the policy
 * (what counts as "far fewer entries") is unit-testable on its own.
 */
export function assessDataCompleteness(currentEntryCount: number, previousEntryCount: number): DataCompleteness {
  if (currentEntryCount === 0) {
    return {
      status: "NO_DATA",
      currentEntryCount,
      previousEntryCount,
      note: "DATA STATUS: NO_DATA. Zero activity entries exist for the current period. Any 0.00 tCO2e total shown for it is an absence of data, not a measured or confirmed zero, and must never be described as an emissions reduction — say plainly that no activity has been recorded yet.",
    };
  }
  if (previousEntryCount > 0 && currentEntryCount < previousEntryCount * 0.5) {
    return {
      status: "PARTIAL_DATA",
      currentEntryCount,
      previousEntryCount,
      note: `DATA STATUS: PARTIAL_DATA. The current period has far fewer recorded entries (${currentEntryCount}) than the comparison period (${previousEntryCount}). Treat any decrease as unconfirmed and say the current period may still be incomplete, rather than presenting the change as a genuine reduction.`,
    };
  }
  return {
    status: "COMPLETE",
    currentEntryCount,
    previousEntryCount,
    note: "DATA STATUS: entry counts for the two periods are broadly comparable.",
  };
}

export interface CarbonContextOptions {
  periodStart: Date;
  periodEnd: Date;
  /** Narrow to one site when the question is about a specific site. */
  siteId?: string | null;
  includeCatalogue?: boolean;
}

export interface CarbonContext {
  text: string;
  /** Ids the answer may legitimately refer to — used to check the reply didn't drift. */
  referencedSiteIds: string[];
  periodLabel: string;
}

/**
 * Builds the "OUR DATA" block. Returns plain text rather than JSON because
 * it is read by a model, and labelled prose survives truncation far better
 * than a nested object does.
 */
export async function buildCarbonContext(
  organisation: OrganisationContext,
  actor: AiActor,
  options: CarbonContextOptions,
): Promise<CarbonContext> {
  // buildAnalyticsSnapshot (T16) requires an OrganisationContext to scope its
  // queries, resolved by the caller and passed straight through so this
  // module stays free of session/auth imports. `actor` (T18) is itself
  // already resolved within that same Organisation — see authorization.ts —
  // so the siteIds filtering below is tenant-safe as well as scope-safe.
  const analytics = await buildAnalyticsSnapshot(organisation, options.periodStart, options.periodEnd);
  const periodLabel = formatRangeLabel(options.periodStart, options.periodEnd);

  // Authorization filter — applied to the aggregation output, never left to
  // the model to respect.
  const allowedSiteIds = new Set(
    options.siteId ? [options.siteId].filter((id) => actor.siteIds.includes(id)) : actor.siteIds,
  );
  const sites = analytics.sites.filter((s) => allowedSiteIds.has(s.siteId));

  const lines: string[] = [];

  lines.push(`Reporting period: ${periodLabel}. Comparison period: ${formatRangeLabel(analytics.previousPeriodStart, analytics.previousPeriodEnd)}.`);
  lines.push("");
  lines.push("GROUP TOTALS (calculated by this platform's deterministic engine):");
  lines.push(`- Total (Scope 1 + Scope 2 location-based + Scope 3): ${t(analytics.group.total)} (${pct(analytics.groupDelta.deltaPercent)})`);
  lines.push(`- Scope 1 (direct): ${t(analytics.group.scope1)} (${pct(analytics.scopeDeltas[0].delta.deltaPercent)})`);
  lines.push(`- Scope 2 location-based: ${t(analytics.group.scope2Location)} (${pct(analytics.scopeDeltas[1].delta.deltaPercent)})`);
  lines.push(`- Scope 2 market-based: ${t(analytics.group.scope2Market)} — reported alongside, never added into the total.`);
  lines.push(`- Scope 3: ${t(analytics.group.scope3)} (${pct(analytics.scopeDeltas[2].delta.deltaPercent)})`);

  if (analytics.byCategory.length > 0) {
    lines.push("");
    lines.push("BY CATEGORY (largest first):");
    for (const c of analytics.byCategory.slice(0, 12)) {
      const share = analytics.group.total > 0 ? ((c.kgCo2e / analytics.group.total) * 100).toFixed(1) : "0.0";
      lines.push(`- ${c.label}: ${t(c.kgCo2e)} (${share}% of total)`);
    }
  }

  if (sites.length > 0) {
    lines.push("");
    lines.push("BY SITE:");
    for (const s of sites) {
      lines.push(
        `- ${s.siteName} (${s.entityName}) [siteId=${s.siteId}]: total ${t(s.totals.total)}; Scope 1 ${t(s.totals.scope1)}; Scope 2 location ${t(s.totals.scope2Location)}; Scope 3 ${t(s.totals.scope3)}`,
      );
    }
  }

  lines.push("");
  lines.push("MONTHLY PROFILE (total, tCO2e):");
  lines.push(analytics.monthly.map((m) => `${m.label}=${(m.total / 1000).toFixed(2)}`).join(", "));

  lines.push("");
  lines.push("DATA QUALITY MIX (share of calculated emissions by tier):");
  for (const dq of analytics.dataQuality) {
    lines.push(`- ${dq.tier}: ${dq.percent.toFixed(1)}% (${t(dq.kgCo2e)})`);
  }

  // Activity entry *counts* — independent of whether those entries produced
  // a calculated figure — so the model can tell a true zero apart from an
  // empty or partially-entered period. Scoped to the same authorized sites
  // as everything else above.
  const allowedSiteIdList = Array.from(allowedSiteIds);
  const [currentEntryCount, previousEntryCount] = await Promise.all([
    prisma.activityEntry.count({
      where: { siteId: { in: allowedSiteIdList }, periodStart: { gte: options.periodStart, lte: options.periodEnd } },
    }),
    prisma.activityEntry.count({
      where: {
        siteId: { in: allowedSiteIdList },
        periodStart: { gte: analytics.previousPeriodStart, lte: analytics.previousPeriodEnd },
      },
    }),
  ]);

  const completeness = assessDataCompleteness(currentEntryCount, previousEntryCount);

  lines.push("");
  lines.push("COMPLETENESS:");
  lines.push(`- Entries flagged for review and excluded from totals: ${analytics.flaggedCount}`);
  lines.push(`- Entries captured but awaiting an emission factor (not in any total): ${analytics.awaitingFactorCount}`);
  lines.push(`- Activity entries recorded for the current period: ${currentEntryCount}`);
  lines.push(`- Activity entries recorded for the comparison period: ${previousEntryCount}`);
  if (!analytics.hasAnyData) {
    lines.push("- No calculated emissions exist in this period at all.");
  }
  lines.push(`- ${completeness.note}`);

  const factorSets = await prisma.emissionFactorSet.findMany({
    where: {
      effectiveFrom: { lte: options.periodEnd },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: options.periodStart } }],
      // Phase 1 tenancy (T18): platform sets plus this organisation's own —
      // never another tenant's supplier-specific/customer-created set.
      AND: [{ OR: [{ visibility: "PLATFORM" }, { visibility: "ORGANISATION", ownerOrganisationId: organisation.organisationId }] }],
    },
    select: { name: true, publisher: true, sourceType: true, vintageYear: true, isPlaceholder: true, sourceUrl: true },
    orderBy: { effectiveFrom: "desc" },
    take: 8,
  });
  if (factorSets.length > 0) {
    lines.push("");
    lines.push("EMISSION FACTOR SETS IN EFFECT FOR THIS PERIOD:");
    for (const fs of factorSets) {
      lines.push(
        `- ${fs.name} — ${fs.publisher}, ${fs.sourceType}, vintage ${fs.vintageYear}${fs.isPlaceholder ? " (PLACEHOLDER — not verified)" : ""}${fs.sourceUrl ? `, source: ${fs.sourceUrl}` : ""}`,
      );
    }
  }

  if (options.includeCatalogue) {
    const dataPoints = await prisma.activityDataPoint.findMany({
      orderBy: { sortOrder: "asc" },
      select: { code: true, scope: true, category: true, dataPointName: true, unitOptions: true, scope3Category: true },
    });
    lines.push("");
    lines.push("ACTIVITY DATA POINTS THIS PLATFORM COLLECTS (code — name — scope — units):");
    for (const dp of dataPoints) {
      lines.push(
        `- ${dp.code} — ${dp.dataPointName} — ${dp.scope}${dp.scope3Category ? ` (${dp.scope3Category})` : ""} — units: ${dp.unitOptions.join("/") || "n/a"}`,
      );
    }
  }

  return {
    text: lines.join("\n"),
    referencedSiteIds: sites.map((s) => s.siteId),
    periodLabel,
  };
}

/**
 * Compact context for classification and factor-mapping: what the platform
 * can actually record, so a suggestion points at a real data point rather
 * than a category invented on the spot.
 */
export async function buildCatalogueContext(): Promise<string> {
  const dataPoints = await prisma.activityDataPoint.findMany({
    orderBy: { sortOrder: "asc" },
    include: { factorOptions: { orderBy: { sortOrder: "asc" } } },
  });

  const lines = ["ACTIVITY DATA POINTS AND THEIR TYPE OPTIONS (the only codes and subtype keys you may suggest):"];
  for (const dp of dataPoints) {
    lines.push(
      `- ${dp.code} | ${dp.dataPointName} | ${dp.scope}${dp.scope3Category ? ` | ${dp.scope3Category}` : ""} | category=${dp.factorCategory} | units=${dp.unitOptions.join("/") || "per-option"}`,
    );
    for (const opt of dp.factorOptions) {
      lines.push(`    · subtypeKey=${opt.subtypeKey} — ${opt.label}${opt.unit ? ` (unit: ${opt.unit})` : ""}`);
    }
  }
  return lines.join("\n");
}

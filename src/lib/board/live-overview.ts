import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requireOrganisationContext } from "@/lib/organisation/session";
import { requireCarbonView } from "@/lib/rbac/carbon-access";
import { hasPermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext, requireSiteInScope } from "@/lib/repositories/carbon-repository";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { buildAnalyticsSnapshot, type AnalyticsSnapshot } from "@/lib/analytics-service";
import { monthInputValue, formatRangeLabel } from "@/lib/report-period";
import { listOverdueOrUnevaluatedObligations } from "@/lib/ems/legal/evaluation-service";
import { boardPeriodSchema } from "./schemas";
import { loadOverview, type OverviewPorts, type BoardScope } from "./overview-service";
import { buildCarbonSection, type AuthorizedAnalyticsWindow, type WindowCoverage } from "./carbon-adapter";
import { actionAttention, actionCounts, mergeAttention } from "./attention";
import type { OverviewModel, AttentionItem, Coverage } from "./contracts";
import {
  unknownCoverage, carbonGapAttention, mapCanonicalActionRows, monthKeyOf, monthKeysInRange, priorYear, monthStringToDate,
} from "./live-overview-helpers";

/**
 * BD05 live wiring for INTEGRATION/LIVE_BINDINGS.md §2-3. This is the one
 * file in the board/product sprint that reads real domain state and feeds
 * it into the Astra-supplied pure adapters (overview-service.ts,
 * carbon-adapter.ts, attention.ts) — those files never query Prisma
 * themselves, so every authorization/scoping decision below is this
 * module's responsibility, not theirs.
 *
 * Deliberately no caching: this is a small board-demo tenant
 * (INTEGRATION/LIVE_BINDINGS.md §2.7), and every read is fresh per request
 * and already scoped to the caller's own OrganisationContext.
 *
 * Genuine compatibility deviation from INTEGRATION/LIVE_BINDINGS.md §2's
 * `import "server-only"` instruction: that package is not a dependency of
 * this repository (not in package.json/lockfile/node_modules) and breaks
 * Vitest module resolution — the identical, already-documented BD04 finding
 * for live-nav.ts (see Docs/board-sprint/CONTINUITY.md). Safe to omit for
 * the same reason: this module only calls other server-only modules
 * (`@/lib/prisma`, `@/lib/organisation/session`) and is only ever imported
 * from a server component (`(app)/page.tsx`, `(app)/attention/page.tsx`),
 * never from client code.
 */

export interface OverviewSearchParams {
  from?: string;
  to?: string;
  siteId?: string;
}

/**
 * Real Coverage derived from ActivityEntry rows actually submitted for the
 * window — never a fabricated "expected" denominator. There is no live
 * expected-submission-obligation model for Carbon yet (confirmed by
 * inspection: no such service exists anywhere in src/lib), so `expected`
 * stays `null` (unknown) at every level rather than inventing one — the
 * adapter's own `assertCoverageWindow` explicitly allows a uniformly-null
 * `expected` and skips its reconciliation check in that case. `received`,
 * `reviewed`, `excluded`, `awaitingFactor` and `flagged` are all real
 * counts, bucketed by the same periodStart-derived month key convention
 * `analytics-service.ts`'s own `buildMonthly` already uses, so site+month
 * coverage always reconciles with the group total by construction (every
 * row is counted in exactly one site bucket and one month bucket).
 */
async function computeCoverageWindow(
  context: OrganisationContext,
  siteIds: readonly string[],
  periodStart: Date,
  periodEnd: Date,
): Promise<WindowCoverage> {
  const ctx = toTenantRepositoryContext(context);
  const months = monthKeysInRange(periodStart, periodEnd);
  const siteCoverage: Record<string, Coverage> = Object.fromEntries(siteIds.map((id) => [id, unknownCoverage()]));
  const monthCoverage: Record<string, Coverage> = Object.fromEntries(months.map((m) => [m, unknownCoverage()]));
  const group = unknownCoverage();

  if (siteIds.length > 0) {
    const rows = await prisma.activityEntry.findMany({
      where: tenantWhere(ctx, { siteId: { in: [...siteIds] }, periodStart: { gte: periodStart, lte: periodEnd } }),
      select: { siteId: true, periodStart: true, status: true },
    });
    for (const row of rows) {
      const monthKey = monthKeyOf(row.periodStart);
      const site = siteCoverage[row.siteId];
      const month = monthCoverage[monthKey];
      if (!site || !month) continue; // outside the requested site/month set — never happens given the query's own filters, but fail closed rather than miscount
      for (const bucket of [site, month, group]) {
        bucket.received += 1;
        if (row.status === "APPROVED") bucket.reviewed += 1;
        else if (row.status === "REJECTED") bucket.excluded += 1;
        else if (row.status === "AWAITING_FACTOR") bucket.awaitingFactor += 1;
        else if (row.status === "FLAGGED") bucket.flagged += 1;
      }
    }
  }
  return { group, sites: siteCoverage, months: monthCoverage };
}

function toAnalyticsWindow(snapshot: AnalyticsSnapshot): AuthorizedAnalyticsWindow {
  return {
    group: snapshot.group,
    sites: snapshot.sites.map((s) => ({ siteId: s.siteId, siteName: s.siteName, entityName: s.entityName, totals: s.totals })),
    monthly: snapshot.monthly.map((m) => ({ month: m.month, label: m.label, total: m.total })),
  };
}

/** Real Scope 3 category coverage from the emission-factor/data-point catalogue and this period's own calculations — never a fixture constant. */
async function computeScope3CategoryCoverage(
  context: OrganisationContext,
  siteIds: readonly string[],
  periodStart: Date,
  periodEnd: Date,
): Promise<{ quantifiedCategories: number; screenedCategories: number }> {
  const screened = await prisma.activityDataPoint.findMany({
    where: { scope: "SCOPE_3" },
    select: { category: true },
    distinct: ["category"],
  });
  if (siteIds.length === 0) return { quantifiedCategories: 0, screenedCategories: screened.length };
  const ctx = toTenantRepositoryContext(context);
  const quantified = await prisma.calculation.findMany({
    where: tenantWhere<Prisma.CalculationWhereInput>(ctx, {
      scope: "SCOPE_3",
      resultKgCo2e: { gt: 0 },
      activityEntry: { is: { siteId: { in: [...siteIds] }, periodStart: { gte: periodStart, lte: periodEnd } } },
    }),
    select: { activityEntry: { select: { activityDataPoint: { select: { category: true } } } } },
    distinct: ["activityEntryId"],
  });
  const categories = new Set(quantified.map((c) => c.activityEntry.activityDataPoint.category));
  return { quantifiedCategories: categories.size, screenedCategories: screened.length };
}

/** True only when a real Scope 2 market-based/residual-mix companion calculation exists for this window — never assumed available. */
async function computeMarketBasedAvailable(
  context: OrganisationContext,
  siteIds: readonly string[],
  periodStart: Date,
  periodEnd: Date,
): Promise<boolean> {
  if (siteIds.length === 0) return false;
  const ctx = toTenantRepositoryContext(context);
  const count = await prisma.calculation.count({
    where: tenantWhere<Prisma.CalculationWhereInput>(ctx, {
      scope: "SCOPE_2",
      basis: { in: ["MARKET_BASED", "RESIDUAL_MIX"] },
      activityEntry: { is: { siteId: { in: [...siteIds] }, periodStart: { gte: periodStart, lte: periodEnd } } },
    }),
  });
  return count > 0;
}

function obligationAttention(rows: Awaited<ReturnType<typeof listOverdueOrUnevaluatedObligations>>): AttentionItem[] {
  return rows.map((o) => ({
    key: `obligation:${o.obligationId}:evaluation:${o.version}`,
    source: { kind: "obligation", id: o.obligationVersionId, revision: String(o.version), label: "Open evaluation", href: "/ems/legal/evaluations" },
    title: o.title, implication: o.neverEvaluated ? "This obligation has never been evaluated." : "This obligation's evaluation is overdue for review.",
    reason: o.neverEvaluated ? "review" : "overdue", owner: "Compliance", site: "Organisation-wide",
    dueDate: o.reviewDueDate ? o.reviewDueDate.toISOString().slice(0, 10) : null, nextAction: "Evaluate obligation", priority: o.neverEvaluated ? 4 : 1,
  }));
}

/** Nonconformities genuinely awaiting an independent effectiveness decision — distinct from the linked corrective-action work itself. */
async function effectivenessReviewAttention(context: OrganisationContext): Promise<AttentionItem[]> {
  const ctx = toTenantRepositoryContext(context);
  const rows = await prisma.nonconformity.findMany({
    where: tenantWhere<Prisma.NonconformityWhereInput>(ctx, { status: "EFFECTIVENESS_REVIEW" }),
    select: { id: true, reference: true, statement: true, updatedAt: true, ownerMembershipId: true },
  });
  return rows.map((nc) => ({
    key: `nc:${nc.id}:review`, source: { kind: "nonconformity", id: nc.id, revision: nc.updatedAt.toISOString(), label: "Open nonconformity", href: `/ems/nonconformities/${nc.id}` },
    title: `${nc.reference} — independent effectiveness review due`, implication: "A completed corrective action is awaiting an independent effectiveness decision.",
    reason: "review", owner: "Reviewer", site: "Organisation-wide", dueDate: null, nextAction: "Perform review", priority: 1,
  }));
}

/** Canonical open/awaiting-verification work, deduped once here (never twice — an ActionItem shared by a CorrectiveAction is one row, not two). */
async function correctiveActionAndActionItemAttention(context: OrganisationContext, asOfDate: string): Promise<{ items: AttentionItem[]; counts: { open: number; awaitingVerification: number } }> {
  const ctx = toTenantRepositoryContext(context);
  const [actionItems, correctiveActions] = await Promise.all([
    prisma.actionItem.findMany({
      where: tenantWhere(ctx, {}),
      select: { id: true, title: true, status: true, dueDate: true, owner: { select: { user: { select: { name: true } } } }, programme: { select: { title: true } } },
    }),
    prisma.correctiveAction.findMany({
      where: tenantWhere(ctx, {}),
      select: { id: true, description: true, status: true, dueDate: true, sharedActionItemId: true, nonconformityId: true, owner: { select: { user: { select: { name: true } } } } },
    }),
  ]);
  const rows = mapCanonicalActionRows(actionItems, correctiveActions);
  return { items: actionAttention(rows, asOfDate), counts: actionCounts(rows) };
}

function resolveScopeParams(raw: OverviewSearchParams): { from: string; to: string; siteId?: string } {
  if (!raw.from && !raw.to && !raw.siteId) {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return { from: monthInputValue(start), to: monthInputValue(now) };
  }
  // A partial or malformed selection is never silently replaced by today's/default period — surfaced as a rejected scope instead (see authorizeScope).
  return boardPeriodSchema.parse(raw);
}

class InvalidBoardScopeError extends Error {}

async function authorizeScope(context: OrganisationContext, scope: BoardScope): Promise<void> {
  requireCarbonView(context); // fails before any read — a denial never becomes empty success
  if (scope.organisationId !== context.organisationId) throw new InvalidBoardScopeError("Organisation mismatch");
}

async function header(context: OrganisationContext, scope: BoardScope): ReturnType<OverviewPorts<OrganisationContext>["header"]> {
  const organisation = await prisma.organisation.findUnique({ where: { id: context.organisationId }, select: { name: true } });
  const periodStart = monthStringToDate(scope.from, false), periodEnd = monthStringToDate(scope.to, true);
  const prior = priorYear(periodStart, periodEnd);
  return {
    organisationName: organisation?.name ?? context.organisationSlug,
    periodLabel: formatRangeLabel(periodStart, periodEnd),
    previousPeriodLabel: formatRangeLabel(prior.periodStart, prior.periodEnd),
    synthetic: false, // BD02's guarded-environment identity is not wired to a real disposable database in any environment this branch has run in yet — see Docs/board-sprint/CONTINUITY.md
    managementPack: null, // /management-packs is BD08-owned and does not exist on this branch yet — no dead link is ever shown
  };
}

async function carbon(context: OrganisationContext, scope: BoardScope): ReturnType<OverviewPorts<OrganisationContext>["carbon"]> {
  const periodStart = monthStringToDate(scope.from, false), periodEnd = monthStringToDate(scope.to, true);
  const prior = priorYear(periodStart, periodEnd);
  // A single explicitly-selected site must actually narrow every dataset
  // below it, not just the hrefs buildCarbonSection stamps onto each metric
  // — buildCarbonSection itself is a pure adapter that sums whatever site
  // rows it's handed, so the narrowing has to happen at query time, here.
  // getBoardOverview already ran requireSiteInScope on this id, so it can
  // never widen past the caller's own accessible-site set.
  const restrictToSiteIds = scope.siteIds.length === 1 ? scope.siteIds : undefined;
  const [currentSnapshot, previousSnapshot] = await Promise.all([
    buildAnalyticsSnapshot(context, periodStart, periodEnd, restrictToSiteIds),
    buildAnalyticsSnapshot(context, prior.periodStart, prior.periodEnd, restrictToSiteIds),
  ]);
  const current = toAnalyticsWindow(currentSnapshot), previous = toAnalyticsWindow(previousSnapshot);
  const permittedSiteIds = current.sites.map((s) => s.siteId);
  const previousSiteIds = previous.sites.map((s) => s.siteId);
  const [currentCoverage, previousCoverage, scope3, marketBasedAvailable] = await Promise.all([
    computeCoverageWindow(context, permittedSiteIds, periodStart, periodEnd),
    computeCoverageWindow(context, previousSiteIds, prior.periodStart, prior.periodEnd),
    computeScope3CategoryCoverage(context, permittedSiteIds, periodStart, periodEnd),
    computeMarketBasedAvailable(context, permittedSiteIds, periodStart, periodEnd),
  ]);
  // Boundary/method are the same accessible-site set and the same location-based methodology in both periods for this sprint — a stable key that only
  // changes if the caller's effective site scope itself changes (a genuinely different boundary), never fabricated per period.
  const comparisonKey = `${context.organisationId}:${[...permittedSiteIds].sort().join(",")}:LB`;
  return buildCarbonSection({
    current, previous, currentCoverage, previousCoverage,
    from: scope.from, to: scope.to, previousFrom: monthInputValue(prior.periodStart), previousTo: monthInputValue(prior.periodEnd),
    permittedSiteIds, selectedSiteId: scope.siteIds.length === 1 ? scope.siteIds[0] : undefined,
    currentComparisonKey: comparisonKey, previousComparisonKey: comparisonKey,
    quantifiedCategories: scope3.quantifiedCategories, screenedCategories: scope3.screenedCategories, asOf: new Date().toISOString(),
    marketBasedAvailable,
  });
}

async function attention(context: OrganisationContext, scope: BoardScope): ReturnType<OverviewPorts<OrganisationContext>["attention"]> {
  const periodStart = monthStringToDate(scope.from, false), periodEnd = monthStringToDate(scope.to, true);
  const restrictToSiteIds = scope.siteIds.length === 1 ? scope.siteIds : undefined;
  // Nonconformity/ActionItem/CorrectiveAction/ComplianceObligation carry no
  // site or entity attribution in the schema, so there is no truthful way
  // to narrow them to a RESTRICTED member's site/entity allow-list — per
  // Astra's instruction, when that support isn't safe the section is
  // denied rather than shown organisation-wide. An ORGANISATION_WIDE
  // member's standing access already covers the whole organisation, so
  // their view is unaffected.
  const emsAttentionAllowed = context.access.mode === "ORGANISATION_WIDE";
  const [analyticsWindow, coverage, obligations, effectivenessItems, actionResult] = await Promise.all([
    buildAnalyticsSnapshot(context, periodStart, periodEnd, restrictToSiteIds).then(toAnalyticsWindow),
    computeCoverageWindow(context, [], periodStart, periodEnd), // recomputed below once sites are known
    emsAttentionAllowed && hasPermission(context, "ems.view") ? listOverdueOrUnevaluatedObligations(context) : Promise.resolve([]),
    emsAttentionAllowed && hasPermission(context, "ems.view") ? effectivenessReviewAttention(context) : Promise.resolve([]),
    emsAttentionAllowed && (hasPermission(context, "ems.corrective_action.manage") || hasPermission(context, "ems.view"))
      ? correctiveActionAndActionItemAttention(context, scope.asOfDate)
      : Promise.resolve({ items: [], counts: { open: 0, awaitingVerification: 0 } }),
  ]);
  const permittedSiteIds = analyticsWindow.sites.map((s) => s.siteId);
  const realCoverage = permittedSiteIds.length > 0 ? await computeCoverageWindow(context, permittedSiteIds, periodStart, periodEnd) : coverage;
  const groups: AttentionItem[][] = [
    carbonGapAttention(realCoverage, analyticsWindow.sites),
    obligationAttention(obligations),
    effectivenessItems,
    actionResult.items,
  ];
  const items = mergeAttention(groups);
  return {
    state: "ready", asOf: new Date().toISOString(),
    data: { items, total: items.length, openActions: actionResult.counts.open, awaitingVerification: actionResult.counts.awaitingVerification },
  };
}

async function priorities(context: OrganisationContext, scope: BoardScope): ReturnType<OverviewPorts<OrganisationContext>["priorities"]> {
  // Deliberately derived from the same authorized attention read rather than a second query set — a genuine top-3 summary, never fabricated copy.
  const result = await attention(context, scope);
  if (result.state === "unavailable") return result;
  return {
    state: "ready", asOf: result.asOf,
    data: result.data.items.slice(0, 3).map((item) => ({
      title: item.title, detail: item.implication,
      tone: item.reason === "overdue" || item.reason === "blocked" ? "danger" : item.reason === "missing" ? "warning" : "info",
      source: { label: item.nextAction, href: item.source.href },
    })),
  };
}

const ports: OverviewPorts<OrganisationContext> = {
  authorizeScope, header, carbon, attention, priorities,
  sectionFailure(section) {
    // Safe operational metadata only — never the underlying exception, credentials or evidence bytes.
    console.error(`[board-overview] section unavailable: ${section}`);
  },
};

/**
 * The actual overview logic, taking an already-resolved OrganisationContext
 * directly — same testability pattern as live-records.ts's exports — so
 * Checkpoint B's restricted-actor/foreign-tenant/selected-site tests can
 * drive it against a real Postgres membership without going through
 * requireOrganisationContext()'s auth()/cookies() (unresolvable under
 * Vitest's node environment, same documented exception as live-nav.ts).
 */
export async function loadOverviewForContext(context: OrganisationContext, searchParams: OverviewSearchParams): Promise<OverviewModel> {
  const parsed = resolveScopeParams(searchParams);
  if (parsed.siteId) await requireSiteInScope(context, parsed.siteId); // an invalid or foreign selected site is rejected, never broadened to all sites
  const scope: BoardScope = {
    organisationId: context.organisationId,
    siteIds: parsed.siteId ? [parsed.siteId] : [],
    from: parsed.from, to: parsed.to,
    asOfDate: new Date().toISOString().slice(0, 10), // no guarded synthetic environment is wired in any environment this branch has run in — the real date is always used
  };
  return loadOverview(ports, context, scope);
}

/** Server entry point for `/` and `/attention`. Never call the adapters above directly from a page. */
export async function getBoardOverview(searchParams: OverviewSearchParams): Promise<OverviewModel> {
  const context = await requireOrganisationContext();
  return loadOverviewForContext(context, searchParams);
}

export { InvalidBoardScopeError };
export type { OverviewSearchParams as BoardOverviewSearchParams };

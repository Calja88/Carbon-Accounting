import { Prisma } from "@prisma/client";
import { isVerifiedSyntheticOrganisation } from "./demo-identity";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requireCarbonView } from "@/lib/rbac/carbon-access";
import { hasPermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext, requireSiteInScope } from "@/lib/repositories/carbon-repository";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { buildAnalyticsSnapshot, type AnalyticsSnapshot } from "@/lib/analytics-service";
import { monthInputValue, formatRangeLabel } from "@/lib/report-period";
import { listOverdueOrUnevaluatedObligations } from "@/lib/ems/legal/evaluation-service";
import { computeReviewFingerprint } from "@/lib/carbon/source-period-obligation-service";
import { logEvent } from "@/lib/observability/logger";
import { boardPeriodSchema } from "./schemas";
import { loadOverview, type OverviewPorts, type BoardScope } from "./overview-service";
import { buildCarbonSection, type AuthorizedAnalyticsWindow, type WindowCoverage } from "./carbon-adapter";
import { actionAttention, actionCounts, mergeAttention } from "./attention";
import type { OverviewModel, AttentionItem, Coverage } from "./contracts";
import {
  carbonGapAttention, mapCanonicalActionRows, monthKeyOf, monthKeysInRange, priorYear, monthStringToDate,
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

function emptyCoverage(): Coverage {
  return { expected: null, received: 0, reviewed: 0, excluded: 0, awaitingFactor: 0, flagged: 0 };
}

/** Sums a set of same-shaped coverage cells; `expected` stays known only when every contributing cell is. */
function sumCoverage(cells: readonly Coverage[]): Coverage {
  const known = cells.every((c) => c.expected !== null);
  return {
    expected: known ? cells.reduce((sum, c) => sum + (c.expected ?? 0), 0) : null,
    received: cells.reduce((sum, c) => sum + c.received, 0),
    reviewed: cells.reduce((sum, c) => sum + c.reviewed, 0),
    excluded: cells.reduce((sum, c) => sum + c.excluded, 0),
    awaitingFactor: cells.reduce((sum, c) => sum + c.awaitingFactor, 0),
    flagged: cells.reduce((sum, c) => sum + c.flagged, 0),
  };
}

/**
 * Real Coverage, computed one (site, month) cell at a time from whichever
 * source is truer for that exact cell:
 *  - When genuine `CarbonSourcePeriodObligation` rows exist for it, they are
 *    the real denominator — an independent, source-period review decision
 *    distinct from entry-level QA, so `expected`/`reviewed`/`excluded` come
 *    from the obligations themselves, and `received`/`awaitingFactor`/
 *    `flagged` from the exact `ActivityEntry` each one is genuinely bound
 *    to (`submittedActivityEntryId`, never populated without a real
 *    persisted entry to point to).
 *  - Otherwise, the same `ActivityEntry`-derived fallback this always used —
 *    an organisation that has never adopted source-period obligations for a
 *    given site/month never regresses to a fabricated denominator or a
 *    metric wrongly reported "missing".
 * A cell is decided once and contributes to exactly its own site bucket,
 * its own month bucket and the group, so site+month coverage always
 * reconciles with the group total by construction — and `expected` on any
 * aggregate stays known only when every cell it sums is (never a known
 * group denominator built over an unknown site/month, per the adapter's own
 * `assertCoverageWindow`).
 */
class InvalidBoardScopeError extends Error {}

export async function loadOverviewForContext(context: OrganisationContext, searchParams: OverviewSearchParams, db: Prisma.TransactionClient = prisma): Promise<OverviewModel> {
  // Reuse reads within this one authorised request and database snapshot.
  let currentAnalytics: ReturnType<typeof buildAnalyticsSnapshot> | undefined;
  let attentionResult: ReturnType<OverviewPorts<OrganisationContext>["attention"]> | undefined;
requireCarbonView(context);
async function computeCoverageWindow(
  context: OrganisationContext,
  siteIds: readonly string[],
  periodStart: Date,
  periodEnd: Date,
): Promise<WindowCoverage> {
  const ctx = toTenantRepositoryContext(context);
  const months = monthKeysInRange(periodStart, periodEnd);
  const siteCoverage: Record<string, Coverage> = Object.fromEntries(siteIds.map((id) => [id, emptyCoverage()]));
  const monthCoverage: Record<string, Coverage> = Object.fromEntries(months.map((m) => [m, emptyCoverage()]));
  if (siteIds.length === 0 || months.length === 0) return { group: emptyCoverage(), sites: siteCoverage, months: monthCoverage };

  const cellKey = (siteId: string, month: string) => `${siteId} ${month}`;

  const entryRows = await db.activityEntry.findMany({
    where: tenantWhere(ctx, { siteId: { in: [...siteIds] }, periodStart: { gte: periodStart, lte: periodEnd } }),
    select: { id: true, siteId: true, periodStart: true, status: true },
  });
  const entriesByCell = new Map<string, typeof entryRows>();
  for (const row of entryRows) {
    const key = cellKey(row.siteId, monthKeyOf(row.periodStart));
    const list = entriesByCell.get(key);
    if (list) list.push(row);
    else entriesByCell.set(key, [row]);
  }

  const obligationRows = await db.carbonSourcePeriodObligation.findMany({
    where: tenantWhere<Prisma.CarbonSourcePeriodObligationWhereInput>(ctx, {
      siteId: { in: [...siteIds] },
      month: { gte: months[0], lte: months[months.length - 1] },
    }),
    select: { siteId: true, month: true, status: true, submittedActivityEntryId: true, reviewFingerprint: true },
  });
  const obligationsByCell = new Map<string, typeof obligationRows>();
  for (const row of obligationRows) {
    const key = cellKey(row.siteId, row.month);
    const list = obligationsByCell.get(key);
    if (list) list.push(row);
    else obligationsByCell.set(key, [row]);
  }

  // Revalidate every obligation-to-entry pair against tenant scope and the
  // permitted-site predicate rather than trusting the stored id alone — a
  // dangling reference (deleted/foreign entry) or one whose site/period no
  // longer matches the obligation it claims must never silently count as a
  // valid received/reviewed submission.
  const linkedEntryIds = obligationRows.map((o) => o.submittedActivityEntryId).filter((id): id is string => id !== null);
  const linkedEntries = linkedEntryIds.length
    ? await db.activityEntry.findMany({
        where: tenantWhere(ctx, { id: { in: linkedEntryIds }, siteId: { in: [...siteIds] } }),
        select: { id: true, siteId: true, periodStart: true, status: true, canonicalValue: true, canonicalUnit: true },
      })
    : [];
  const linkedEntryById = new Map(linkedEntries.map((e) => [e.id, e]));
  const linkedCalculations = linkedEntryIds.length
    ? await db.calculation.findMany({
        where: tenantWhere(ctx, { activityEntryId: { in: linkedEntryIds } }),
        select: { id: true, basis: true, resultKgCo2e: true, activityEntryId: true },
      })
    : [];
  const calculationsByEntryId = new Map<string, typeof linkedCalculations>();
  for (const calc of linkedCalculations) {
    const list = calculationsByEntryId.get(calc.activityEntryId);
    if (list) list.push(calc);
    else calculationsByEntryId.set(calc.activityEntryId, [calc]);
  }

  const cells = new Map<string, Coverage>();
  for (const siteId of siteIds) {
    for (const month of months) {
      const key = cellKey(siteId, month);
      const obligationsForCell = obligationsByCell.get(key);
      const cell = emptyCoverage();
      // Dedupe by entry id so an obligation-linked entry's flagged/
      // awaiting-factor state is never double-counted against the same
      // status also surfaced via the unmapped-submission scan below.
      const flaggedOrAwaitingEntryIds = new Set<string>();
      if (obligationsForCell && obligationsForCell.length > 0) {
        cell.expected = 0;
        for (const obligation of obligationsForCell) {
          cell.expected += 1;
          if (obligation.status === "EXCLUDED") {
            cell.excluded += 1;
            continue;
          }
          const entry = obligation.submittedActivityEntryId ? linkedEntryById.get(obligation.submittedActivityEntryId) : undefined;
          const validMatch =
            entry !== undefined && entry.siteId === obligation.siteId && monthKeyOf(entry.periodStart) === obligation.month;
          if (!validMatch) continue; // dangling/mismatched link: neither received nor reviewed
          cell.received += 1;
          flaggedOrAwaitingEntryIds.add(entry.id);
          if (entry.status === "AWAITING_FACTOR") cell.awaitingFactor += 1;
          else if (entry.status === "FLAGGED") cell.flagged += 1;
          if (obligation.status === "REVIEWED") {
            const calcs = calculationsByEntryId.get(entry.id) ?? [];
            const freshFingerprint = calcs.length > 0 ? computeReviewFingerprint(entry, calcs) : null;
            // A stale fingerprint (submission or its calculations changed
            // since the recorded review) must require review again — the
            // status column alone is not trusted as current truth.
            if (freshFingerprint !== null && freshFingerprint === obligation.reviewFingerprint) {
              cell.reviewed += 1;
            }
          }
        }
      }
      // Unmapped submissions in this exact cell — real ActivityEntry rows
      // that exist regardless of whether any obligation claims them. A cell
      // with obligations must not hide additional flagged/awaiting-factor
      // entries the obligation set doesn't happen to cover; deduped by
      // entry id so a row already counted above via a valid obligation
      // link is never counted twice.
      for (const row of entriesByCell.get(key) ?? []) {
        if (obligationsForCell && obligationsForCell.length > 0) {
          if (flaggedOrAwaitingEntryIds.has(row.id)) continue;
          if (row.status === "AWAITING_FACTOR") cell.awaitingFactor += 1;
          else if (row.status === "FLAGGED") cell.flagged += 1;
          continue;
        }
        cell.received += 1;
        if (row.status === "APPROVED") cell.reviewed += 1;
        else if (row.status === "REJECTED") cell.excluded += 1;
        else if (row.status === "AWAITING_FACTOR") cell.awaitingFactor += 1;
        else if (row.status === "FLAGGED") cell.flagged += 1;
      }
      cells.set(key, cell);
    }
  }

  for (const siteId of siteIds) siteCoverage[siteId] = sumCoverage(months.map((m) => cells.get(cellKey(siteId, m))!));
  for (const month of months) monthCoverage[month] = sumCoverage(siteIds.map((s) => cells.get(cellKey(s, month))!));
  const group = sumCoverage([...cells.values()]);
  return { group, sites: siteCoverage, months: monthCoverage };
}

function toAnalyticsWindow(snapshot: AnalyticsSnapshot): AuthorizedAnalyticsWindow {
  return {
    group: snapshot.group,
    sites: snapshot.sites.map((s) => ({ siteId: s.siteId, siteName: s.siteName, entityName: s.entityName, totals: s.totals })),
    monthly: snapshot.monthly.map((m) => ({ month: m.month, label: m.label, total: m.total })),
  };
}

/**
 * Real Scope 3 quantified-category count from this period's own
 * calculations — never a fixture constant.
 *
 * Grouped by `scope3Category` (the canonical GHG Protocol category label,
 * e.g. "Cat 1 — Purchased goods & services"), never by the catalogue's
 * free-text `category` display label: two data points legitimately share a
 * generic display category while representing different canonical Scope 3
 * categories (or, as BOARD-1 previously did, every data point regardless of
 * scope shared the same display category), which would silently collapse
 * or miscount canonical categories.
 *
 * Checkpoint B corrective handoff §2: `screenedCategories` is honestly
 * `null` — no Scope 3 screening decision/record exists anywhere in this
 * codebase (confirmed by inspection: there is no screening subsystem, only
 * the `ActivityDataPoint` catalogue and the standing Category 3 derivation
 * mechanism, neither of which is an actual screening decision). The
 * previous implementation inferred "screened" from which catalogue
 * categories happen to exist plus an unconditional Category 3 insertion —
 * that is catalogue/derivation-mechanism presence, not a screening record,
 * and is removed rather than carried forward as if it were one. Building a
 * real screening subsystem is out of this checkpoint's scope.
 */
async function computeScope3CategoryCoverage(
  context: OrganisationContext,
  siteIds: readonly string[],
  periodStart: Date,
  periodEnd: Date,
): Promise<{ quantifiedCategories: number; screenedCategories: null; screenedCategoriesReason: string }> {
  const screenedCategoriesReason = "Scope 3 screening is not recorded for this reporting boundary.";
  if (siteIds.length === 0) return { quantifiedCategories: 0, screenedCategories: null, screenedCategoriesReason };
  const ctx = toTenantRepositoryContext(context);
  const quantified = await db.calculation.findMany({
    where: tenantWhere<Prisma.CalculationWhereInput>(ctx, {
      scope: "SCOPE_3",
      scope3Category: { not: null },
      resultKgCo2e: { gt: 0 },
      activityEntry: { is: { siteId: { in: [...siteIds] }, periodStart: { gte: periodStart, lte: periodEnd } } },
    }),
    // Grouped on Calculation.scope3Category directly, never the entry's
    // ActivityDataPoint — a derived Category 3 calculation (scope3-derived.ts)
    // hangs off another data point's own entry (e.g. electricity) entirely,
    // and copies its category onto the calculation for exactly this reason
    // (schema comment on ActivityDataPoint.scope3Category).
    select: { scope3Category: true },
    distinct: ["scope3Category"],
  });
  const categories = new Set(quantified.map((c) => c.scope3Category).filter((c): c is string => c !== null));
  return { quantifiedCategories: categories.size, screenedCategories: null, screenedCategoriesReason };
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
  const count = await db.calculation.count({
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
  const rows = await db.nonconformity.findMany({
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
    db.actionItem.findMany({
      where: tenantWhere(ctx, {}),
      select: { id: true, title: true, status: true, dueDate: true, owner: { select: { user: { select: { name: true } } } }, programme: { select: { title: true } } },
    }),
    db.correctiveAction.findMany({
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



async function authorizeScope(context: OrganisationContext, scope: BoardScope): Promise<void> {
  requireCarbonView(context); // fails before any read — a denial never becomes empty success
  if (scope.organisationId !== context.organisationId) throw new InvalidBoardScopeError("Organisation mismatch");
}

async function header(context: OrganisationContext, scope: BoardScope): ReturnType<OverviewPorts<OrganisationContext>["header"]> {
  const organisation = await db.organisation.findUnique({ where: { id: context.organisationId }, select: { name: true } });
  const periodStart = monthStringToDate(scope.from, false), periodEnd = monthStringToDate(scope.to, true);
  const prior = priorYear(periodStart, periodEnd);
  const pack = context.access.mode === "ORGANISATION_WIDE" && hasPermission(context, "ems.view") && hasPermission(context, "lca.view")
    ? await db.managementReviewPack.findFirst({ where: { organisationId: context.organisationId, status: "ISSUED", payload: { path: ["board", "schemaVersion"], equals: 1 } }, orderBy: { issuedAt: "desc" }, select: { reviewId: true } }) : null;
  return {
    organisationName: organisation?.name ?? context.organisationSlug,
    periodLabel: formatRangeLabel(periodStart, periodEnd),
    previousPeriodLabel: formatRangeLabel(prior.periodStart, prior.periodEnd),
    synthetic: await isVerifiedSyntheticOrganisation(context.organisationId, db),
    managementPack: pack ? { label: "Open issued management pack", href: `/ems/management-reviews/${pack.reviewId}/pack` } : null,
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
    currentAnalytics ??= buildAnalyticsSnapshot(context, periodStart, periodEnd, restrictToSiteIds, db),
    buildAnalyticsSnapshot(context, prior.periodStart, prior.periodEnd, restrictToSiteIds, db),
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
    quantifiedCategories: scope3.quantifiedCategories, screenedCategories: scope3.screenedCategories, screenedCategoriesReason: scope3.screenedCategoriesReason, asOf: new Date().toISOString(),
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
  // Even an ORGANISATION_WIDE member who has narrowed to one selected site
  // gets organisation-wide EMS attention if shown at all — Nonconformity/
  // ActionItem/CorrectiveAction/ComplianceObligation carry no site relation
  // to filter by, so "EMS for this site" cannot be truthfully rendered.
  // Surface that as an explicit unavailable reason for the selected scope
  // rather than silently presenting organisation-wide EMS as site-specific.
  const singleSiteSelected = scope.siteIds.length === 1;
  const emsAttentionAllowed = context.access.mode === "ORGANISATION_WIDE" && !singleSiteSelected;
  const emsUnavailableReason =
    context.access.mode !== "ORGANISATION_WIDE"
      ? "EMS attention is organisation-wide and cannot be narrowed to your site access — showing carbon attention for your sites only."
      : singleSiteSelected
        ? "EMS attention is organisation-wide and cannot be narrowed to one selected site — showing carbon attention for the selected site only."
        : null;
  const [analyticsWindow, coverage, obligations, effectivenessItems, actionResult] = await Promise.all([
    (currentAnalytics ??= buildAnalyticsSnapshot(context, periodStart, periodEnd, restrictToSiteIds, db)).then(toAnalyticsWindow),
    computeCoverageWindow(context, [], periodStart, periodEnd), // recomputed below once sites are known
    emsAttentionAllowed && hasPermission(context, "ems.view") ? listOverdueOrUnevaluatedObligations(context, db) : Promise.resolve([]),
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
    data: {
      items, total: items.length, openActions: actionResult.counts.open, awaitingVerification: actionResult.counts.awaitingVerification,
      emsAvailable: emsAttentionAllowed, emsUnavailableReason,
    },
  };
}

async function priorities(context: OrganisationContext, scope: BoardScope): ReturnType<OverviewPorts<OrganisationContext>["priorities"]> {
  // Deliberately derived from the same authorized attention read rather than a second query set — a genuine top-3 summary, never fabricated copy.
  const result = await ports.attention(context, scope);
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
  authorizeScope, header, carbon, attention: (context, scope) => attentionResult ??= attention(context, scope), priorities,
  sectionFailure(section, error) {
    // Server-side structured log. The real exception is what makes a
    // failure fixable, so name/message/stack are recorded here; `logEvent`
    // redacts value/quantity/token-shaped fields and nothing from this
    // entry is ever returned to the browser (the caller renders the
    // section's own generic recovery message instead).
    logEvent({
      level: "error",
      message: "board-overview section failed",
      organisationId: context.organisationId,
      fields: {
        section,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
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
async function load(): Promise<OverviewModel> {
  let selected = searchParams;
  if (!selected.from && !selected.to && !selected.siteId && await isVerifiedSyntheticOrganisation(context.organisationId, db)) {
    const latest = await db.carbonSourcePeriodObligation.findFirst({ where: { organisationId: context.organisationId }, orderBy: { month: "desc" }, select: { month: true } });
    if (latest) selected = { from: `${latest.month.slice(0, 4)}-01`, to: latest.month };
  }
  const parsed = resolveScopeParams(selected);
  if (parsed.siteId) await requireSiteInScope(context, parsed.siteId, db); // an invalid or foreign selected site is rejected, never broadened to all sites
  const scope: BoardScope = {
    organisationId: context.organisationId,
    siteIds: parsed.siteId ? [parsed.siteId] : [],
    from: parsed.from, to: parsed.to,
    asOfDate: new Date().toISOString().slice(0, 10), // no guarded synthetic environment is wired in any environment this branch has run in — the real date is always used
  };
  return loadOverview(ports, context, scope);
}

return load();
}

export { InvalidBoardScopeError };
export type { OverviewSearchParams as BoardOverviewSearchParams };

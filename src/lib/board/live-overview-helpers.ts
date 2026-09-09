import type { AuthorizedAnalyticsWindow, WindowCoverage } from "./carbon-adapter";
import type { AuthorizedAction } from "./attention";
import type { AttentionItem, Coverage } from "./contracts";

/**
 * Pure helpers factored out of live-overview.ts so they're directly
 * unit-testable without pulling in Prisma/NextAuth (live-overview.ts
 * transitively imports @/lib/organisation/session -> next-auth -> next's
 * server runtime, which Vitest's plain node environment can't resolve).
 * No Prisma import here, ever.
 */

export const unknownCoverage = (): Coverage => ({
  expected: null,
  received: 0,
  reviewed: 0,
  excluded: 0,
  awaitingFactor: 0,
  flagged: 0,
});

/** Real carbon-data-gap attention: sites with no submissions, or with flagged/awaiting-factor entries, in the current window. */
export function carbonGapAttention(coverage: WindowCoverage, sites: AuthorizedAnalyticsWindow["sites"]): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const site of sites) {
    const c = coverage.sites[site.siteId] ?? unknownCoverage();
    if (c.received === 0) {
      items.push({
        key: `carbon:${site.siteId}:missing`, source: { kind: "site", id: site.siteId, revision: "current", label: "Open activity entry", href: "/entry" },
        title: `No activity data submitted — ${site.siteName}`, implication: "This site has no submitted activity data for the selected period.",
        reason: "missing", owner: site.entityName, site: site.siteName, dueDate: null, nextAction: "Enter activity data", priority: 3,
      });
    }
    if (c.flagged > 0) {
      items.push({
        key: `carbon:${site.siteId}:flagged`, source: { kind: "site", id: site.siteId, revision: "current", label: "Review flagged entries", href: "/entry" },
        title: `${c.flagged} flagged ${c.flagged === 1 ? "entry needs" : "entries need"} review — ${site.siteName}`,
        implication: "Flagged activity data has not yet been reviewed.", reason: "review", owner: site.entityName, site: site.siteName,
        dueDate: null, nextAction: "Review entries", priority: 2,
      });
    }
    if (c.awaitingFactor > 0) {
      items.push({
        key: `carbon:${site.siteId}:awaiting-factor`, source: { kind: "site", id: site.siteId, revision: "current", label: "View calculations", href: "/calculations" },
        title: `${c.awaitingFactor} ${c.awaitingFactor === 1 ? "entry" : "entries"} awaiting an emission factor — ${site.siteName}`,
        implication: "Real activity data is saved but has no matching emission factor yet.", reason: "review", owner: site.entityName, site: site.siteName,
        dueDate: null, nextAction: "View calculations", priority: 4,
      });
    }
  }
  return items;
}

export interface RawActionItemRow {
  id: string; title: string; status: AuthorizedAction["state"]; dueDate: Date;
  owner: { user: { name: string | null } }; programme: { title: string };
}
export interface RawCorrectiveActionRow {
  id: string; description: string; status: AuthorizedAction["state"]; dueDate: Date;
  sharedActionItemId: string | null; nonconformityId: string; owner: { user: { name: string | null } };
}

/**
 * Pure row mapping — no Prisma import, so it's directly unit-testable.
 * An ActionItem shared by a CorrectiveAction (`sharedActionItemId`) maps to
 * the SAME canonical key as its own ActionItem row; `dedupeActions` (in
 * attention.ts) then either merges them (states agree) or throws a
 * conflicting-projection error (states disagree) — never silently picks one.
 */
export function mapCanonicalActionRows(actionItems: RawActionItemRow[], correctiveActions: RawCorrectiveActionRow[]): AuthorizedAction[] {
  return [
    // canonicalActionId is the ActionItem's OWN id, not null: dedupeActions keys on
    // `canonicalActionId ?? source.kind:id`, and a CorrectiveAction sharing this
    // ActionItem resolves its own key to the same `sharedActionItemId` value — the
    // two rows only collapse into one if both resolve to the identical key.
    ...actionItems.map((a): AuthorizedAction => ({
      id: a.id, canonicalActionId: a.id, title: a.title, state: a.status, requiresVerification: a.status === "COMPLETED",
      dueDate: a.dueDate.toISOString().slice(0, 10), owner: a.owner.user.name ?? "Unassigned", site: a.programme.title,
      source: { kind: "actionitem", id: a.id, revision: a.status, label: "View action", href: "/ems/actions" }, blocker: a.status === "BLOCKED" ? "Blocked — see action record for detail." : null,
    })),
    ...correctiveActions.map((ca): AuthorizedAction => ({
      id: ca.id, canonicalActionId: ca.sharedActionItemId, title: ca.description, state: ca.status, requiresVerification: ca.status === "COMPLETED",
      dueDate: ca.dueDate.toISOString().slice(0, 10), owner: ca.owner.user.name ?? "Unassigned", site: "Organisation-wide",
      source: { kind: "correctiveaction", id: ca.id, revision: ca.status, label: "Open nonconformity", href: `/ems/nonconformities/${ca.nonconformityId}` }, blocker: null,
    })),
  ];
}

export function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthKeysInRange(periodStart: Date, periodEnd: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), 1));
  const last = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), 1));
  while (cursor <= last) {
    keys.push(monthKeyOf(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

/** One year earlier, same calendar-month length — the app's existing YoY comparison convention (see analytics-service.ts). */
export function priorYear(periodStart: Date, periodEnd: Date): { periodStart: Date; periodEnd: Date } {
  return {
    periodStart: new Date(Date.UTC(periodStart.getUTCFullYear() - 1, periodStart.getUTCMonth(), 1)),
    periodEnd: new Date(Date.UTC(periodEnd.getUTCFullYear() - 1, periodEnd.getUTCMonth() + 1, 0)),
  };
}

export function monthStringToDate(month: string, endOfMonth: boolean): Date {
  const [y, m] = month.split("-").map(Number);
  return endOfMonth ? new Date(Date.UTC(y, m, 0)) : new Date(Date.UTC(y, m - 1, 1));
}

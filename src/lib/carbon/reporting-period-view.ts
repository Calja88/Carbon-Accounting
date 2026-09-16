import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { hasPermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { listAuditEvents } from "@/lib/repositories/audit-repository";
import { monthInputValue } from "@/lib/report-period";
import { getReportingPeriod } from "./reporting-period-service";

/**
 * Phase 4-iii read model for the close/reopen control surface. It adds no
 * rule of its own: state comes from the Phase 4-ii service, and the actor,
 * timestamp and reason come from the hash-chained audit events that service
 * already writes (the ReportingPeriod row deliberately stores none of them).
 */
export interface ReportingPeriodTransitionView {
  state: "OPEN" | "CLOSED";
  at: Date;
  actorName: string | null;
  reason: string | null;
}

export interface ReportingPeriodView {
  siteId: string;
  monthStart: Date;
  monthLabel: string;
  monthInput: string;
  state: "OPEN" | "CLOSED";
  /** UI affordance only — `setReportingPeriodState` re-checks the same grant server-side. */
  canTransition: boolean;
  /** The transition that put the period in its current state, when one was recorded. */
  current: ReportingPeriodTransitionView | null;
  history: ReportingPeriodTransitionView[];
}

const MONTH_INPUT = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-09" → 1 September 2026 UTC. Anything else is a selection this page will not guess at. */
export function monthStartFromInput(value: string | undefined | null): Date | null {
  const match = MONTH_INPUT.exec((value ?? "").trim());
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)) : null;
}

export function formatMonthLabel(monthStart: Date): string {
  return monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function getReportingPeriodView(
  context: OrganisationContext,
  siteId: string,
  monthStart: Date,
): Promise<ReportingPeriodView> {
  // Permission and site scope are enforced here, by the Phase 4-ii read.
  const period = await getReportingPeriod(context, siteId, monthStart);
  const base = {
    siteId,
    monthStart: period.monthStart,
    monthLabel: formatMonthLabel(period.monthStart),
    monthInput: monthInputValue(period.monthStart),
    state: period.state as "OPEN" | "CLOSED",
    canTransition: hasPermission(context, "carbon.entry.approve"),
  };
  // No row means nobody has ever transitioned this month: open, no history.
  if (!period.id) return { ...base, current: null, history: [] };

  const events = await listAuditEvents(toTenantRepositoryContext(context), {
    resourceType: "reporting_period",
    resourceId: period.id,
    take: 6,
  });
  const actorIds = [...new Set(events.map((e) => e.actorUserId).filter((id): id is string => !!id))];
  const names = new Map(
    actorIds.length === 0
      ? []
      : (await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map(
          (user) => [user.id, user.name] as const,
        ),
  );

  const history = events.map((event) => {
    const after = asRecord(event.after);
    const reason = typeof after.reason === "string" && after.reason.trim() ? after.reason.trim() : null;
    return {
      state: event.eventType === "reporting_period.closed" ? ("CLOSED" as const) : ("OPEN" as const),
      at: event.occurredAt,
      actorName: event.actorUserId ? names.get(event.actorUserId) ?? null : null,
      reason,
    };
  });

  return { ...base, current: history[0]?.state === base.state ? history[0] : null, history };
}

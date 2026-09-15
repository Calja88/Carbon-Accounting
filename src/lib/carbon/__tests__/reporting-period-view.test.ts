/**
 * Phase 4-iii read model. The rule itself belongs to Phase 4-ii, so these
 * tests only assert what the close/reopen surface is told: the state the
 * service reports, the actor/time/reason recovered from the audit record the
 * service already writes, and whether this membership may act at all.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, SITE_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";
import type { OrganisationContext } from "@/lib/organisation/context";

const getReportingPeriod = vi.fn();
vi.mock("@/lib/carbon/reporting-period-service", () => ({
  getReportingPeriod: (...a: unknown[]) => getReportingPeriod(...a),
}));

const listAuditEvents = vi.fn();
vi.mock("@/lib/repositories/audit-repository", () => ({
  listAuditEvents: (...a: unknown[]) => listAuditEvents(...a),
}));

const findManyUsers = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: (...a: unknown[]) => findManyUsers(...a) } } }));

const { getReportingPeriodView, monthStartFromInput, formatMonthLabel } = await import(
  "@/lib/carbon/reporting-period-view"
);

const SEPTEMBER = new Date(Date.UTC(2026, 8, 1));

function context(permissions: string[]): OrganisationContext {
  return makeOrganisationContext(ORG_A, {
    permissions: new Set(permissions) as unknown as OrganisationContext["permissions"],
  });
}

function auditEvent(patch: Record<string, unknown> = {}) {
  return {
    id: "audit-1",
    eventType: "reporting_period.closed",
    actorUserId: "user-lead",
    occurredAt: new Date("2026-09-15T14:22:00.000Z"),
    before: { state: "OPEN" },
    after: { state: "CLOSED", reason: "Month-end close" },
    ...patch,
  };
}

beforeEach(() => {
  getReportingPeriod.mockReset();
  listAuditEvents.mockReset().mockResolvedValue([]);
  findManyUsers.mockReset().mockResolvedValue([{ id: "user-lead", name: "Dana Okafor" }]);
});

describe("month parsing", () => {
  it("reads a month picker value as the first of that UTC month", () => {
    expect(monthStartFromInput("2026-09")?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("refuses anything that is not a real month rather than guessing one", () => {
    for (const value of ["", "2026", "2026-13", "2026-00", "september", "2026-09-15", undefined]) {
      expect(monthStartFromInput(value)).toBeNull();
    }
  });

  it("labels a month the way the screen shows it", () => {
    expect(formatMonthLabel(SEPTEMBER)).toBe("September 2026");
  });
});

describe("getReportingPeriodView", () => {
  it("reports a month nobody has ever closed as open, with no history to show", async () => {
    getReportingPeriod.mockResolvedValue({ id: null, monthStart: SEPTEMBER, state: "OPEN" });

    const view = await getReportingPeriodView(context(["carbon.view", "carbon.entry.approve"]), SITE_A, SEPTEMBER);

    expect(view.state).toBe("OPEN");
    expect(view.monthLabel).toBe("September 2026");
    expect(view.monthInput).toBe("2026-09");
    expect(view.current).toBeNull();
    expect(view.history).toEqual([]);
    // Nothing has ever happened to this month, so nothing is read back.
    expect(listAuditEvents).not.toHaveBeenCalled();
  });

  it("reports a closed month with the actor, time and reason from the audit record", async () => {
    getReportingPeriod.mockResolvedValue({ id: "period-1", monthStart: SEPTEMBER, state: "CLOSED" });
    listAuditEvents.mockResolvedValue([auditEvent()]);

    const view = await getReportingPeriodView(context(["carbon.view", "carbon.entry.approve"]), SITE_A, SEPTEMBER);

    expect(view.state).toBe("CLOSED");
    expect(view.current).toEqual({
      state: "CLOSED",
      at: new Date("2026-09-15T14:22:00.000Z"),
      actorName: "Dana Okafor",
      reason: "Month-end close",
    });
    expect(listAuditEvents).toHaveBeenCalledWith(expect.anything(), {
      resourceType: "reporting_period",
      resourceId: "period-1",
      take: 6,
    });
  });

  it("keeps the close and the reopening that followed it, newest first", async () => {
    getReportingPeriod.mockResolvedValue({ id: "period-1", monthStart: SEPTEMBER, state: "OPEN" });
    listAuditEvents.mockResolvedValue([
      auditEvent({
        id: "audit-2",
        eventType: "reporting_period.opened",
        actorUserId: "user-finance",
        occurredAt: new Date("2026-09-16T09:10:00.000Z"),
        after: { state: "OPEN", reason: "Corrected supplier invoice" },
      }),
      auditEvent(),
    ]);
    findManyUsers.mockResolvedValue([
      { id: "user-lead", name: "Dana Okafor" },
      { id: "user-finance", name: "Priya Shah" },
    ]);

    const view = await getReportingPeriodView(context(["carbon.view", "carbon.entry.approve"]), SITE_A, SEPTEMBER);

    expect(view.state).toBe("OPEN");
    expect(view.history.map((entry) => entry.state)).toEqual(["OPEN", "CLOSED"]);
    expect(view.history[0].actorName).toBe("Priya Shah");
    expect(view.history[1].reason).toBe("Month-end close");
    // The reopening is what made it open, so that is the current state shown.
    expect(view.current?.reason).toBe("Corrected supplier invoice");
  });

  it("still shows the state when the actor is no longer a listed user", async () => {
    getReportingPeriod.mockResolvedValue({ id: "period-1", monthStart: SEPTEMBER, state: "CLOSED" });
    listAuditEvents.mockResolvedValue([auditEvent({ actorUserId: null, after: { state: "CLOSED" } })]);
    findManyUsers.mockResolvedValue([]);

    const view = await getReportingPeriodView(context(["carbon.view"]), SITE_A, SEPTEMBER);

    expect(view.current?.actorName).toBeNull();
    expect(view.current?.reason).toBeNull();
    expect(findManyUsers).not.toHaveBeenCalled();
  });

  it("offers the transition only to a membership holding the approval grant", async () => {
    getReportingPeriod.mockResolvedValue({ id: null, monthStart: SEPTEMBER, state: "OPEN" });

    expect((await getReportingPeriodView(context(["carbon.view"]), SITE_A, SEPTEMBER)).canTransition).toBe(false);
    expect(
      (await getReportingPeriodView(context(["carbon.view", "carbon.entry.approve"]), SITE_A, SEPTEMBER))
        .canTransition,
    ).toBe(true);
  });

  it("lets the Phase 4-ii read refuse an out-of-scope site rather than answering itself", async () => {
    getReportingPeriod.mockRejectedValue(new Error("Site not in scope"));
    await expect(getReportingPeriodView(context(["carbon.view"]), "site-elsewhere", SEPTEMBER)).rejects.toThrow(
      "Site not in scope",
    );
  });
});

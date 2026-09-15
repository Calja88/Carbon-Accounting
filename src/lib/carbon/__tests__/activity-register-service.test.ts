/**
 * Phase 4-iii-b Activity Data Register — the safety decision and the two
 * mutations it permits.
 *
 * The register adds no accounting rule of its own, so these tests assert the
 * seam rather than the rule: which records it declares mutable and why not,
 * that its queries carry the tenant/site filter and the caller's own filters,
 * and — the part that actually protects the ledger — that the Phase 4-ii
 * barrier and the reference checks run inside the write transaction, so a
 * page rendered while a period was open cannot push a write through after it
 * closed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, SITE_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";
import type { OrganisationContext } from "@/lib/organisation/context";

const assertPeriodAllowsMutation = vi.fn();
class FakeClosedError extends Error {
  readonly code = "REPORTING_PERIOD_CLOSED";
}
vi.mock("@/lib/carbon/reporting-period-guard", () => ({
  assertPeriodAllowsMutation: (...a: unknown[]) => assertPeriodAllowsMutation(...a),
  isReportingPeriodClosedError: (error: unknown) => error instanceof FakeClosedError,
  REPORTING_PERIOD_CLOSED_MESSAGE: "This reporting period is closed. Reopen the period before changing accounting data.",
}));

const recordAuditEvent = vi.fn();
vi.mock("@/lib/repositories/audit-repository", () => ({
  recordAuditEvent: (...a: unknown[]) => recordAuditEvent(...a),
}));

vi.mock("@/lib/repositories/row-locks", () => ({ lockActivityEntry: vi.fn() }));

const entryCount = vi.fn();
const entryFindMany = vi.fn();
const entryFindFirst = vi.fn();
const entryUpdate = vi.fn();
const entryDelete = vi.fn();
const reportingPeriodFindMany = vi.fn();
const calculationCount = vi.fn();
const lcaLinkCount = vi.fn();
const commutingCount = vi.fn();
const obligationCount = vi.fn();

const tx = {
  activityEntry: {
    findFirst: (...a: unknown[]) => entryFindFirst(...a),
    update: (...a: unknown[]) => entryUpdate(...a),
    delete: (...a: unknown[]) => entryDelete(...a),
  },
  calculation: { count: (...a: unknown[]) => calculationCount(...a) },
  lcaCorporateDataLink: { count: (...a: unknown[]) => lcaLinkCount(...a) },
  commutingSurveyResponse: { count: (...a: unknown[]) => commutingCount(...a) },
  carbonSourcePeriodObligation: { count: (...a: unknown[]) => obligationCount(...a) },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activityEntry: {
      count: (...a: unknown[]) => entryCount(...a),
      findMany: (...a: unknown[]) => entryFindMany(...a),
      findFirst: (...a: unknown[]) => entryFindFirst(...a),
    },
    reportingPeriod: { findMany: (...a: unknown[]) => reportingPeriodFindMany(...a) },
    reportSnapshotCalculation: { count: vi.fn().mockResolvedValue(0) },
    site: { findMany: vi.fn().mockResolvedValue([]) },
    activityDataPoint: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: (fn: (client: typeof tx) => unknown) => fn(tx),
  },
}));

const {
  ActivityRecordProtectedError,
  deleteActivityEntry,
  describeMutability,
  listActivityRegister,
  updateActivityEntryNotes,
} = await import("@/lib/carbon/activity-register-service");

const SEPTEMBER = new Date(Date.UTC(2026, 8, 1));
const SEPTEMBER_END = new Date(Date.UTC(2026, 8, 30));

function context(permissions: string[]): OrganisationContext {
  return makeOrganisationContext(ORG_A, {
    permissions: new Set(permissions) as unknown as OrganisationContext["permissions"],
  });
}

const FULL = () => context(["carbon.view", "carbon.entry.create", "carbon.entry.review", "carbon.entry.approve"]);
const READ_ONLY = () => context(["carbon.view"]);

const NO_REFERENCES = { calculations: 0, lcaLinks: 0, commutingSurvey: false, sourceReviews: 0, reportSnapshots: 0 };

function entryRow(patch: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    organisationId: ORG_A,
    siteId: SITE_A,
    periodStart: SEPTEMBER,
    periodEnd: SEPTEMBER_END,
    rawValue: 1200,
    rawUnit: "kWh",
    canonicalValue: 1200,
    canonicalUnit: "kWh",
    status: "SUBMITTED",
    notes: "Meter read",
    plausibilityFlagged: false,
    updatedAt: SEPTEMBER,
    organisation: { name: "Aster Group" },
    site: { name: "Aster North", entity: { name: "Aster Manufacturing" } },
    activityDataPoint: { code: "S1-01", dataPointName: "Natural gas", scope: "SCOPE_1", scope3Category: null },
    factorOption: null,
    calculations: [],
    ...patch,
  };
}

beforeEach(() => {
  assertPeriodAllowsMutation.mockReset().mockResolvedValue(undefined);
  recordAuditEvent.mockReset().mockResolvedValue({ id: "audit-1" });
  entryCount.mockReset().mockResolvedValue(0);
  entryFindMany.mockReset().mockResolvedValue([]);
  entryFindFirst.mockReset().mockResolvedValue(null);
  entryUpdate.mockReset().mockResolvedValue(undefined);
  entryDelete.mockReset().mockResolvedValue(undefined);
  reportingPeriodFindMany.mockReset().mockResolvedValue([]);
  calculationCount.mockReset().mockResolvedValue(0);
  lcaLinkCount.mockReset().mockResolvedValue(0);
  commutingCount.mockReset().mockResolvedValue(0);
  obligationCount.mockReset().mockResolvedValue(0);
});

describe("describeMutability", () => {
  it("lets an open-period record with no figure and no citation be edited and deleted", () => {
    const result = describeMutability(FULL(), "OPEN", NO_REFERENCES);
    expect(result.canEditNotes).toBe(true);
    expect(result.canDelete).toBe(true);
    expect(result.deleteBlockers).toEqual([]);
  });

  it("blocks both edit and delete in a closed period, naming the period as the reason", () => {
    const result = describeMutability(FULL(), "CLOSED", NO_REFERENCES);
    expect(result.canEditNotes).toBe(false);
    expect(result.canDelete).toBe(false);
    expect(result.editBlockers).toContain("closed_period");
    expect(result.deleteBlockers).toContain("closed_period");
  });

  it("protects a calculated record from deletion while leaving its notes editable", () => {
    const result = describeMutability(FULL(), "OPEN", { ...NO_REFERENCES, calculations: 2 });
    expect(result.canDelete).toBe(false);
    expect(result.deleteBlockers).toContain("calculated");
    // Notes carry no figure, so annotating a calculated record is still safe.
    expect(result.canEditNotes).toBe(true);
  });

  it.each([
    ["a product assessment", { lcaLinks: 1 }],
    ["a commuting survey", { commutingSurvey: true }],
    ["a source review", { sourceReviews: 1 }],
  ])("protects a record cited by %s from deletion", (_label, patch) => {
    const result = describeMutability(FULL(), "OPEN", { ...NO_REFERENCES, ...patch });
    expect(result.canDelete).toBe(false);
    expect(result.deleteBlockers).toContain("referenced");
  });

  it("offers a read-only member neither action, without pretending the record is protected", () => {
    const result = describeMutability(READ_ONLY(), "OPEN", NO_REFERENCES);
    expect(result.canEditNotes).toBe(false);
    expect(result.canDelete).toBe(false);
    expect(result.editBlockers).toEqual(["permission"]);
    expect(result.deleteBlockers).toEqual(["permission"]);
  });
});

describe("listActivityRegister", () => {
  it("scopes every read to the tenant and pages server-side", async () => {
    entryCount.mockResolvedValue(60);
    entryFindMany.mockResolvedValue([entryRow()]);

    const result = await listActivityRegister(FULL(), { page: 2 });

    const args = entryFindMany.mock.calls[0][0];
    expect(args.where.organisationId).toBe(ORG_A);
    expect(args.take).toBe(25);
    expect(args.skip).toBe(25);
    expect(result.pageCount).toBe(3);
    expect(result.total).toBe(60);
  });

  it("filters by site, reporting period, status and source", async () => {
    await listActivityRegister(FULL(), {
      siteId: SITE_A,
      from: SEPTEMBER,
      to: SEPTEMBER_END,
      status: "AWAITING_FACTOR",
      activityDataPointId: "adp-1",
      scope: "SCOPE_2",
    });

    const { where } = entryFindMany.mock.calls[0][0];
    expect(where.siteId).toBe(SITE_A);
    expect(where.status).toBe("AWAITING_FACTOR");
    expect(where.activityDataPointId).toBe("adp-1");
    expect(where.periodStart).toEqual({ gte: SEPTEMBER, lte: SEPTEMBER_END });
    expect(where.activityDataPoint).toEqual({ scope: "SCOPE_2" });
  });

  it("searches the human-readable fields, not internal ids", async () => {
    await listActivityRegister(FULL(), { q: "  Aster  " });

    const { where } = entryFindMany.mock.calls[0][0];
    const searched = where.OR.map((clause: Record<string, unknown>) => Object.keys(clause)[0]);
    expect(searched).toEqual(
      expect.arrayContaining(["notes", "supplierName", "site", "factorOption", "activityDataPoint"]),
    );
    expect(where.OR[0].notes).toEqual({ contains: "Aster", mode: "insensitive" });
  });

  it("treats a month with no reporting-period row as open, and a closed row as read-only", async () => {
    entryCount.mockResolvedValue(2);
    entryFindMany.mockResolvedValue([
      entryRow({ id: "open-entry" }),
      entryRow({ id: "closed-entry", siteId: "site-closed" }),
    ]);
    reportingPeriodFindMany.mockResolvedValue([{ siteId: "site-closed", monthStart: SEPTEMBER }]);

    const { rows } = await listActivityRegister(FULL());

    expect(rows.find((row) => row.id === "open-entry")?.periodState).toBe("OPEN");
    expect(rows.find((row) => row.id === "closed-entry")?.periodState).toBe("CLOSED");
  });

  it("totals the calculations on a row so the register shows its emissions figure", async () => {
    entryCount.mockResolvedValue(1);
    entryFindMany.mockResolvedValue([entryRow({ calculations: [{ resultKgCo2e: 120.5 }, { resultKgCo2e: 30.25 }] })]);

    const { rows } = await listActivityRegister(FULL());
    expect(rows[0].resultKgCo2e).toBeCloseTo(150.75);
    expect(rows[0].calculationCount).toBe(2);
  });
});

describe("updateActivityEntryNotes", () => {
  it("writes the note and its audit event once the barrier allows the month", async () => {
    entryFindFirst.mockResolvedValue(entryRow());

    await updateActivityEntryNotes(FULL(), "entry-1", "  Corrected from the supplier invoice  ");

    expect(assertPeriodAllowsMutation).toHaveBeenCalledWith(tx, expect.anything(), SITE_A, SEPTEMBER);
    expect(entryUpdate.mock.calls[0][0].data).toEqual({ notes: "Corrected from the supplier invoice" });
    expect(recordAuditEvent.mock.calls[0][2]).toMatchObject({
      eventType: "activity_entry.updated",
      resourceType: "activity_entry",
      resourceId: "entry-1",
    });
  });

  it("refuses a member without the review grant before touching the database", async () => {
    await expect(updateActivityEntryNotes(READ_ONLY(), "entry-1", "note")).rejects.toBeInstanceOf(
      ActivityRecordProtectedError,
    );
    expect(entryUpdate).not.toHaveBeenCalled();
  });

  it("lets the closed-period barrier refuse the write, never the rendered page", async () => {
    entryFindFirst.mockResolvedValue(entryRow());
    assertPeriodAllowsMutation.mockRejectedValue(new FakeClosedError("closed"));

    await expect(updateActivityEntryNotes(FULL(), "entry-1", "note")).rejects.toBeInstanceOf(FakeClosedError);
    expect(entryUpdate).not.toHaveBeenCalled();
  });
});

describe("deleteActivityEntry", () => {
  it("deletes an unreferenced open-period record and records why it could go", async () => {
    entryFindFirst.mockResolvedValue(
      entryRow({ activityDataPoint: { code: "S1-01" }, site: { name: "Aster North" } }),
    );

    const result = await deleteActivityEntry(FULL(), "entry-1");

    expect(result).toEqual({ code: "S1-01", siteName: "Aster North" });
    expect(entryDelete).toHaveBeenCalled();
    // The audit event is written before the row disappears, and keeps its value.
    expect(recordAuditEvent.mock.calls[0][2]).toMatchObject({
      eventType: "activity_entry.deleted",
      before: expect.objectContaining({ canonicalUnit: "kWh" }),
    });
  });

  it("refuses to destroy a record that has produced an emissions figure", async () => {
    entryFindFirst.mockResolvedValue(entryRow({ activityDataPoint: { code: "S1-01" }, site: { name: "Aster North" } }));
    calculationCount.mockResolvedValue(1);

    await expect(deleteActivityEntry(FULL(), "entry-1")).rejects.toMatchObject({ blockers: ["calculated"] });
    expect(entryDelete).not.toHaveBeenCalled();
  });

  it("refuses to destroy a record a product assessment still cites", async () => {
    entryFindFirst.mockResolvedValue(entryRow({ activityDataPoint: { code: "S1-01" }, site: { name: "Aster North" } }));
    lcaLinkCount.mockResolvedValue(1);

    await expect(deleteActivityEntry(FULL(), "entry-1")).rejects.toMatchObject({ blockers: ["referenced"] });
    expect(entryDelete).not.toHaveBeenCalled();
  });

  it("re-checks references inside the transaction, so a stale open page cannot force a delete through", async () => {
    entryFindFirst.mockResolvedValue(entryRow({ activityDataPoint: { code: "S1-01" }, site: { name: "Aster North" } }));
    // The page was drawn when nothing referenced this row; a calculation
    // finished between the render and the click.
    expect(describeMutability(FULL(), "OPEN", NO_REFERENCES).canDelete).toBe(true);
    calculationCount.mockResolvedValue(1);

    await expect(deleteActivityEntry(FULL(), "entry-1")).rejects.toBeInstanceOf(ActivityRecordProtectedError);
    expect(entryDelete).not.toHaveBeenCalled();
  });

  it("lets the closed-period barrier win over a page that still showed the period open", async () => {
    entryFindFirst.mockResolvedValue(entryRow({ activityDataPoint: { code: "S1-01" }, site: { name: "Aster North" } }));
    assertPeriodAllowsMutation.mockRejectedValue(new FakeClosedError("closed"));

    await expect(deleteActivityEntry(FULL(), "entry-1")).rejects.toBeInstanceOf(FakeClosedError);
    expect(entryDelete).not.toHaveBeenCalled();
  });

  it("refuses a member without the approve grant before touching the database", async () => {
    await expect(deleteActivityEntry(READ_ONLY(), "entry-1")).rejects.toBeInstanceOf(ActivityRecordProtectedError);
    expect(entryFindFirst).not.toHaveBeenCalled();
  });
});

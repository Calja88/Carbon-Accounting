/**
 * Phase 4-iii server actions. Two things are proved here: the close/reopen
 * action routes every transition through the Phase 4-ii service with a
 * server-resolved context (never anything the browser claimed), and a write
 * refused by the closed-period barrier reaches the screen as the barrier's
 * own sentence rather than as a generic failure.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, SITE_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { LegalHoldError } from "@/lib/retention/legal-hold-service";
import { ReportingPeriodClosedError } from "@/lib/carbon/reporting-period-guard";
import type { OrganisationContext } from "@/lib/organisation/context";

class FakeRedirectError extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new FakeRedirectError(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

class MockOrganisationAccessError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}
const requireOrganisationContext = vi.fn();
vi.mock("@/lib/organisation/session", () => ({
  requireOrganisationContext: () => requireOrganisationContext(),
  OrganisationAccessError: MockOrganisationAccessError,
}));

const setReportingPeriodState = vi.fn();
vi.mock("@/lib/carbon/reporting-period-service", () => ({
  setReportingPeriodState: (...a: unknown[]) => setReportingPeriodState(...a),
  getReportingPeriod: vi.fn(),
}));

vi.mock("@/lib/carbon/collection-plan-service", () => ({
  CollectionPlanError: class CollectionPlanError extends Error {},
  excludeCollectionRequirement: vi.fn(),
  generateCollectionPlan: vi.fn(),
  reopenCollectionRequirement: vi.fn(),
  reviewCollectionRequirement: vi.fn(),
}));

const createActivityEntryWithCalculations = vi.fn();
vi.mock("@/lib/entries-service", () => ({
  createActivityEntryWithCalculations: (...a: unknown[]) => createActivityEntryWithCalculations(...a),
}));

const findUniqueDataPoint = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { activityDataPoint: { findUnique: (...a: unknown[]) => findUniqueDataPoint(...a) } },
}));

const { setReportingPeriodStateAction } = await import("@/app/(app)/data/actions");
const { submitEntryAction } = await import("@/app/(app)/entry/[siteId]/[code]/actions");

function context(permissions: string[]): OrganisationContext {
  return makeOrganisationContext(ORG_A, {
    permissions: new Set(permissions) as unknown as OrganisationContext["permissions"],
  });
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

function closeForm(patch: Record<string, string> = {}): FormData {
  return form({
    siteId: SITE_A,
    periodMonth: "2026-09",
    state: "CLOSED",
    reason: "Month-end close",
    from: "2026-01",
    to: "2026-09",
    ...patch,
  });
}

/** The action always ends in a redirect; this reports where it went. */
async function runToRedirect(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (err) {
    if (err instanceof FakeRedirectError) return err.url;
    throw err;
  }
  throw new Error("Expected the action to redirect.");
}

beforeEach(() => {
  requireOrganisationContext.mockReset().mockResolvedValue(context(["carbon.view", "carbon.entry.create", "carbon.entry.approve"]));
  setReportingPeriodState.mockReset().mockResolvedValue({ id: "period-1", state: "CLOSED" });
  createActivityEntryWithCalculations.mockReset();
  findUniqueDataPoint.mockReset().mockResolvedValue({ id: "adp-gas", code: "S1-01", frequency: "Monthly" });
});

describe("setReportingPeriodStateAction", () => {
  it("closes the named month through the Phase 4-ii service and comes back saying so", async () => {
    const url = await runToRedirect(() => setReportingPeriodStateAction(closeForm()));

    expect(setReportingPeriodState).toHaveBeenCalledWith(expect.objectContaining({ organisationId: ORG_A }), {
      siteId: SITE_A,
      accountingDate: new Date(Date.UTC(2026, 8, 1)),
      state: "CLOSED",
      reason: "Month-end close",
    });
    expect(url).toContain("periodDone=CLOSED");
    expect(url).toContain("periodMonth=2026-09");
    // The collection filters the user was looking at survive the round trip.
    expect(url).toContain("from=2026-01");
    expect(url).toContain(`siteId=${SITE_A}`);
  });

  it("reopens through the same service, with its own reason", async () => {
    setReportingPeriodState.mockResolvedValue({ id: "period-1", state: "OPEN" });
    const url = await runToRedirect(() =>
      setReportingPeriodStateAction(closeForm({ state: "OPEN", reason: "Corrected supplier invoice" })),
    );

    expect(setReportingPeriodState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ state: "OPEN", reason: "Corrected supplier invoice" }),
    );
    expect(url).toContain("periodDone=OPEN");
  });

  it("takes the actor from the server context, never from the submitted form", async () => {
    await runToRedirect(() =>
      setReportingPeriodStateAction(
        closeForm({ organisationId: "org-attacker", membershipId: "membership-attacker", userId: "user-attacker" }),
      ),
    );

    const [passedContext, input] = setReportingPeriodState.mock.calls[0];
    expect(passedContext.organisationId).toBe(ORG_A);
    expect(passedContext.membershipId).toBe(`membership-${ORG_A}`);
    expect(input).not.toHaveProperty("organisationId");
    expect(input).not.toHaveProperty("membershipId");
  });

  it("reports a refused transition as a denial, and never claims it happened", async () => {
    setReportingPeriodState.mockRejectedValue(new PermissionDeniedError("MISSING_PERMISSION"));
    const url = await runToRedirect(() => setReportingPeriodStateAction(closeForm()));

    expect(url).toContain("error=denied");
    expect(url).not.toContain("periodDone");
  });

  it("reports a legal hold as its own outcome rather than a generic failure", async () => {
    setReportingPeriodState.mockRejectedValue(new LegalHoldError("This reporting period is under an active legal hold."));
    const url = await runToRedirect(() => setReportingPeriodStateAction(closeForm({ state: "OPEN" })));

    expect(url).toContain("error=hold");
  });

  it("refuses an incomplete transition without calling the service at all", async () => {
    const incomplete: Record<string, string>[] = [
      { reason: " " },
      { periodMonth: "2026-13" },
      { state: "ARCHIVED" },
      { siteId: "" },
    ];
    for (const patch of incomplete) {
      const url = await runToRedirect(() => setReportingPeriodStateAction(closeForm(patch)));
      expect(url).toContain("error=period_invalid");
    }
    expect(setReportingPeriodState).not.toHaveBeenCalled();
  });

  it("lets an unexpected fault reach the error boundary instead of reporting a quiet success", async () => {
    setReportingPeriodState.mockRejectedValue(new Error('relation "ReportingPeriod" does not exist'));
    await expect(setReportingPeriodStateAction(closeForm())).rejects.toThrow("ReportingPeriod");
  });
});

describe("a write into a closed month", () => {
  const entry = form({
    siteId: SITE_A,
    code: "S1-01",
    periodInput: "2026-09",
    rawValue: "1200",
    rawUnit: "kWh",
  });

  it("tells the user the period is closed and what to do about it", async () => {
    createActivityEntryWithCalculations.mockRejectedValue(new ReportingPeriodClosedError());

    const state = await submitEntryAction(
      { error: null, success: false, flagged: false, flagReason: null, awaitingFactor: false },
      entry,
    );

    expect(state.success).toBe(false);
    expect(state.error).toBe("This reporting period is closed. Reopen the period before changing accounting data.");
    expect(state.error).not.toContain("Something went wrong");
  });

  it("says the same thing when the database trigger is what refused the write", async () => {
    // A direct/bulk path reaches the trigger rather than the service guard;
    // the screen must not show the raw SQL failure.
    createActivityEntryWithCalculations.mockRejectedValue(
      new Error('db error: ERROR: REPORTING_PERIOD_CLOSED\n   at RuntimeError.fromPanic'),
    );

    const state = await submitEntryAction(
      { error: null, success: false, flagged: false, flagReason: null, awaitingFactor: false },
      entry,
    );

    expect(state.error).toBe("This reporting period is closed. Reopen the period before changing accounting data.");
    expect(state.error).not.toContain("RuntimeError");
  });

  it("refuses a stale page's write on the server, not on what the page was rendered with", async () => {
    // The page was rendered while the month was open; somebody else closed it
    // in between. Nothing client-side is consulted — the write is attempted
    // and the server's refusal is what the user is told.
    createActivityEntryWithCalculations.mockRejectedValue(new ReportingPeriodClosedError());

    const state = await submitEntryAction(
      { error: null, success: true, flagged: false, flagReason: null, awaitingFactor: false },
      entry,
    );

    expect(createActivityEntryWithCalculations).toHaveBeenCalledTimes(1);
    expect(state.success).toBe(false);
    expect(state.error).toContain("This reporting period is closed");
  });

  it("leaves an ordinary save alone", async () => {
    createActivityEntryWithCalculations.mockResolvedValue({
      entry: { status: "SUBMITTED" },
      calculations: [{ id: "calc-1" }],
      plausibility: { reason: null },
    });

    const state = await submitEntryAction(
      { error: null, success: false, flagged: false, flagReason: null, awaitingFactor: false },
      entry,
    );

    expect(state).toEqual({ error: null, success: true, flagged: false, flagReason: null, awaitingFactor: false });
  });
});

/**
 * Phase 2B-ii route check for /data. Renders the real server component with
 * the service layer stubbed, so this asserts what the page does with what it
 * is given: honest empty states (never the "Section unavailable" error card),
 * a real error card plus a logged exception when the plan genuinely fails to
 * load, correct status badges and summary counts, working filters, entry
 * links into the existing route, and no management controls for a member
 * without the grant.
 *
 * Rendered with react-dom/server, matching the existing board component
 * tests — this repository has no React test-renderer dependency.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ORG_A, SITE_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";
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

class MockOrganisationAccessError extends Error {
  constructor(readonly reason: string) {
    super(`Organisation context unavailable: ${reason}`);
  }
}
const requireOrganisationContext = vi.fn();
vi.mock("@/lib/organisation/session", () => ({
  requireOrganisationContext: () => requireOrganisationContext(),
  OrganisationAccessError: MockOrganisationAccessError,
}));

// The server actions pull in NextAuth via the session module; the page only
// needs function references to hand to <form action={...}>.
vi.mock("@/app/(app)/data/actions", () => ({
  generateCollectionPlanAction: () => undefined,
  decideRequirementAction: () => undefined,
  setReportingPeriodStateAction: () => undefined,
}));

// Phase 4-iii: the close/reopen panel reads through the Phase 4-ii service.
const getReportingPeriodView = vi.fn();
vi.mock("@/lib/carbon/reporting-period-view", async () => {
  const actual = await vi.importActual<typeof import("@/lib/carbon/reporting-period-view")>(
    "@/lib/carbon/reporting-period-view",
  );
  return { ...actual, getReportingPeriodView: (...a: unknown[]) => getReportingPeriodView(...a) };
});

const listConfigurableSites = vi.fn();
const listSourceCatalogue = vi.fn();
vi.mock("@/lib/carbon/source-config-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/carbon/source-config-service")>(
    "@/lib/carbon/source-config-service",
  );
  return {
    ...actual,
    listConfigurableSites: (...a: unknown[]) => listConfigurableSites(...a),
    listSourceCatalogue: (...a: unknown[]) => listSourceCatalogue(...a),
  };
});

const getCollectionMatrix = vi.fn();
vi.mock("@/lib/carbon/collection-plan-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/carbon/collection-plan-service")>(
    "@/lib/carbon/collection-plan-service",
  );
  return { ...actual, getCollectionMatrix: (...a: unknown[]) => getCollectionMatrix(...a) };
});

const logEvent = vi.fn();
vi.mock("@/lib/observability/logger", () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const DataPage = (await import("@/app/(app)/data/page")).default;

const GAS = "adp-gas";
const site = { id: SITE_A, name: "Aster North", entityId: "entity-aster", entityName: "Aster Manufacturing" };
const source = {
  id: GAS,
  code: "S1-01",
  scope: "SCOPE_1" as const,
  category: "Stationary combustion",
  dataPointName: "Natural gas — facilities",
  promptTemplate: "How much gas?",
  helpText: null,
  unitOptions: ["kWh"],
  catalogueFrequency: "Monthly",
  factorCategory: "natural_gas",
  scope3Category: null,
  sortOrder: 1,
};

function cell(patch: Partial<Record<string, unknown>> = {}) {
  return {
    id: "req-1",
    siteId: SITE_A,
    activityDataPointId: GAS,
    periodKey: "2026-01",
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    periodEnd: new Date("2026-01-31T00:00:00.000Z"),
    periodKind: "MONTHLY",
    decision: "PENDING",
    status: "missing",
    entryIds: [],
    excludedReason: null,
    periodOpen: false,
    ...patch,
  };
}

function context(permissions: string[]): OrganisationContext {
  return makeOrganisationContext(ORG_A, {
    permissions: new Set(permissions) as unknown as OrganisationContext["permissions"],
  });
}

async function render(searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(await DataPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  requireOrganisationContext.mockResolvedValue(context(["carbon.view", "carbon.entry.review", "carbon.entry.approve"]));
  listConfigurableSites.mockResolvedValue([site]);
  listSourceCatalogue.mockResolvedValue([source]);
  getCollectionMatrix.mockResolvedValue([cell()]);
  getReportingPeriodView.mockReset().mockResolvedValue({
    siteId: SITE_A,
    monthStart: new Date(Date.UTC(2026, 8, 1)),
    monthLabel: "September 2026",
    monthInput: "2026-09",
    state: "OPEN",
    canTransition: true,
    current: null,
    history: [],
  });
  logEvent.mockClear();
});

describe("/data", () => {
  it("renders the page, its controls and the matrix", async () => {
    const html = await render();
    expect(html).toContain("Data Collection");
    expect(html).toContain("Track required carbon data by site, source and period");
    expect(html).toContain("Natural gas — facilities");
    expect(html).toContain("Aster North");
    expect(html).toContain("2026-01");
    expect(html).toContain("Missing");
    expect(html).not.toContain("Section unavailable");
  });

  it("shows a setup state, not an error card, when no site is in scope", async () => {
    listConfigurableSites.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("No sites available to you yet");
    expect(html).not.toContain("Section unavailable");
  });

  it("shows a setup state, not an error card, when no plan has been generated", async () => {
    getCollectionMatrix.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("No collection plan for this period yet");
    expect(html).toContain("/sources");
    expect(html).not.toContain("Section unavailable");
  });

  it("shows a real error card and logs the exception when the plan genuinely fails to load", async () => {
    getCollectionMatrix.mockRejectedValue(new Error('relation "CarbonCollectionRequirement" does not exist'));
    const html = await render();
    expect(html).toContain("Section unavailable");

    expect(logEvent).toHaveBeenCalledTimes(1);
    const entry = logEvent.mock.calls[0][0];
    expect(entry.level).toBe("error");
    expect(entry.message).toBe("data collection plan load failed");
    expect(entry.fields.errorMessage).toContain("CarbonCollectionRequirement");
    expect(entry.fields.stack).toBeTruthy();
    // The real exception stays server-side.
    expect(html).not.toContain("CarbonCollectionRequirement");
  });

  it("counts each status in the summary cards", async () => {
    getCollectionMatrix.mockResolvedValue([
      cell({ id: "r1", status: "missing", periodKey: "2026-01" }),
      cell({ id: "r2", status: "reviewed", periodKey: "2026-02", decision: "REVIEWED" }),
      cell({ id: "r3", status: "awaiting_factor", periodKey: "2026-03" }),
    ]);
    const html = await render();
    expect(html).toContain("Required");
    expect(html).toContain("Awaiting factor");
    expect(html).toContain("Changed since review");
    // Three requirements, one of each of three statuses.
    expect(html).toContain(">3<");
  });

  it("renders a period that has not closed yet as still open rather than late", async () => {
    getCollectionMatrix.mockResolvedValue([cell({ periodOpen: true })]);
    // "Period still running" is deliberately not the accounting wording — a
    // calendar period that has not ended is not a closed reporting period. It
    // says "period" rather than "month" because quarterly and annual
    // requirements share this column.
    expect(await render()).toContain("period still running");
  });

  it("asks for a single site before offering to close or reopen a month", async () => {
    const html = await render();
    expect(html).toContain("Reporting period");
    expect(html).toContain("closed or reopened one site at a time");
    expect(getReportingPeriodView).not.toHaveBeenCalled();
  });

  it("shows the reporting period for the selected site, defaulting to the last month in the window", async () => {
    const html = await render({ siteId: SITE_A, from: "2026-01", to: "2026-09" });
    expect(getReportingPeriodView).toHaveBeenCalledWith(expect.anything(), SITE_A, new Date(Date.UTC(2026, 8, 1)));
    expect(html).toContain("September 2026");
    expect(html).toContain("Close period");
  });

  it("reviews the month the visitor picked instead of the end of the window", async () => {
    await render({ siteId: SITE_A, from: "2026-01", to: "2026-09", periodMonth: "2026-03" });
    expect(getReportingPeriodView).toHaveBeenCalledWith(expect.anything(), SITE_A, new Date(Date.UTC(2026, 2, 1)));
  });

  it("shows a closed month as closed, with who closed it, and offers to reopen it", async () => {
    getReportingPeriodView.mockResolvedValue({
      siteId: SITE_A,
      monthStart: new Date(Date.UTC(2026, 8, 1)),
      monthLabel: "September 2026",
      monthInput: "2026-09",
      state: "CLOSED",
      canTransition: true,
      current: { state: "CLOSED", at: new Date("2026-09-15T14:22:00.000Z"), actorName: "Dana Okafor", reason: "Month-end close" },
      history: [{ state: "CLOSED", at: new Date("2026-09-15T14:22:00.000Z"), actorName: "Dana Okafor", reason: "Month-end close" }],
    });
    const html = await render({ siteId: SITE_A });
    expect(html).toContain(">Closed<");
    expect(html).toContain("Dana Okafor");
    expect(html).toContain("Reopen period");
    // A closed month is read-only, not an error state.
    expect(html).not.toContain("Section unavailable");
    expect(html).toContain("Natural gas — facilities");
  });

  it("reports a refused close honestly rather than as a generic failure", async () => {
    const html = await render({ siteId: SITE_A, error: "hold" });
    expect(html).toContain("under an active legal hold");
    expect(html).not.toContain("Something went wrong");
  });

  it("renders a period a row's cadence does not cover as not required, never as a zero or a gap", async () => {
    getCollectionMatrix.mockResolvedValue([
      cell({ id: "r1", periodKey: "2026-01" }),
      cell({ id: "r2", siteId: "site-other", periodKey: "2026-Q1", periodKind: "QUARTERLY" }),
    ]);
    const html = await render();
    // Two rows, two columns, two real cells — so exactly two blanks, each
    // labelled rather than left as a bare dash, and neither shown as
    // "Missing" (which would invent an expectation nobody set).
    expect(html.match(/Not required for this period/g)).toHaveLength(2);
    expect(html.match(/aria-label="[^"]*: Missing"/g)).toHaveLength(2);
  });

  it("filters by status and says so honestly when nothing matches", async () => {
    getCollectionMatrix.mockResolvedValue([cell({ status: "missing" })]);
    const html = await render({ status: "reviewed" });
    expect(html).toContain("No required data matches this filter");
    expect(html).not.toContain("Section unavailable");
  });

  it("reports when everything required has been supplied", async () => {
    getCollectionMatrix.mockResolvedValue([cell({ status: "reviewed", decision: "REVIEWED" })]);
    expect(await render()).toContain("Everything required for this period has been supplied");
  });

  it("links a selected cell to the existing entry route with period and return-to", async () => {
    const html = await render({ cell: "req-1" });
    expect(html).toContain("Requirement detail");
    expect(html).toContain(`/entry/${SITE_A}/S1-01?period=2026-01&amp;returnTo=%2Fdata`);
    expect(html).toContain("Enter data");
    expect(html).toContain("Expected unit");
    expect(html).toContain("kWh");
  });

  it("shows the exclusion reason and a reopen action for an excluded requirement", async () => {
    getCollectionMatrix.mockResolvedValue([
      cell({ status: "excluded", decision: "EXCLUDED", excludedReason: "Site closed that month" }),
    ]);
    const html = await render({ cell: "req-1" });
    expect(html).toContain("Site closed that month");
    expect(html).toContain("Reopen");
    expect(html).not.toContain("Mark reviewed");
  });

  it("hides every management control from a view-only member", async () => {
    requireOrganisationContext.mockResolvedValue(context(["carbon.view"]));
    const html = await render({ cell: "req-1" });
    expect(html).toContain("Natural gas — facilities");
    expect(html).not.toContain("Generate collection plan");
    expect(html).not.toContain("Refresh collection plan");
    expect(html).not.toContain("Mark reviewed");
    expect(html).not.toContain("Exclude</button>");
    expect(html).toContain("not generate a plan or record decisions");
  });

  it("offers review but not exclude to a reviewer without the approve grant", async () => {
    requireOrganisationContext.mockResolvedValue(context(["carbon.view", "carbon.entry.review"]));
    const html = await render({ cell: "req-1" });
    expect(html).toContain("Mark reviewed");
    expect(html).toContain("Refresh collection plan");
    expect(html).not.toContain("Reason to exclude");
  });

  it("reports what a generation run actually did, including zero", async () => {
    const html = await render({ generated: "0:12:2" });
    expect(html).toContain("Collection plan refreshed");
    expect(html).toContain("0 new requirements created");
    expect(html).toContain("12 already present");
    expect(html).toContain("2 ad-hoc sources were skipped");
  });

  it("sends a visitor with no organisation context to sign in", async () => {
    requireOrganisationContext.mockRejectedValue(new MockOrganisationAccessError("NOT_AUTHENTICATED"));
    await expect(render()).rejects.toThrow(FakeRedirectError);
  });
});

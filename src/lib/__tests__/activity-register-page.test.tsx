/**
 * Phase 4-iii-b route check for /activity and /activity/[id]. The real server
 * components are rendered with the register service stubbed, so these assert
 * what the screens do with what they are given: honest empty states, the real
 * Carbon Ledger status vocabulary, filters that reach the service, closed
 * periods presented as read-only rather than broken, and — the part a demo
 * turns on — destructive actions that are only offered where they can
 * actually succeed, with the specific reason shown where they cannot.
 *
 * Rendered with react-dom/server, matching the existing board and /data route
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
class FakeNotFoundError extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new FakeRedirectError(url);
  },
  notFound: () => {
    throw new FakeNotFoundError("not found");
  },
}));

class MockOrganisationAccessError extends Error {}
const requireOrganisationContext = vi.fn();
vi.mock("@/lib/organisation/session", () => ({
  requireOrganisationContext: () => requireOrganisationContext(),
  OrganisationAccessError: MockOrganisationAccessError,
}));

// The server actions pull in NextAuth via the session module; the pages only
// need function references to hand to <form action={...}>.
vi.mock("@/app/(app)/activity/actions", () => ({
  updateActivityNotesAction: () => undefined,
  deleteActivityEntryAction: () => undefined,
}));

const listActivityRegister = vi.fn();
const getRegisterFilterOptions = vi.fn();
const getActivityRecord = vi.fn();
vi.mock("@/lib/carbon/activity-register-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/carbon/activity-register-service")>(
    "@/lib/carbon/activity-register-service",
  );
  return {
    ...actual,
    listActivityRegister: (...a: unknown[]) => listActivityRegister(...a),
    getRegisterFilterOptions: (...a: unknown[]) => getRegisterFilterOptions(...a),
    getActivityRecord: (...a: unknown[]) => getActivityRecord(...a),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const RegisterPage = (await import("@/app/(app)/activity/page")).default;
const RecordPage = (await import("@/app/(app)/activity/[id]/page")).default;

const SEPTEMBER = new Date(Date.UTC(2026, 8, 1));
const SEPTEMBER_END = new Date(Date.UTC(2026, 8, 30));

function context(permissions: string[]): OrganisationContext {
  return makeOrganisationContext(ORG_A, {
    permissions: new Set(permissions) as unknown as OrganisationContext["permissions"],
  });
}
const FULL = ["carbon.view", "carbon.entry.create", "carbon.entry.review", "carbon.entry.approve"];
const READ_ONLY = ["carbon.view"];

function row(patch: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    periodStart: SEPTEMBER,
    periodEnd: SEPTEMBER_END,
    code: "S1-01",
    dataPointName: "Natural gas — facilities",
    scope: "SCOPE_1",
    scope3Category: null,
    optionLabel: null,
    organisationName: "Aster Group",
    siteName: "Aster North",
    entityName: "Aster Manufacturing",
    rawValue: 1200,
    rawUnit: "kWh",
    status: "SUBMITTED",
    plausibilityFlagged: false,
    calculationCount: 1,
    resultKgCo2e: 219.6,
    updatedAt: SEPTEMBER,
    periodState: "OPEN",
    ...patch,
  };
}

function record(patch: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    periodStart: SEPTEMBER,
    periodEnd: SEPTEMBER_END,
    code: "S1-01",
    dataPointName: "Natural gas — facilities",
    category: "Stationary combustion",
    scope: "SCOPE_1",
    scope3Category: null,
    optionLabel: null,
    organisationName: "Aster Group",
    siteId: SITE_A,
    siteName: "Aster North",
    entityName: "Aster Manufacturing",
    rawValue: 1200,
    rawUnit: "kWh",
    canonicalValue: 1200,
    canonicalUnit: "kWh",
    supplierName: null,
    notes: "Meter read from the October invoice",
    status: "SUBMITTED",
    dataQualityTier: "TIER_1",
    dataOrigin: "USER_ENTERED",
    plausibilityFlagged: false,
    plausibilityReason: null,
    enteredByName: "Dana Okafor",
    enteredAt: SEPTEMBER,
    updatedAt: SEPTEMBER,
    sourceDocumentId: null,
    sourceDocumentName: null,
    calculations: [],
    references: { calculations: 0, lcaLinks: 0, commutingSurvey: false, sourceReviews: 0, reportSnapshots: 0 },
    periodState: "OPEN",
    ...patch,
  };
}

async function renderRegister(searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(await RegisterPage({ searchParams: Promise.resolve(searchParams) }));
}

async function renderRecord(searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(
    await RecordPage({ params: Promise.resolve({ id: "entry-1" }), searchParams: Promise.resolve(searchParams) }),
  );
}

beforeEach(() => {
  requireOrganisationContext.mockReset().mockResolvedValue(context(FULL));
  getRegisterFilterOptions.mockReset().mockResolvedValue({
    sites: [{ id: SITE_A, label: "Aster Manufacturing — Aster North" }],
    dataPoints: [{ id: "adp-gas", label: "S1-01 — Natural gas — facilities" }],
  });
  listActivityRegister.mockReset().mockResolvedValue({ rows: [row()], total: 1, page: 1, pageCount: 1 });
  getActivityRecord.mockReset().mockResolvedValue(record());
});

describe("/activity register", () => {
  it("renders the entered activity records with their real status vocabulary", async () => {
    const html = await renderRegister();
    expect(html).toContain("Activity Data Register");
    expect(html).toContain("Natural gas — facilities");
    expect(html).toContain("Aster North");
    expect(html).toContain("1,200 kWh");
    expect(html).toContain("Submitted");
  });

  it("passes the site, period, status, scope and source filters to the service", async () => {
    await renderRegister({
      siteId: SITE_A,
      from: "2026-09",
      to: "2026-09",
      status: "AWAITING_FACTOR",
      scope: "SCOPE_2",
      source: "adp-gas",
    });

    expect(listActivityRegister.mock.calls[0][1]).toMatchObject({
      siteId: SITE_A,
      status: "AWAITING_FACTOR",
      scope: "SCOPE_2",
      activityDataPointId: "adp-gas",
    });
  });

  it("passes free-text search through rather than filtering in the browser", async () => {
    await renderRegister({ q: "Aster" });
    expect(listActivityRegister.mock.calls[0][1].q).toBe("Aster");
  });

  it("ignores a status or scope that is not part of the domain vocabulary", async () => {
    await renderRegister({ status: "NONSENSE", scope: "SCOPE_9" });
    const filters = listActivityRegister.mock.calls[0][1];
    expect(filters.status).toBeUndefined();
    expect(filters.scope).toBeUndefined();
  });

  it("links each record to its own detail route", async () => {
    const html = await renderRegister();
    expect(html).toContain('href="/activity/entry-1"');
  });

  it("marks a closed-period record read-only without hiding it", async () => {
    listActivityRegister.mockResolvedValue({
      rows: [row({ periodState: "CLOSED" })],
      total: 1,
      page: 1,
      pageCount: 1,
    });
    const html = await renderRegister();
    expect(html).toContain("Closed period");
    expect(html).toContain("read-only");
    // Still fully readable: the record and its figure are on the page.
    expect(html).toContain("Natural gas — facilities");
  });

  it("shows an honest empty state, not an error card, when nothing has been entered", async () => {
    listActivityRegister.mockResolvedValue({ rows: [], total: 0, page: 1, pageCount: 1 });
    const html = await renderRegister();
    expect(html).toContain("No activity data entered yet");
    expect(html).not.toContain("Section unavailable");
  });

  it("distinguishes an over-filtered register from an empty one", async () => {
    listActivityRegister.mockResolvedValue({ rows: [], total: 0, page: 1, pageCount: 1 });
    const html = await renderRegister({ q: "nothing matches this" });
    expect(html).toContain("No activity data matches these filters");
  });

  it("pages server-side, carrying the active filters into the page links", async () => {
    listActivityRegister.mockResolvedValue({ rows: [row()], total: 60, page: 2, pageCount: 3 });
    const html = await renderRegister({ page: "2", siteId: SITE_A, q: "gas" });
    expect(html).toContain("Page 2 of 3");
    expect(html).toContain("page=3");
    expect(html).toContain(`siteId=${SITE_A}`);
    expect(html).toContain("q=gas");
  });

  it("surfaces a closed-period rejection from the server in its own words", async () => {
    const html = await renderRegister({ error: "closed" });
    expect(html).toContain("This reporting period is closed. Reopen the period before changing accounting data.");
    expect(html).not.toContain("Something went wrong");
  });
});

describe("/activity/[id] record", () => {
  it("opens a record and shows the activity, its provenance and its period state", async () => {
    const html = await renderRecord();
    expect(html).toContain("Natural gas — facilities");
    expect(html).toContain("Stationary combustion");
    expect(html).toContain("Dana Okafor");
    expect(html).toContain("Open for accounting changes");
  });

  it("shows the factor and result behind a calculated record, and links the explanation", async () => {
    getActivityRecord.mockResolvedValue(
      record({
        calculations: [
          {
            id: "calc-1",
            basis: "STANDARD",
            scope: "SCOPE_1",
            resultKgCo2e: 219.6,
            factorValue: 0.183,
            factorUnit: "kgCO2e/kWh",
            factorSource: "DEFRA/DESNZ 2024",
            factorVintage: "2024",
            calculatedAt: SEPTEMBER,
          },
        ],
        references: { calculations: 1, lcaLinks: 0, commutingSurvey: false, sourceReviews: 0, reportSnapshots: 2 },
      }),
    );
    const html = await renderRecord();
    expect(html).toContain("DEFRA/DESNZ 2024");
    expect(html).toContain('href="/calculations/calc-1"');
  });

  it("offers notes editing on an open-period record", async () => {
    const html = await renderRecord();
    expect(html).toContain("Save notes");
    expect(html).toContain('name="notes"');
  });

  it("blocks editing on a closed-period record and says why, keeping the record readable", async () => {
    getActivityRecord.mockResolvedValue(record({ periodState: "CLOSED" }));
    const html = await renderRecord();
    expect(html).not.toContain("Save notes");
    expect(html).toContain("This reporting period is closed. Reopen the period before changing accounting data.");
    expect(html).toContain("Meter read from the October invoice");
  });

  it("offers deletion on a safe record only behind an explicit confirmation naming it", async () => {
    const listed = await renderRecord();
    expect(listed).toContain("Delete this activity record");
    // The first click only asks; nothing is submitted yet.
    expect(listed).not.toContain('value="DELETE"');

    const confirming = await renderRecord({ confirm: "1" });
    expect(confirming).toContain("Delete this activity record?");
    expect(confirming).toContain("1,200 kWh");
    expect(confirming).toContain("Aster North");
    expect(confirming).toContain("cannot be undone");
    expect(confirming).toContain('value="DELETE"');
  });

  it("protects a calculated record from deletion, naming the figure as the reason", async () => {
    getActivityRecord.mockResolvedValue(
      record({ references: { calculations: 1, lcaLinks: 0, commutingSurvey: false, sourceReviews: 0, reportSnapshots: 3 } }),
    );
    const html = await renderRecord({ confirm: "1" });
    expect(html).toContain("protected and cannot be deleted");
    expect(html).toContain("emissions figure");
    expect(html).toContain("3 issued reports");
    expect(html).not.toContain('value="DELETE"');
  });

  it("protects a record a product assessment cites, and says which dependency holds it", async () => {
    getActivityRecord.mockResolvedValue(
      record({ references: { calculations: 0, lcaLinks: 2, commutingSurvey: false, sourceReviews: 0, reportSnapshots: 0 } }),
    );
    const html = await renderRecord();
    expect(html).toContain("2 product assessments cite");
    expect(html).not.toContain('value="DELETE"');
  });

  it("blocks deletion in a closed period", async () => {
    getActivityRecord.mockResolvedValue(record({ periodState: "CLOSED" }));
    const html = await renderRecord({ confirm: "1" });
    expect(html).toContain("protected and cannot be deleted");
    expect(html).not.toContain('value="DELETE"');
  });

  it("gives a read-only member the whole record but neither mutation", async () => {
    requireOrganisationContext.mockResolvedValue(context(READ_ONLY));
    const html = await renderRecord({ confirm: "1" });
    expect(html).toContain("Natural gas — facilities");
    expect(html).toContain("Meter read from the October invoice");
    expect(html).not.toContain("Save notes");
    expect(html).not.toContain('value="DELETE"');
    expect(html).toContain("You do not have permission");
  });

  it("explains that a record awaiting a factor is complete, not broken", async () => {
    getActivityRecord.mockResolvedValue(record({ status: "AWAITING_FACTOR", calculations: [] }));
    const html = await renderRecord();
    expect(html).toContain("Awaiting emission factor");
    expect(html).toContain("waiting on an emission factor");
  });

  it("does not reveal that an out-of-scope record exists", async () => {
    getActivityRecord.mockResolvedValue(null);
    await expect(renderRecord()).rejects.toBeInstanceOf(FakeNotFoundError);
  });
});

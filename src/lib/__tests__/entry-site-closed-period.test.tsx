/**
 * Phase 4-iii read-only experience. A closed month must look closed on the
 * screen a person enters data from — and must still show every source, its
 * status and its links, so the site stays readable rather than looking
 * broken. The refusal itself remains the Phase 4-ii barrier's job; this page
 * only reports what that barrier already says.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ORG_A, SITE_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";
import type { OrganisationContext } from "@/lib/organisation/context";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const requireOrganisationContext = vi.fn();
vi.mock("@/lib/organisation/session", () => ({
  requireOrganisationContext: () => requireOrganisationContext(),
  OrganisationAccessError: class extends Error {},
}));

const requireSiteInScope = vi.fn();
vi.mock("@/lib/repositories/carbon-repository", async () => {
  const actual = await vi.importActual<typeof import("@/lib/repositories/carbon-repository")>(
    "@/lib/repositories/carbon-repository",
  );
  return { ...actual, requireSiteInScope: (...a: unknown[]) => requireSiteInScope(...a) };
});

const getReportingPeriod = vi.fn();
vi.mock("@/lib/carbon/reporting-period-service", () => ({
  getReportingPeriod: (...a: unknown[]) => getReportingPeriod(...a),
  setReportingPeriodState: vi.fn(),
}));

const getSiteQuantityStatus = vi.fn();
const getSiteContractStatus = vi.fn();
vi.mock("@/lib/entry-status", () => ({
  getSiteQuantityStatus: (...a: unknown[]) => getSiteQuantityStatus(...a),
  getSiteContractStatus: (...a: unknown[]) => getSiteContractStatus(...a),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { entity: { findUnique: async () => ({ id: "entity-aster", name: "Aster Manufacturing" }) } },
}));

const SiteEntryPage = (await import("@/app/(app)/entry/[siteId]/page")).default;

const NOW = new Date();
const CURRENT_MONTH_LABEL = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1)).toLocaleDateString("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function context(permissions: string[]): OrganisationContext {
  return makeOrganisationContext(ORG_A, {
    permissions: new Set(permissions) as unknown as OrganisationContext["permissions"],
  });
}

async function render() {
  return renderToStaticMarkup(await SiteEntryPage({ params: Promise.resolve({ siteId: SITE_A }) }));
}

beforeEach(() => {
  requireOrganisationContext.mockReset().mockResolvedValue(context(["carbon.view", "carbon.entry.create"]));
  requireSiteInScope.mockReset().mockResolvedValue({ id: SITE_A, name: "Aster North", entityId: "entity-aster" });
  getReportingPeriod.mockReset().mockResolvedValue({ id: null, state: "OPEN" });
  getSiteContractStatus.mockReset().mockResolvedValue(null);
  getSiteQuantityStatus.mockReset().mockResolvedValue([
    {
      dataPoint: { id: "adp-gas", code: "S1-01", scope: "SCOPE_1", dataPointName: "Natural gas — facilities" },
      status: "submitted",
      periodLabel: "September 2026",
    },
    {
      dataPoint: { id: "adp-elec", code: "S2-01", scope: "SCOPE_2", dataPointName: "Purchased electricity" },
      status: "missing",
      periodLabel: "September 2026",
    },
  ]);
});

describe("/entry/[siteId] with a closed reporting period", () => {
  it("says nothing about closure while the month is open", async () => {
    const html = await render();
    expect(html).not.toContain("read only");
    expect(html).toContain("Natural gas — facilities");
  });

  it("says the month is closed and read-only, and points to where it is reopened", async () => {
    getReportingPeriod.mockResolvedValue({ id: "period-1", state: "CLOSED" });

    const html = await render();

    expect(html).toContain(`${CURRENT_MONTH_LABEL} is closed`);
    expect(html).toContain("read only");
    expect(html).toContain("viewed but not added, changed or deleted");
    expect(html).toContain("Other months are unaffected");
    expect(html).toContain(`/data?siteId=${SITE_A}`);
  });

  it("keeps the site fully readable when the month is closed", async () => {
    getReportingPeriod.mockResolvedValue({ id: "period-1", state: "CLOSED" });

    const html = await render();

    // Sources, statuses and their links all stay — a closed month is
    // read-only, not an empty or failed page.
    expect(html).toContain("Natural gas — facilities");
    expect(html).toContain("Submitted");
    expect(html).toContain(`/entry/${SITE_A}/S1-01`);
    expect(html).toContain("Electricity supplier &amp; REGO certificates");
  });

  it("does not ask for the period when the membership cannot read carbon data", async () => {
    requireOrganisationContext.mockResolvedValue(context(["carbon.entry.create"]));

    await render();

    expect(getReportingPeriod).not.toHaveBeenCalled();
  });
});

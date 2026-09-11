import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExecutiveOverview } from "../overview";
import type { CarbonMetric, Coverage, OverviewModel } from "../../../lib/board/contracts";

/**
 * An ordinary organisation that has not loaded anything yet must get real
 * setup states, never the "Section unavailable" error card — that card is
 * reserved for a section that genuinely failed to load.
 *
 * Rendered with react-dom/server rather than a DOM testing library: this
 * repository has no React test-renderer dependency and one is not worth
 * adding to assert on rendered copy.
 */
const coverage = (): Coverage => ({ expected: null, received: 0, reviewed: 0, excluded: 0, awaitingFactor: 0, flagged: 0 });
const missing = (): CarbonMetric => ({ kgCO2e: null, state: "missing", coverage: coverage(), comparisonKey: "k", source: { label: "View source inventory", href: "/carbon" } });

function model(overrides: Partial<OverviewModel> = {}): OverviewModel {
  return {
    organisationName: "Northwind Operations", periodLabel: "Jan–Sep 2026", previousPeriodLabel: "Jan–Sep 2025",
    synthetic: false, capturedAt: "2026-09-11T09:00:00.000Z", managementPack: null,
    carbon: { state: "ready", asOf: "2026-09-11T09:00:00.000Z", data: {
      current: missing(), previous: missing(), marketBasedKg: null, quantifiedCategories: 0,
      screenedCategories: null, screenedCategoriesReason: "Scope 3 screening is not recorded for this reporting boundary.",
      sites: [], trend: [],
    } },
    attention: { state: "ready", asOf: "2026-09-11T09:00:00.000Z", data: { items: [], total: 0, openActions: 0, awaitingVerification: 0, emsAvailable: true, emsUnavailableReason: null } },
    priorities: { state: "ready", asOf: "2026-09-11T09:00:00.000Z", data: [] },
    ...overrides,
  };
}

describe("Overview for an ordinary organisation with no data", () => {
  const html = renderToStaticMarkup(<ExecutiveOverview model={model()} />);

  it("never shows the error card for an expected no-data state", () => {
    expect(html).not.toContain("Section unavailable");
  });

  it("offers a real next step for sites, emissions data and management focus", () => {
    expect(html).toContain("No sites set up yet");
    expect(html).toContain("Set up sites");
    expect(html).toContain("Nothing is competing for management attention");
    expect(html).toContain("/admin/organisation");
  });

  it("prompts for activity data once sites exist but no period has data", () => {
    const withSite = model();
    if (withSite.carbon.state !== "ready") throw new Error("fixture");
    withSite.carbon.data.sites = [{ id: "s1", name: "Depot", entity: "Northwind Ltd", current: missing(), previous: missing(), scope1Kg: null, scope2LocationKg: null, scope3Kg: null }];
    const withSiteHtml = renderToStaticMarkup(<ExecutiveOverview model={withSite} />);
    expect(withSiteHtml).toContain("No emissions data loaded yet");
    expect(withSiteHtml).toContain("Enter activity data");
    expect(withSiteHtml).not.toContain("Section unavailable");
  });

  it("still shows the error card when a section genuinely failed", () => {
    const failed = model({ carbon: { state: "unavailable", message: "The emissions figures could not be read for this period." } });
    const failedHtml = renderToStaticMarkup(<ExecutiveOverview model={failed} />);
    expect(failedHtml).toContain("Section unavailable");
    expect(failedHtml).toContain("could not be read");
  });
});

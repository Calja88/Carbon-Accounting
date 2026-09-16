import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExecutiveOverview } from "../overview";
import type { CarbonMetric, Coverage, OverviewModel } from "../../../lib/board/contracts";

/**
 * Phase 1B: /carbon's figures now live on the one dashboard. These assert the
 * sections actually made the move, and — more importantly — that a period
 * with no confirmed result still reads as missing rather than as a zero or as
 * an improvement.
 *
 * Rendered with react-dom/server, matching overview-empty-states.test.tsx.
 */
const complete = (): Coverage => ({ expected: 2, received: 2, reviewed: 2, excluded: 0, awaitingFactor: 0, flagged: 0 });
const none = (): Coverage => ({ expected: null, received: 0, reviewed: 0, excluded: 0, awaitingFactor: 0, flagged: 0 });
const ready = (kg: number): CarbonMetric => ({ kgCO2e: kg, state: "complete", coverage: complete(), comparisonKey: "same", source: { label: "View source inventory", href: "/" } });
const missing = (): CarbonMetric => ({ kgCO2e: null, state: "missing", coverage: none(), comparisonKey: "same", source: { label: "View source inventory", href: "/" } });

function model(current: CarbonMetric, previous: CarbonMetric, overrides: Partial<OverviewModel["carbon"] & { data: unknown }> = {}): OverviewModel {
  return {
    organisationName: "Paragon Group", periodLabel: "Jan–Sep 2026", previousPeriodLabel: "Jan–Sep 2025",
    synthetic: false, capturedAt: "2026-09-14T09:00:00.000Z", managementPack: null,
    carbon: {
      state: "ready", asOf: "2026-09-14T09:00:00.000Z",
      data: {
        current, previous, marketBasedKg: current.kgCO2e === null ? null : 40_000,
        quantifiedCategories: 4, screenedCategories: null,
        screenedCategoriesReason: "Scope 3 screening is not recorded for this reporting boundary.",
        sites: [{
          id: "site-a", name: "Ashby Works", entity: "Paragon Manufacturing",
          current, previous,
          scope1Kg: current.kgCO2e === null ? null : 300_000,
          scope2LocationKg: current.kgCO2e === null ? null : 200_000,
          scope3Kg: current.kgCO2e === null ? null : 500_000,
        }],
        trend: [],
        scopeBreakdown: [
          { key: "scope1", label: "Scope 1 — direct", currentKg: current.kgCO2e === null ? null : 300_000, previousKg: previous.kgCO2e === null ? null : 400_000 },
          { key: "scope2Location", label: "Scope 2 — electricity (location-based)", currentKg: current.kgCO2e === null ? null : 200_000, previousKg: previous.kgCO2e === null ? null : 200_000 },
          { key: "scope3", label: "Scope 3 — value chain", currentKg: current.kgCO2e === null ? null : 500_000, previousKg: previous.kgCO2e === null ? null : 400_000 },
        ],
        categories: current.kgCO2e === null ? [] : [
          { key: "gas", label: "Natural gas", kgCO2e: 600_000 },
          { key: "elec", label: "Purchased electricity", kgCO2e: 400_000 },
        ],
      },
      ...overrides,
    } as OverviewModel["carbon"],
    attention: { state: "ready", asOf: "2026-09-14T09:00:00.000Z", data: { items: [], total: 0, openActions: 0, awaitingVerification: 0, emsAvailable: true, emsUnavailableReason: null } },
    priorities: { state: "ready", asOf: "2026-09-14T09:00:00.000Z", data: [] },
  };
}

describe("the consolidated carbon dashboard", () => {
  const html = renderToStaticMarkup(<ExecutiveOverview model={model(ready(1_000_000), ready(1_000_000))} />);

  it("carries the scope split that only /carbon used to show", () => {
    expect(html).toContain("Scope 1 — direct");
    expect(html).toContain("Scope 2 — electricity (location-based)");
    expect(html).toContain("Scope 3 — value chain");
    expect(html).toContain("data-scope=\"scope1\"");
  });

  it("carries the category breakdown that only /carbon used to show", () => {
    expect(html).toContain("Largest sources");
    expect(html).toContain("Natural gas");
    expect(html).toContain("Purchased electricity");
  });

  it("keeps the market-based companion a companion, never added to the headline", () => {
    expect(html).toContain("Not added to the headline");
  });

  it("writes every figure through the shared formatting utility", () => {
    // lib/format's subscript unit, and its thousands grouping — not "tCO2e" or a raw kg number.
    expect(html).toContain("tCO₂e");
    expect(html).not.toContain("tCO2e");
    expect(html).toContain("1,000"); // 1,000,000 kg rendered as tonnes
  });
});

describe("a period with no confirmed result", () => {
  const html = renderToStaticMarkup(<ExecutiveOverview model={model(missing(), ready(1_200_000))} />);

  it("never renders a missing scope figure as zero", () => {
    expect(html).toContain("Not available");
    expect(html).not.toMatch(/data-scope="scope1"[^>]*data-value/);
  });

  it("keeps the prior period visible rather than hiding it with the current one", () => {
    expect(html).toContain("1,200");
    expect(html).toContain("vs Jan–Sep 2025");
  });

  it("says not comparable instead of showing an improvement", () => {
    expect(html).toContain("Not comparable");
    expect(html).toContain("reviewed coverage is required in both periods");
  });

  it("offers no category split rather than a split of zeroes", () => {
    expect(html).toContain("No category split for this period");
    expect(html).not.toContain("Natural gas");
  });

  it("treats absent data as a setup state, never as a failed section", () => {
    expect(html).not.toContain("Section unavailable");
  });
});

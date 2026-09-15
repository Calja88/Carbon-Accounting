import type { ManagementReportInput } from "../management-report";

export const CAT1 = "Cat 1 — Purchased goods & services";
export const CAT6 = "Cat 6 — Business travel";

/**
 * One coherent two-site, two-month period, built so that every reconciliation
 * the adapter enforces genuinely holds: site totals sum to the group, the
 * ranked source rows sum to the headline, and the headline is
 * Scope 1 + Scope 2 location-based + Scope 3.
 *
 * Shared by the Phase 5A read-model tests and the Phase 5B export tests, so
 * "the export matches the screen" is asserted against the same figures rather
 * than against a second fixture that could drift away from this one.
 */
export function input(overrides: Partial<ManagementReportInput> = {}): ManagementReportInput {
  const alpha = { scope1: 1000, scope2Location: 2000, scope2Market: 1500, scope3: 3000, total: 6000 };
  const beta = { scope1: 500, scope2Location: 500, scope2Market: 400, scope3: 1000, total: 2000 };
  const group = { scope1: 1500, scope2Location: 2500, scope2Market: 1900, scope3: 4000, total: 8000 };
  return {
    organisationName: "Synthetic Group",
    periodLabel: "Jan 2026 – Feb 2026",
    previousPeriodLabel: "Jan 2025 – Feb 2025",
    from: "2026-01",
    to: "2026-02",
    group,
    previousGroup: { scope1: 1200, scope2Location: 2000, scope2Market: 1500, scope3: 3000, total: 6200 },
    sites: [
      { siteId: "alpha", siteName: "Alpha Works", entityName: "Synthetic Ltd", totals: alpha },
      { siteId: "beta", siteName: "Beta Depot", entityName: "Synthetic Ltd", totals: beta },
    ],
    previousSitesById: {
      alpha: { scope1: 900, scope2Location: 1600, scope2Market: 1200, scope3: 2200, total: 4700 },
      beta: { scope1: 300, scope2Location: 400, scope2Market: 300, scope3: 800, total: 1500 },
    },
    monthly: [
      { month: "2026-01", label: "Jan 26", scope1: 900, scope2Location: 1500, scope3: 2400, total: 4800 },
      { month: "2026-02", label: "Feb 26", scope1: 600, scope2Location: 1000, scope3: 1600, total: 3200 },
    ],
    monthsWithData: ["2026-01", "2026-02"],
    previousMonthsWithData: ["2025-01", "2025-02"],
    previousMonthsInRange: 2,
    sourceRows: [
      { siteId: "alpha", siteName: "Alpha Works", scope: "SCOPE_3", category: CAT1, kgCo2e: 3000 },
      { siteId: "alpha", siteName: "Alpha Works", scope: "SCOPE_2", category: "Electricity", kgCo2e: 2000 },
      { siteId: "alpha", siteName: "Alpha Works", scope: "SCOPE_1", category: "Natural gas", kgCo2e: 1000 },
      { siteId: "beta", siteName: "Beta Depot", scope: "SCOPE_3", category: CAT1, kgCo2e: 1000 },
      { siteId: "beta", siteName: "Beta Depot", scope: "SCOPE_2", category: "Electricity", kgCo2e: 500 },
      { siteId: "beta", siteName: "Beta Depot", scope: "SCOPE_1", category: "Natural gas", kgCo2e: 500 },
    ],
    scope3Catalogue: [CAT1, CAT6],
    scope3Totals: { [CAT1]: 4000 },
    reportingPeriods: [
      { siteId: "alpha", month: "2026-01", state: "OPEN" },
      { siteId: "alpha", month: "2026-02", state: "OPEN" },
      { siteId: "beta", month: "2026-01", state: "OPEN" },
      { siteId: "beta", month: "2026-02", state: "OPEN" },
    ],
    collectionStatuses: ["reviewed", "submitted", "awaiting_factor", "missing", "excluded", "not_required"],
    flaggedCount: 0,
    factorSources: [{ source: "DEFRA/DESNZ 2024", vintage: "2024", scope: "SCOPE_1", placeholder: false }],
    engineVersions: ["calc-engine-v1"],
    boundary: "Synthetic Group — operational control.",
    dataQuality: [{ tier: "TIER_1", kgCo2e: 8000, percent: 100 }],
    marketBasedAvailable: true,
    capturedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

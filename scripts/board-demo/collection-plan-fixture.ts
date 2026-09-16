/**
 * The BOARD demo's synthetic collection plan, with no database dependency —
 * the same split as `prisma/seed/lca-demo-fixture.ts`, so the plan's shape
 * and the requirement count it implies can be asserted against the real
 * period-enumeration logic without a live connection.
 *
 * Synthetic demonstration configuration over the synthetic BOARD-1 fixture.
 * Not Paragon environmental data.
 */

import type { CarbonSourceFrequency } from "@prisma/client";

export interface PlannedSource {
  /** `Site.name` in the BOARD-1 fixture. */
  site: string;
  /** `ActivityDataPoint.code` in the BOARD-1 fixture. */
  sourceCode: string;
  frequency: CarbonSourceFrequency;
}

/**
 * When these sources began applying to the sites. The BOARD-1 fixture's
 * activity history starts in January 2025, so anything later would make the
 * generator skip periods the demo actually has data for (it never asks for
 * data from before a source applied), and anything earlier would ask for
 * data that never existed.
 */
export const EFFECTIVE_FROM = new Date(Date.UTC(2025, 0, 1));

/**
 * Deliberately not every site x source combination the schema would allow: a
 * real collection plan is shaped by what a site does. Central Digital is an
 * office, so it reports electricity and travel and no combustion; the two
 * operational sites report their own fuel and power.
 */
export const COLLECTION_PLAN: readonly PlannedSource[] = [
  { site: "North Works", sourceCode: "BOARD1-stationary_combustion_natural_gas", frequency: "MONTHLY" },
  { site: "North Works", sourceCode: "BOARD1-grid_electricity", frequency: "MONTHLY" },
  { site: "North Works", sourceCode: "BOARD1-mobile_combustion_fuel", frequency: "MONTHLY" },
  { site: "North Works", sourceCode: "BOARD1-board1_purchased_goods", frequency: "MONTHLY" },
  { site: "East Cards", sourceCode: "BOARD1-stationary_combustion_natural_gas", frequency: "MONTHLY" },
  { site: "East Cards", sourceCode: "BOARD1-grid_electricity", frequency: "MONTHLY" },
  { site: "Central Digital", sourceCode: "BOARD1-grid_electricity", frequency: "MONTHLY" },
  // Travel is collected from an expense system once a quarter rather than
  // monthly — and it exercises the generator's non-monthly cadence.
  { site: "Central Digital", sourceCode: "BOARD1-board1_business_travel", frequency: "QUARTERLY" },
];

/** Year-to-date: the window `/reports/management` opens on by default. */
export function reportingWindow(now: Date): { periodStart: Date; periodEnd: Date } {
  return {
    periodStart: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
    periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)),
  };
}

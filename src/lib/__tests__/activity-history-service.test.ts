import { describe, expect, it } from "vitest";
import { FactorBasis } from "@prisma/client";
import {
  buildActivityHistoryWhere,
  formatRowEmissions,
  parseActivityHistoryFilters,
  sumHeadlineKgCo2e,
} from "@/lib/activity-history-service";

describe("parseActivityHistoryFilters", () => {
  it("ignores an invalid enum value rather than passing it through to the query", () => {
    const filters = parseActivityHistoryFilters({ scope: "NOT_A_SCOPE", status: "BOGUS" });
    expect(filters.scope).toBeUndefined();
    expect(filters.status).toBeUndefined();
  });

  it("accepts a valid scope and status", () => {
    const filters = parseActivityHistoryFilters({ scope: "SCOPE_2", status: "FLAGGED" });
    expect(filters.scope).toBe("SCOPE_2");
    expect(filters.status).toBe("FLAGGED");
  });

  it("clamps page to a minimum of 1 and falls back to the default page size", () => {
    const filters = parseActivityHistoryFilters({ page: "0", pageSize: "999" });
    expect(filters.page).toBe(1);
    expect(filters.pageSize).toBe(25);
  });

  it("accepts a supported page size", () => {
    expect(parseActivityHistoryFilters({ pageSize: "50" }).pageSize).toBe(50);
  });

  it("drops an unparseable date rather than passing it to Prisma", () => {
    const filters = parseActivityHistoryFilters({ from: "not-a-date" });
    expect(filters.from).toBeUndefined();
  });

  it("trims search text and treats blank search as no filter", () => {
    expect(parseActivityHistoryFilters({ search: "  diesel  " }).search).toBe("diesel");
    expect(parseActivityHistoryFilters({ search: "   " }).search).toBeUndefined();
  });
});

describe("buildActivityHistoryWhere", () => {
  it("scopes to the authenticated site and status filters given", () => {
    const where = buildActivityHistoryWhere({ siteId: "site-1", status: "FLAGGED" });
    expect(where.siteId).toBe("site-1");
    expect(where.status).toBe("FLAGGED");
  });

  it("combines scope and category filters on the same activityDataPoint relation without clobbering each other", () => {
    const where = buildActivityHistoryWhere({ scope: "SCOPE_1", category: "Stationary combustion" });
    expect(where.activityDataPoint).toEqual({ scope: "SCOPE_1", category: "Stationary combustion" });
  });

  it("builds a case-insensitive OR search across the documented fields", () => {
    const where = buildActivityHistoryWhere({ search: "acme" });
    expect(Array.isArray(where.OR)).toBe(true);
    expect(where.OR!.length).toBeGreaterThan (0);
  });

  it("produces no filters at all for an empty filter set", () => {
    expect(buildActivityHistoryWhere({})).toEqual({});
  });
});

describe("sumHeadlineKgCo2e", () => {
  it("sums only STANDARD/LOCATION_BASED rows, never the MARKET_BASED companion", () => {
    const total = sumHeadlineKgCo2e([
      { basis: FactorBasis.LOCATION_BASED, resultKgCo2e: 100 },
      { basis: FactorBasis.MARKET_BASED, resultKgCo2e: 40 },
    ]);
    expect(total).toBe(100);
  });

  it("returns null (not 0) when nothing has been calculated yet", () => {
    expect(sumHeadlineKgCo2e([])).toBeNull();
  });
});

describe("formatRowEmissions", () => {
  it("shows 'Not calculated' rather than a fabricated zero", () => {
    expect(formatRowEmissions(null)).toBe("Not calculated");
  });

  it("formats sub-tonne figures in kgCO2e", () => {
    expect(formatRowEmissions(842)).toBe("842 kgCO2e");
  });

  it("formats figures at or above 1000kg in tCO2e", () => {
    expect(formatRowEmissions(1420)).toBe("1.42 tCO2e");
  });
});

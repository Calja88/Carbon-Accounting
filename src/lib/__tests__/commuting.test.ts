import { describe, expect, it } from "vitest";
import { computeCommutingMiles, totalPercentAssigned } from "@/lib/commuting";

describe("computeCommutingMiles", () => {
  it("multiplies headcount x mode share x distance x round trip x commuting days", () => {
    // 100 employees, 40% drive petrol cars, 5 miles one-way, 220 commuting days
    const miles = computeCommutingMiles({
      headcount: 100,
      percentOfHeadcount: 40,
      avgOneWayDistanceMiles: 5,
      commutingDaysInPeriod: 220,
    });
    // 100 * 0.4 * 5 * 2 * 220
    expect(miles).toBeCloseTo(88000, 5);
  });

  it("returns 0 when nobody uses this mode", () => {
    const miles = computeCommutingMiles({
      headcount: 100,
      percentOfHeadcount: 0,
      avgOneWayDistanceMiles: 5,
      commutingDaysInPeriod: 220,
    });
    expect(miles).toBe(0);
  });

  it("returns 0 for a zero-emission mode with a distance still recorded", () => {
    // Cycling/WFH modes still have a distance entered for completeness of
    // the modal split, but produce a real (non-zero) mileage figure — it's
    // the emission *factor* for that mode that's zero, not the distance.
    const miles = computeCommutingMiles({
      headcount: 50,
      percentOfHeadcount: 10,
      avgOneWayDistanceMiles: 2,
      commutingDaysInPeriod: 200,
    });
    expect(miles).toBeGreaterThan(0);
  });

  it("throws on negative inputs", () => {
    expect(() =>
      computeCommutingMiles({
        headcount: -1,
        percentOfHeadcount: 10,
        avgOneWayDistanceMiles: 2,
        commutingDaysInPeriod: 200,
      }),
    ).toThrow(RangeError);
  });
});

describe("totalPercentAssigned", () => {
  it("sums percentages across modes", () => {
    expect(totalPercentAssigned([40, 30, 20, 10])).toBe(100);
  });

  it("does not throw or clamp when the total is not 100 — informational only", () => {
    expect(totalPercentAssigned([40, 30])).toBe(70);
    expect(totalPercentAssigned([60, 60])).toBe(120);
  });
});

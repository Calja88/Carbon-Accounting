import { describe, expect, it } from "vitest";
import { checkPlausibility, DEFAULT_PLAUSIBILITY_THRESHOLD_PCT } from "@/lib/plausibility";

describe("checkPlausibility", () => {
  it("does not flag when there is no previous period to compare against", () => {
    const result = checkPlausibility(1000, null);
    expect(result.flagged).toBe(false);
  });

  it("does not flag a modest period-on-period change", () => {
    const result = checkPlausibility(1100, 1000);
    expect(result.flagged).toBe(false);
  });

  it("flags a jump beyond the default threshold, per the methodology's 300% MoM example", () => {
    const result = checkPlausibility(500, 100, DEFAULT_PLAUSIBILITY_THRESHOLD_PCT);
    expect(result.flagged).toBe(true);
    expect(result.reason).toContain("increase");
  });

  it("flags a sharp drop against a smaller threshold (a decrease can never exceed -100%, so the default 300% threshold can only ever fire on increases)", () => {
    const result = checkPlausibility(10, 1000, 80);
    expect(result.flagged).toBe(true);
    expect(result.reason).toContain("decrease");
  });

  it("respects a custom threshold", () => {
    const result = checkPlausibility(150, 100, 40);
    expect(result.flagged).toBe(true);
  });
});

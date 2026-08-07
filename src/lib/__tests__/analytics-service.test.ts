import { describe, expect, it } from "vitest";
import { buildDelta, previousYearPeriod } from "@/lib/analytics-service";
import { defaultDashboardRange, resolveMonthRange } from "@/lib/report-period";

describe("previousYearPeriod", () => {
  it("shifts the window back exactly one year, keeping the same dates", () => {
    const { start, end } = previousYearPeriod(
      new Date(Date.UTC(2026, 0, 1)),
      new Date(Date.UTC(2026, 7, 31)),
    );
    expect(start.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2025-08-31T00:00:00.000Z");
  });
});

describe("buildDelta", () => {
  it("treats a fall in emissions as an improvement", () => {
    const d = buildDelta(80, 100);
    expect(d.deltaKg).toBe(-20);
    expect(d.deltaPercent).toBeCloseTo(-20, 6);
    expect(d.direction).toBe("down");
    expect(d.isImprovement).toBe(true);
  });

  it("treats a rise in emissions as a worsening", () => {
    const d = buildDelta(120, 100);
    expect(d.direction).toBe("up");
    expect(d.isImprovement).toBe(false);
  });

  it("passes no judgement when there's no prior-year figure to compare against", () => {
    const d = buildDelta(120, 0);
    expect(d.deltaPercent).toBeNull();
    expect(d.isImprovement).toBeNull();
  });

  it("treats a sub-0.05% move as flat rather than dressing noise up as a trend", () => {
    const d = buildDelta(100.02, 100);
    expect(d.direction).toBe("flat");
    expect(d.isImprovement).toBeNull();
  });
});

describe("resolveMonthRange", () => {
  const now = new Date(Date.UTC(2026, 7, 15)); // 15 Aug 2026

  it("defaults to year-to-date through the end of the current month", () => {
    const r = defaultDashboardRange(now);
    expect(r.periodStart.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(r.periodEnd.toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("resolves valid month pickers to inclusive full-month bounds", () => {
    const r = resolveMonthRange("2025-02", "2025-04", now);
    expect(r.periodStart.toISOString()).toBe("2025-02-01T00:00:00.000Z");
    expect(r.periodEnd.toISOString()).toBe("2025-04-30T00:00:00.000Z");
  });

  it("falls back to the default window for malformed or reversed input", () => {
    const fallback = defaultDashboardRange(now).periodStart.toISOString();
    expect(resolveMonthRange("nonsense", "2025-04", now).periodStart.toISOString()).toBe(fallback);
    expect(resolveMonthRange("2025-13", "2025-04", now).periodStart.toISOString()).toBe(fallback);
    expect(resolveMonthRange("2025-06", "2025-01", now).periodStart.toISOString()).toBe(fallback);
    expect(resolveMonthRange(undefined, undefined, now).periodStart.toISOString()).toBe(fallback);
  });
});

/**
 * T83 metrics registry tests (Docs/PHASE8_HARDENING_READINESS_SPEC.md §6).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getMetricsSnapshot, incrementCounter, METRIC_NAMES, observeDuration, resetMetrics } from "@/lib/observability/metrics";

describe("metrics registry", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("accumulates a counter across calls", () => {
    incrementCounter(METRIC_NAMES.authDenied);
    incrementCounter(METRIC_NAMES.authDenied);
    incrementCounter(METRIC_NAMES.authDenied, {}, 3);

    const snapshot = getMetricsSnapshot();
    expect(snapshot[METRIC_NAMES.authDenied]).toEqual({ kind: "counter", value: 5 });
  });

  it("keeps differently-labelled counters separate", () => {
    incrementCounter(METRIC_NAMES.jobDeadLettered, { topic: "legal.sync" });
    incrementCounter(METRIC_NAMES.jobDeadLettered, { topic: "ems.reminder" });

    const snapshot = getMetricsSnapshot();
    expect(snapshot[`${METRIC_NAMES.jobDeadLettered}|topic=legal.sync`]).toEqual({ kind: "counter", value: 1 });
    expect(snapshot[`${METRIC_NAMES.jobDeadLettered}|topic=ems.reminder`]).toEqual({ kind: "counter", value: 1 });
  });

  it("computes percentile summaries for a histogram", () => {
    for (const ms of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
      observeDuration(METRIC_NAMES.httpRequestDurationMs, {}, ms);
    }
    const snapshot = getMetricsSnapshot();
    const summary = snapshot[METRIC_NAMES.httpRequestDurationMs];
    expect(summary.kind).toBe("histogram");
    if (summary.kind === "histogram") {
      expect(summary.count).toBe(10);
      expect(summary.p50).toBeGreaterThan(0);
      expect(summary.max).toBe(100);
    }
  });

  it("resetMetrics clears all recorded state", () => {
    incrementCounter(METRIC_NAMES.authDenied);
    resetMetrics();
    expect(getMetricsSnapshot()).toEqual({});
  });
});

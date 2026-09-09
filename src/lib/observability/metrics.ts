/**
 * In-process metrics registry (task T83, Docs/PHASE8_HARDENING_READINESS_SPEC.md
 * §6 "metrics for HTTP, DB, jobs, cursors, outbox, exports, storage and auth
 * denials"). Deliberately a plain in-memory map, not a Prometheus/StatsD
 * client — this repository has no metrics-backend dependency yet, and
 * picking one is an infrastructure decision outside T83's scope (see
 * `docs/operations/slo-sli.md` "Owner decisions"). Call sites use the
 * counter/histogram names declared in `METRIC_NAMES` below so a future
 * backend swap only touches this file, not every call site.
 *
 * A snapshot function (`getMetricsSnapshot`) exists so load-test scripts and
 * tests can assert on recorded counts/latencies without scraping stdout.
 */

export const METRIC_NAMES = {
  httpRequestDurationMs: "http.request.duration_ms",
  dbQueryDurationMs: "db.query.duration_ms",
  jobRunDurationMs: "job.run.duration_ms",
  jobDeadLettered: "job.dead_lettered.count",
  jobRequeued: "job.requeued.count",
  outboxBacklogDepth: "outbox.backlog.depth",
  legalCursorStalenessMs: "legal.cursor.staleness_ms",
  exportDurationMs: "export.duration_ms",
  storageOperationFailure: "storage.operation.failure.count",
  authDenied: "auth.denied.count",
} as const;

export type MetricName = (typeof METRIC_NAMES)[keyof typeof METRIC_NAMES];

interface CounterState {
  kind: "counter";
  value: number;
}

interface HistogramState {
  kind: "histogram";
  samples: number[];
}

type MetricState = CounterState | HistogramState;

/** Keyed by `${name}|${sortedLabelPairs}` so the same metric name with different labels (e.g. per-topic job duration) stays separate. */
const registry = new Map<string, MetricState>();

function labelKey(name: string, labels: Record<string, string> = {}): string {
  const sortedLabels = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return sortedLabels ? `${name}|${sortedLabels}` : name;
}

export function incrementCounter(name: MetricName, labels: Record<string, string> = {}, amount = 1): void {
  const key = labelKey(name, labels);
  const existing = registry.get(key);
  if (existing && existing.kind === "counter") {
    existing.value += amount;
  } else {
    registry.set(key, { kind: "counter", value: amount });
  }
}

export function observeDuration(name: MetricName, labels: Record<string, string> = {}, milliseconds: number): void {
  const key = labelKey(name, labels);
  const existing = registry.get(key);
  if (existing && existing.kind === "histogram") {
    existing.samples.push(milliseconds);
  } else {
    registry.set(key, { kind: "histogram", samples: [milliseconds] });
  }
}

function percentile(sortedSamples: number[], p: number): number {
  if (sortedSamples.length === 0) return 0;
  const index = Math.min(sortedSamples.length - 1, Math.ceil((p / 100) * sortedSamples.length) - 1);
  return sortedSamples[Math.max(0, index)];
}

export interface CounterSnapshot {
  kind: "counter";
  value: number;
}

export interface HistogramSnapshot {
  kind: "histogram";
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** Read-only snapshot of every recorded metric — used by load-test scripts to report SLO compliance and by unit tests to assert on instrumentation. */
export function getMetricsSnapshot(): Record<string, CounterSnapshot | HistogramSnapshot> {
  const snapshot: Record<string, CounterSnapshot | HistogramSnapshot> = {};
  for (const [key, state] of registry.entries()) {
    if (state.kind === "counter") {
      snapshot[key] = { kind: "counter", value: state.value };
    } else {
      const sorted = [...state.samples].sort((a, b) => a - b);
      snapshot[key] = {
        kind: "histogram",
        count: sorted.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        max: sorted[sorted.length - 1] ?? 0,
      };
    }
  }
  return snapshot;
}

/** Test/script-only reset — production call sites never need this since the registry lives for the process lifetime. */
export function resetMetrics(): void {
  registry.clear();
}

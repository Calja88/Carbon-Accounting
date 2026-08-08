import { CHART_INK, RANKED_BAR_COLOR, formatKgPrecise } from "./palette";
import { ChartEmptyState } from "./chart-parts";

export interface ContributionBar {
  key: string;
  label: string;
  sublabel?: string;
  value: number;
  percent: number;
  color?: string;
}

/**
 * Ranked horizontal bars for "where does this footprint come from?".
 *
 * Position already carries the ordering, so the bars take a single accent
 * rather than eight competing hues. Every bar ships with its label, its
 * figure and its share, so the chart is a faster way to read the same table —
 * not the only way to read it.
 */
export function ContributionBarChart({
  bars,
  emptyMessage = "Nothing to show for this breakdown yet.",
  maxBars,
  unitLabel = "kgCO2e",
}: {
  bars: ContributionBar[];
  emptyMessage?: string;
  maxBars?: number;
  unitLabel?: string;
}) {
  const shown = maxBars ? bars.slice(0, maxBars) : bars;
  const max = Math.max(...shown.map((b) => Math.abs(b.value)), 0);

  if (shown.length === 0 || max <= 0) {
    return <ChartEmptyState message={emptyMessage} />;
  }

  return (
    <div className="space-y-2.5">
      {shown.map((bar) => {
        const width = (Math.abs(bar.value) / max) * 100;
        const isCredit = bar.value < 0;
        return (
          <div key={bar.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-slate-800" title={bar.label}>
                {bar.label}
                {bar.sublabel && <span className="ml-2 text-xs font-normal text-slate-500">{bar.sublabel}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-slate-600">
                {formatKgPrecise(bar.value)} {unitLabel}
                <span className="ml-2 text-xs text-slate-500">{bar.percent.toFixed(1)}%</span>
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: CHART_INK.gridline }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(width, 0.5)}%`,
                  backgroundColor: bar.color ?? (isCredit ? "#1baf7a" : RANKED_BAR_COLOR),
                }}
              />
            </div>
          </div>
        );
      })}
      {maxBars && bars.length > maxBars && (
        <p className="pt-1 text-xs text-slate-500">
          Showing the {maxBars} largest of {bars.length}. The full breakdown is in the calculation register export.
        </p>
      )}
    </div>
  );
}

/**
 * A single part-to-whole bar — used for data-type coverage and carbon-class
 * splits, where the shares matter more than the absolute figures. Segments
 * under 4% still get a legend entry, because a small share can still be the
 * one a reviewer needs to see.
 */
export function ProportionBar({
  segments,
  emptyMessage = "No data yet.",
}: {
  segments: { key: string; label: string; percent: number; color: string; detail?: string }[];
  emptyMessage?: string;
}) {
  const visible = segments.filter((s) => s.percent > 0);
  const total = visible.reduce((sum, s) => sum + s.percent, 0);

  if (visible.length === 0 || total <= 0) {
    return <ChartEmptyState message={emptyMessage} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full" style={{ backgroundColor: CHART_INK.gridline }}>
        {visible.map((segment) => (
          <div
            key={segment.key}
            style={{ width: `${(segment.percent / total) * 100}%`, backgroundColor: segment.color }}
            title={`${segment.label}: ${segment.percent.toFixed(1)}%`}
          />
        ))}
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {visible.map((segment) => (
          <li key={segment.key} className="flex items-baseline gap-2 text-xs text-slate-600">
            <span
              aria-hidden="true"
              className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: segment.color }}
            />
            <span className="min-w-0 flex-1">
              {segment.label}
              {segment.detail && <span className="ml-1 text-slate-400">{segment.detail}</span>}
            </span>
            <span className="shrink-0 tabular-nums font-medium text-slate-700">{segment.percent.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

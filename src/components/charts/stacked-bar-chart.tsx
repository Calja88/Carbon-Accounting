import { CHART_INK, formatTonnes } from "./palette";
import { ChartEmptyState, ChartLegend, type LegendItem } from "./chart-parts";

export interface StackedBarSegment {
  label: string;
  value: number;
  color: string;
}

export interface StackedBarRow {
  label: string;
  sublabel?: string;
  segments: StackedBarSegment[];
}

const BAR_HEIGHT = 22; // <= 24px per mark spec — the band's leftover stays air
const GAP = 2; // surface gap: white, not a stroke, does the separating
const ROW_HEIGHT = 52;

/**
 * Horizontal stacked bars — part-to-whole per row, with all rows on one
 * shared scale so bar lengths are comparable between sites.
 *
 * Rounded right (data) end, square left (baseline) end, achieved with a
 * clip path so interior segment joins stay square.
 */
export function StackedBarChart({
  rows,
  legend,
  emptyMessage = "No emissions calculated for this period yet.",
}: {
  rows: StackedBarRow[];
  legend: LegendItem[];
  emptyMessage?: string;
}) {
  const totals = rows.map((r) => r.segments.reduce((s, seg) => s + Math.max(0, seg.value), 0));
  const max = Math.max(...totals, 0);

  if (rows.length === 0 || max <= 0) {
    return (
      <div className="space-y-3">
        <ChartLegend items={legend} />
        <ChartEmptyState message={emptyMessage} />
      </div>
    );
  }

  const width = 680;
  const labelWidth = 168;
  const valueWidth = 74;
  const plotWidth = width - labelWidth - valueWidth;
  const height = rows.length * ROW_HEIGHT;

  return (
    <div className="space-y-3">
      <ChartLegend items={legend} />
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full min-w-[520px]"
          role="img"
          aria-label={`Emissions by scope for ${rows.length} site${rows.length === 1 ? "" : "s"}, in tonnes CO2e`}
        >
          {rows.map((row, i) => {
            const total = totals[i];
            const y = i * ROW_HEIGHT;
            const barY = y + 20;
            const barWidth = max > 0 ? (total / max) * plotWidth : 0;
            const clipId = `stack-clip-${i}`;

            let cursor = 0;
            return (
              <g key={row.label}>
                <text x={0} y={y + 14} fontSize={12} fontWeight={600} fill={CHART_INK.primary}>
                  {row.label}
                </text>
                {row.sublabel && (
                  <text x={0} y={y + 30} fontSize={11} fill={CHART_INK.muted}>
                    {row.sublabel}
                  </text>
                )}

                <defs>
                  <clipPath id={clipId}>
                    {/* Rounded data-end only: the rect is drawn wider than the
                        bar and pushed left, so only its right corners land
                        inside the visible area. */}
                    <rect
                      x={labelWidth}
                      y={barY}
                      width={Math.max(barWidth, 0.01)}
                      height={BAR_HEIGHT}
                      rx={4}
                      ry={4}
                    />
                    <rect x={labelWidth} y={barY} width={Math.min(4, barWidth)} height={BAR_HEIGHT} />
                  </clipPath>
                </defs>

                <g clipPath={`url(#${clipId})`}>
                  {row.segments.map((seg) => {
                    const value = Math.max(0, seg.value);
                    if (value <= 0) return null;
                    const segWidth = (value / max) * plotWidth;
                    const x = labelWidth + cursor;
                    cursor += segWidth;
                    return (
                      <rect
                        key={seg.label}
                        x={x}
                        y={barY}
                        width={Math.max(segWidth - GAP, 0.5)}
                        height={BAR_HEIGHT}
                        fill={seg.color}
                      >
                        <title>{`${row.label} — ${seg.label}: ${formatTonnes(value)} t CO2e`}</title>
                      </rect>
                    );
                  })}
                </g>

                {/* Direct label at the tip — required relief for the sub-3:1 aqua slot. */}
                <text
                  x={labelWidth + barWidth + 8}
                  y={barY + BAR_HEIGHT / 2 + 4}
                  fontSize={12}
                  fontWeight={600}
                  fill={CHART_INK.secondary}
                >
                  {formatTonnes(total)} t
                </text>
              </g>
            );
          })}
          <line x1={labelWidth} y1={0} x2={labelWidth} y2={height} stroke={CHART_INK.axis} strokeWidth={1} />
        </svg>
      </div>
    </div>
  );
}

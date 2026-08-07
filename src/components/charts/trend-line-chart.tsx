import { CHART_INK, SCOPE_COLORS, formatTonnes, niceAxisMax } from "./palette";
import { ChartEmptyState } from "./chart-parts";

export interface TrendPoint {
  label: string;
  value: number;
}

const PLOT_HEIGHT = 150;
// Clear row above the topmost tick for the axis-unit label, plus headroom
// for the peak's direct label.
const TOP_PAD = 30;
const LABEL_BAND = 28;
const AXIS_WIDTH = 52;

/**
 * Single-series monthly trend: 2px line, 10%-opacity area wash, ≥8px
 * markers ringed in the surface colour so they stay legible where they sit
 * on the line. One series, so no legend box — the caption names it.
 */
export function TrendLineChart({
  points,
  emptyMessage = "No monthly emissions data for this period yet.",
}: {
  points: TrendPoint[];
  emptyMessage?: string;
}) {
  const values = points.map((p) => Math.max(0, p.value));
  const rawMax = Math.max(...values, 0);

  if (points.length === 0 || rawMax <= 0) {
    return <ChartEmptyState message={emptyMessage} />;
  }

  const axisMax = niceAxisMax(rawMax / 1000) * 1000;
  const ticks = [0, 0.5, 1].map((f) => axisMax * f);

  const stepWidth = Math.max(48, Math.min(96, 560 / Math.max(points.length, 1)));
  const width = AXIS_WIDTH + Math.max(points.length - 1, 1) * stepWidth + 24;
  const height = TOP_PAD + PLOT_HEIGHT + LABEL_BAND;
  const baselineY = TOP_PAD + PLOT_HEIGHT;

  const coords = points.map((p, i) => ({
    x: AXIS_WIDTH + i * stepWidth,
    y: baselineY - (Math.max(0, p.value) / axisMax) * PLOT_HEIGHT,
    point: p,
  }));

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
  const areaPath =
    coords.length > 1
      ? `${linePath} L ${coords[coords.length - 1].x} ${baselineY} L ${coords[0].x} ${baselineY} Z`
      : "";

  // Label the endpoint and the peak only — never a number on every point.
  const peakIndex = values.indexOf(Math.max(...values));
  const labelled = new Set([coords.length - 1, peakIndex]);
  // With many months, thin the x-axis ticks so they can't collide.
  const tickEvery = points.length > 12 ? Math.ceil(points.length / 8) : 1;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        style={{ maxWidth: `${width}px` }}
        role="img"
        aria-label="Monthly total emissions trend, in tonnes CO2e"
      >
        {ticks.map((t) => {
          const y = baselineY - (t / axisMax) * PLOT_HEIGHT;
          return (
            <g key={t}>
              <line
                x1={AXIS_WIDTH}
                y1={y}
                x2={width - 8}
                y2={y}
                stroke={t === 0 ? CHART_INK.axis : CHART_INK.gridline}
                strokeWidth={1}
              />
              <text
                x={AXIS_WIDTH - 8}
                y={y + 4}
                fontSize={11}
                textAnchor="end"
                fill={CHART_INK.muted}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatTonnes(t)}
              </text>
            </g>
          );
        })}

        {areaPath && <path d={areaPath} fill={SCOPE_COLORS.scope1} fillOpacity={0.1} />}
        {coords.length > 1 && (
          <path d={linePath} fill="none" stroke={SCOPE_COLORS.scope1} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        )}

        {coords.map((c, i) => (
          <g key={c.point.label}>
            <circle cx={c.x} cy={c.y} r={4} fill={SCOPE_COLORS.scope1} stroke={CHART_INK.surface} strokeWidth={2}>
              <title>{`${c.point.label}: ${formatTonnes(c.point.value)} t CO2e`}</title>
            </circle>
            {labelled.has(i) && (
              <text
                x={c.x}
                y={c.y - 10}
                fontSize={10}
                textAnchor="middle"
                fill={CHART_INK.secondary}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatTonnes(c.point.value)}
              </text>
            )}
            {i % tickEvery === 0 && (
              <text x={c.x} y={baselineY + 18} fontSize={10} textAnchor="middle" fill={CHART_INK.muted}>
                {c.point.label}
              </text>
            )}
          </g>
        ))}

        {/* Right-aligned into the tick column so it reads as that axis's unit. */}
        <text x={AXIS_WIDTH - 8} y={12} fontSize={10} textAnchor="end" fill={CHART_INK.muted}>
          tCO2e
        </text>
      </svg>
    </div>
  );
}

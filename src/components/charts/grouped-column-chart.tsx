import { CHART_INK, formatTonnes, niceAxisMax } from "./palette";
import { ChartEmptyState, ChartLegend, type LegendItem } from "./chart-parts";

export interface GroupedColumnGroup {
  label: string;
  /** Two values per group: [current period, same period last year]. */
  values: { seriesLabel: string; value: number; color: string }[];
}

const COL_WIDTH = 24; // mark-spec cap
const COL_GAP = 2; // surface gap between the two touching columns
const PLOT_HEIGHT = 190;
// Room for the value on the cap *and* a clear row for the axis-unit label
// above the topmost tick, so the two can't collide.
const TOP_PAD = 34;
const LABEL_BAND = 34;

/**
 * Grouped columns for period-on-period comparison. Two shades of one hue,
 * not two categorical hues — this is one measure at two points in time, so
 * the encoding is ordinal, not identity.
 */
export function GroupedColumnChart({
  groups,
  legend,
  emptyMessage = "No emissions calculated for either period.",
}: {
  groups: GroupedColumnGroup[];
  legend: LegendItem[];
  emptyMessage?: string;
}) {
  const allValues = groups.flatMap((g) => g.values.map((v) => Math.max(0, v.value)));
  const rawMax = Math.max(...allValues, 0);

  if (groups.length === 0 || rawMax <= 0) {
    return (
      <div className="space-y-3">
        <ChartLegend items={legend} />
        <ChartEmptyState message={emptyMessage} />
      </div>
    );
  }

  const axisMax = niceAxisMax(rawMax / 1000) * 1000; // axis works in tonnes
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => axisMax * f);

  const groupBandWidth = 118;
  const axisWidth = 52;
  const width = axisWidth + groups.length * groupBandWidth + 8;
  const height = TOP_PAD + PLOT_HEIGHT + LABEL_BAND;
  const baselineY = TOP_PAD + PLOT_HEIGHT;

  return (
    <div className="space-y-3">
      <ChartLegend items={legend} />
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full"
          style={{ maxWidth: `${width}px` }}
          role="img"
          aria-label="Emissions this period compared with the same period last year, in tonnes CO2e"
        >
          {ticks.map((t) => {
            const y = baselineY - (t / axisMax) * PLOT_HEIGHT;
            return (
              <g key={t}>
                <line
                  x1={axisWidth}
                  y1={y}
                  x2={width - 8}
                  y2={y}
                  stroke={t === 0 ? CHART_INK.axis : CHART_INK.gridline}
                  strokeWidth={1}
                />
                <text
                  x={axisWidth - 8}
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

          {groups.map((group, gi) => {
            const bandX = axisWidth + gi * groupBandWidth;
            const pairWidth = group.values.length * COL_WIDTH + (group.values.length - 1) * COL_GAP;
            const startX = bandX + (groupBandWidth - pairWidth) / 2;

            return (
              <g key={group.label}>
                {group.values.map((v, vi) => {
                  const value = Math.max(0, v.value);
                  const colHeight = axisMax > 0 ? (value / axisMax) * PLOT_HEIGHT : 0;
                  const x = startX + vi * (COL_WIDTH + COL_GAP);
                  const y = baselineY - colHeight;
                  const clipId = `col-clip-${gi}-${vi}`;
                  return (
                    <g key={v.seriesLabel}>
                      <defs>
                        <clipPath id={clipId}>
                          {/* Rounded cap, square at the baseline. */}
                          <rect x={x} y={y} width={COL_WIDTH} height={Math.max(colHeight, 0.01)} rx={4} ry={4} />
                          <rect
                            x={x}
                            y={Math.max(y, baselineY - Math.max(colHeight - 4, 0))}
                            width={COL_WIDTH}
                            height={Math.min(4, colHeight)}
                          />
                        </clipPath>
                      </defs>
                      {colHeight > 0 && (
                        <rect x={x} y={y} width={COL_WIDTH} height={colHeight} fill={v.color} clipPath={`url(#${clipId})`}>
                          <title>{`${group.label} — ${v.seriesLabel}: ${formatTonnes(value)} t CO2e`}</title>
                        </rect>
                      )}
                      <text
                        x={x + COL_WIDTH / 2}
                        y={y - 6}
                        fontSize={10}
                        textAnchor="middle"
                        fill={CHART_INK.secondary}
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {formatTonnes(value)}
                      </text>
                    </g>
                  );
                })}
                <text
                  x={bandX + groupBandWidth / 2}
                  y={baselineY + 18}
                  fontSize={11}
                  textAnchor="middle"
                  fill={CHART_INK.secondary}
                >
                  {group.label.length > 18 ? `${group.label.slice(0, 17)}…` : group.label}
                </text>
              </g>
            );
          })}

          {/* Right-aligned into the tick column so it reads as that axis's unit. */}
          <text x={axisWidth - 8} y={12} fontSize={10} textAnchor="end" fill={CHART_INK.muted}>
            tCO2e
          </text>
        </svg>
      </div>
    </div>
  );
}

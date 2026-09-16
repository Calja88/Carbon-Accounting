import { useId } from "react";
import type { TrendPoint } from "../../lib/board/contracts";
import { formatTonnes } from "../../lib/board/metrics";
import { BoardLink, ChartFrame } from "./primitives";

/** SVG with real gaps, shared zero-based axis, no smoothing that invents intermediate results. */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const id = useId(), width = 660, height = 240, left = 48, right = 18, top = 20, bottom = 38;
  const all = points.flatMap(p => [p.currentKg, p.previousKg]).filter((v): v is number => v !== null && Number.isFinite(v));
  const max = Math.max(1, ...all), min = Math.min(0, ...all), range = max - min;
  const x = (i: number) => left + i * (width - left - right) / Math.max(1, points.length - 1);
  const y = (v: number) => top + (max - v) / range * (height - top - bottom);
  function segments(key: "currentKg" | "previousKg") {
    const paths: string[] = []; let current = "";
    points.forEach((p, i) => { const v = p[key]; if (v === null || !Number.isFinite(v)) { if (current) paths.push(current); current = ""; } else current += `${current ? " L" : "M"}${x(i)},${y(v)}`; });
    if (current) paths.push(current); return paths;
  }
  const table = <table className="bd-table"><caption className="bd-sr-only">Monthly emissions in tonnes CO₂e</caption><thead><tr><th scope="col">Month</th><th scope="col">Current</th><th scope="col">Prior</th></tr></thead><tbody>{points.map(p => <tr key={p.month}><th scope="row"><BoardLink href={p.href}>{p.label}</BoardLink></th><td>{formatTonnes(p.currentKg, 1)}</td><td>{formatTonnes(p.previousKg, 1)}</td></tr>)}</tbody></table>;
  return <ChartFrame title="Emissions through the period" description="Location-based headline · tonnes CO₂e · gaps mean missing results" table={table}>
    <div className="bd-chart-legend"><span><i className="bd-legend-current" />Current period</span><span><i className="bd-legend-prior" />Prior period</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} className="bd-trend-svg" role="img" aria-labelledby={`${id}-title ${id}-desc`}><title id={`${id}-title`}>Monthly emissions trend</title><desc id={`${id}-desc`}>Current and prior emissions. Use View chart data for exact values and month drilldowns. Missing observations break the line.</desc>
      {[0, 1, 2, 3].map(n => { const value = min + range * n / 3; return <g key={n}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="#dfe7e8" /><text x={left - 9} y={y(value) + 4} textAnchor="end" fill="#536774" fontSize="11">{formatTonnes(value)}</text></g>; })}
      {segments("previousKg").map((d, i) => <path key={`p${i}`} d={d} fill="none" stroke="#8499a2" strokeWidth="2" strokeDasharray="5 5" />)}
      {segments("currentKg").map((d, i) => <path key={`c${i}`} d={d} fill="none" stroke="#0f766e" strokeWidth="3" />)}
      {points.map((p, i) => <g key={p.month}>{p.currentKg !== null && Number.isFinite(p.currentKg) && <circle cx={x(i)} cy={y(p.currentKg)} r="4" fill="#0f766e" />}{(points.length <= 12 || i % Math.ceil(points.length / 8) === 0) && <text x={x(i)} y={height - 12} textAnchor="middle" fill="#536774" fontSize="11">{p.label}</text>}</g>)}
    </svg>
  </ChartFrame>;
}

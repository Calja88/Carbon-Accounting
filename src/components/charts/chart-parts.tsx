import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { CHART_INK, STATUS_COLORS, formatPercent, formatTonnes } from "./palette";
import type { Delta } from "@/lib/analytics-service";

export interface LegendItem {
  label: string;
  color: string;
}

/** Always rendered for two or more series — identity never rests on colour-matching alone. */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-slate-600">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Period-on-period change. For emissions a fall is the good direction, so
 * the colour follows `isImprovement` (from analytics-service), not the sign
 * of the number — and it always ships with an arrow and a word, so the
 * meaning survives greyscale print and colour-vision deficiency.
 */
export function DeltaBadge({ delta, className = "" }: { delta: Delta; className?: string }) {
  if (delta.previousKg === 0 && delta.currentKg === 0) {
    return <span className={`text-xs text-slate-400 ${className}`}>No data either period</span>;
  }
  if (delta.previousKg === 0) {
    return <span className={`text-xs text-slate-500 ${className}`}>No comparable prior-year data</span>;
  }

  const Icon = delta.direction === "flat" ? Minus : delta.direction === "up" ? ArrowUpRight : ArrowDownRight;
  const color =
    delta.direction === "flat"
      ? STATUS_COLORS.neutral
      : delta.isImprovement
        ? STATUS_COLORS.improvement
        : STATUS_COLORS.worsening;
  const word = delta.direction === "flat" ? "level with" : delta.direction === "up" ? "above" : "below";

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${className}`} style={{ color }}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {delta.direction !== "flat" && formatPercent(delta.deltaPercent)} {word} last year
    </span>
  );
}

/** Shown wherever a chart would otherwise be the only way to read a figure. */
export function ChartEmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[7rem] items-center justify-center rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

export function AxisLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ color: CHART_INK.muted }}>{children}</span>;
}

export function tonnesLabel(kg: number): string {
  return `${formatTonnes(kg)} t`;
}

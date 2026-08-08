import { LIFECYCLE_STAGE_COLORS, formatKgPrecise } from "@/components/charts/palette";
import { ChartEmptyState } from "@/components/charts/chart-parts";
import { LIFECYCLE_STAGE_ORDER, STAGE_LABELS } from "@/lib/lca/labels";
import type { LcaLifecycleStage } from "@prisma/client";

export interface FlowStage {
  stage: LcaLifecycleStage;
  kgCo2e: number;
  percent: number;
  processCount: number;
  itemCount: number;
  inBoundary: boolean;
  modelled: boolean;
}

/**
 * The product's lifecycle as a flow, drawn inline rather than pulled in from a
 * charting library — the shape is fixed and simple, and a dependency for it
 * would be weight without benefit.
 *
 * Two things are shown at once: the path the product actually takes, and where
 * the emissions sit along it. A stage that is inside the boundary but has
 * nothing modelled is drawn as an outline, because an empty stage is a finding,
 * not an absence.
 */
export function LifecycleFlow({ stages }: { stages: FlowStage[] }) {
  const ordered = LIFECYCLE_STAGE_ORDER.filter((stage) => {
    const entry = stages.find((s) => s.stage === stage);
    return entry && (entry.inBoundary || entry.modelled);
  });

  if (ordered.length === 0) {
    return <ChartEmptyState message="No lifecycle stages are in scope yet — set the boundary on the goal and scope page." />;
  }

  const maxPercent = Math.max(...stages.map((s) => s.percent), 1);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-stretch gap-0">
          {ordered.map((stage, index) => {
            const entry = stages.find((s) => s.stage === stage) as FlowStage;
            const intensity = entry.percent / maxPercent;
            const color = LIFECYCLE_STAGE_COLORS[stage] ?? "#94a3b8";

            return (
              <div key={stage} className="flex items-stretch">
                <div
                  className="flex w-40 flex-col justify-between rounded-lg border p-3"
                  style={{
                    borderColor: entry.modelled ? color : "#cbd5e1",
                    borderStyle: entry.modelled ? "solid" : "dashed",
                    // Weight the fill by contribution so the hotspot is visible
                    // at a glance, while the number stays on the card.
                    backgroundColor: entry.modelled ? `${color}${toHexAlpha(0.08 + intensity * 0.22)}` : "transparent",
                  }}
                >
                  <div>
                    <div className="flex items-start gap-1.5">
                      <span
                        aria-hidden="true"
                        className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: entry.modelled ? color : "#cbd5e1" }}
                      />
                      <span className="text-xs font-semibold leading-tight text-slate-800">{STAGE_LABELS[stage]}</span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-tight text-slate-500">
                      {entry.modelled
                        ? `${entry.processCount} process${entry.processCount === 1 ? "" : "es"}, ${entry.itemCount} line${entry.itemCount === 1 ? "" : "s"}`
                        : entry.inBoundary
                          ? "In scope, nothing modelled"
                          : "Outside the boundary"}
                    </p>
                  </div>
                  <div className="mt-3">
                    <div className="text-sm font-semibold tabular-nums text-slate-900">
                      {entry.modelled ? `${formatKgPrecise(entry.kgCo2e)} kg` : "—"}
                    </div>
                    <div className="text-[11px] tabular-nums text-slate-500">
                      {entry.modelled ? `${entry.percent.toFixed(1)}% of gross` : ""}
                    </div>
                  </div>
                </div>
                {index < ordered.length - 1 && (
                  <div className="flex w-6 items-center justify-center" aria-hidden="true">
                    <svg width="18" height="12" viewBox="0 0 18 12" className="text-slate-300">
                      <path d="M0 6 H12 M8 2 L12 6 L8 10" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Shading is weighted by each stage&apos;s share of gross emissions. A dashed outline means the stage is inside the
        declared boundary but nothing has been modelled in it yet.
      </p>
    </div>
  );
}

/** Alpha as a two-digit hex suffix, for tinting a stage colour on a white card. */
function toHexAlpha(alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  return Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0");
}

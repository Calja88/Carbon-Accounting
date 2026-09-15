"use client";

import { useActionState, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { generateReportAction, GenerateReportState, prepareReportingDataAction, PrepareReportingDataState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: GenerateReportState = { error: null };
const initialPrepareState: PrepareReportingDataState = { error: null, result: null };

function monthValue(year: number, monthIndex0: number): string {
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;
}

/** Common reporting windows, so the usual cases are one click rather than two pickers. */
function buildPresets(now: Date): { label: string; start: string; end: string }[] {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const twelveMonthsAgo = new Date(Date.UTC(year, month - 11, 1));
  return [
    { label: "This year to date", start: monthValue(year, 0), end: monthValue(year, month) },
    { label: "Last full year", start: monthValue(year - 1, 0), end: monthValue(year - 1, 11) },
    {
      label: "Last 12 months",
      start: monthValue(twelveMonthsAgo.getUTCFullYear(), twelveMonthsAgo.getUTCMonth()),
      end: monthValue(year, month),
    },
  ];
}

export function GenerateReportForm({ defaultStart, defaultEnd }: { defaultStart: string; defaultEnd: string }) {
  const [state, formAction, pending] = useActionState(generateReportAction, initialState);
  const [prepareState, prepareAction, preparePending] = useActionState(prepareReportingDataAction, initialPrepareState);
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);

  const presets = buildPresets(new Date());
  const activePreset = presets.find((p) => p.start === start && p.end === end)?.label;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => {
          const isActive = activePreset === p.label;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setStart(p.start);
                setEnd(p.end);
              }}
              aria-pressed={isActive}
              className={
                isActive
                  ? "rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800"
                  : "rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <form action={formAction} className="flex flex-wrap items-end gap-4">
        <div>
          <Label htmlFor="periodStartMonth">From</Label>
          <Input
            id="periodStartMonth"
            name="periodStartMonth"
            type="month"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="periodEndMonth">To</Label>
          <Input
            id="periodEndMonth"
            name="periodEndMonth"
            type="month"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            required
            className="mt-1"
          />
        </div>
        <Button type="submit" disabled={pending}>
          <FileText className="h-4 w-4" />
          {pending ? "Generating…" : "Generate report"}
        </Button>
      </form>

      <p className="text-xs text-slate-500">
        Generating creates a permanent, versioned snapshot: totals by scope and site, the year-on-year comparison
        against the same dates last year, the monthly profile, data-quality tiers, factor sources, and a full
        calculation audit trail. It reads existing calculations only — it does not derive new Category 3
        (fuel/energy-related) rows. Use &ldquo;Prepare reporting data&rdquo; first if this period&rsquo;s Category 3
        figures may not be up to date.
      </p>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <form
          action={(formData) => {
            formData.set("periodStartMonth", start);
            formData.set("periodEndMonth", end);
            prepareAction(formData);
          }}
          className="flex flex-wrap items-center gap-3"
        >
          <Button type="submit" variant="secondary" size="sm" disabled={preparePending}>
            <RefreshCw className="h-3.5 w-3.5" />
            {preparePending ? "Preparing…" : "Prepare reporting data"}
          </Button>
          <p className="text-xs text-slate-500">
            Derives any newly-calculable Category 3 (fuel/energy-related) rows for the selected period. Safe to run
            more than once.
          </p>
        </form>
        {prepareState.error && <p className="mt-2 text-sm text-red-600">{prepareState.error}</p>}
        {prepareState.result && (
          <p className="mt-2 text-sm text-slate-700">
            {prepareState.result.created} Category 3 row(s) derived.
            {prepareState.result.skippedNoFactor > 0
              ? ` ${prepareState.result.skippedNoFactor} source row(s) could not be derived — no matching emission factor was found for them.`
              : ""}
          </p>
        )}
      </div>
    </div>
  );
}

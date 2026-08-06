"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { submitSurveyAction, SurveyFormState } from "./survey-actions";
import { totalPercentAssigned } from "@/lib/commuting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FactorOption {
  id: string;
  label: string;
}

interface DataPointForSurvey {
  code: string;
  promptTemplate: string;
  helpText: string | null;
  frequency: string;
  factorOptions: FactorOption[];
}

const initialState: SurveyFormState = { error: null, success: false };

export function SurveyForm({
  site,
  dataPoint,
  initialPeriodValue,
}: {
  site: { id: string; name: string };
  dataPoint: DataPointForSurvey;
  initialPeriodValue: string;
}) {
  const [state, formAction, pending] = useActionState(submitSurveyAction, initialState);
  const [percentages, setPercentages] = useState<Record<string, number>>({});

  const totalPercent = useMemo(() => totalPercentAssigned(Object.values(percentages)), [percentages]);

  if (state.success) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6">
        <h1 className="text-lg font-semibold text-emerald-900">Thanks — that&apos;s saved.</h1>
        <p className="mt-2 text-sm text-emerald-800">
          Commuting emissions have been calculated for each mode you entered a percentage for.
        </p>
        <Link href={`/entry/${site.id}`} className="mt-4 inline-block text-sm font-medium text-emerald-700 hover:underline">
          ← Back to {site.name}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      <input type="hidden" name="siteId" value={site.id} />
      <input type="hidden" name="code" value={dataPoint.code} />

      <div>
        <h1 className="text-xl font-semibold text-slate-900">{dataPoint.promptTemplate}</h1>
        {dataPoint.helpText && (
          <details className="mt-2 text-sm text-slate-500">
            <summary className="cursor-pointer select-none text-slate-600">Why are we asking this?</summary>
            <p className="mt-1">{dataPoint.helpText}</p>
          </details>
        )}
      </div>

      <div className="flex flex-wrap gap-4">
        <div>
          <Label htmlFor="periodInput">Survey year</Label>
          <Input id="periodInput" name="periodInput" type="month" defaultValue={initialPeriodValue} required className="mt-1 max-w-xs" />
        </div>
        <div>
          <Label htmlFor="headcount">How many employees does this survey represent?</Label>
          <Input id="headcount" name="headcount" type="number" min="1" step="1" required className="mt-1 max-w-xs" />
        </div>
        <div>
          <Label htmlFor="commutingDaysInPeriod">Roughly how many days did employees commute to a site in this period?</Label>
          <Input id="commutingDaysInPeriod" name="commutingDaysInPeriod" type="number" min="1" step="1" required className="mt-1 max-w-xs" placeholder="e.g. 220" />
          <p className="mt-1 text-xs text-slate-400">Exclude weekends, leave and remote-working days already covered by &quot;works from home&quot; below.</p>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>For each mode, roughly what share of the headcount above uses it, and how far do they travel one-way?</Label>
          <span className={`text-xs ${totalPercent === 100 ? "text-emerald-600" : "text-slate-400"}`}>
            {totalPercent.toFixed(0)}% assigned
          </span>
        </div>
        <div className="space-y-2 rounded-lg border border-slate-200">
          <div className="grid grid-cols-[1fr_100px_140px] gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
            <span>Mode</span>
            <span>% of headcount</span>
            <span>Avg one-way distance (miles)</span>
          </div>
          {dataPoint.factorOptions.map((o) => (
            <div key={o.id} className="grid grid-cols-[1fr_100px_140px] items-center gap-2 px-3 py-1.5">
              <Label htmlFor={`percent_${o.id}`} className="text-sm font-normal text-slate-700">
                {o.label}
              </Label>
              <Input
                id={`percent_${o.id}`}
                name={`percent_${o.id}`}
                type="number"
                min="0"
                max="100"
                step="any"
                defaultValue={0}
                onChange={(e) => setPercentages((p) => ({ ...p, [o.id]: Number(e.target.value) || 0 }))}
              />
              <Input id={`distance_${o.id}`} name={`distance_${o.id}`} type="number" min="0" step="any" defaultValue={0} />
            </div>
          ))}
        </div>
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save survey"}
      </Button>
    </form>
  );
}

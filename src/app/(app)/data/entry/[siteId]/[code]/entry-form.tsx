"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { submitEntryAction, EntryFormState } from "./actions";
import { resolvePrompt } from "@/lib/prompts";
import { periodInputKindForFrequency, resolvePeriod } from "@/lib/period";
import { FACTOR_OPTION_LABELS, SUPPLIER_OVERRIDE_CODES } from "@/lib/form-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

interface FactorOption {
  id: string;
  label: string;
  unit: string | null;
}

interface DataPointForForm {
  code: string;
  dataPointName: string;
  promptTemplate: string;
  helpText: string | null;
  sourceSystemHint: string | null;
  unitOptions: string[];
  frequency: string;
  factorOptions: FactorOption[];
}

const initialState: EntryFormState = { error: null, success: false, flagged: false, flagReason: null, awaitingFactor: false };

export function EntryForm({
  site,
  dataPoint,
  initialPeriodValue,
}: {
  site: { id: string; name: string };
  dataPoint: DataPointForForm;
  initialPeriodValue: string;
}) {
  const [state, formAction, pending] = useActionState(submitEntryAction, initialState);
  const [periodInput, setPeriodInput] = useState(initialPeriodValue);
  const [unit, setUnit] = useState(dataPoint.unitOptions[0] ?? "");
  const [factorOptionId, setFactorOptionId] = useState(dataPoint.factorOptions[0]?.id ?? "");

  const periodKind = periodInputKindForFrequency(dataPoint.frequency);
  const selectedOption = dataPoint.factorOptions.find((o) => o.id === factorOptionId);

  // Some data points (e.g. S3-06 business travel) give each type its own
  // unit — rail/flights in miles, hotel stays in nights — rather than
  // sharing one unit picker across every option.
  const optionDrivenUnit = dataPoint.factorOptions.some((o) => o.unit);
  const effectiveUnit = optionDrivenUnit ? selectedOption?.unit ?? "" : unit;

  const showSupplierField = SUPPLIER_OVERRIDE_CODES.has(dataPoint.code);

  const resolvedPrompt = useMemo(() => {
    const { periodStart } = resolvePeriod(dataPoint.frequency, periodInput || initialPeriodValue);
    return resolvePrompt(dataPoint.promptTemplate, {
      siteName: site.name,
      periodStart,
      frequency: dataPoint.frequency,
      optionLabel: selectedOption?.label,
    });
  }, [dataPoint.frequency, dataPoint.promptTemplate, periodInput, initialPeriodValue, site.name, selectedOption]);

  if (state.success) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6">
        <h1 className="text-lg font-semibold text-emerald-900">Thanks — that&apos;s saved.</h1>
        {state.flagged ? (
          <p className="mt-2 text-sm text-amber-800">
            This entry looks unusual and has been flagged for review before it&apos;s included in a report:{" "}
            {state.flagReason}
          </p>
        ) : state.awaitingFactor ? (
          <p className="mt-2 text-sm text-amber-800">
            Your data is saved, but no emission factor has been imported for this category yet — the emissions
            figure will appear automatically once one is.
          </p>
        ) : (
          <p className="mt-2 text-sm text-emerald-800">The emissions figure has been calculated automatically.</p>
        )}
        <div className="mt-4 flex gap-3">
          <Link href={`/data/entry/${site.id}`} className="text-sm font-medium text-brand-700 hover:text-brand-800">
            ← Back to {site.name}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="max-w-xl space-y-5">
      <input type="hidden" name="siteId" value={site.id} />
      <input type="hidden" name="code" value={dataPoint.code} />

      <div>
        <h1 className="text-xl font-semibold text-slate-900">{resolvedPrompt}</h1>
        {dataPoint.helpText && (
          <details className="mt-2 text-sm text-slate-500">
            <summary className="cursor-pointer select-none text-slate-600">Why are we asking this?</summary>
            <p className="mt-1">{dataPoint.helpText}</p>
          </details>
        )}
      </div>

      <div>
        <Label htmlFor="periodInput">Period</Label>
        <Input
          id="periodInput"
          name="periodInput"
          type={periodKind}
          value={periodInput}
          onChange={(e) => setPeriodInput(e.target.value)}
          required
          className="mt-1 max-w-xs"
        />
      </div>

      {dataPoint.factorOptions.length > 0 && (
        <div>
          <Label htmlFor="factorOptionId">{FACTOR_OPTION_LABELS[dataPoint.code] ?? "Type"}</Label>
          <Select
            id="factorOptionId"
            name="factorOptionId"
            value={factorOptionId}
            onChange={(e) => setFactorOptionId(e.target.value)}
            required
            className="mt-1 max-w-xs"
          >
            {dataPoint.factorOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="flex gap-3">
        <div className="flex-1 max-w-[160px]">
          <Label htmlFor="rawValue">Amount</Label>
          <Input id="rawValue" name="rawValue" type="number" step="any" min="0" required className="mt-1" />
        </div>
        <div className="flex-1 max-w-[160px]">
          <Label htmlFor="rawUnit">Unit</Label>
          {optionDrivenUnit ? (
            <>
              <Input value={effectiveUnit} disabled className="mt-1" />
              <input type="hidden" name="rawUnit" value={effectiveUnit} />
            </>
          ) : dataPoint.unitOptions.length > 1 ? (
            <Select
              id="rawUnit"
              name="rawUnit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="mt-1"
            >
              {dataPoint.unitOptions.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          ) : (
            <>
              <Input value={dataPoint.unitOptions[0] ?? ""} disabled className="mt-1" />
              <input type="hidden" name="rawUnit" value={dataPoint.unitOptions[0] ?? ""} />
            </>
          )}
        </div>
      </div>

      {showSupplierField && (
        <div>
          <Label htmlFor="supplierName">Supplier name (optional)</Label>
          <Input id="supplierName" name="supplierName" className="mt-1 max-w-sm" placeholder="e.g. Acme Components Ltd" />
          <p className="mt-1 text-xs text-slate-400">
            If this supplier has given us their own carbon figure, naming them here uses it instead of the general
            estimate.
          </p>
        </div>
      )}

      {dataPoint.sourceSystemHint && (
        <p className="text-xs text-slate-400">Typically found on: {dataPoint.sourceSystemHint}</p>
      )}

      <div>
        <Label htmlFor="notes">Notes (optional)</Label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
      </div>

      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { uploadFactorSetAction, UploadFactorSetState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

const initialState: UploadFactorSetState = {
  error: null,
  success: false,
  createdSetId: null,
  rowErrors: [],
  rowWarnings: [],
  importedCount: 0,
  backfillRecalculated: 0,
  backfillChecked: 0,
};

export function UploadForm({ existingSets }: { existingSets: { id: string; name: string; effectiveTo: string | null }[] }) {
  const [state, formAction, pending] = useActionState(uploadFactorSetAction, initialState);
  const [sourceType, setSourceType] = useState("OFFICIAL_DEFRA_DESNZ");

  if (state.success) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/40">
        <CardContent>
          <h2 className="text-lg font-semibold text-emerald-900">Import complete</h2>
          <p className="mt-2 text-sm text-emerald-800">
            {state.importedCount} factor{state.importedCount === 1 ? "" : "s"} imported into a new set.
            {state.backfillChecked > 0 &&
              ` ${state.backfillRecalculated} of ${state.backfillChecked} entries that were awaiting a factor now have one.`}
          </p>
          {state.rowWarnings.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium text-amber-800">Warnings (imported anyway):</p>
              <ul className="mt-1 list-inside list-disc text-sm text-amber-800">
                {state.rowWarnings.map((w, i) => (
                  <li key={i}>
                    Row {w.rowNumber}: {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 flex gap-3">
            {state.createdSetId && (
              <Link href={`/factors/${state.createdSetId}`} className="text-sm font-medium text-brand-700 hover:text-brand-800">
                View this set →
              </Link>
            )}
            <Link href="/factors" className="text-sm font-medium text-brand-700 hover:text-brand-800">
              All factor sets
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <Label htmlFor="file">Factor file (.csv or .xlsx)</Label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,.xlsx,.xlsm"
          required
          className="mt-1 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="name">Set name</Label>
          <Input id="name" name="name" required placeholder="e.g. UK Gov GHG Conversion Factors 2026" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="publisher">Publisher</Label>
          <Input id="publisher" name="publisher" required placeholder="e.g. DEFRA/DESNZ" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="sourceType">Source type</Label>
          <Select id="sourceType" name="sourceType" value={sourceType} onChange={(e) => setSourceType(e.target.value)} className="mt-1">
            <option value="OFFICIAL_DEFRA_DESNZ">Official (DEFRA/DESNZ) — primary</option>
            <option value="EEIO_SPEND_BASED">EEIO spend-based — Cat 1/2 fallback</option>
            <option value="SUPPLIER_SPECIFIC">Supplier-specific — override</option>
          </Select>
        </div>
        {sourceType === "SUPPLIER_SPECIFIC" && (
          <div>
            <Label htmlFor="supplierName">Supplier name</Label>
            <Input id="supplierName" name="supplierName" required placeholder="Must match the name entered on activity entries" className="mt-1" />
          </div>
        )}
        <div>
          <Label htmlFor="vintageYear">Vintage year</Label>
          <Input id="vintageYear" name="vintageYear" type="number" min="2000" max="2100" required defaultValue={new Date().getFullYear()} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="effectiveFrom">Effective from</Label>
          <Input id="effectiveFrom" name="effectiveFrom" type="date" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="effectiveTo">Effective to (optional)</Label>
          <Input id="effectiveTo" name="effectiveTo" type="date" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="sourceUrl">Source URL (optional)</Label>
          <Input id="sourceUrl" name="sourceUrl" type="url" className="mt-1" />
        </div>
      </div>

      {existingSets.length > 0 && (
        <div>
          <Label htmlFor="supersedesSetId">This set supersedes (optional)</Label>
          <Select id="supersedesSetId" name="supersedesSetId" defaultValue="" className="mt-1 max-w-md">
            <option value="">— none —</option>
            {existingSets
              .filter((s) => !s.effectiveTo)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
          <p className="mt-1 text-xs text-slate-400">
            If picked, that set&apos;s effective-to date is set to just before this one starts. Its factor rows are
            never edited or deleted.
          </p>
        </div>
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

      {state.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{state.error}</p>
          {state.rowErrors.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-sm text-red-700">
              {state.rowErrors.slice(0, 20).map((e, i) => (
                <li key={i}>
                  Row {e.rowNumber}: {e.message}
                </li>
              ))}
              {state.rowErrors.length > 20 && <li>…and {state.rowErrors.length - 20} more.</li>}
            </ul>
          )}
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Validating & importing…" : "Import"}
      </Button>
    </form>
  );
}

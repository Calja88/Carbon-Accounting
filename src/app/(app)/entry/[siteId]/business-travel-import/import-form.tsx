"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Info } from "lucide-react";
import { commitExpenseInAction, previewExpenseInAction } from "./actions";
import { INITIAL_PREVIEW_STATE, type PreviewState } from "./types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const COLUMN_ROLES = [
  { role: "date", label: "Expense date", required: true },
  { role: "category", label: "Category", required: true },
  { role: "quantity", label: "Distance / nights", required: true },
  { role: "description", label: "Description (optional)", required: false },
] as const;

function formatNumber(n: number) {
  return n.toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

/** "1 night", not "1 nights" — km stays km either way. */
function formatQuantity(value: number, unit: string) {
  const label = unit === "nights" && value === 1 ? "night" : unit;
  return `${formatNumber(value)} ${label}`;
}

export function ExpenseInImportForm({ site }: { site: { id: string; name: string } }) {
  const [previewState, previewAction, previewPending] = useActionState(previewExpenseInAction, INITIAL_PREVIEW_STATE);
  const [commitState, commitAction, commitPending] = useActionState(commitExpenseInAction, INITIAL_PREVIEW_STATE);

  // The commit action carries the final outcome; until it runs, the preview
  // action's state is what's on screen.
  const state: PreviewState = commitState.stage === "done" ? commitState : previewState;

  const [distanceUnit, setDistanceUnit] = useState<"miles" | "km">("miles");

  if (commitState.stage === "done") {
    return (
      <Card className="border-emerald-200 bg-emerald-50/40">
        <CardContent>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-emerald-900">
            <CheckCircle2 className="h-5 w-5" />
            Import complete
          </h2>
          <p className="mt-2 text-sm text-emerald-800">
            {commitState.importedCount} business-travel {commitState.importedCount === 1 ? "entry" : "entries"} created
            for {site.name}.
          </p>
          {commitState.awaitingFactorCount > 0 && (
            <p className="mt-2 text-sm text-amber-800">
              {commitState.awaitingFactorCount} of them {commitState.awaitingFactorCount === 1 ? "is" : "are"} awaiting
              an emission factor and will calculate automatically once one is imported.
            </p>
          )}
          {commitState.flaggedCount > 0 && (
            <p className="mt-2 text-sm text-amber-800">
              {commitState.flaggedCount} {commitState.flaggedCount === 1 ? "was" : "were"} flagged by the plausibility
              check and held back for review.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-4">
            <Link href={`/entry/${site.id}`} className="text-sm font-medium text-brand-700 hover:text-brand-800">
              ← Back to {site.name}
            </Link>
            <Link href="/" className="text-sm font-medium text-brand-700 hover:text-brand-800">
              View the dashboard
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const importableTotal = state.rows.reduce((sum, r) => sum + r.rowCount, 0);

  return (
    <div className="space-y-6">
      <Card className="border-blue-200 bg-blue-50/40">
        <CardContent className="flex items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
          <div className="text-sm text-blue-900">
            <p className="font-medium">How to get this file out of ExpenseIn</p>
            <p className="mt-1 text-brand-800">
              Finance → Completed → Export as CSV. The export needs at least an <strong>expense date</strong>, a{" "}
              <strong>category</strong>, and a <strong>distance or nights</strong> column. ExpenseIn export formats are
              configurable, so if your column names differ, map them by hand below after previewing.
            </p>
            <p className="mt-2 text-brand-800">
              Emissions for travel are calculated from <em>distance travelled</em> and <em>nights stayed</em>, not from
              the amount spent — a £ figure can&apos;t be used for this category.
            </p>
          </div>
        </CardContent>
      </Card>

      <form action={previewAction} className="space-y-5">
        <div>
          <Label htmlFor="file">ExpenseIn export (.csv or .xlsx)</Label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,.xlsx,.xlsm"
            required
            className="mt-1 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
          />
        </div>

        <div className="max-w-xs">
          <Label htmlFor="distanceUnit">Distances in this export are in</Label>
          <Select
            id="distanceUnit"
            name="distanceUnit"
            value={distanceUnit}
            onChange={(e) => setDistanceUnit(e.target.value as "miles" | "km")}
            className="mt-1"
          >
            <option value="miles">Miles</option>
            <option value="km">Kilometres</option>
          </Select>
          <p className="mt-1 text-xs text-slate-500">
            Converted to km for the emission factor. Hotel rows are always read as nights.
          </p>
        </div>

        {state.headers.length > 0 && (
          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-medium text-slate-700">Column mapping</legend>
            <p className="mb-3 text-xs text-slate-500">
              Auto-detected from your file&apos;s headers. Change any that are wrong and preview again.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {COLUMN_ROLES.map(({ role, label, required }) => (
                <div key={role}>
                  <Label htmlFor={`col_${role}`}>{label}</Label>
                  <Select
                    id={`col_${role}`}
                    name={`col_${role}`}
                    defaultValue={state.mapping?.[role] ?? ""}
                    className="mt-1"
                  >
                    <option value="">{required ? "— not mapped —" : "— none —"}</option>
                    {state.headers.map((h, i) => (
                      <option key={`${h}-${i}`} value={i}>
                        {h || `(column ${i + 1})`}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          </fieldset>
        )}

        {state.error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <p className="text-sm text-red-700">{state.error}</p>
          </div>
        )}

        <Button type="submit" variant="secondary" disabled={previewPending}>
          <FileSpreadsheet className="h-4 w-4" />
          {previewPending ? "Reading file…" : state.stage === "preview" ? "Preview again" : "Preview import"}
        </Button>
      </form>

      {state.stage === "preview" && !state.error && (
        <Card>
          <CardHeader>
            <CardTitle>Preview — nothing has been saved yet</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              {state.totalDataRows} row{state.totalDataRows === 1 ? "" : "s"} read · {importableTotal} matched a
              business-travel type · {state.skipped.length} skipped. Matching lines are combined into one entry per
              month per travel type.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {state.rows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th scope="col" className="pb-2 font-medium">Period</th>
                      <th scope="col" className="pb-2 font-medium">Travel type</th>
                      <th scope="col" className="pb-2 text-right font-medium">Quantity</th>
                      <th scope="col" className="pb-2 text-right font-medium">From lines</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {state.rows.map((r) => (
                      <tr key={`${r.periodStartIso}-${r.subtype}`} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 text-slate-700">{r.periodLabel}</td>
                        <td className="py-2 text-slate-700">{r.subtypeLabel}</td>
                        <td className="py-2 text-right text-slate-900">{formatQuantity(r.value, r.unit)}</td>
                        <td className="py-2 text-right text-slate-500">{r.rowCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No rows matched a business-travel type. Check the column mapping above — particularly the category
                column.
              </p>
            )}

            {state.skipped.length > 0 && (
              <details className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                <summary className="cursor-pointer select-none text-sm font-medium text-amber-900">
                  {state.skipped.length} row{state.skipped.length === 1 ? "" : "s"} will be skipped — see why
                </summary>
                <ul className="mt-2 space-y-1 text-sm text-amber-900">
                  {state.skipped.slice(0, 50).map((s) => (
                    <li key={s.rowNumber}>
                      <span className="font-medium">Row {s.rowNumber}</span>
                      {s.categoryText ? ` (${s.categoryText})` : ""}: {s.reason}
                    </li>
                  ))}
                  {state.skipped.length > 50 && <li>…and {state.skipped.length - 50} more.</li>}
                </ul>
              </details>
            )}

            {state.rows.length > 0 && (
              <form action={commitAction} className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                <input type="hidden" name="siteId" value={site.id} />
                <input
                  type="hidden"
                  name="rowsJson"
                  value={JSON.stringify(
                    state.rows.map((r) => ({
                      periodStartIso: r.periodStartIso,
                      subtype: r.subtype,
                      value: r.value,
                      rowCount: r.rowCount,
                    })),
                  )}
                />
                <Button type="submit" disabled={commitPending}>
                  {commitPending
                    ? "Importing…"
                    : `Import ${state.rows.length} ${state.rows.length === 1 ? "entry" : "entries"} to ${site.name}`}
                </Button>
                <Badge tone="info">Creates new entries — existing ones are not replaced</Badge>
              </form>
            )}

            {commitState.error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <p className="text-sm text-red-700">{commitState.error}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, Notice, Td } from "@/components/lca/ui";
import { DUPLICATE_STRATEGY_LABELS, type DuplicateStrategy } from "@/lib/lca/import/inventory-import";
import { emptyImportState } from "@/lib/lca/form-state";
import { commitImportAction, previewImportAction } from "./actions";

export function InventoryImportForm({ assessmentId }: { assessmentId: string }) {
  const [previewState, previewAction, previewPending] = useActionState(previewImportAction, emptyImportState);
  const [commitState, commitFormAction, commitPending] = useActionState(commitImportAction, emptyImportState);
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>("skip");

  const committed = commitState.committed;
  const preview = committed ? null : previewState.preview;

  if (committed) {
    return (
      <Notice tone="success" title="Import complete">
        {committed.created} line(s) created, {committed.updated} updated, {committed.skipped} skipped as duplicates.{" "}
        <Link href={`/assessments/${assessmentId}/inventory`} className="font-medium underline">
          Open the inventory
        </Link>{" "}
        — then run the calculation to bring the results up to date.
      </Notice>
    );
  }

  if (!preview) {
    return (
      <form action={previewAction} className="space-y-4">
        <input type="hidden" name="assessmentId" value={assessmentId} />
        {previewState.error && <Notice tone="danger">{previewState.error}</Notice>}

        <div>
          <Label htmlFor="importFile">Bill of materials or inventory file</Label>
          <Input id="importFile" name="file" type="file" accept=".csv,.xlsx,.xlsm" required className="mt-1" />
          <p className="mt-1 text-xs text-slate-500">
            CSV or Excel, in the template format. Nothing is written until you have seen what the file contains and
            confirmed it.
          </p>
        </div>

        <Button type="submit" disabled={previewPending}>
          <Upload className="h-4 w-4" />
          {previewPending ? "Checking the file…" : "Check the file"}
        </Button>
      </form>
    );
  }

  const importableRows = preview.rows
    .filter((row) => row.prepared !== null && (row.status === "ready" || row.status === "duplicate"))
    .map((row) => row.prepared);

  const willWrite =
    duplicateStrategy === "skip"
      ? preview.readyCount
      : preview.readyCount + preview.duplicateCount;

  return (
    <div className="space-y-5">
      {commitState.error && <Notice tone="danger">{commitState.error}</Notice>}

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">Rows in file</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{preview.totalRows}</div>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-xs uppercase tracking-wide text-emerald-700">Ready to import</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-emerald-900">{preview.readyCount}</div>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="text-xs uppercase tracking-wide text-amber-700">Already in the assessment</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-amber-900">{preview.duplicateCount}</div>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="text-xs uppercase tracking-wide text-red-700">Cannot be imported</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-red-900">{preview.errorCount}</div>
        </div>
      </div>

      {preview.errorCount > 0 && (
        <Notice tone="warning" title={`${preview.errorCount} row(s) cannot be imported`}>
          They are listed below with the reason. Fix them in the file and upload it again — they are not written now and
          they are not quietly dropped either.
        </Notice>
      )}

      {preview.duplicateCount > 0 && (
        <div className="rounded-lg border border-slate-200 p-4">
          <Label htmlFor="duplicateStrategy">What to do with rows that already exist</Label>
          <Select
            id="duplicateStrategy"
            value={duplicateStrategy}
            onChange={(e) => setDuplicateStrategy(e.target.value as DuplicateStrategy)}
            className="mt-1"
          >
            {Object.entries(DUPLICATE_STRATEGY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-slate-500">
            A row counts as a duplicate when it matches an existing line in the same process by part number, or by name
            when there is no part number.
          </p>
        </div>
      )}

      <DataTable headers={["Row", "Status", "Line", "Process", { label: "Quantity", align: "right" }, "Factor", "Notes"]}>
        {preview.rows.map((row) => (
          <tr
            key={row.rowNumber}
            className={row.status === "error" ? "bg-red-50/60" : row.status === "duplicate" ? "bg-amber-50/60" : undefined}
          >
            <Td className="text-xs">{row.rowNumber}</Td>
            <Td>
              <Badge tone={row.status === "ready" ? "success" : row.status === "duplicate" ? "warning" : "danger"}>
                {row.status === "ready" ? "Ready" : row.status === "duplicate" ? "Duplicate" : "Error"}
              </Badge>
            </Td>
            <Td className="font-medium text-slate-900">{row.raw.name ?? <span className="text-slate-400">No name</span>}</Td>
            <Td className="text-xs">{row.raw.process ?? row.raw.stage ?? <span className="text-slate-400">—</span>}</Td>
            <Td align="right" className="text-xs">
              {row.raw.quantity} {row.raw.unit}
            </Td>
            <Td className="text-xs">
              {row.prepared?.emissionFactorId
                ? "Matched from the library"
                : row.prepared?.manualFactorValue
                  ? `${row.prepared.manualFactorValue} kgCO2e/${row.prepared.manualFactorUnit}`
                  : "None — will await a factor"}
            </Td>
            <Td className="text-xs">
              {row.errors.length > 0 && (
                <ul className="space-y-0.5 text-red-700">
                  {row.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              )}
              {row.duplicateOf && <p className="text-amber-800">Matches the existing line &quot;{row.duplicateOf.name}&quot;.</p>}
              {row.warnings.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-slate-500">
                  {row.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              )}
              {row.errors.length === 0 && row.warnings.length === 0 && !row.duplicateOf && (
                <span className="text-slate-400">—</span>
              )}
            </Td>
          </tr>
        ))}
      </DataTable>

      <form action={commitFormAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="assessmentId" value={assessmentId} />
        <input type="hidden" name="fileName" value={previewState.fileName ?? "uploaded file"} />
        <input type="hidden" name="duplicateStrategy" value={duplicateStrategy} />
        <input type="hidden" name="rows" value={JSON.stringify(importableRows)} />
        <Button type="submit" disabled={commitPending || willWrite === 0}>
          {commitPending ? "Importing…" : `Import ${willWrite} row(s)`}
        </Button>
        <span className="text-sm text-slate-500">
          {preview.errorCount > 0 && `${preview.errorCount} row(s) with errors will not be imported. `}
          {duplicateStrategy === "skip" && preview.duplicateCount > 0 && `${preview.duplicateCount} duplicate(s) will be left alone.`}
        </span>
      </form>
    </div>
  );
}

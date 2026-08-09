"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { previewLciImportAction, commitLciImportAction, LciPreviewState, LciCommitState } from "./actions";
import { stagedFileOptions } from "./staged-files";

const PREVIEW_INITIAL: LciPreviewState = {
  error: null,
  fileKey: null,
  fileName: null,
  sourceVersion: null,
  governanceBlockReason: null,
  counts: null,
  sampleRejected: [],
  zeroValueSampleCount: 0,
};

const COMMIT_INITIAL: LciCommitState = { error: null, success: false, factorSetId: null, importedCount: 0, duplicateCount: 0, rejectedCount: 0 };

export function ImportPanel() {
  const options = stagedFileOptions();
  const [fileKey, setFileKey] = useState(options[0]?.key ?? "");
  const [previewState, previewAction, previewPending] = useActionState(previewLciImportAction, PREVIEW_INITIAL);
  const [commitState, commitAction, commitPending] = useActionState(commitLciImportAction, COMMIT_INITIAL);

  if (commitState.success) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/40">
        <CardContent>
          <h2 className="text-lg font-semibold text-emerald-900">Import complete</h2>
          <p className="mt-2 text-sm text-emerald-800">
            {commitState.importedCount} factor{commitState.importedCount === 1 ? "" : "s"} imported into a new,
            versioned factor set. {commitState.duplicateCount} duplicate row(s) already present were skipped (not
            overwritten). {commitState.rejectedCount} row(s) were rejected (no published value, wrong licence
            decision, etc.) — see the audit trail for full detail.
          </p>
          {commitState.factorSetId && (
            <Link href={`/admin/factors/${commitState.factorSetId}`} className="mt-3 inline-block text-sm font-medium text-blue-700 hover:text-blue-800">
              View the new factor set →
            </Link>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import the UK DESNZ 2026 LCI pack</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-slate-500">
          The pack is already staged in the repository at <code>data/lci-import/uk-desnz-2026/</code>. Preview a file
          first — nothing is written until you confirm.
        </p>

        <form action={previewAction} className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-md">
            <Label htmlFor="fileKey">File</Label>
            <Select id="fileKey" name="fileKey" value={fileKey} onChange={(e) => setFileKey(e.target.value)} className="mt-1">
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary" disabled={previewPending}>
            {previewPending ? "Previewing…" : "Preview"}
          </Button>
        </form>

        {previewState.error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{previewState.error}</div>
        )}

        {previewState.counts && (
          <div className="space-y-4 rounded-lg border border-slate-200 p-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral">{previewState.counts.total} rows in file</Badge>
              <Badge tone="success">{previewState.counts.toImport} importable (new)</Badge>
              {previewState.zeroValueSampleCount > 0 && (
                <Badge tone="info">{previewState.zeroValueSampleCount} legitimate zero-value factors, preserved</Badge>
              )}
              <Badge tone="warning">{previewState.counts.duplicates} duplicate (already imported)</Badge>
              <Badge tone="danger">{previewState.counts.rejectedMissingValue} rejected — no published value</Badge>
              <Badge tone="danger">{previewState.counts.rejectedOther} rejected — other reason</Badge>
            </div>

            {previewState.governanceBlockReason && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Commit blocked: {previewState.governanceBlockReason}
              </div>
            )}

            {previewState.sampleRejected.length > 0 && (
              <div>
                <p className="text-sm font-medium text-slate-700">Sample rejected rows:</p>
                <ul className="mt-1 max-h-48 list-inside list-disc overflow-y-auto text-sm text-slate-500">
                  {previewState.sampleRejected.map((r, i) => (
                    <li key={i}>
                      Row {r.rowNumber} ({r.factorId ?? "no id"}) — {r.reason}: {r.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!previewState.governanceBlockReason && previewState.counts.toImport > 0 && (
              <form action={commitAction}>
                <input type="hidden" name="fileKey" value={previewState.fileKey ?? ""} />
                <Button type="submit" disabled={commitPending}>
                  {commitPending ? "Importing…" : `Confirm — import ${previewState.counts.toImport} factor(s)`}
                </Button>
              </form>
            )}

            {commitState.error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{commitState.error}</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

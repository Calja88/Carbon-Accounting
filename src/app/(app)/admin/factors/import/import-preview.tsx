"use client";

import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Surface } from "@/components/ui/primitives";
import {
  emptyPreviewState,
  previewFactorImportAction,
  type FactorImportPreviewState,
  type PreviewGroup,
  type PreviewRow,
} from "./actions";

type GroupKey = "accepted" | "warning" | "rejected" | "duplicate";

const GROUPS: { key: GroupKey; label: string; tone: "success" | "warning" | "danger" | "neutral"; blurb: string }[] = [
  { key: "accepted", label: "Accepted", tone: "success", blurb: "Mapped cleanly. These are the rows a future import would propose." },
  { key: "warning", label: "Warnings", tone: "warning", blurb: "Readable but ambiguous. Each needs a decision before any import could proceed." },
  { key: "rejected", label: "Rejected", tone: "danger", blurb: "Refused. A rejected row is never guessed at and never imported." },
  { key: "duplicate", label: "Duplicates & conflicts", tone: "neutral", blurb: "Already proposed in this file, or already present in the selected dataset. Existing factors are never overwritten." },
];

function Count({ label, value, tone }: { label: string; value: number; tone?: "success" | "warning" | "danger" | "neutral" }) {
  return (
    <div>
      <p className="bd-metric-label">{label}</p>
      <p className="bd-numeric text-2xl font-semibold tabular-nums text-[var(--bd-ink)]">{value.toLocaleString("en-GB")}</p>
      {tone && value > 0 && <Badge tone={tone}>{label}</Badge>}
    </div>
  );
}

function Messages({ messages }: { messages: PreviewRow["messages"] }) {
  if (messages.length === 0) return <span className="bd-muted">—</span>;
  return (
    <ul className="m-0 list-none p-0">
      {messages.map((m, i) => (
        <li key={i} className={m.severity === "error" ? "text-[#9f3030]" : "text-[#80520f]"}>
          {m.message} <span className="bd-muted">({m.code})</span>
        </li>
      ))}
    </ul>
  );
}

function RowTable({ group }: { group: PreviewGroup }) {
  if (group.total === 0) {
    return <p className="bd-muted">No rows in this group.</p>;
  }
  return (
    <>
      <div className="bd-table-scroll">
        <table className="bd-table">
          <thead>
            <tr>
              <th scope="col">Sheet / row</th>
              <th scope="col">Category &amp; activity</th>
              <th scope="col">Unit</th>
              <th scope="col" className="bd-numeric">Factor</th>
              <th scope="col">Gas / kind</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <tr key={`${row.sheet}-${row.rowNumber}-${row.identity}`}>
                <th scope="row">
                  {row.sheet}
                  <br />
                  <span className="bd-muted">row {row.rowNumber}</span>
                </th>
                <td>
                  {row.categoryPath || <span className="bd-muted">(no category)</span>}
                  <br />
                  <span className="bd-muted">{row.activity || "(no activity)"}</span>
                </td>
                <td>
                  {row.rawUnit || <span className="bd-muted">(none)</span>}
                  <br />
                  <span className="bd-muted">
                    {row.canonicalUnit ? `→ ${row.canonicalUnit}` : "not recognised"}
                  </span>
                </td>
                <td className="bd-numeric">
                  {row.factorValue ?? <span className="bd-muted">—</span>}
                  {row.factorUnit && <div className="bd-muted">{row.factorUnit}</div>}
                </td>
                <td>
                  {row.gas ?? <span className="bd-muted">—</span>}
                  {row.kind && <div className="bd-muted">{row.kind}</div>}
                </td>
                <td>
                  <Messages messages={row.messages} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="bd-table-count">
        {group.rows.length < group.total
          ? `Showing the first ${group.rows.length} of ${group.total.toLocaleString("en-GB")} rows.`
          : `${group.total.toLocaleString("en-GB")} row${group.total === 1 ? "" : "s"}.`}
      </p>
    </>
  );
}

export function ImportPreview({ existingSets }: { existingSets: { id: string; name: string; factorCount: number }[] }) {
  const [state, formAction, pending] = useActionState<FactorImportPreviewState, FormData>(
    previewFactorImportAction,
    emptyPreviewState,
  );
  const [tab, setTab] = useState<GroupKey>("accepted");
  const preview = state.preview;

  return (
    <>
      <Surface title="Choose a file" subtitle="Nothing leaves this page — the file is read in memory and never stored." className="mt-6">
        <form action={formAction} className="space-y-5">
          <div>
            <Label htmlFor="file">Factor file (.csv, .xlsx or .xlsm, up to 10 MiB)</Label>
            <input
              id="file"
              name="file"
              type="file"
              accept=".csv,.xlsx,.xlsm"
              required
              className="mt-1 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="publisher">Publisher (optional)</Label>
              <Input id="publisher" name="publisher" placeholder="e.g. DEFRA/DESNZ" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="year">Dataset year (optional)</Label>
              <Input id="year" name="year" type="number" min="2000" max="2100" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="release">Release (optional)</Label>
              <Input id="release" name="release" placeholder="e.g. v1.1" className="mt-1" />
            </div>
          </div>
          <p className="bd-muted text-xs">
            These are only used when the file does not state its own publisher, year or release. Values found in the
            file are reported as detected.
          </p>

          {existingSets.length > 0 && (
            <div>
              <Label htmlFor="existingFactorSetId">Compare against an existing dataset (optional)</Label>
              <Select id="existingFactorSetId" name="existingFactorSetId" defaultValue="" className="mt-1 max-w-md">
                <option value="">— skip database duplicate checks —</option>
                {existingSets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.factorCount} factors)
                  </option>
                ))}
              </Select>
              <p className="bd-muted mt-1 text-xs">
                Only datasets visible to this organisation are listed, and only that dataset is read.
              </p>
            </div>
          )}

          {state.error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3" role="alert">
              <p className="text-sm text-red-700">{state.error}</p>
            </div>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? "Reading file…" : "Preview import"}
          </Button>
        </form>
      </Surface>

      {!preview && !state.error && (
        <Surface className="mt-5">
          <p className="bd-muted">
            No file previewed yet. Choose a file above to see what it contains and what would happen to each row.
          </p>
        </Surface>
      )}

      {preview && (
        <>
          <Surface title="What was read" subtitle={preview.sourceFileName} className="mt-5">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="bd-metric-label">Publisher</dt>
                <dd>{preview.metadata.publisher ?? <span className="bd-muted">Not stated</span>}</dd>
              </div>
              <div>
                <dt className="bd-metric-label">Dataset year</dt>
                <dd>{preview.metadata.year ?? <span className="bd-muted">Not stated</span>}</dd>
              </div>
              <div>
                <dt className="bd-metric-label">Release</dt>
                <dd>{preview.metadata.release ?? <span className="bd-muted">Not stated</span>}</dd>
              </div>
              <div>
                <dt className="bd-metric-label">Rows scanned</dt>
                <dd className="bd-numeric">{preview.totalRowsScanned.toLocaleString("en-GB")}</dd>
              </div>
            </dl>

            <div className="bd-table-scroll mt-5">
              <table className="bd-table">
                <thead>
                  <tr>
                    <th scope="col">Sheet</th>
                    <th scope="col">Processed</th>
                    <th scope="col" className="bd-numeric">Rows scanned</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sheets.length === 0 && (
                    <tr>
                      <td colSpan={3} className="bd-muted">No sheets could be read from this file.</td>
                    </tr>
                  )}
                  {preview.sheets.map((sheet) => (
                    <tr key={sheet.name}>
                      <th scope="row">{sheet.name}</th>
                      <td>
                        {sheet.supported ? (
                          <Badge tone="success">Processed</Badge>
                        ) : (
                          <Badge tone="neutral">Not a recognised factor sheet — skipped</Badge>
                        )}
                      </td>
                      <td className="bd-numeric">{sheet.rowsScanned.toLocaleString("en-GB")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="bd-muted mt-4 text-xs">
              Proposed dataset name: {preview.proposedName || "— not derivable from this file —"}.{" "}
              {preview.existingDatasetChecked
                ? "Checked against the selected existing dataset."
                : "No existing dataset was selected, so database duplicate checks were not run."}
            </p>
          </Surface>

          <Surface title="What it found" className="mt-5">
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-5">
              <Count label="Scanned" value={preview.totalRowsScanned} />
              <Count label="Accepted" value={preview.counts.accepted} tone="success" />
              <Count label="Warnings" value={preview.counts.warning} tone="warning" />
              <Count label="Rejected" value={preview.counts.rejected} tone="danger" />
              <Count label="Duplicates" value={preview.counts.duplicate} tone="neutral" />
            </div>

            {preview.totalRowsScanned > 0 &&
              preview.counts.accepted + preview.counts.warning + preview.counts.rejected + preview.counts.duplicate ===
                0 && (
                <p className="bd-notice mt-5">
                  No factor rows were recognised in this file. Check it is a factor table with a header row rather than
                  a cover sheet or an index.
                </p>
              )}

            {preview.messages.length > 0 && (
              <div className="mt-5">
                <h3 className="text-sm font-semibold">File-level messages</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {preview.messages.map((m, i) => (
                    <li key={i} className={m.severity === "error" ? "text-[#9f3030]" : "text-[#80520f]"}>
                      <Badge tone={m.severity === "error" ? "danger" : "warning"}>{m.severity}</Badge> {m.message}{" "}
                      <span className="bd-muted">({m.code})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Surface>

          <Surface title="Row review" className="mt-5">
            <div className="bd-filterbar" role="tablist" aria-label="Row groups">
              {GROUPS.map((g) => (
                <Button
                  key={g.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === g.key}
                  variant={tab === g.key ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => setTab(g.key)}
                >
                  {g.label} ({preview[g.key].total.toLocaleString("en-GB")})
                </Button>
              ))}
            </div>
            {GROUPS.filter((g) => g.key === tab).map((g) => (
              <div key={g.key}>
                <p className="bd-muted mb-3 text-xs">{g.blurb}</p>
                <RowTable group={preview[g.key]} />
              </div>
            ))}
          </Surface>

          <Surface title="Import factors — disabled" className="mt-5">
            <p className="bd-muted">
              {preview.validationPassed
                ? "This file passed validation, and it still cannot be imported."
                : "This file has unresolved errors or warnings, and it cannot be imported."}{" "}
              Nothing on this page has changed any factor.
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              {preview.commitBlockedReasons.map((reason, i) => (
                <li key={i}>• {reason}</li>
              ))}
            </ul>
            <p className="bd-muted mt-3 text-xs">
              Full official validation still needs the published 2026 UK Government conversion factor workbook
              (2026-full-set.xlsx) and its release metadata; this preview is built and tested against synthetic
              fixtures only.
            </p>
            <div className="mt-4">
              <Button type="button" disabled aria-disabled="true">
                Import factors — disabled
              </Button>
            </div>
          </Surface>
        </>
      )}
    </>
  );
}

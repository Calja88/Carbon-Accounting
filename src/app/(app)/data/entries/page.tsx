import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, FileScan, Trash2 } from "lucide-react";
import { auth } from "@/auth";
import { DataOrigin, EntryStatus, Scope } from "@prisma/client";
import { listActivityEntries, listFilterableSites } from "@/lib/entries-explorer-service";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { DataTable, Td } from "@/components/ui/data-table";
import { RecordList } from "@/components/ui/record-list";
import { FilterBar } from "@/components/ui/filter-bar";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { OriginBadge } from "@/components/ai/ai-disclosure";
import { formatTonnes } from "@/components/charts/palette";
import { deleteActivityEntryAction } from "./actions";

const SCOPE_LABELS: Record<Scope, string> = {
  SCOPE_1: "Scope 1",
  SCOPE_2: "Scope 2",
  SCOPE_3: "Scope 3",
};

const STATUS_OPTIONS: EntryStatus[] = ["SUBMITTED", "FLAGGED", "APPROVED", "REJECTED", "AWAITING_FACTOR"];
const ORIGIN_LABELS: Record<DataOrigin, string> = {
  USER_ENTERED: "Entered by a person",
  IMPORTED: "Imported",
  AI_EXTRACTED: "AI-extracted, accepted",
  DERIVED: "Derived by the platform",
};

interface SearchParams {
  siteId?: string;
  entityId?: string;
  scope?: string;
  status?: string;
  dataOrigin?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: string;
}

function parseMonthInput(value?: string): Date | undefined {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return undefined;
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

/**
 * The Historical Data Explorer: every activity entry ever recorded,
 * filterable/sortable/paginated, browsable without generating a report —
 * see docs/ui-overhaul-plan.md §9 "Historical-data inspection".
 */
export default async function HistoricalDataPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const scope = sp.scope && (["SCOPE_1", "SCOPE_2", "SCOPE_3"] as string[]).includes(sp.scope) ? (sp.scope as Scope) : undefined;
  const status = sp.status && STATUS_OPTIONS.includes(sp.status as EntryStatus) ? (sp.status as EntryStatus) : undefined;
  const dataOrigin =
    sp.dataOrigin && (Object.keys(ORIGIN_LABELS) as string[]).includes(sp.dataOrigin) ? (sp.dataOrigin as DataOrigin) : undefined;

  const [result, sites] = await Promise.all([
    listActivityEntries({
      siteId: sp.siteId || undefined,
      entityId: sp.entityId || undefined,
      scope,
      status,
      dataOrigin,
      q: sp.q || undefined,
      periodFrom: parseMonthInput(sp.from),
      periodTo: parseMonthInput(sp.to),
      page,
    }),
    listFilterableSites(),
  ]);

  const hasActiveFilters = Boolean(sp.siteId || sp.entityId || sp.scope || sp.status || sp.dataOrigin || sp.q || sp.from || sp.to);

  const withPage = (targetPage: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      if (key !== "page" && value) params.set(key, value);
    }
    params.set("page", String(targetPage));
    return `/data/entries?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Data", href: "/data/entry" }, { label: "Historical data" }]} />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Historical data</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Every activity entry ever recorded — however it arrived, hand-typed, imported, or accepted from a document
          extraction — with the emission factor status and the resulting figure. Filter, search and sort without
          having to generate a report first.
        </p>
      </div>

      <FilterBar action="/data/entries" hasActiveFilters={hasActiveFilters} clearHref="/data/entries">
        <div className="min-w-[10rem]">
          <Label htmlFor="q">Search</Label>
          <Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Data point, site, supplier…" className="mt-1" />
        </div>
        <div className="min-w-[10rem]">
          <Label htmlFor="siteId">Site</Label>
          <Select id="siteId" name="siteId" defaultValue={sp.siteId ?? ""} className="mt-1">
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.entity.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="scope">Scope</Label>
          <Select id="scope" name="scope" defaultValue={sp.scope ?? ""} className="mt-1">
            <option value="">All scopes</option>
            {(Object.keys(SCOPE_LABELS) as Scope[]).map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="status">Status</Label>
          <Select id="status" name="status" defaultValue={sp.status ?? ""} className="mt-1">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="dataOrigin">Origin</Label>
          <Select id="dataOrigin" name="dataOrigin" defaultValue={sp.dataOrigin ?? ""} className="mt-1">
            <option value="">Any origin</option>
            {(Object.keys(ORIGIN_LABELS) as DataOrigin[]).map((o) => (
              <option key={o} value={o}>
                {ORIGIN_LABELS[o]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="month" defaultValue={sp.from ?? ""} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="month" defaultValue={sp.to ?? ""} className="mt-1" />
        </div>
      </FilterBar>

      <RecordList
        state={result.rows.length === 0 ? "empty" : "ready"}
        emptyTitle={hasActiveFilters ? "No entries match these filters" : "No activity data recorded yet"}
        emptyDescription={
          hasActiveFilters ? (
            "Try widening the site, scope, status or period filters above."
          ) : (
            <>
              Figures appear here once activity data is entered.{" "}
              <Link href="/data/entry" className="font-medium text-brand-700 underline hover:text-brand-800">
                Enter activity data
              </Link>{" "}
              to get started.
            </>
          )
        }
      >
        <div className="rounded-lg border border-slate-200 bg-white">
          <DataTable
            caption="Activity entries matching the selected filters"
            headers={[
              "Period",
              "Site",
              "Data point",
              { label: "Quantity", align: "right" },
              "Status",
              "Origin",
              { label: "Emissions", align: "right" },
              "",
              { label: "", align: "right" },
            ]}
          >
            {result.rows.map((row) => {
              const detailHref = row.calculationId ? `/calculations/${row.calculationId}` : `/data/entries/${row.id}`;
              return (
                <tr key={row.id} className="hover:bg-slate-50">
                  <Td>
                    {row.periodStart.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}
                  </Td>
                  <Td>
                    <div className="font-medium text-slate-800">{row.siteName}</div>
                    <div className="text-xs text-slate-500">{row.entityName}</div>
                  </Td>
                  <Td>
                    <Link href={detailHref} className="font-medium text-slate-900 hover:text-brand-700">
                      {row.dataPointName}
                    </Link>
                    <div className="text-xs text-slate-500">{row.dataPointCode}</div>
                  </Td>
                  <Td align="right">
                    {row.rawValue.toLocaleString("en-GB", { maximumFractionDigits: 2 })} {row.rawUnit}
                  </Td>
                  <Td>
                    <StatusBadge domain="activityEntry" status={row.status} />
                  </Td>
                  <Td>
                    <OriginBadge origin={row.dataOrigin} />
                  </Td>
                  <Td align="right">{row.resultKgCo2e === null ? <span className="text-slate-400">—</span> : `${formatTonnes(row.resultKgCo2e)} t`}</Td>
                  <Td>
                    {row.sourceDocumentId && (
                      <Link
                        href={`/documents/${row.sourceDocumentId}`}
                        className="flex items-center gap-1 text-xs text-slate-500 hover:text-brand-700"
                        aria-label="View evidence document"
                      >
                        <FileScan className="h-3.5 w-3.5" aria-hidden="true" />
                        Evidence
                      </Link>
                    )}
                  </Td>
                  <Td align="right">
                    <DestructiveActionDialog
                      triggerLabel={`Delete ${row.dataPointName} entry`}
                      triggerIcon={<Trash2 className="h-3.5 w-3.5" />}
                      title="Delete this activity entry?"
                      description="This deletes the entry and its calculation(s). Refused if it's already included in a generated report — reports are permanent snapshots, so a source figure behind one can't be pulled out from under it."
                      confirmLabel="Delete"
                      formAction={deleteActivityEntryAction}
                    >
                      <input type="hidden" name="entryId" value={row.id} />
                    </DestructiveActionDialog>
                  </Td>
                </tr>
              );
            })}
          </DataTable>
        </div>

        <nav aria-label="Pagination" className="flex items-center justify-between gap-4 px-1 py-2 text-sm text-slate-500">
          <span>
            {result.total === 0
              ? "0 entries"
              : `Showing ${(result.page - 1) * result.pageSize + 1}–${Math.min(result.page * result.pageSize, result.total)} of ${result.total}`}
          </span>
          <div className="flex items-center gap-2">
            <Link
              href={withPage(Math.max(1, result.page - 1))}
              aria-disabled={result.page <= 1}
              className={
                result.page <= 1
                  ? "pointer-events-none flex items-center gap-1 text-slate-300"
                  : "flex items-center gap-1 hover:text-slate-800"
              }
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Previous
            </Link>
            <span className="tabular-nums">
              Page {result.page} of {result.pageCount}
            </span>
            <Link
              href={withPage(Math.min(result.pageCount, result.page + 1))}
              aria-disabled={result.page >= result.pageCount}
              className={
                result.page >= result.pageCount
                  ? "pointer-events-none flex items-center gap-1 text-slate-300"
                  : "flex items-center gap-1 hover:text-slate-800"
              }
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </nav>
      </RecordList>
    </div>
  );
}

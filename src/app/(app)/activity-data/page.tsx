import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, ClipboardList, FileScan, History } from "lucide-react";
import { EntryStatus, Scope } from "@prisma/client";
import { resolveAiActor } from "@/lib/ai";
import { prisma } from "@/lib/prisma";
import { formatTonnes } from "@/components/charts/palette";
import {
  ActivityHistoryRow,
  PAGE_SIZE_OPTIONS,
  SCOPE_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
  formatRowEmissions,
  listActivityHistory,
  listActivityHistoryCategories,
  parseActivityHistoryFilters,
} from "@/lib/activity-history-service";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Builds an /activity-data href that keeps every current filter except the ones being overridden. */
function buildHref(current: Record<string, string | undefined>, overrides: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  const merged = { ...current, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `/activity-data?${qs}` : "/activity-data";
}

export default async function ActivityDataPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await resolveAiActor();
  if (!actor) redirect("/login");

  const raw = await searchParams;
  const rawFlat: Record<string, string | undefined> = {
    search: first(raw.search),
    scope: first(raw.scope),
    category: first(raw.category),
    siteId: first(raw.siteId),
    status: first(raw.status),
    from: first(raw.from),
    to: first(raw.to),
    sort: first(raw.sort),
    dir: first(raw.dir),
    page: first(raw.page),
    pageSize: first(raw.pageSize),
  };
  const filters = parseActivityHistoryFilters(rawFlat);

  const [sites, categories, historyPage, anyEntryExists] = await Promise.all([
    prisma.site.findMany({
      where: { isActive: true, id: { in: actor.siteIds } },
      include: { entity: true },
      orderBy: [{ entity: { name: "asc" } }, { name: "asc" }],
    }),
    listActivityHistoryCategories(),
    listActivityHistory(filters),
    prisma.activityEntry.findFirst({ select: { id: true } }),
  ]);

  const hasFilters = Boolean(
    filters.search || filters.scope || filters.category || filters.siteId || filters.status || filters.from || filters.to,
  );

  const rangeStart = historyPage.totalCount === 0 ? 0 : (historyPage.page - 1) * historyPage.pageSize + 1;
  const rangeEnd = Math.min(historyPage.page * historyPage.pageSize, historyPage.totalCount);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Activity Data</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          View, filter and manage previously entered carbon activity data. No report is generated from this page.
        </p>
      </div>

      <Card>
        <CardContent>
          <form method="GET" action="/activity-data" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                name="search"
                type="text"
                placeholder="Supplier, description, site, document filename…"
                defaultValue={filters.search ?? ""}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="scope">Scope</Label>
              <Select id="scope" name="scope" defaultValue={filters.scope ?? ""} className="mt-1">
                <option value="">All scopes</option>
                {Object.values(Scope).map((s) => (
                  <option key={s} value={s}>
                    {SCOPE_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="category">Category</Label>
              <Select id="category" name="category" defaultValue={filters.category ?? ""} className="mt-1">
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="siteId">Site</Label>
              <Select id="siteId" name="siteId" defaultValue={filters.siteId ?? ""} className="mt-1">
                <option value="">All sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.entity.name})
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue={filters.status ?? ""} className="mt-1">
                <option value="">All statuses</option>
                {Object.values(EntryStatus).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="from">From</Label>
              <Input id="from" name="from" type="date" defaultValue={raw.from ? String(first(raw.from)) : ""} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" type="date" defaultValue={raw.to ? String(first(raw.to)) : ""} className="mt-1" />
            </div>
            <div className="flex items-end gap-2 lg:col-span-4">
              <Button type="submit">Apply filters</Button>
              {hasFilters && (
                <Link href="/activity-data" className="text-sm font-medium text-slate-500 hover:text-slate-800">
                  Clear filters
                </Link>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-slate-500">
        <span>
          {historyPage.totalCount === 0
            ? "No records"
            : `Showing ${rangeStart}–${rangeEnd} of ${historyPage.totalCount} records`}
        </span>
        {historyPage.totalCount > 0 && (
          <span>
            Total for filtered records:{" "}
            <span className="font-medium text-slate-900">{formatTonnes(historyPage.totalKgCo2eFiltered)} tCO2e</span>
          </span>
        )}
      </div>

      {historyPage.rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <History className="h-8 w-8 text-slate-300" />
            {!anyEntryExists ? (
              <>
                <p className="text-sm text-slate-500">No activity data has been added yet.</p>
                <div className="flex gap-2">
                  <Link href="/entry">
                    <Button variant="secondary" size="sm">
                      <ClipboardList className="h-3.5 w-3.5" />
                      Add data
                    </Button>
                  </Link>
                  <Link href="/documents">
                    <Button variant="secondary" size="sm">
                      <FileScan className="h-3.5 w-3.5" />
                      Upload documents
                    </Button>
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-500">No records match the selected filters.</p>
                <Link href="/activity-data" className="text-sm font-medium text-blue-700 hover:text-blue-800">
                  Clear filters
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Site</th>
                  <th className="py-2 pr-3 font-medium">Scope &amp; category</th>
                  <th className="py-2 pr-3 font-medium">Description</th>
                  <th className="py-2 pr-3 text-right font-medium">Quantity</th>
                  <th className="py-2 pr-3 text-right font-medium">Emissions</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pl-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {historyPage.rows.map((row: ActivityHistoryRow) => (
                  <tr key={row.id} className="border-b border-slate-100 align-top last:border-0">
                    <td className="py-2.5 pr-3 whitespace-nowrap text-slate-700">
                      {new Date(row.periodStart).toLocaleDateString("en-GB")}
                    </td>
                    <td className="py-2.5 pr-3 text-slate-700">
                      {row.site.name}
                      <div className="text-xs text-slate-400">{row.site.entityName}</div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge tone="info">{SCOPE_LABELS[row.scope]}</Badge>
                      <div className="mt-1 text-xs text-slate-500">{row.category}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-700">
                      {row.dataPointName}
                      {(row.optionLabel || row.supplierName) && (
                        <div className="text-xs text-slate-400">
                          {[row.optionLabel, row.supplierName].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700">
                      {row.rawValue} {row.rawUnit}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700">{formatRowEmissions(row.kgCo2e)}</td>
                    <td className="py-2.5 pr-3">
                      <Badge tone={STATUS_TONES[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                    </td>
                    <td className="py-2.5 pl-3">
                      <Link href={`/activity-data/${row.id}`} className="font-medium text-blue-700 hover:text-blue-800">
                        View details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {historyPage.totalCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2 text-slate-500">
            Rows per page
            <div className="flex gap-1">
              {PAGE_SIZE_OPTIONS.map((size) => (
                <Link
                  key={size}
                  href={buildHref(rawFlat, { pageSize: size, page: 1 })}
                  className={
                    size === historyPage.pageSize
                      ? "rounded-md bg-slate-900 px-2 py-1 text-white"
                      : "rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100"
                  }
                >
                  {size}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {historyPage.page > 1 ? (
              <Link
                href={buildHref(rawFlat, { page: historyPage.page - 1 })}
                className="flex items-center gap-1 font-medium text-slate-700 hover:text-slate-900"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Previous
              </Link>
            ) : (
              <span className="flex items-center gap-1 text-slate-300">
                <ArrowLeft className="h-3.5 w-3.5" />
                Previous
              </span>
            )}
            <span className="text-slate-500">
              Page {historyPage.page} of {historyPage.pageCount}
            </span>
            {historyPage.page < historyPage.pageCount ? (
              <Link
                href={buildHref(rawFlat, { page: historyPage.page + 1 })}
                className="flex items-center gap-1 font-medium text-slate-700 hover:text-slate-900"
              >
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <span className="flex items-center gap-1 text-slate-300">
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

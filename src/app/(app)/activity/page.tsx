import Link from "next/link";
import { redirect } from "next/navigation";
import { EntryStatus, Scope } from "@prisma/client";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { requireCarbonView } from "@/lib/rbac/carbon-access";
import { resolveMonthRange, formatRangeLabel } from "@/lib/report-period";
import { formatKgCO2e } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PageHeader, SetupState, Surface } from "@/components/ui/primitives";
import {
  ENTRY_STATUS_LABEL,
  ENTRY_STATUS_TONE,
  SCOPE_LABEL,
  getRegisterFilterOptions,
  listActivityRegister,
  type ActivityRegisterRow,
} from "@/lib/carbon/activity-register-service";
import type { ActivityActionErrorCode } from "./actions";

/**
 * Phase 4-iii-b: the Activity Data Register — the canonical answer to "what
 * activity data has been entered?".
 *
 * /data stays the collection plan (what is *required*) and /entry stays the
 * place data is *entered*; this is the register of what actually exists. It
 * reads through the existing tenant/site filters and the Phase 4-ii period
 * state, and it never loads more than one page of an organisation's history.
 */

const ERROR_MESSAGE: Record<ActivityActionErrorCode, string> = {
  closed: "This reporting period is closed. Reopen the period before changing accounting data.",
  protected:
    "That activity record is referenced by calculations, reporting or history, so it cannot be deleted. Nothing was changed.",
  denied: "You do not have permission to do that. Ask an administrator for the relevant carbon grant.",
  missing: "That activity record no longer exists, or is not one you can work on. Nothing was changed.",
  invalid: "That request was incomplete, so nothing was changed.",
};

interface SearchParams {
  from?: string;
  to?: string;
  siteId?: string;
  scope?: string;
  status?: string;
  source?: string;
  q?: string;
  page?: string;
  error?: string;
  deleted?: string;
}

function dateLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function quantityLabel(row: ActivityRegisterRow): string {
  return `${row.rawValue.toLocaleString("en-GB", { maximumFractionDigits: 4 })} ${row.rawUnit}`;
}

/**
 * The accounting state of a row in one phrase. A closed period is shown as
 * the read-only overlay it is, not as a replacement for the entry's own
 * status — a closed record is still "Approved" or "Awaiting factor".
 */
function CalculationState({ row }: { row: ActivityRegisterRow }) {
  if (row.calculationCount > 0) {
    return (
      <span className="tabular-nums">
        {formatKgCO2e(row.resultKgCo2e, { unit: true })}
        <span className="block text-[11px] text-[var(--bd-muted)]">
          {row.calculationCount === 1 ? "1 calculation" : `${row.calculationCount} calculations`}
        </span>
      </span>
    );
  }
  return (
    <span className="text-[var(--bd-muted)]">
      {row.status === EntryStatus.AWAITING_FACTOR ? "Awaiting factor" : "Not calculated"}
    </span>
  );
}

export default async function ActivityRegisterPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let context;
  try {
    context = await requireOrganisationContext();
    requireCarbonView(context);
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    if (err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  const params = await searchParams;
  // Same period parsing as /data and the dashboard, so a bad query string
  // falls back to the standard window rather than erroring.
  const range = resolveMonthRange(params.from, params.to);
  const status = params.status && params.status in ENTRY_STATUS_LABEL ? (params.status as EntryStatus) : undefined;
  const scope = params.scope && params.scope in SCOPE_LABEL ? (params.scope as Scope) : undefined;
  const page = Number.parseInt(params.page ?? "1", 10);
  const errorCode = params.error && params.error in ERROR_MESSAGE ? (params.error as ActivityActionErrorCode) : null;

  const [options, result] = await Promise.all([
    getRegisterFilterOptions(context),
    listActivityRegister(context, {
      siteId: params.siteId || undefined,
      from: range.periodStart,
      to: range.periodEnd,
      status,
      scope,
      activityDataPointId: params.source || undefined,
      q: params.q,
      page: Number.isFinite(page) ? page : 1,
    }),
  ]);

  const filtered = Boolean(params.siteId || params.status || params.scope || params.source || params.q?.trim());
  const closedCount = result.rows.filter((row) => row.periodState === "CLOSED").length;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Activity data"
        title="Activity Data Register"
        description={`Every activity record entered into Carbon Ledger. Showing ${formatRangeLabel(range.periodStart, range.periodEnd)}.`}
        actions={
          <Link href="/entry">
            <Button variant="secondary">Enter new data</Button>
          </Link>
        }
      />

      {errorCode && (
        <div className="bd-empty" role="alert">
          <h3>That change was not saved</h3>
          <p>{ERROR_MESSAGE[errorCode]}</p>
        </div>
      )}
      {params.deleted && (
        <div className="bd-empty" role="status">
          <h3>Activity record deleted</h3>
          <p>{params.deleted} was permanently removed. This cannot be undone.</p>
        </div>
      )}

      <Surface>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Field label="Search">
            <Input
              type="search"
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Source, site, supplier or notes"
              className="min-w-[220px]"
            />
          </Field>
          <Field label="Site">
            <Select name="siteId" defaultValue={params.siteId ?? ""} className="min-w-[200px]">
              <option value="">All permitted sites</option>
              {options.sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <Input type="month" name="from" defaultValue={range.startMonth} />
          </Field>
          <Field label="To">
            <Input type="month" name="to" defaultValue={range.endMonth} min={range.startMonth} />
          </Field>
          <Field label="Scope">
            <Select name="scope" defaultValue={params.scope ?? ""}>
              <option value="">All scopes</option>
              {(Object.keys(SCOPE_LABEL) as Scope[]).map((value) => (
                <option key={value} value={value}>
                  {SCOPE_LABEL[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select name="status" defaultValue={params.status ?? ""}>
              <option value="">All statuses</option>
              {(Object.keys(ENTRY_STATUS_LABEL) as EntryStatus[]).map((value) => (
                <option key={value} value={value}>
                  {ENTRY_STATUS_LABEL[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Source">
            <Select name="source" defaultValue={params.source ?? ""} className="min-w-[200px]">
              <option value="">All sources</option>
              {options.dataPoints.map((point) => (
                <option key={point.id} value={point.id}>
                  {point.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
      </Surface>

      {result.total === 0 ? (
        <SetupState
          title={filtered ? "No activity data matches these filters" : "No activity data entered yet"}
          detail={
            filtered
              ? "Clear the search or a filter to see the rest of the register for this period."
              : "Once activity data is entered for a site and period, every record appears here with its status, its figure and whether it can still be changed."
          }
          actions={[{ label: "Enter activity data", href: "/entry" }]}
        />
      ) : (
        <Surface
          title={`${result.total} ${result.total === 1 ? "record" : "records"}`}
          subtitle={
            closedCount > 0
              ? `${closedCount} of the records on this page sit in a closed period and are read-only.`
              : undefined
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-[var(--bd-muted)]">
                  <th className="py-2 pr-3 font-semibold">Activity date</th>
                  <th className="py-2 pr-3 font-semibold">Source</th>
                  <th className="py-2 pr-3 font-semibold">Site</th>
                  <th className="py-2 pr-3 font-semibold text-right">Quantity</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold text-right">Emissions</th>
                  <th className="py-2 pr-3 font-semibold">Last updated</th>
                  <th className="py-2 font-semibold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 align-top last:border-b-0">
                    <td className="py-3 pr-3 whitespace-nowrap">
                      {dateLabel(row.periodStart)}
                      <span className="block text-[11px] text-[var(--bd-muted)]">
                        to {dateLabel(row.periodEnd)}
                      </span>
                    </td>
                    <td className="py-3 pr-3">
                      <span className="font-medium text-slate-900">{row.dataPointName}</span>
                      <span className="block text-[11px] text-[var(--bd-muted)]">
                        {row.code} · {SCOPE_LABEL[row.scope]}
                        {row.scope3Category ? ` · ${row.scope3Category}` : ""}
                        {row.optionLabel ? ` · ${row.optionLabel}` : ""}
                      </span>
                    </td>
                    <td className="py-3 pr-3">
                      {row.siteName}
                      <span className="block text-[11px] text-[var(--bd-muted)]">{row.entityName}</span>
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums whitespace-nowrap">{quantityLabel(row)}</td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={ENTRY_STATUS_TONE[row.status]}>{ENTRY_STATUS_LABEL[row.status]}</Badge>
                        {row.periodState === "CLOSED" && <Badge tone="neutral">Closed period · read-only</Badge>}
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-right">
                      <CalculationState row={row} />
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap text-[var(--bd-muted)]">{dateLabel(row.updatedAt)}</td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <Link href={`/activity/${row.id}`} className="text-sm font-medium text-blue-700 hover:underline">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={result.page} pageCount={result.pageCount} total={result.total} params={params} />
        </Surface>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--bd-muted)]">{label}</span>
      {children}
    </label>
  );
}

/**
 * Page links keep every active filter, so paging never silently widens the
 * set the reader thought they were looking at.
 */
function Pagination({
  page,
  pageCount,
  total,
  params,
}: {
  page: number;
  pageCount: number;
  total: number;
  params: SearchParams;
}) {
  if (pageCount <= 1) return null;
  const href = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== "page" && key !== "error" && key !== "deleted") next.set(key, value);
    }
    next.set("page", String(target));
    return `/activity?${next.toString()}`;
  };

  return (
    <nav className="mt-4 flex items-center justify-between gap-4 text-sm" aria-label="Register pages">
      <span className="text-[var(--bd-muted)]">
        Page {page} of {pageCount} · {total} records
      </span>
      <span className="flex gap-3">
        {page > 1 ? (
          <Link href={href(page - 1)} className="font-medium text-blue-700 hover:underline">
            Previous
          </Link>
        ) : (
          <span className="text-slate-300">Previous</span>
        )}
        {page < pageCount ? (
          <Link href={href(page + 1)} className="font-medium text-blue-700 hover:underline">
            Next
          </Link>
        ) : (
          <span className="text-slate-300">Next</span>
        )}
      </span>
    </nav>
  );
}

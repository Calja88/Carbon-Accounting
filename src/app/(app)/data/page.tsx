import { redirect } from "next/navigation";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { logEvent } from "@/lib/observability/logger";
import { resolveMonthRange, formatRangeLabel } from "@/lib/report-period";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AsyncBoundary, BoardLink, PageHeader, SetupState, Surface } from "@/components/ui/primitives";
import {
  FREQUENCY_LABEL,
  listConfigurableSites,
  listSourceCatalogue,
  type CatalogueSource,
  type ConfigurableSite,
} from "@/lib/carbon/source-config-service";
import {
  canExcludeCollectionRequirement,
  canManageCollectionPlan,
  getCollectionMatrix,
  type CollectionMatrixRow,
  type CollectionStatus,
} from "@/lib/carbon/collection-plan-service";
import { getReportingPeriodView, monthStartFromInput } from "@/lib/carbon/reporting-period-view";
import { ReportingPeriodPanel } from "./reporting-period-panel";
import {
  decideRequirementAction,
  generateCollectionPlanAction,
  setReportingPeriodStateAction,
  type DataActionErrorCode,
} from "./actions";

const STATUS_LABEL: Record<CollectionStatus, string> = {
  not_required: "Not required",
  missing: "Missing",
  submitted: "Submitted",
  awaiting_factor: "Awaiting factor",
  reviewed: "Reviewed",
  excluded: "Excluded",
  changed_since_review: "Changed since review",
};

const STATUS_TONE: Record<CollectionStatus, "neutral" | "success" | "warning" | "danger" | "info"> = {
  not_required: "neutral",
  missing: "warning",
  submitted: "info",
  awaiting_factor: "warning",
  reviewed: "success",
  excluded: "neutral",
  changed_since_review: "danger",
};

/** The statuses shown as summary cards, in the order a lead reads them. */
const SUMMARY_STATUSES: CollectionStatus[] = [
  "missing",
  "submitted",
  "awaiting_factor",
  "reviewed",
  "excluded",
  "changed_since_review",
];

const SCOPE_LABEL: Record<CatalogueSource["scope"], string> = {
  SCOPE_1: "Scope 1 — direct emissions",
  SCOPE_2: "Scope 2 — purchased energy",
  SCOPE_3: "Scope 3 — value chain",
};

const ERROR_MESSAGE: Record<DataActionErrorCode, string> = {
  denied: "You do not have permission to do that. Ask an administrator for the relevant carbon grant.",
  scope: "That site is not one you can work on. Nothing was changed.",
  invalid: "That request was incomplete, so nothing was changed. An exclusion needs a reason.",
  rejected: "That change was not accepted — the requirement may have no settled submission yet, or its state changed. Reload and check.",
  hold: "This reporting period is under an active legal hold, so it cannot be reopened. Nothing was changed.",
  period_invalid: "That reporting period change was incomplete, so nothing was changed. Closing or reopening a month needs a site, a month and a reason.",
};

interface SearchParams {
  from?: string;
  to?: string;
  siteId?: string;
  scope?: string;
  status?: string;
  cell?: string;
  error?: string;
  generated?: string;
  periodMonth?: string;
  periodDone?: string;
}

export default async function DataCollectionPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let context;
  try {
    context = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    if (err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  const params = await searchParams;
  // Same period parsing as the dashboard and the report generator, so a bad
  // query string falls back to the standard year-to-date window rather than
  // erroring.
  const range = resolveMonthRange(params.from, params.to);
  const canManage = canManageCollectionPlan(context);
  const canExclude = canExcludeCollectionRequirement(context);
  const errorCode = params.error && params.error in ERROR_MESSAGE ? (params.error as DataActionErrorCode) : null;

  let sites: ConfigurableSite[], catalogue: CatalogueSource[], matrix: CollectionMatrixRow[];
  try {
    [sites, catalogue, matrix] = await Promise.all([
      listConfigurableSites(context),
      listSourceCatalogue(context),
      getCollectionMatrix(context, {
        periodStart: range.periodStart,
        periodEnd: range.periodEnd,
        siteId: params.siteId || undefined,
      }),
    ]);
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    if (err instanceof PermissionDeniedError) redirect("/");
    // The real exception is what makes a failure fixable; the browser only
    // ever sees the generic message below.
    logEvent({
      level: "error",
      message: "data collection plan load failed",
      organisationId: context.organisationId,
      correlationId: context.correlationId,
      fields: {
        errorName: err instanceof Error ? err.name : typeof err,
        errorMessage: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
    });
    return (
      <div className="space-y-8">
        <DataHeader range={range} />
        <AsyncBoundary
          state="error"
          message="The collection plan could not be loaded. This is a fault, not an empty plan — reload, and report it if it persists."
        />
      </div>
    );
  }

  const siteById = new Map(sites.map((site) => [site.id, site]));
  const sourceById = new Map(catalogue.map((source) => [source.id, source]));
  const scopeFilter = params.scope && params.scope in SCOPE_LABEL ? (params.scope as CatalogueSource["scope"]) : null;
  const statusFilter = params.status && params.status in STATUS_LABEL ? (params.status as CollectionStatus) : null;

  const visible = matrix.filter((row) => {
    if (scopeFilter && sourceById.get(row.activityDataPointId)?.scope !== scopeFilter) return false;
    if (statusFilter && row.status !== statusFilter) return false;
    return true;
  });

  // Columns come from the rows themselves, so a monthly and a quarterly
  // source can coexist: each row only fills the columns its own cadence
  // produced, and the rest read "not required" rather than "missing".
  const columns = [...new Map(visible.map((row) => [row.periodKey, row.periodStart])).entries()]
    .sort((a, b) => a[1].getTime() - b[1].getTime() || a[0].localeCompare(b[0]))
    .map(([periodKey]) => periodKey);

  const rows = groupRows(visible, siteById, sourceById);
  const counts = countStatuses(visible);
  const selected = params.cell ? visible.find((row) => row.id === params.cell) ?? null : null;
  const scopeState = { from: range.startMonth, to: range.endMonth, siteId: params.siteId, scope: params.scope, status: params.status };
  const generated = parseGenerated(params.generated);

  // Phase 4-iii: close/reopen is per site and per month, so the panel only
  // appears once the filters name one of each. The month defaults to the end
  // of the selected window — the month a lead closes at month end — and the
  // panel's own picker overrides it without disturbing the matrix filters.
  const periodSite = params.siteId ? siteById.get(params.siteId) ?? null : null;
  const periodMonth = monthStartFromInput(params.periodMonth) ?? monthStartFromInput(range.endMonth);
  const periodView =
    periodSite && periodMonth ? await getReportingPeriodView(context, periodSite.id, periodMonth) : null;
  const periodDone = params.periodDone === "CLOSED" || params.periodDone === "OPEN" ? params.periodDone : null;

  return (
    <div className="space-y-8">
      <DataHeader range={range} />

      {errorCode && (
        <div className="bd-empty" role="alert">
          <h3>That change was not saved</h3>
          <p>{ERROR_MESSAGE[errorCode]}</p>
        </div>
      )}
      {generated && (
        <div className="bd-empty" role="status">
          <h3>Collection plan refreshed</h3>
          <p>
            {generated.created} new {generated.created === 1 ? "requirement" : "requirements"} created;{" "}
            {generated.alreadyPresent} already present.
            {generated.skippedAdHoc > 0
              ? ` ${generated.skippedAdHoc} ad-hoc ${generated.skippedAdHoc === 1 ? "source was" : "sources were"} skipped — those have no fixed cadence to generate from.`
              : ""}
          </p>
        </div>
      )}

      {sites.length === 0 ? (
        <SetupState
          title="No sites available to you yet"
          detail="Data collection is tracked per site. Once a site exists in your organisation and you have access to it, its required data appears here."
          actions={[{ label: "Open admin", href: "/admin" }]}
        />
      ) : (
        <>
          <Surface>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <Field label="Site">
                <Select name="siteId" defaultValue={params.siteId ?? ""} className="min-w-[200px]">
                  <option value="">All permitted sites</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.entityName} — {site.name}
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
                  {(Object.keys(SCOPE_LABEL) as CatalogueSource["scope"][]).map((scope) => (
                    <option key={scope} value={scope}>
                      {SCOPE_LABEL[scope]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status">
                <Select name="status" defaultValue={params.status ?? ""}>
                  <option value="">All statuses</option>
                  {SUMMARY_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABEL[status]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" variant="secondary">
                Apply
              </Button>
            </form>
          </Surface>

          {periodView && periodSite ? (
            <ReportingPeriodPanel
              view={periodView}
              siteLabel={`${periodSite.entityName} — ${periodSite.name}`}
              scope={scopeState}
              action={setReportingPeriodStateAction}
              done={periodDone}
            />
          ) : (
            <Surface title="Reporting period">
              <p className="bd-muted text-sm">
                A month is closed or reopened one site at a time. Choose a single site above to see whether its months
                are open or closed for accounting changes.
              </p>
            </Surface>
          )}

          {canManage && (
            <form action={generateCollectionPlanAction} className="flex flex-wrap items-center gap-3">
              <ScopeInputs scope={scopeState} />
              <Button type="submit">{matrix.length === 0 ? "Generate collection plan" : "Refresh collection plan"}</Button>
              <span className="text-xs text-[var(--bd-muted)]">
                Creates any requirement this window is missing. Existing reviews and exclusions are never overwritten.
              </span>
            </form>
          )}
          {!canManage && (
            <p className="text-xs text-[var(--bd-muted)]">
              You can see what data is required, but not generate a plan or record decisions — that needs the carbon review permission.
            </p>
          )}

          {matrix.length === 0 ? (
            <SetupState
              title="No collection plan for this period yet"
              detail={
                canManage
                  ? "Nothing has been required of these sites for this window yet. Enable the sources each site reports, then generate the plan."
                  : "Nothing has been required of these sites for this window yet. Someone with the carbon review permission can generate the plan."
              }
              actions={[{ label: "Open emission sources", href: "/sources" }]}
            />
          ) : (
            <>
              <SummaryCards total={visible.length} counts={counts} />

              {selected && (
                <DetailPanel
                  row={selected}
                  site={siteById.get(selected.siteId)}
                  source={sourceById.get(selected.activityDataPointId)}
                  scope={scopeState}
                  canManage={canManage}
                  canExclude={canExclude}
                />
              )}

              {visible.length === 0 ? (
                <SetupState
                  title="No required data matches this filter"
                  detail="Clear the scope or status filter to see the rest of the collection plan for this period."
                />
              ) : counts.missing === 0 && counts.awaiting_factor === 0 && counts.changed_since_review === 0 ? (
                <Surface title="Everything required for this period has been supplied">
                  <p className="bd-muted">
                    No source is missing data, awaiting a factor, or changed since it was reviewed. The matrix below shows the
                    detail.
                  </p>
                </Surface>
              ) : null}

              <Matrix rows={rows} columns={columns} scope={scopeState} selectedId={selected?.id ?? null} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function DataHeader({ range }: { range: { periodStart: Date; periodEnd: Date } }) {
  return (
    <PageHeader
      eyebrow="Data collection"
      title="Data Collection"
      description={`Track required carbon data by site, source and period. Showing ${formatRangeLabel(range.periodStart, range.periodEnd)}.`}
    />
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

interface ScopeState {
  from: string;
  to: string;
  siteId?: string;
  scope?: string;
  status?: string;
}

function ScopeInputs({ scope, cell }: { scope: ScopeState; cell?: string }) {
  return (
    <>
      <input type="hidden" name="from" value={scope.from} />
      <input type="hidden" name="to" value={scope.to} />
      {scope.siteId && <input type="hidden" name="siteId" value={scope.siteId} />}
      {scope.scope && <input type="hidden" name="scope" value={scope.scope} />}
      {scope.status && <input type="hidden" name="status" value={scope.status} />}
      {cell && <input type="hidden" name="cell" value={cell} />}
    </>
  );
}

function countStatuses(rows: CollectionMatrixRow[]): Record<CollectionStatus, number> {
  const counts = Object.fromEntries(Object.keys(STATUS_LABEL).map((key) => [key, 0])) as Record<CollectionStatus, number>;
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

function SummaryCards({ total, counts }: { total: number; counts: Record<CollectionStatus, number> }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
      <div className="bd-surface">
        <p className="bd-metric-label">Required</p>
        <p className="text-2xl font-semibold text-[var(--bd-ink)]">{total}</p>
        <p className="bd-muted text-xs">data points expected this period</p>
      </div>
      {SUMMARY_STATUSES.map((status) => (
        <div key={status} className="bd-surface">
          <p className="bd-metric-label">{STATUS_LABEL[status]}</p>
          <p className="text-2xl font-semibold text-[var(--bd-ink)]">{counts[status]}</p>
          <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
        </div>
      ))}
    </div>
  );
}

interface MatrixRow {
  key: string;
  siteName: string;
  entityName: string;
  sourceName: string;
  sourceCode: string;
  cellsByPeriod: Map<string, CollectionMatrixRow>;
}

function groupRows(
  rows: CollectionMatrixRow[],
  siteById: Map<string, ConfigurableSite>,
  sourceById: Map<string, CatalogueSource>,
): MatrixRow[] {
  const grouped = new Map<string, MatrixRow>();
  for (const row of rows) {
    const key = `${row.siteId}:${row.activityDataPointId}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.cellsByPeriod.set(row.periodKey, row);
      continue;
    }
    const site = siteById.get(row.siteId);
    const source = sourceById.get(row.activityDataPointId);
    grouped.set(key, {
      key,
      siteName: site?.name ?? "Site no longer in scope",
      entityName: site?.entityName ?? "",
      sourceName: source?.dataPointName ?? "Source no longer in the catalogue",
      sourceCode: source?.code ?? "—",
      cellsByPeriod: new Map([[row.periodKey, row]]),
    });
  }
  return [...grouped.values()].sort(
    (a, b) => a.siteName.localeCompare(b.siteName) || a.sourceName.localeCompare(b.sourceName),
  );
}

function cellHref(scope: ScopeState, requirementId: string): string {
  const params = new URLSearchParams({ from: scope.from, to: scope.to, cell: requirementId });
  if (scope.siteId) params.set("siteId", scope.siteId);
  if (scope.scope) params.set("scope", scope.scope);
  if (scope.status) params.set("status", scope.status);
  return `/data?${params.toString()}`;
}

function Matrix({
  rows,
  columns,
  scope,
  selectedId,
}: {
  rows: MatrixRow[];
  columns: string[];
  scope: ScopeState;
  selectedId: string | null;
}) {
  if (rows.length === 0) return null;
  return (
    <Surface title="Required data" subtitle="Select any cell to see what is expected and what has been supplied.">
      <div style={{ overflowX: "auto" }}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 bg-[var(--bd-surface)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--bd-muted)]">
                Site &amp; source
              </th>
              {columns.map((periodKey) => (
                <th key={periodKey} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--bd-muted)]">
                  {periodKey}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-[var(--bd-line)]">
                <th scope="row" className="sticky left-0 bg-[var(--bd-surface)] px-3 py-3 text-left font-normal">
                  <span className="block font-medium text-[var(--bd-ink)]">{row.sourceName}</span>
                  <span className="block text-xs text-[var(--bd-muted)]">
                    {row.entityName ? `${row.entityName} — ` : ""}
                    {row.siteName} · {row.sourceCode}
                  </span>
                </th>
                {columns.map((periodKey) => {
                  const cell = row.cellsByPeriod.get(periodKey);
                  if (!cell) {
                    // This row's cadence produces no period here. Not a gap —
                    // rendering it as "missing" would invent an expectation.
                    return (
                      <td key={periodKey} className="px-3 py-3 text-[var(--bd-muted)]">
                        <span aria-label="Not required for this period">—</span>
                      </td>
                    );
                  }
                  return (
                    <td key={periodKey} className="px-3 py-3">
                      <BoardLink
                        href={cellHref(scope, cell.id)}
                        className="inline-flex flex-col gap-1"
                        aria-label={`${row.sourceName}, ${row.siteName}, ${periodKey}: ${STATUS_LABEL[cell.status]}`}
                        {...(cell.id === selectedId ? { "aria-current": "page" as const } : {})}
                      >
                        <Badge tone={STATUS_TONE[cell.status]}>{STATUS_LABEL[cell.status]}</Badge>
                        {cell.periodOpen && <span className="text-[10px] text-[var(--bd-muted)]">month still running</span>}
                      </BoardLink>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

function DetailPanel({
  row,
  site,
  source,
  scope,
  canManage,
  canExclude,
}: {
  row: CollectionMatrixRow;
  site?: ConfigurableSite;
  source?: CatalogueSource;
  scope: ScopeState;
  canManage: boolean;
  canExclude: boolean;
}) {
  const entryHref = source
    ? `/entry/${row.siteId}/${source.code}?period=${row.periodKey}&returnTo=%2Fdata`
    : null;
  const facts: [string, string][] = [
    ["Site", site ? `${site.entityName} — ${site.name}` : "No longer in scope"],
    ["Source", source?.dataPointName ?? "No longer in the catalogue"],
    ["Code", source?.code ?? "—"],
    ["Period", `${row.periodKey} (${row.periodStart.toISOString().slice(0, 10)} to ${row.periodEnd.toISOString().slice(0, 10)})`],
    ["Status", STATUS_LABEL[row.status]],
    ["Frequency", FREQUENCY_LABEL[row.periodKind]],
    ["Expected unit", source?.unitOptions[0] ?? "Not specified in the catalogue"],
    // "Calendar period", not the accounting reporting period above — this row
    // only says whether the month itself has finished, never whether the
    // period is locked for accounting changes.
    ["Calendar period", row.periodOpen ? "Still running — data is not late yet" : "Ended"],
    ["Submissions", row.entryIds.length > 0 ? row.entryIds.join(", ") : "None recorded for this period"],
  ];
  if (row.excludedReason) facts.push(["Excluded because", row.excludedReason]);

  return (
    <Surface title="Requirement detail" subtitle={`${source?.dataPointName ?? "Source"} · ${row.periodKey}`}>
      <dl className="grid gap-x-6 gap-y-2" style={{ gridTemplateColumns: "minmax(140px, max-content) 1fr" }}>
        {facts.map(([term, value], index) => (
          <div key={`${term}-${index}`} className="contents">
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--bd-muted)]">{term}</dt>
            <dd className="text-sm text-[var(--bd-ink)]">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        {entryHref && (
          <BoardLink href={entryHref} className="bd-button bd-button--quiet">
            {row.entryIds.length > 0 ? "Edit data" : "Enter data"}
          </BoardLink>
        )}

        {canManage && row.status !== "excluded" && row.decision === "PENDING" && (
          <form action={decideRequirementAction} className="flex items-end gap-2">
            <ScopeInputs scope={scope} cell={row.id} />
            <input type="hidden" name="requirementId" value={row.id} />
            <Button type="submit" name="intent" value="review" variant="secondary" size="sm">
              Mark reviewed
            </Button>
          </form>
        )}

        {canExclude && row.status !== "excluded" && (
          <form action={decideRequirementAction} className="flex items-end gap-2">
            <ScopeInputs scope={scope} cell={row.id} />
            <input type="hidden" name="requirementId" value={row.id} />
            <Field label="Reason to exclude">
              <Textarea name="reason" rows={1} required placeholder="Why is this not expected?" className="min-w-[220px]" />
            </Field>
            <Button type="submit" name="intent" value="exclude" variant="ghost" size="sm">
              Exclude
            </Button>
          </form>
        )}

        {canExclude && row.status === "excluded" && (
          <form action={decideRequirementAction} className="flex items-end gap-2">
            <ScopeInputs scope={scope} cell={row.id} />
            <input type="hidden" name="requirementId" value={row.id} />
            <Button type="submit" name="intent" value="reopen" variant="secondary" size="sm">
              Reopen
            </Button>
          </form>
        )}
      </div>
    </Surface>
  );
}

function parseGenerated(value?: string): { created: number; alreadyPresent: number; skippedAdHoc: number } | null {
  if (!value) return null;
  const parts = value.split(":").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return { created: parts[0], alreadyPresent: parts[1], skippedAdHoc: parts[2] };
}

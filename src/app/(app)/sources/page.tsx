import { redirect } from "next/navigation";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { resolveMonthRange, formatRangeLabel } from "@/lib/report-period";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AsyncBoundary, PageHeader, SetupState, Surface } from "@/components/ui/primitives";
import {
  CarbonSourceFrequency,
  FACTOR_KIND_LABEL,
  FREQUENCY_LABEL,
  canManageSourceConfig,
  getFactorAvailability,
  listConfigurableSites,
  listSiteSourceConfigs,
  listSourceCatalogue,
  suggestedFrequency,
  type CatalogueSource,
  type FactorAvailability,
  type SourceConfigRow,
} from "@/lib/carbon/source-config-service";
import { configureSourceAction, type SourceConfigErrorCode } from "./actions";

const SCOPE_LABEL: Record<CatalogueSource["scope"], string> = {
  SCOPE_1: "Scope 1 — direct emissions",
  SCOPE_2: "Scope 2 — purchased energy",
  SCOPE_3: "Scope 3 — value chain",
};

const ERROR_MESSAGE: Record<SourceConfigErrorCode, string> = {
  denied: "You do not have permission to change what a site reports. Ask an administrator for the site configuration grant.",
  scope: "That site is not one you can configure. Nothing was changed.",
  invalid: "That request was incomplete, so nothing was changed. Try again.",
  not_configured: "That source is not switched on for this site yet — enable it before setting a reporting frequency.",
};

const FREQUENCY_OPTIONS = Object.values(CarbonSourceFrequency);

interface SearchParams {
  siteId?: string;
  from?: string;
  to?: string;
  scope?: string;
  show?: string;
  error?: string;
}

export default async function SourcesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let context;
  try {
    context = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    if (err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  const params = await searchParams;
  const range = resolveMonthRange(params.from, params.to);
  const canManage = canManageSourceConfig(context);
  const errorCode = params.error && params.error in ERROR_MESSAGE ? (params.error as SourceConfigErrorCode) : null;

  // Load everything the screen needs in one place so a genuine fault
  // (database down, permission revoked mid-session) surfaces as a real
  // error state rather than as an empty catalogue that reads like "you
  // have no emission sources".
  let sites, catalogue, configs, availability;
  try {
    [sites, catalogue] = await Promise.all([listConfigurableSites(context), listSourceCatalogue(context)]);
    [configs, availability] = await Promise.all([
      listSiteSourceConfigs(context),
      getFactorAvailability(context, range.periodEnd, catalogue.map((source) => source.factorCategory)),
    ]);
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    if (err instanceof PermissionDeniedError) redirect("/");
    return (
      <div className="space-y-8">
        <SourcesHeader range={range} />
        <AsyncBoundary
          state="error"
          message="The emission source catalogue could not be loaded. This is a fault, not an empty configuration — reload, and report it if it persists."
        />
      </div>
    );
  }

  const selectedSite = sites.find((site) => site.id === params.siteId) ?? sites[0] ?? null;
  const scopeFilter = params.scope && params.scope in SCOPE_LABEL ? (params.scope as CatalogueSource["scope"]) : null;
  const showEnabledOnly = params.show === "enabled";

  const configBySite = new Map<string, SourceConfigRow>();
  const enabledSiteCount = new Map<string, number>();
  for (const config of configs) {
    if (selectedSite && config.siteId === selectedSite.id) configBySite.set(config.activityDataPointId, config);
    if (config.enabled) {
      enabledSiteCount.set(config.activityDataPointId, (enabledSiteCount.get(config.activityDataPointId) ?? 0) + 1);
    }
  }

  const visible = catalogue.filter((source) => {
    if (scopeFilter && source.scope !== scopeFilter) return false;
    if (showEnabledOnly && !configBySite.get(source.id)?.enabled) return false;
    return true;
  });

  const groups = groupByScopeAndCategory(visible);
  const formScope = { from: range.startMonth, to: range.endMonth, scope: params.scope, show: params.show };

  return (
    <div className="space-y-8">
      <SourcesHeader range={range} />

      {errorCode && (
        <div className="bd-empty" role="alert">
          <h3>That change was not saved</h3>
          <p>{ERROR_MESSAGE[errorCode]}</p>
        </div>
      )}

      {sites.length === 0 ? (
        <SetupState
          title="No sites available to you yet"
          detail="Emission sources are configured per site. Once a site exists in your organisation and you have access to it, its reporting plan appears here."
          actions={[{ label: "Open admin", href: "/admin" }]}
        />
      ) : catalogue.length === 0 ? (
        <SetupState
          title="No emission source catalogue yet"
          detail="The platform's activity data catalogue is empty, so there is nothing to switch on for a site. This is a setup step, not a reporting gap."
          actions={[{ label: "Open factor datasets", href: "/admin/factors" }]}
        />
      ) : (
        <>
          <Surface>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <Field label="Site">
                <Select name="siteId" defaultValue={selectedSite?.id} className="min-w-[220px]">
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
              <Field label="Show">
                <Select name="show" defaultValue={showEnabledOnly ? "enabled" : "all"}>
                  <option value="all">All sources</option>
                  <option value="enabled">Only sources this site reports</option>
                </Select>
              </Field>
              <Button type="submit" variant="secondary">
                Apply
              </Button>
            </form>
          </Surface>

          {!canManage && (
            <p className="text-xs text-[var(--bd-muted)]">
              You can see what each site reports, but not change it — that needs the site configuration permission.
            </p>
          )}

          {visible.length === 0 ? (
            <SetupState
              title={showEnabledOnly ? "This site does not report any sources yet" : "No sources match this filter"}
              detail={
                showEnabledOnly
                  ? "Switch the filter to “All sources” and enable the ones this site should report. Nothing is expected from this site until you do."
                  : "No catalogue source matches the selected scope. Clear the scope filter to see the full catalogue."
              }
            />
          ) : (
            groups.map(({ scope, categories }) => (
              <Surface key={scope} title={SCOPE_LABEL[scope]} subtitle={`${categories.reduce((n, c) => n + c.sources.length, 0)} sources in the catalogue`}>
                <div className="space-y-6">
                  {categories.map(({ category, sources }) => (
                    <div key={category}>
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--bd-muted)]">{category}</h3>
                      <div className="space-y-3">
                        {sources.map((source) => (
                          <SourceRow
                            key={source.id}
                            source={source}
                            config={configBySite.get(source.id) ?? null}
                            availability={availability.get(source.factorCategory) ?? null}
                            enabledSites={enabledSiteCount.get(source.id) ?? 0}
                            siteId={selectedSite!.id}
                            siteName={selectedSite!.name}
                            canManage={canManage}
                            formScope={formScope}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Surface>
            ))
          )}
        </>
      )}
    </div>
  );
}

function SourcesHeader({ range }: { range: { periodStart: Date; periodEnd: Date } }) {
  return (
    <PageHeader
      eyebrow="Emission sources"
      title="Emission Sources"
      description={`Choose which carbon sources each site reports, and how often. These choices drive the data you will be asked for later — nothing here changes a calculation or a report. Factor availability is shown for ${formatRangeLabel(range.periodStart, range.periodEnd)}.`}
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

function FactorBadge({ availability }: { availability: FactorAvailability | null }) {
  if (!availability?.available) {
    // No visible factor for this period. Deliberately "awaiting" — never a
    // zero, and never presented as an error.
    return <Badge tone="warning">Awaiting factor</Badge>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone="success">Factor available</Badge>
      {availability.kinds.map((kind) => (
        <Badge key={kind} tone="neutral">
          {FACTOR_KIND_LABEL[kind]}
        </Badge>
      ))}
    </span>
  );
}

function SourceRow({
  source,
  config,
  availability,
  enabledSites,
  siteId,
  siteName,
  canManage,
  formScope,
}: {
  source: CatalogueSource;
  config: SourceConfigRow | null;
  availability: FactorAvailability | null;
  enabledSites: number;
  siteId: string;
  siteName: string;
  canManage: boolean;
  formScope: { from: string; to: string; scope?: string; show?: string };
}) {
  const enabled = config?.enabled ?? false;
  const frequency = config?.frequency ?? suggestedFrequency(source.catalogueFrequency);
  const typicalUnit = source.unitOptions[0];

  return (
    <div className="rounded-[var(--bd-radius-sm)] border border-[var(--bd-line)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[260px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-[var(--bd-ink)]">{source.dataPointName}</span>
            <Badge tone="neutral">{source.code}</Badge>
            {source.scope3Category && <Badge tone="info">{source.scope3Category}</Badge>}
          </div>
          <p className="mt-1 text-sm text-[var(--bd-muted)]">
            {typicalUnit ? `Usually reported in ${typicalUnit}. ` : ""}
            {source.promptTemplate}
          </p>
          {source.helpText && (
            <details className="mt-2 text-sm text-[var(--bd-muted)]">
              <summary className="cursor-pointer">Why are we asking for this?</summary>
              <p className="mt-1">{source.helpText}</p>
            </details>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <FactorBadge availability={availability} />
            <span className="text-xs text-[var(--bd-muted)]">
              {enabledSites === 0
                ? "Not reported by any site yet"
                : `Reported by ${enabledSites} ${enabledSites === 1 ? "site" : "sites"}`}
            </span>
          </div>
        </div>

        <div className="min-w-[260px]">
          <div className="mb-2 flex items-center gap-2">
            {enabled ? (
              <Badge tone="success">{siteName} reports this</Badge>
            ) : config ? (
              <Badge tone="neutral">Switched off for {siteName}</Badge>
            ) : (
              <Badge tone="neutral">Not set up for {siteName}</Badge>
            )}
            {enabled && <span className="text-xs text-[var(--bd-muted)]">{FREQUENCY_LABEL[frequency]}</span>}
          </div>

          {canManage ? (
            <form action={configureSourceAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="siteId" value={siteId} />
              <input type="hidden" name="activityDataPointId" value={source.id} />
              <input type="hidden" name="from" value={formScope.from} />
              <input type="hidden" name="to" value={formScope.to} />
              {formScope.scope && <input type="hidden" name="scope" value={formScope.scope} />}
              {formScope.show && <input type="hidden" name="show" value={formScope.show} />}
              <Field label="Reporting frequency">
                <Select name="frequency" defaultValue={frequency} aria-label={`Reporting frequency for ${source.dataPointName}`}>
                  {FREQUENCY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {FREQUENCY_LABEL[option]}
                    </option>
                  ))}
                </Select>
              </Field>
              {enabled ? (
                <>
                  <Button type="submit" name="intent" value="frequency" variant="secondary" size="sm">
                    Save frequency
                  </Button>
                  <Button type="submit" name="intent" value="disable" variant="ghost" size="sm">
                    Stop reporting
                  </Button>
                </>
              ) : (
                <Button type="submit" name="intent" value="enable" size="sm">
                  Report this source
                </Button>
              )}
            </form>
          ) : (
            <p className="text-xs text-[var(--bd-muted)]">
              {enabled ? `Expected ${FREQUENCY_LABEL[frequency].toLowerCase()}.` : "Not currently expected from this site."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Catalogue order is already scope -> sortOrder -> code; this only buckets it, never re-sorts. */
function groupByScopeAndCategory(sources: CatalogueSource[]) {
  const byScope = new Map<CatalogueSource["scope"], Map<string, CatalogueSource[]>>();
  for (const source of sources) {
    const categories = byScope.get(source.scope) ?? new Map<string, CatalogueSource[]>();
    categories.set(source.category, [...(categories.get(source.category) ?? []), source]);
    byScope.set(source.scope, categories);
  }
  return [...byScope.entries()].map(([scope, categories]) => ({
    scope,
    categories: [...categories.entries()].map(([category, items]) => ({ category, sources: items })),
  }));
}

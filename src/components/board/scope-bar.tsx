"use client";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import type { LocalHref } from "../../lib/board/contracts";
import { localHref } from "../../lib/board/navigation";
/** Organisation switch is supplied as the existing server-authorized action, never a hidden tenant-id form here. */
export function ScopeBar({ organisationName, organisationSwitcher, sites, siteId, from, to, action, periodMode = "carbon", operationalAsOf }: {
  organisationName: string; organisationSwitcher?: ReactNode; sites: { id: string; name: string }[];
  siteId?: string; from: string; to: string; action: LocalHref; periodMode?: "carbon" | "operational" | "product"; operationalAsOf?: string;
}) {
  // The URL is the scope. The layout that renders this bar never sees a
  // page's searchParams, so the current selection is read here and the
  // server-resolved default is used only when the URL carries none — the
  // control and the dashboard therefore always show the same period.
  const params = useSearchParams();
  const month = (value: string | null) => (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null);
  const selectedFrom = month(params.get("from")) ?? from;
  const selectedTo = month(params.get("to")) ?? to;
  const requestedSite = params.get("siteId") ?? siteId ?? "";
  // An out-of-scope site is the server's to reject; the control simply does not pretend to have it selected.
  const selectedSite = sites.some(s => s.id === requestedSite) ? requestedSite : "";
  return <div className="bd-scopebar"><div className="bd-organisation">{organisationSwitcher ?? <strong>{organisationName}</strong>}</div>
    {periodMode === "carbon" ? <form action={localHref(action)} method="get" className="bd-scope-form"><label><span className="bd-sr-only">Site</span><select aria-label="Site" name="siteId" defaultValue={selectedSite} key={`site:${selectedSite}`}><option value="">All permitted sites</option>{sites.map(site => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label>
      <label><span className="bd-sr-only">Carbon period start</span><input aria-label="Carbon period start" type="month" name="from" defaultValue={selectedFrom} key={`from:${selectedFrom}`} required /></label><span aria-hidden="true">—</span><label><span className="bd-sr-only">Carbon period end</span><input aria-label="Carbon period end" type="month" name="to" defaultValue={selectedTo} key={`to:${selectedTo}`} min={selectedFrom} required /></label><button className="bd-button bd-button--primary" type="submit">Apply</button></form>
    : <p className="bd-muted">{periodMode === "product" ? "Product boundary set in assessment" : `Operational position${operationalAsOf ? ` · ${operationalAsOf}` : ""}`}</p>}
  </div>;
}

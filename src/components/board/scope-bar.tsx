"use client";
import type { ReactNode } from "react";
import type { LocalHref } from "../../lib/board/contracts";
import { localHref } from "../../lib/board/navigation";
/** Organisation switch is supplied as the existing server-authorized action, never a hidden tenant-id form here. */
export function ScopeBar({ organisationName, organisationSwitcher, sites, siteId, from, to, action, periodMode = "carbon", operationalAsOf }: {
  organisationName: string; organisationSwitcher?: ReactNode; sites: { id: string; name: string }[];
  siteId?: string; from: string; to: string; action: LocalHref; periodMode?: "carbon" | "operational" | "product"; operationalAsOf?: string;
}) {
  return <div className="bd-scopebar"><div className="bd-organisation">{organisationSwitcher ?? <strong>{organisationName}</strong>}</div>
    {periodMode === "carbon" ? <form action={localHref(action)} method="get" className="bd-scope-form"><label><span className="bd-sr-only">Site</span><select aria-label="Site" name="siteId" defaultValue={siteId ?? ""} key={`site:${siteId}`}><option value="">All permitted sites</option>{sites.map(site => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label>
      <label><span className="bd-sr-only">Carbon period start</span><input aria-label="Carbon period start" type="month" name="from" defaultValue={from} key={`from:${from}`} required /></label><span aria-hidden="true">—</span><label><span className="bd-sr-only">Carbon period end</span><input aria-label="Carbon period end" type="month" name="to" defaultValue={to} key={`to:${to}`} min={from} required /></label><button className="bd-button bd-button--quiet" type="submit">Apply</button></form>
    : <p className="bd-muted">{periodMode === "product" ? "Product boundary set in assessment" : `Operational position${operationalAsOf ? ` · ${operationalAsOf}` : ""}`}</p>}
  </div>;
}

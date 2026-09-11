"use client";
import { useMemo, useState } from "react";
import type { AttentionItem } from "../../lib/board/contracts";
import { AttentionPanel } from "./overview";
import { PageHeader } from "./primitives";

/** UI filters authorized DTOs; no mutation or dismissal that pretends source work is complete. */
export function AttentionWorkbench({ items, capturedAt }: { items: AttentionItem[]; capturedAt: string }) {
  const [view, setView] = useState("all"), [search, setSearch] = useState("");
  const filtered = useMemo(() => items.filter(item => (view === "all" || item.reason === view) && `${item.title} ${item.owner} ${item.site}`.toLowerCase().includes(search.toLowerCase())), [items, view, search]);
  return <div><PageHeader eyebrow="Management workspace" title="Attention" description="Follow the work to its source. Completing a notification does not complete an action." />
    <div className="bd-filterbar"><label>Show<select aria-label="Show" value={view} onChange={e => setView(e.target.value)}><option value="all">All permitted work</option><option value="overdue">Overdue</option><option value="verification">Awaiting verification</option><option value="blocked">Blocked</option><option value="review">Review</option><option value="missing">Missing</option><option value="upcoming">Upcoming</option></select></label><label>Search<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Record, owner or site" /></label><a className="bd-button bd-button--quiet" href="/attention">Refresh position</a></div>
    <p aria-live="polite" className="bd-muted">{filtered.length} of {items.length} items · Loaded {capturedAt}</p><AttentionPanel items={filtered} total={items.length} />
  </div>;
}

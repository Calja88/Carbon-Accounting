"use client";
import type { OverviewModel, AttentionItem, SiteRow } from "../../lib/board/contracts";
import { compareCarbon, formatPercent, formatTonnes } from "../../lib/board/metrics";
import { AsyncBoundary, BoardLink, MetricValue, PageHeader, SetupState, StatusBadge, Surface } from "./primitives";
import { DataTable } from "./data-table";
import { TrendChart } from "./trend-chart";

export function AttentionPanel({ items, total, compact = false }: { items: AttentionItem[]; total: number; compact?: boolean }) {
  return <Surface title="What needs attention" subtitle="Work and decisions that move the position forward" actions={<BoardLink href="/attention" className="bd-text-link">View all ({total}) →</BoardLink>} className="bd-attention-panel">
    {!items.length ? <AsyncBoundary state="empty" message="No open items in your permitted scope." /> : <ol className="bd-attention-list">{items.slice(0, compact ? 3 : items.length).map(item => <li key={item.key} data-attention-key={item.key}>
      <div className={`bd-priority-line bd-priority-line--${item.reason}`} /><div><div className="bd-inline-meta"><StatusBadge tone={item.reason === "overdue" || item.reason === "blocked" ? "warning" : "info"}>{item.reason === "verification" ? "Awaiting verification" : item.reason[0].toUpperCase() + item.reason.slice(1)}</StatusBadge><span>{item.site}</span></div>
        <h3><BoardLink href={item.source.href}>{item.title}</BoardLink></h3><p className="bd-muted">{item.implication}</p><div className="bd-attention-footer"><span>{item.owner}{item.dueDate ? ` · Due ${item.dueDate}` : ""}</span><BoardLink href={item.source.href} className="bd-text-link">{item.nextAction} →</BoardLink></div></div>
    </li>)}</ol>}
  </Surface>;
}
export function ExecutiveOverview({ model }: { model: OverviewModel }) {
  const carbon = model.carbon.state === "ready" ? model.carbon.data : null;
  const comparison = carbon ? compareCarbon(carbon.current, carbon.previous) : null;
  // Expected no-data, not a failure: the section loaded fine and honestly
  // reports that neither period has a confirmed result. Never inferred from
  // a zero — `missing` means no received submissions at all.
  const noSites = carbon !== null && carbon.sites.length === 0;
  const noCarbonData = carbon !== null && carbon.current.state === "missing" && carbon.previous.state === "missing";
  const carbonMessage = model.carbon.state === "unavailable" ? model.carbon.message : undefined;
  return <div className="bd-overview"><PageHeader eyebrow="Environmental performance" title="The position. The priorities. The next move." description={`${model.periodLabel} · ${model.organisationName}`} actions={model.managementPack && <BoardLink className="bd-button bd-button--primary" href={model.managementPack.href}>{model.managementPack.label} ↗</BoardLink>} />
    <div className="bd-overview-top"><Surface className="bd-carbon-hero">
      {!carbon ? <AsyncBoundary state="unavailable" message={carbonMessage} />
      : noSites ? <SetupState title="No sites set up yet" detail="Add the entities and sites you report on, then activity data can be recorded against them." actions={[{ label: "Set up sites", href: "/admin/organisation" }]} />
      : noCarbonData ? <SetupState title="No emissions data loaded yet" detail={`Nothing has been submitted for ${model.periodLabel} or the comparison period. Record activity data for a site, or choose a different period on the carbon inventory.`} actions={[{ label: "Enter activity data", href: "/entry" }, { label: "Open the carbon inventory", href: "/carbon" }]} />
      : <><div className="bd-hero-top"><div data-testid="board-total-kg" data-value={carbon.current.kgCO2e ?? undefined}><MetricValue metric={carbon.current} label="Corporate emissions" large /></div><div className="bd-comparison" data-testid="board-comparison-percent" data-value={comparison?.percent ?? undefined}><StatusBadge tone={comparison?.percent !== null && comparison?.percent !== undefined && comparison.percent < 0 ? "success" : "neutral"}>{formatPercent(comparison?.percent ?? null)}</StatusBadge><p>vs {model.previousPeriodLabel}</p><strong>{formatTonnes(carbon.previous.kgCO2e)} tCO₂e</strong></div></div>
        {comparison?.reason && <p className="bd-notice">{comparison.reason}</p>}
        <TrendChart points={carbon.trend} /><div className="bd-carbon-disclosure"><p><strong>Scope 1 + Scope 2 location-based + covered Scope 3</strong><br />Scope 2 market-based companion: <span data-testid="board-scope2-market-kg" data-value={carbon.marketBasedKg ?? undefined}>{formatTonnes(carbon.marketBasedKg)} tCO₂e</span>. Not added to the headline.</p><p><strong>{carbon.quantifiedCategories}/15 Scope 3 categories quantified</strong><br />{carbon.screenedCategories === null ? (carbon.screenedCategoriesReason ?? "Screening not recorded.") : `${carbon.screenedCategories}/15 screened.`} Coverage and exclusions stay visible.</p></div>
        <BoardLink href={carbon.current.source.href} className="bd-text-link bd-source-link">Explore the carbon inventory →</BoardLink></>}
    </Surface>
    {model.attention.state === "ready" ? <AttentionPanel items={model.attention.data.items} total={model.attention.data.total} compact /> : <Surface title="What needs attention"><AsyncBoundary state="unavailable" message={model.attention.message} /></Surface>}</div>
    <div className="bd-overview-bottom"><Surface title="Where emissions come from" subtitle="Open a site to follow the result back to its source and evidence">
      {!carbon ? <AsyncBoundary state="unavailable" message={carbonMessage} />
      : noSites ? <SetupState title="Nothing to break down yet" detail="Emissions are attributed per site. Once entities and sites exist, each one appears here with its own scope split and change against the prior period." actions={[{ label: "Set up sites", href: "/admin/organisation" }]} />
      : <DataTable<SiteRow> caption="Site emissions" rows={carbon.sites} rowKey={r => r.id} columns={[
        { id: "site", label: "Site", rowHeader: true, sortValue: r => r.name, render: r => <><BoardLink href={r.current.source.href}>{r.name} ↗</BoardLink><small className="bd-cell-detail">{r.entity}</small></> },
        { id: "s1", label: "Scope 1", numeric: true, sortValue: r => r.scope1Kg, render: r => formatTonnes(r.scope1Kg) },
        { id: "s2", label: "Scope 2 LB", numeric: true, sortValue: r => r.scope2LocationKg, render: r => formatTonnes(r.scope2LocationKg) },
        { id: "s3", label: "Scope 3", numeric: true, sortValue: r => r.scope3Kg, render: r => formatTonnes(r.scope3Kg) },
        { id: "total", label: "Total tCO₂e", numeric: true, sortValue: r => r.current.kgCO2e, render: r => <strong>{formatTonnes(r.current.kgCO2e)}</strong> },
        { id: "change", label: "Change", numeric: true, render: r => formatPercent(compareCarbon(r.current, r.previous).percent) },
      ]} />}
    </Surface><Surface title="Management focus" subtitle="A connected view of risk, control and improvement">
      {model.priorities.state !== "ready" ? <AsyncBoundary state="unavailable" message={model.priorities.message} />
      : model.priorities.data.length === 0 ? <SetupState title="Nothing is competing for management attention" detail="No overdue obligation evaluation, blocked action or open nonconformity is outstanding in your permitted scope. Start an EMS assessment or a management review pack to build the next cycle." actions={[{ label: "Aspects & controls", href: "/ems/aspects" }, { label: "Management reviews", href: "/ems/management-reviews" }]} />
      : <div className="bd-priorities">{model.priorities.data.map(item => <article key={item.source.href + item.title}><StatusBadge tone={item.tone}>{item.title}</StatusBadge><p>{item.detail}</p><BoardLink href={item.source.href} className="bd-text-link">{item.source.label} →</BoardLink></article>)}</div>}
      {model.attention.state === "ready" && <div className="bd-action-summary"><strong>{model.attention.data.openActions}</strong><span>open actions</span><strong>{model.attention.data.awaitingVerification}</strong><span>completed, awaiting verification</span></div>}
    </Surface></div><p className="bd-freshness">Position loaded {new Date(model.capturedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })} Europe/London. Each section retains its own source cutoff.</p>
  </div>;
}

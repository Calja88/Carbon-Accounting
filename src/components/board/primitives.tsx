import type { ReactNode } from "react";
import type { CarbonMetric, Tone } from "../../lib/board/contracts";
import { coverageLabel, formatTonnes } from "../../lib/board/metrics";
import { localHref } from "../../lib/board/navigation";

export function BoardLink({ href, children, className = "", ...rest }: { href: string; children: ReactNode; className?: string; "aria-label"?: string; "aria-current"?: "page" }) {
  return <a href={localHref(href)} className={className} {...rest}>{children}</a>;
}
export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`bd-status bd-status--${tone}`}><span aria-hidden="true" className="bd-status-dot" />{children}</span>;
}
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return <header className="bd-page-header"><div>{eyebrow && <p className="bd-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <div className="bd-description">{description}</div>}</div>{actions && <div className="bd-header-actions">{actions}</div>}</header>;
}
export function MetricValue({ metric, label, large = false }: { metric: CarbonMetric; label: string; large?: boolean }) {
  const unavailable = metric.state === "missing" || metric.state === "unavailable";
  return <div className={`bd-metric ${large ? "bd-metric--hero" : ""}`}>
    <p className="bd-metric-label">{label}</p><p className="bd-metric-number">{formatTonnes(unavailable ? null : metric.kgCO2e)}{!unavailable && metric.kgCO2e !== null && <span>tCO₂e</span>}</p>
    <p className="bd-muted">{coverageLabel(metric.coverage)}</p>
    {metric.state !== "complete" && <StatusBadge tone={unavailable ? "neutral" : "warning"}>{metric.reason ?? (unavailable ? "No confirmed result" : "Partial coverage")}</StatusBadge>}
  </div>;
}
export function Surface({ title, subtitle, actions, children, className = "" }: { title?: string; subtitle?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`bd-surface ${className}`}>{title && <header className="bd-surface-header"><div><h2>{title}</h2>{subtitle && <p className="bd-muted">{subtitle}</p>}</div>{actions}</header>}{children}</section>;
}
export function ChartFrame({ title, description, children, table }: { title: string; description: string; children: ReactNode; table: ReactNode }) {
  return <figure className="bd-chart"><figcaption><h3>{title}</h3><p className="bd-muted">{description}</p></figcaption>{children}<details className="bd-chart-data"><summary>View chart data</summary>{table}</details></figure>;
}
/** Explicit async-state presentation; use with Next error.tsx for an actual render exception boundary. */
export function AsyncBoundary({ state, message, children, retry }: { state: "ready" | "loading" | "empty" | "error" | "unavailable"; message?: string; children?: ReactNode; retry?: ReactNode }) {
  if (state === "ready") return <>{children}</>;
  if (state === "loading") return <div className="bd-skeleton" role="status" aria-live="polite"><span>Loading this section…</span><div /><div /><div /></div>;
  return <div className="bd-empty" role={state === "error" ? "alert" : "status"}><h3>{state === "empty" ? "Nothing needs attention here" : "Section unavailable"}</h3><p>{message ?? "Open the source workspace or try again."}</p>{retry}</div>;
}
export function SyntheticDisclosure() {
  return <div className="bd-demo-banner" role="note"><strong>Synthetic demonstration — not company performance</strong><span>Fictional records for evaluation</span></div>;
}

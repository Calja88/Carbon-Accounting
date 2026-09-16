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
/** Expected "nothing here yet" — a real setup step, never an error card. Only for states the app genuinely knows are empty. */
export function SetupState({ title, detail, actions = [] }: { title: string; detail: string; actions?: { label: string; href: string }[] }) {
  return <div className="bd-empty" role="status"><h3>{title}</h3><p>{detail}</p>
    {actions.length > 0 && <div className="bd-empty-actions">{actions.map((action, i) => <BoardLink key={action.href} href={action.href} className={`bd-button ${i === 0 ? "bd-button--primary" : "bd-button--quiet"}`}>{action.label}</BoardLink>)}</div>}
  </div>;
}
/**
 * Route-level loading skeleton. Deliberately dumb: it mirrors the *shape* of
 * the page that replaces it (header, then cards, then rows) so the layout
 * does not jump, and it never implies a figure — a skeleton is not a zero.
 */
export function RouteSkeleton({ title, cards = 0, rows = 0 }: { title: string; cards?: number; rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="bd-sr-only">Loading {title}…</span>
      <header className="bd-page-header" aria-hidden="true">
        <div style={{ width: "100%" }}>
          <div className="cl-skeleton-block" style={{ height: 12, width: 120, marginBottom: 12 }} />
          <div className="cl-skeleton-block" style={{ height: 26, maxWidth: 340 }} />
          <div className="cl-skeleton-block" style={{ height: 12, maxWidth: 460, marginTop: 12 }} />
        </div>
      </header>
      {cards > 0 && (
        <div
          aria-hidden="true"
          style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(220px, 1fr))`, gap: 16, marginBottom: 20 }}
        >
          {Array.from({ length: cards }, (_, i) => (
            <div key={i} className="bd-surface">
              <div className="cl-skeleton-block" style={{ height: 11, width: 90 }} />
              <div className="cl-skeleton-block" style={{ height: 30, width: "60%", marginTop: 14 }} />
              <div className="cl-skeleton-block" style={{ height: 10, width: "40%", marginTop: 12 }} />
            </div>
          ))}
        </div>
      )}
      {rows > 0 && (
        <div className="bd-surface" aria-hidden="true">
          <div className="cl-skeleton-block" style={{ height: 13, width: 180, marginBottom: 20 }} />
          {Array.from({ length: rows }, (_, i) => (
            <div
              key={i}
              className="cl-skeleton-block"
              style={{ height: 14, marginBottom: 16, width: `${100 - (i % 4) * 9}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
export function SyntheticDisclosure() {
  return <div className="bd-demo-banner" role="note"><strong>Synthetic demonstration — not company performance</strong><span>Fictional records for evaluation</span></div>;
}

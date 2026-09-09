import type { ReactNode } from "react";
import type { EvidenceItem, RecordModel, RecordRef } from "../../lib/board/contracts";
import { BoardLink, PageHeader, StatusBadge, Surface } from "./primitives";

export function RelationshipPanel({ relations }: { relations: RecordRef[] }) {
  return <Surface title="Connected records" subtitle="Exact references across the workflow"><ul className="bd-relations">{relations.map(ref => <li key={`${ref.kind}:${ref.id}:${ref.revision}`}><small>{ref.kind} · {ref.revision}</small><BoardLink href={ref.href}>{ref.label}<span aria-hidden="true">↗</span></BoardLink></li>)}</ul>{!relations.length && <p className="bd-muted">No linked records visible in your scope.</p>}</Surface>;
}
export function EvidencePanel({ items }: { items: EvidenceItem[] }) {
  return <Surface title="Evidence" subtitle="Files, revisions and source records"><ul className="bd-evidence-list">{items.map(item => <li key={item.id}>
    <div className="bd-file-icon" aria-hidden="true">DOC</div><div><h3>{item.name}</h3><p className="bd-muted">{item.revision} · {item.mime}{item.sizeBytes !== null ? ` · ${(item.sizeBytes / 1024).toFixed(1)} KB` : ""} · {item.recordedAt}</p><p><StatusBadge tone={item.status === "available" ? "neutral" : "warning"}>{item.kind === "external-reference" ? "External reference" : item.status === "available" ? "File available" : item.status === "missing" ? "Source bytes missing" : "Awaiting file"}</StatusBadge></p><BoardLink href={item.source.href} className="bd-text-link">{item.source.label} →</BoardLink>
      {item.checksum && <details><summary>File integrity</summary><p className="bd-checksum">SHA-256: {item.checksum}</p></details>}</div>
    {item.download && item.status === "available" && item.kind !== "external-reference" ? <BoardLink className="bd-button bd-button--quiet" href={item.download}>Download</BoardLink> : <span className="bd-muted">{item.kind === "external-reference" ? "Open source record" : "Download unavailable"}</span>}
  </li>)}</ul>{!items.length && <p className="bd-muted">No evidence visible for this record.</p>}</Surface>;
}
/** actions is the existing permission-aware domain form/action, not a new generic status dropdown. */
export function RecordWorkspace({ model, children, actions }: { model: RecordModel; children?: ReactNode; actions?: ReactNode }) {
  return <div className="bd-record"><PageHeader eyebrow={`${model.kind} / ${model.reference}`} title={model.title} description={<>{model.site} · {model.owner} · {model.revision}</>} />
    <div className="bd-record-grid"><div><section className="bd-next-step"><StatusBadge tone={model.status.tone}>{model.status.label}</StatusBadge><h2>{model.nextStep.title}</h2><p>{model.nextStep.detail}</p>{actions && <div className="bd-domain-actions">{actions}</div>}</section>
      <Surface title="Record details"><p>{model.summary}</p>{children}</Surface><EvidencePanel items={model.evidence} />
      <Surface title="Progress and decisions"><ol className="bd-timeline">{model.timeline.map(event => <li key={event.id}><h3>{event.title}</h3><p>{event.detail}</p><small>{event.actor} · {event.occurredAt}</small></li>)}</ol></Surface>
    </div><RelationshipPanel relations={model.relations} /></div>
  </div>;
}

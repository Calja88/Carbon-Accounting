"use client";
import { useState } from "react";
import { BoardLink, StatusBadge } from "./primitives";
import { pathMatches } from "../../lib/board/navigation";

export interface AssessmentNavItem { segment: string; label: string; badge?: number | null; badgeTone?: "danger" | "warning" | "neutral" }
const GROUPS = [
  { name: "Setup", segments: ["", "goal-scope"] },
  { name: "Inventory", segments: ["model", "inventory", "registers", "evidence"] },
  { name: "Results", segments: ["results", "data-quality", "scenarios"] },
  { name: "Review & issue", segments: ["review", "versions", "audit", "report"] },
];
export function LcaNavigation({ assessmentId, pathname, items }: { assessmentId: string; pathname: string; items: AssessmentNavItem[] }) {
  const base = `/assessments/${encodeURIComponent(assessmentId)}`;
  const active = items.filter(item => item.segment ? pathMatches(pathname, `${base}/${item.segment}`) : pathname === base).sort((a, b) => b.segment.length - a.segment.length)[0];
  const routeGroup = GROUPS.find(group => group.segments.includes(active?.segment ?? ""))?.name ?? "Setup";
  const [selection, setSelection] = useState<{ pathname: string; name: string } | null>(null);
  const chosen = selection?.pathname === pathname ? selection.name : routeGroup;
  const visible = items.filter(item => GROUPS.find(group => group.name === chosen)?.segments.includes(item.segment));
  const extra = items.filter(item => !GROUPS.some(group => group.segments.includes(item.segment)));
  return <div className="bd-lca-nav"><div className="bd-lca-groups" role="group" aria-label="Assessment stages">{GROUPS.map((group, index) => <button type="button" key={group.name} aria-pressed={chosen === group.name} onClick={() => setSelection({ pathname, name: group.name })}><span>{index + 1}</span>{group.name}</button>)}</div>
    <nav aria-label={`${chosen} assessment pages`} className="bd-lca-pages">{visible.map(item => <BoardLink key={item.segment} href={`${base}${item.segment ? `/${item.segment}` : ""}`} aria-current={active?.segment === item.segment ? "page" : undefined}>{item.label}{typeof item.badge === "number" && item.badge > 0 && <StatusBadge tone={item.badgeTone ?? "neutral"}>{item.badge}</StatusBadge>}</BoardLink>)}</nav>
    {!!extra.length && <details><summary>Additional assessment pages</summary>{extra.map(item => <BoardLink key={item.segment} href={`${base}/${item.segment}`}>{item.label}</BoardLink>)}</details>}
  </div>;
}

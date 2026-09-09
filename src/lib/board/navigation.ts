import type { LocalHref } from "./contracts";

export interface BoardNavItem { id: string; label: string; href: LocalHref; matches: string[]; group: "workspace" | "environment" | "assurance" | "resources" | "administration" }
/** Candidate routes only. Pass ONLY entries whose route and current user's grant have been verified server-side. */
export const BOARD_NAV: BoardNavItem[] = [
  { id: "overview", label: "Overview", href: "/", matches: ["/", "/overview"], group: "workspace" },
  { id: "attention", label: "Attention", href: "/attention", matches: ["/attention"], group: "workspace" },
  { id: "carbon", label: "Carbon", href: "/carbon", matches: ["/carbon", "/entry", "/calculations", "/reports"], group: "workspace" },
  { id: "products", label: "Products", href: "/assessments", matches: ["/assessments", "/products", "/suppliers"], group: "workspace" },
  { id: "aspects", label: "Aspects & controls", href: "/ems/aspects", matches: ["/ems/aspects", "/ems/processes", "/ems/controls"], group: "environment" },
  { id: "compliance", label: "Compliance", href: "/ems/legal/obligations", matches: ["/ems/legal"], group: "environment" },
  { id: "objectives", label: "Objectives", href: "/ems/objectives", matches: ["/ems/objectives", "/ems/actions"], group: "environment" },
  { id: "audits", label: "Audits", href: "/ems/audits", matches: ["/ems/audits"], group: "assurance" },
  { id: "nonconformities", label: "Nonconformities", href: "/ems/nonconformities", matches: ["/ems/nonconformities"], group: "assurance" },
  { id: "evidence", label: "Evidence", href: "/evidence", matches: ["/evidence", "/ems/evidence", "/ems/documents"], group: "resources" },
  { id: "packs", label: "Management packs", href: "/management-packs", matches: ["/management-packs", "/ems/management-reviews"], group: "resources" },
  { id: "admin", label: "Administration", href: "/admin", matches: ["/admin"], group: "administration" },
];
export function pathMatches(pathname: string, prefix: string): boolean {
  return prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`);
}
export function activeNavId(items: BoardNavItem[], pathname: string): string | null {
  return items.flatMap(item => item.matches.filter(prefix => pathMatches(pathname, prefix)).map(prefix => ({ id: item.id, length: prefix.length })))
    .sort((a, b) => b.length - a.length)[0]?.id ?? null;
}
/** Do not use as an authorization check. Prevents unsafe/remote URLs entering presentation contracts. */
export function localHref(href: string): LocalHref {
  if (!href.startsWith("/") || href.startsWith("//") || /[\\\x00-\x20]/.test(href)) throw new Error("Expected local application URL");
  const url = new URL(href, "https://board.invalid");
  if (url.origin !== "https://board.invalid") throw new Error("Expected same-origin URL");
  return href as LocalHref;
}
export function carbonHref(path: string, scope: { from: string; to: string; siteId?: string }): LocalHref {
  const url = new URL(localHref(path), "https://board.invalid");
  url.searchParams.set("from", scope.from); url.searchParams.set("to", scope.to);
  if (scope.siteId) url.searchParams.set("siteId", scope.siteId); else url.searchParams.delete("siteId");
  return localHref(url.pathname + url.search);
}

import type { LocalHref } from "./contracts";

export interface BoardNavItem { id: string; label: string; href: LocalHref; matches: string[]; group: "workspace" | "environment" | "assurance" | "resources" | "administration" }
/**
 * Phase 0 product reset: carbon-first nav. Candidate routes only — pass
 * ONLY entries whose route and current user's grant have been verified
 * server-side (see live-nav.ts). EMS/LCA/AI live behind "Advanced" now
 * rather than as top-level nav entries; every href below is a route that
 * exists on this branch today.
 */
export const BOARD_NAV: BoardNavItem[] = [
  { id: "overview", label: "Dashboard", href: "/", matches: ["/", "/overview"], group: "workspace" },
  { id: "entry", label: "Activity Data", href: "/entry", matches: ["/entry"], group: "workspace" },
  { id: "factors", label: "Factor Datasets", href: "/admin/factors", matches: ["/admin/factors"], group: "workspace" },
  { id: "evidence", label: "Evidence", href: "/documents", matches: ["/documents"], group: "workspace" },
  { id: "reports", label: "Reports", href: "/reports", matches: ["/reports"], group: "workspace" },
  {
    id: "advanced",
    label: "Advanced",
    href: "/advanced",
    matches: ["/advanced", "/ems", "/assessments", "/products", "/suppliers", "/admin/ai", "/calculations"],
    group: "administration",
  },
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
/**
 * /carbon was the second carbon dashboard; it is now one dashboard at /.
 * Old links, bookmarks and the report drilldowns keep working: the scope
 * they carry is translated rather than dropped. Months may arrive as
 * YYYY-MM or as a full YYYY-MM-DD date (the shape /carbon's own links used),
 * and anything that is neither is discarded rather than guessed at.
 */
export function carbonRedirectTarget(params: Record<string, string | string[] | undefined>): LocalHref {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const month = (value: string | string[] | undefined) => /^(\d{4})-(0[1-9]|1[0-2])(?:-|$)/.exec(first(value)?.trim() ?? "")?.slice(1, 3).join("-");
  const from = month(params.from), to = month(params.to);
  const siteId = first(params.siteId)?.trim() || undefined;
  if (from && to) return carbonHref("/", { from, to, siteId });
  // No usable period: / resolves its own default, and any site selection still travels with the visitor.
  return localHref(siteId ? `/?siteId=${encodeURIComponent(siteId)}` : "/");
}
export function carbonHref(path: string, scope: { from: string; to: string; siteId?: string }): LocalHref {
  const url = new URL(localHref(path), "https://board.invalid");
  url.searchParams.set("from", scope.from); url.searchParams.set("to", scope.to);
  if (scope.siteId) url.searchParams.set("siteId", scope.siteId); else url.searchParams.delete("siteId");
  return localHref(url.pathname + url.search);
}

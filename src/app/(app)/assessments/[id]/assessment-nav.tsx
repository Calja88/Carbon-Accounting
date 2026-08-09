"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export interface NavItem {
  segment: string;
  label: string;
  badge?: number | null;
  badgeTone?: "danger" | "warning" | "neutral";
  /** null for the standalone Overview tab; every other tab belongs to a group. */
  group: string | null;
}

function BadgeChip({ badge, tone }: { badge: number; tone: NavItem["badgeTone"] }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none",
        tone === "danger" ? "bg-red-100 text-red-700" : tone === "warning" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600",
      )}
    >
      {badge}
    </span>
  );
}

/**
 * The assessment sub-nav: 13 destinations grouped into Setup / Analysis /
 * Governance / Output, same relative order as before — grouping headers are
 * new, nothing was reordered or dropped. Below 1024px this collapses to a
 * <select> so the tab bar never needs horizontal scrolling on a phone.
 */
export function AssessmentNav({ assessmentId, items }: { assessmentId: string; items: NavItem[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/assessments/${assessmentId}`;

  const isActive = (item: NavItem) => {
    const href = item.segment ? `${base}/${item.segment}` : base;
    return item.segment ? pathname.startsWith(href) : pathname === base;
  };

  const overview = items.find((i) => i.group === null);
  const current = items.find(isActive);

  // Two explicit rows rather than one wrapped row: Setup+Analysis (6 tabs)
  // and Governance+Output (6 tabs) balance evenly and read as two distinct
  // phases of the assessment — model/build, then review/publish.
  const rowGroups = [
    ["Setup", "Analysis"],
    ["Governance", "Output"],
  ];

  return (
    <>
      {/* Mobile/tablet picker, below lg */}
      <div className="lg:hidden">
        <label htmlFor="assessment-section" className="sr-only">
          Jump to section
        </label>
        <select
          id="assessment-section"
          value={current?.segment ?? ""}
          onChange={(e) => router.push(e.target.value ? `${base}/${e.target.value}` : base)}
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          {items.map((item) => (
            <option key={item.segment || "overview"} value={item.segment}>
              {item.group ? `${item.group} — ${item.label}` : item.label}
              {typeof item.badge === "number" && item.badge > 0 ? ` (${item.badge})` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop/tablet tab bar, >=1024px: Overview standalone, then two
          grouped rows (Setup+Analysis, Governance+Output). */}
      <nav aria-label="Assessment sections" className="hidden space-y-1 lg:block">
        {overview && (
          <div className="flex border-b border-slate-100 text-sm">
            <Link
              href={base}
              aria-current={isActive(overview) ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 font-medium transition-colors",
                isActive(overview) ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800",
              )}
            >
              {overview.label}
            </Link>
          </div>
        )}
        {rowGroups.map((rowGroupNames, rowIndex) => (
          <div
            key={rowIndex}
            className={cn("-mb-px flex flex-wrap items-center gap-x-1 text-sm", rowIndex === rowGroups.length - 1 && "border-b border-slate-200")}
          >
            {rowGroupNames.map((group) => {
              const groupItems = items.filter((i) => i.group === group);
              const groupHasActive = groupItems.some(isActive);
              return (
                <div key={group} className="flex items-center">
                  <span
                    className={cn(
                      "ml-3 mr-1 self-center text-[10px] font-semibold uppercase tracking-wide",
                      groupHasActive ? "text-slate-500" : "text-slate-300",
                    )}
                  >
                    {group}
                  </span>
                  {groupItems.map((item) => {
                    const href = `${base}/${item.segment}`;
                    const active = isActive(item);
                    return (
                      <Link
                        key={item.segment}
                        href={href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 font-medium transition-colors",
                          active ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800",
                        )}
                      >
                        {item.label}
                        {typeof item.badge === "number" && item.badge > 0 && <BadgeChip badge={item.badge} tone={item.badgeTone} />}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </nav>
    </>
  );
}

"use client";

/**
 * Grouped top-level navigation, replacing the old flat item list + single
 * "More" dropdown (src/app/(app)/nav-links.tsx). The corporate GHG inventory
 * and the product LCA module are legitimately different systems (their
 * totals are never summed — see README/schema comments), so they get their
 * own visually distinct groups rather than being flattened into one row:
 * a user can tell at a glance which workspace a destination belongs to.
 *
 * Route targets in each group's `items` are the single source of truth for
 * "where does this nav item point right now" — as routes move during the
 * redesign (e.g. /entry -> /data/entry, /admin/factors -> /factors) this
 * file's hrefs are updated to the new canonical path once that path exists
 * and redirects from the old path; the nav should never link somewhere that
 * doesn't resolve yet.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookMarked,
  Bot,
  Boxes,
  ChevronDown,
  ClipboardList,
  Database,
  FileBarChart,
  FileScan,
  History,
  LayoutDashboard,
  Menu,
  Package,
  Truck,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { NavGroup, NavIconKey, NavItem } from "./nav-config";

export type { NavGroup, NavItem } from "./nav-config";

// Icon *keys* cross the server/client boundary (see nav-config.ts) — this
// registry resolves a key to the actual component reference client-side.
const ICONS: Record<NavIconKey, React.ComponentType<{ className?: string }>> = {
  overview: LayoutDashboard,
  enterData: ClipboardList,
  historicalData: History,
  documents: FileScan,
  reports: FileBarChart,
  products: Package,
  assessments: Boxes,
  suppliers: Truck,
  factors: Database,
  methodology: BookMarked,
  settings: Bot,
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function groupActive(pathname: string, group: NavGroup) {
  return group.items.some((item) => isActive(pathname, item.href));
}

/** A single link, styled the same whether it's standalone or inside a dropdown trigger. */
function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = ICONS[item.icon];
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {item.label}
    </Link>
  );
}

function NavDropdown({ group, pathname }: { group: NavGroup; pathname: string }) {
  const [open, setOpen] = useState(false);
  const active = groupActive(pathname, group);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-expanded={open}
        aria-haspopup="true"
        className={cn(
          "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
          active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        )}
      >
        {group.label}
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-60 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {group.items.map((item) => {
            const itemActive = isActive(pathname, item.href);
            const Icon = ICONS[item.icon];
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={itemActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-sm transition-colors",
                  itemActive ? "bg-slate-50 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PrimaryNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="hidden flex-wrap items-center gap-1 text-sm md:flex">
      {groups.map((group, i) =>
        group.label === null ? (
          group.items.map((item) => <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />)
        ) : (
          <NavDropdown key={group.label ?? i} group={group} pathname={pathname} />
        ),
      )}
    </nav>
  );
}

/** Hamburger trigger + slide-over sheet for <768px. */
export function MobileNavToggle({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-label="Open navigation menu"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-[85vw] max-w-sm flex-col overflow-y-auto bg-white p-4 shadow-2xl"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900">Menu</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Primary" className="flex flex-1 flex-col gap-4">
              {groups.map((group, i) => (
                <div key={group.label ?? i}>
                  {group.label && (
                    <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {group.label}
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5">
                    {group.items.map((item) => {
                      const active = isActive(pathname, item.href);
                      const Icon = ICONS[item.icon];
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setOpen(false)}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                            active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100",
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
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
  HelpCircle,
  LayoutDashboard,
  Package,
  Truck,
  Users,
  Leaf,
} from "lucide-react";
import { cn } from "@/lib/cn";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Every corporate carbon/LCA route, grouped under one "Carbon & Lifecycle"
 * dropdown (see `GroupedDropdown` below) rather than listed individually in
 * the main row — that flat row is what overflowed past the viewport on
 * laptop widths once EMS/admin items were added alongside it. EMS keeps its
 * own separate top-level entry (`EMS_ITEM`) rather than joining this group.
 */
export const CARBON_LIFECYCLE_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/entry", label: "Data entry", icon: ClipboardList },
  { href: "/documents", label: "Documents", icon: FileScan },
  { href: "/reports", label: "Reports", icon: FileBarChart },
  // Product-level assessment sits alongside the corporate inventory rather
  // than inside it: the two answer different questions and their totals are
  // never combined.
  { href: "/products", label: "Products", icon: Package },
  { href: "/assessments", label: "Assessments", icon: Boxes },
  { href: "/suppliers", label: "Suppliers & supplier PCFs", icon: Truck },
  { href: "/methodologies", label: "Methodology register", icon: BookMarked },
  { href: "/help/lca", label: "Product LCA guidance", icon: HelpCircle },
];

/** Shown only when the current membership holds `ems.view` — see AppLayout. */
export const EMS_ITEM: NavItem = { href: "/ems", label: "EMS", icon: Leaf };

const ADMIN_ITEMS: NavItem[] = [
  { href: "/admin/factors", label: "Emission factors", icon: Database },
  { href: "/admin/ai", label: "AI settings", icon: Bot },
];

const ORGANISATION_ITEMS: NavItem[] = [{ href: "/admin/organisation/members", label: "Members & roles", icon: Users }];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Gap kept between the dropdown panel and the viewport edge, in pixels. */
const VIEWPORT_MARGIN = 8;

/**
 * Dropdown trigger + panel used for the "Carbon & Lifecycle" group. The
 * panel is `position: fixed` with its coordinates computed from the
 * trigger's own bounding rect (not CSS `right-0` on a same-sized wrapper),
 * so it always ends up clamped inside the viewport — including when the
 * trigger itself sits near the left edge on a narrow/mobile width, which is
 * exactly the case the old `absolute right-0` panel pushed off-screen.
 */
function GroupedNavDropdown({ label, items, pathname }: { label: string; items: NavItem[]; pathname: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const groupActive = items.some((item) => isActive(pathname, item.href));

  useEffect(() => {
    if (!open) return;

    function place() {
      const button = buttonRef.current;
      if (!button) return;
      const buttonRect = button.getBoundingClientRect();
      const menuWidth = menuRef.current?.offsetWidth ?? 256;
      const maxLeft = Math.max(window.innerWidth - menuWidth - VIEWPORT_MARGIN, VIEWPORT_MARGIN);
      const left = Math.min(Math.max(buttonRect.right - menuWidth, VIEWPORT_MARGIN), maxLeft);
      setPosition({ top: buttonRect.bottom + 4, left });
    }

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        className={cn(
          "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition-colors",
          groupActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        )}
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          style={position ?? undefined}
          className={cn(
            "fixed z-20 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg",
            !position && "invisible",
          )}
        >
          {items.map(({ href, label: itemLabel, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 text-sm transition-colors",
                isActive(pathname, href) ? "bg-slate-50 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {itemLabel}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function NavLinks({
  canViewPlatformAdmin,
  canManageOrganisation = false,
  canViewEms = false,
}: {
  canViewPlatformAdmin: boolean;
  canManageOrganisation?: boolean;
  canViewEms?: boolean;
}) {
  const pathname = usePathname();
  const trailingItems = [
    // Gated on this membership's own current `ems.view` grant, not the
    // legacy JWT role — a member without EMS access never sees the link,
    // rather than seeing it and hitting a redirect on click.
    ...(canViewEms ? [EMS_ITEM] : []),
    ...(canViewPlatformAdmin ? ADMIN_ITEMS : []),
    // Gated on this organisation's own current permission grant
    // (organisation.membership.manage), not the legacy JWT role — an
    // organisation admin's authority is scoped to their own tenant.
    ...(canManageOrganisation ? ORGANISATION_ITEMS : []),
  ];

  return (
    // flex-wrap rather than a horizontally scrolling row: the dropdown panel
    // is fixed-positioned independently of this row's layout, so wrapping
    // here never clips it. Wrapping happens between whole items, never
    // inside a label.
    <nav className="flex flex-wrap items-center gap-1 text-sm">
      <GroupedNavDropdown label="Carbon & Lifecycle" items={CARBON_LIFECYCLE_ITEMS} pathname={pathname} />

      {trailingItems.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition-colors",
              active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

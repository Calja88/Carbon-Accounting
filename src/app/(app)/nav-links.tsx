"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookMarked,
  Boxes,
  ChevronDown,
  ClipboardList,
  Database,
  FileBarChart,
  HelpCircle,
  LayoutDashboard,
  Package,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/cn";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const BASE_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/entry", label: "Data entry", icon: ClipboardList },
  { href: "/reports", label: "Reports", icon: FileBarChart },
  // Product-level assessment sits alongside the corporate inventory rather
  // than inside it: the two answer different questions and their totals are
  // never combined.
  { href: "/products", label: "Products", icon: Package },
  { href: "/assessments", label: "Assessments", icon: Boxes },
];

const ADMIN_ITEM: NavItem = { href: "/admin/factors", label: "Emission factors", icon: Database };

/** Reachable but not everyday — kept out of the main row so it stays readable. */
const MORE_ITEMS: NavItem[] = [
  { href: "/suppliers", label: "Suppliers & supplier PCFs", icon: Truck },
  { href: "/methodologies", label: "Methodology register", icon: BookMarked },
  { href: "/help/lca", label: "Product LCA guidance", icon: HelpCircle },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = isAdmin ? [...BASE_ITEMS, ADMIN_ITEM] : BASE_ITEMS;
  const moreActive = MORE_ITEMS.some((item) => isActive(pathname, item.href));

  return (
    <nav className="flex items-center gap-1 text-sm">
      {items.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors",
              active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}

      <div className="relative">
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          onBlur={() => setTimeout(() => setMoreOpen(false), 150)}
          aria-expanded={moreOpen}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors",
            moreActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
          )}
        >
          More
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {moreOpen && (
          <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {MORE_ITEMS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-sm transition-colors",
                  isActive(pathname, href) ? "bg-slate-50 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}

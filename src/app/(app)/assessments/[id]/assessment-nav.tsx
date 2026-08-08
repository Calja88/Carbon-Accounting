"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export interface NavItem {
  segment: string;
  label: string;
  badge?: number | null;
  badgeTone?: "danger" | "warning" | "neutral";
}

export function AssessmentNav({ assessmentId, items }: { assessmentId: string; items: NavItem[] }) {
  const pathname = usePathname();
  const base = `/assessments/${assessmentId}`;

  return (
    <nav className="-mb-px flex flex-wrap gap-x-1 gap-y-1 overflow-x-auto border-b border-slate-200 text-sm">
      {items.map((item) => {
        const href = item.segment ? `${base}/${item.segment}` : base;
        const active = item.segment ? pathname.startsWith(href) : pathname === base;
        return (
          <Link
            key={item.segment || "overview"}
            href={href}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 font-medium transition-colors",
              active
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800",
            )}
          >
            {item.label}
            {typeof item.badge === "number" && item.badge > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                  item.badgeTone === "danger"
                    ? "bg-red-100 text-red-700"
                    : item.badgeTone === "warning"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-slate-100 text-slate-600",
                )}
              >
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

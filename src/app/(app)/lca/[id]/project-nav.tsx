"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { segment: "", label: "Results" },
  { segment: "goal-scope", label: "Goal & scope" },
  { segment: "boundary", label: "System boundary" },
  { segment: "inventory", label: "Inventory" },
  { segment: "scenarios", label: "Scenarios" },
];

export function ProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const base = `/lca/${projectId}`;

  return (
    <nav className="flex flex-wrap gap-1 border-b border-slate-200 pb-2 text-sm">
      {TABS.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        const active = tab.segment ? pathname.startsWith(href) : pathname === base;
        return (
          <Link
            key={tab.segment || "results"}
            href={href}
            className={cn(
              "rounded-lg px-3 py-1.5 font-medium transition-colors",
              active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

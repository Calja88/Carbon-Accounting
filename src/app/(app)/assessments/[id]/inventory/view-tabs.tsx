import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * The bill of materials is a view of the inventory, not a separate store: the
 * BOM tab filters to material and packaging lines and shows the BOM-specific
 * columns. One set of rows, one calculation path, two ways of reading it.
 */
export function InventoryViewTabs({ assessmentId, active }: { assessmentId: string; active: "all" | "bom" }) {
  const tabs = [
    { key: "all" as const, href: `/assessments/${assessmentId}/inventory`, label: "All inventory" },
    { key: "bom" as const, href: `/assessments/${assessmentId}/inventory?view=bom`, label: "Bill of materials" },
  ];

  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            active === tab.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

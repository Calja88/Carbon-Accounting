import Link from "next/link";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shared search/filter/sort chrome for list pages. Filters are a real
 * `<form method="get">` (matching the existing PeriodSelector pattern) so
 * filter state lives in the URL — shareable, bookmarkable, and working
 * without client-side JS. Callers supply the actual filter fields as
 * children (selects/inputs named to match the query params their page
 * reads); this component only provides the consistent wrapper, submit
 * button, and an optional "Clear filters" link back to the bare route.
 */
export function FilterBar({
  action,
  children,
  hasActiveFilters,
  clearHref,
}: {
  action: string;
  children: React.ReactNode;
  hasActiveFilters?: boolean;
  clearHref?: string;
}) {
  return (
    <form action={action} method="get" className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <Filter className="mb-2 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        {children}
        <Button type="submit" variant="secondary" size="sm">
          Apply filters
        </Button>
        {hasActiveFilters && clearHref && (
          <Link href={clearHref} className="flex items-center gap-1 pb-2 text-sm text-slate-500 hover:text-slate-800">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}

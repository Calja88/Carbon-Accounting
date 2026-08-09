import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/**
 * Consistent page-orientation trail, replacing the ~15 bespoke
 * `<Link><ArrowLeft/>Back to X</Link>` patterns scattered across the app.
 * The last item is the current page and is never a link (WCAG: a
 * breadcrumb's current-page entry is text, not a self-referential link).
 */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-slate-500">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />}
            {isLast || !item.href ? (
              <span aria-current={isLast ? "page" : undefined} className={isLast ? "font-medium text-slate-700" : undefined}>
                {item.label}
              </span>
            ) : (
              <Link href={item.href} className="hover:text-slate-800">
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

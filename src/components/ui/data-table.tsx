import { cn } from "@/lib/cn";

/**
 * Canonical dense table, promoted from src/components/lca/ui.tsx (which
 * re-exports it for compatibility) so the corporate-side pages that used to
 * render card grids (`/documents`, `/entry`, `/reports`, `/admin/factors`)
 * can use the same table the LCA workspace already relies on.
 *
 * `caption` is optional here for now (existing LCA pages don't pass one) —
 * the accessibility sweep in a later phase tightens this to required and
 * back-fills a caption on every call site in one pass, rather than this
 * shell-focused phase touching 47 page files that aren't otherwise changing.
 */
export function DataTable({
  headers,
  children,
  caption,
}: {
  headers: (string | { label: string; align?: "left" | "right" })[];
  children: React.ReactNode;
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-slate-200">
            {headers.map((header, i) => {
              const label = typeof header === "string" ? header : header.label;
              const align = typeof header === "string" ? "left" : (header.align ?? "left");
              return (
                <th
                  key={`${label}-${i}`}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500",
                    align === "right" ? "text-right" : "text-left",
                  )}
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  align = "left",
  className,
  colSpan,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn("px-3 py-2.5 align-top text-slate-700", align === "right" && "text-right tabular-nums", className)}
    >
      {children}
    </td>
  );
}

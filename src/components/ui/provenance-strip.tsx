import Link from "next/link";
import { FileScan } from "lucide-react";
import { OriginBadge, type ValueOrigin } from "@/components/ai/ai-disclosure";
import { cn } from "@/lib/cn";

export interface ProvenanceStripProps {
  origin: ValueOrigin;
  /** e.g. "Publisher name — vintage 2024" for a factor, or a calculated-by name. */
  source?: string | null;
  evidence?: { label: string; href: string } | null;
  calculatedAt?: string | null;
  className?: string;
}

/**
 * The recurring "who/what/when/source" chip row: generalises the ad hoc
 * provenance badge blocks that used to be one-off per page (the corporate
 * `/calculations/[id]` header, the LCA results pages) into one shared
 * pattern, wrapping the existing OriginBadge rather than inventing new
 * colour semantics for provenance.
 */
export function ProvenanceStrip({ origin, source, evidence, calculatedAt, className }: ProvenanceStripProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm", className)}>
      <OriginBadge origin={origin} />
      {source && <span className="text-slate-500">{source}</span>}
      {calculatedAt && <span className="text-xs text-slate-400">{calculatedAt}</span>}
      {evidence && (
        <Link href={evidence.href} className="flex items-center gap-1 text-brand-700 hover:text-brand-800">
          <FileScan className="h-3.5 w-3.5" aria-hidden="true" />
          {evidence.label}
        </Link>
      )}
    </div>
  );
}

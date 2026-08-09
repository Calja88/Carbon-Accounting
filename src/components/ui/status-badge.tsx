import { Badge } from "@/components/ui/badge";
import { resolveStatusToken, type StatusDomain } from "@/lib/status-tokens";

/**
 * Canonical status badge: looks up { label, tone } from the single shared
 * status-tokens map for its domain, so the same status reads identically
 * everywhere it appears rather than drifting between pages.
 */
export function StatusBadge({
  domain,
  status,
  className,
}: {
  domain: StatusDomain;
  status: string;
  className?: string;
}) {
  const { label, tone } = resolveStatusToken(domain, status);
  return (
    <Badge tone={tone} className={className}>
      {label}
    </Badge>
  );
}

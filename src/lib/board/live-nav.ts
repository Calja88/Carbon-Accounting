import type { OrganisationContext } from "@/lib/organisation/context";
import { hasPermission } from "@/lib/rbac/authorize";
import { BOARD_NAV, type BoardNavItem } from "./navigation";

/**
 * BD04 live wiring for INTEGRATION/LIVE_BINDINGS.md §1: BOARD_NAV is a
 * candidate mapping, not authorization. This filters it down to routes that
 * (a) actually exist on this branch and (b) the current membership's
 * permission grants allow.
 *
 * Phase 0 product reset: carbon is the main product, so every item down to
 * "Advanced" gates on `carbon.view`; "Advanced" itself (the EMS/LCA/AI hub)
 * only needs at least one of the domains it links to.
 *
 * No `import "server-only"` guard: that package isn't a dependency of this
 * project. Safe anyway — this module only checks a permission Set already
 * resolved by the caller and imports no Prisma/auth secret, so nothing
 * leaks even if a future change accidentally pulled it into client code.
 * Only ever call it from a server component (see `(app)/layout.tsx`).
 */

function isPermitted(id: string, context: OrganisationContext): boolean {
  switch (id) {
    case "factors":
      return hasPermission(context, "carbon.factor.view");
    case "advanced":
      return (
        hasPermission(context, "ems.view") ||
        hasPermission(context, "lca.view") ||
        hasPermission(context, "ai.settings.manage")
      );
    default:
      // overview, entry, evidence, reports
      return hasPermission(context, "carbon.view");
  }
}

/** Server-only: pass the result to ConnectedShell, never resolve nav in a client component. */
export function resolveBoardNav(context: OrganisationContext | null): BoardNavItem[] {
  if (!context) return [];
  return BOARD_NAV.filter((item) => isPermitted(item.id, context));
}

import type { OrganisationContext } from "@/lib/organisation/context";
import { hasPermission } from "@/lib/rbac/authorize";
import { BOARD_NAV, type BoardNavItem } from "./navigation";

/**
 * BD04 live wiring for INTEGRATION/LIVE_BINDINGS.md §1: BOARD_NAV is a
 * candidate mapping, not authorization. This filters it down to routes that
 * (a) actually exist on this branch and (b) the current membership's
 * permission grants allow, and corrects two candidate hrefs that don't
 * exist yet (their owning package hasn't built the route) to the nearest
 * real, permitted equivalent so no nav item is ever a dead link or a
 * disabled "coming soon" placeholder.
 *
 * No `import "server-only"` guard: that package isn't a dependency of this
 * project. Safe anyway — this module only checks a permission Set already
 * resolved by the caller and imports no Prisma/auth secret, so nothing
 * leaks even if a future change accidentally pulled it into client code.
 * Only ever call it from a server component (see `(app)/layout.tsx`).
 */

// "overview" (/) and "attention" (/attention) belong to BD05 — not built
// yet on this branch. Until then those routes don't exist, so the item is
// left out of the nav entirely rather than linked or shown disabled.
const NOT_YET_BUILT = new Set(["overview", "attention"]);

// BOARD_NAV's candidate href for these two doesn't exist yet (BD06 owns a
// top-level /evidence hub; BD08 owns /management-packs); redirect each to
// the real, already-permitted route named in its own `matches` list.
const ROUTE_OVERRIDES: Partial<Record<string, BoardNavItem["href"]>> = {
  evidence: "/ems/evidence",
  packs: "/ems/management-reviews",
};

function isPermitted(id: string, context: OrganisationContext): boolean {
  switch (id) {
    case "carbon":
      return hasPermission(context, "carbon.view");
    case "products":
      return hasPermission(context, "lca.view");
    case "admin":
      // Same platform-admin gate the previous top nav used (canViewPlatformAdmin).
      return hasPermission(context, "carbon.factor.view") || hasPermission(context, "ai.settings.manage");
    default:
      // Every remaining candidate (aspects, compliance, objectives, audits,
      // nonconformities, evidence, packs) is an EMS route gated the same
      // way the previous top nav's single EMS entry was: ems.view.
      return hasPermission(context, "ems.view");
  }
}

/** Server-only: pass the result to ConnectedShell, never resolve nav in a client component. */
export function resolveBoardNav(context: OrganisationContext | null): BoardNavItem[] {
  if (!context) return [];
  return BOARD_NAV.filter((item) => !NOT_YET_BUILT.has(item.id))
    .filter((item) => isPermitted(item.id, context))
    .map((item) => {
      const override = ROUTE_OVERRIDES[item.id];
      return override ? { ...item, href: override } : item;
    });
}

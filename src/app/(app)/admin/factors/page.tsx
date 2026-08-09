import { redirect } from "next/navigation";

/**
 * /admin/factors moved to /factors — emission factors are core reference
 * data every calculation depends on, not admin housekeeping, so they moved
 * out from under /admin in the navigation. The upload/edit actions
 * themselves are still admin-gated (requireAdminSession), unchanged — only
 * the URL and its place in the nav moved. See docs/ui-overhaul-plan.md §5.
 */
export default function LegacyAdminFactorsRedirect() {
  redirect("/factors");
}

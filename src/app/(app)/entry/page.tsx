import { redirect } from "next/navigation";

/**
 * /entry moved to /data/entry as part of the new Data-workspace grouping.
 * Kept as a redirect so bookmarks and any links in previously-generated
 * content keep working — see docs/ui-overhaul-plan.md §5/§14 Phase 2.
 */
export default function LegacyEntryRedirect() {
  redirect("/data/entry");
}

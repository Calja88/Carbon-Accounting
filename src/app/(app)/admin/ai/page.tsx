import { redirect } from "next/navigation";

/** /admin/ai moved to /settings/ai — see docs/ui-overhaul-plan.md §5. */
export default function LegacyAdminAiRedirect() {
  redirect("/settings/ai");
}

import { redirect } from "next/navigation";

/** /methodologies moved to /methodology (singular, sibling of /factors) — see docs/ui-overhaul-plan.md §5. */
export default function LegacyMethodologiesRedirect() {
  redirect("/methodology");
}

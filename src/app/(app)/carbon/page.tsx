import { redirect } from "next/navigation";
import { carbonRedirectTarget } from "@/lib/board/navigation";

/**
 * Phase 1B: there is one carbon dashboard, at `/`. This route only forwards
 * the scope the visitor arrived with — existing bookmarks, report drilldowns
 * and shared links keep landing on the same period and site they named.
 */
export default async function CarbonRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(carbonRedirectTarget(await searchParams));
}

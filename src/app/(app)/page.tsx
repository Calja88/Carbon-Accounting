import { redirect } from "next/navigation";

/**
 * BD04: the emissions dashboard that used to live at `/` moved to
 * `/carbon` so `/` is free for BD05's real executive Overview. Until BD05
 * exists, `/` stays a genuine redirect to the real, working carbon landing
 * rather than a page of hardcoded figures — `/carbon` still runs its own
 * full auth/organisation-access check and redirect to `/login`.
 */
export default function RootRedirect() {
  redirect("/carbon");
}

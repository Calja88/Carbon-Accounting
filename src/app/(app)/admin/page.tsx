import { redirect } from "next/navigation";

/**
 * Phase 0: `/admin` itself has no page — every admin surface lives under a
 * subpath (`/admin/factors`, `/admin/organisation/members`, `/admin/ai`).
 * Redirect to the safest, most broadly-granted one rather than 404ing;
 * `/admin/factors` itself redirects on to `/` if the visitor lacks
 * `carbon.factor.view`, so this never exposes anything unauthorized.
 */
export default function AdminIndexPage() {
  redirect("/admin/factors");
}

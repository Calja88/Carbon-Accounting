import { Suspense } from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { getAiAvailability } from "@/lib/ai";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission } from "@/lib/rbac/authorize";
import { AssistantPanel } from "@/components/ai/assistant-panel";
import { Providers } from "./providers";
import { SignOutButton } from "./sign-out-button";
import { NavLinks } from "./nav-links";

const ROLE_LABELS: Record<string, string> = {
  DATA_OWNER: "Data owner",
  SUSTAINABILITY_LEAD: "Sustainability lead",
  FINANCE: "Finance",
  ADMIN: "Admin",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  // Resolved on the server so the assistant opens already knowing whether it
  // can answer — the platform never offers an AI affordance that will fail.
  // Phase 1 tenancy (T18): AI availability is per-Organisation, so this needs
  // a resolved OrganisationContext first. A visitor with no active
  // membership yet (mid-onboarding, or between organisations) simply sees
  // the assistant as unavailable, same as being signed out — this layout
  // renders for both states and must not throw for either.
  const organisation = await requireOrganisationContext().catch((err) => {
    if (err instanceof OrganisationAccessError) return null;
    throw err;
  });
  const aiAvailability = organisation
    ? await getAiAvailability(organisation.organisationId)
    : { available: false, reason: null, message: null };

  // Nav visibility for the platform-admin section (factor administration,
  // AI settings) — gated on this Organisation's own current permission
  // grants (T1A), not the legacy JWT role. Either permission is enough to
  // show the section; the destination pages each enforce their own,
  // narrower permission.
  const canViewPlatformAdmin =
    organisation !== null &&
    (hasPermission(organisation, "carbon.factor.view") || hasPermission(organisation, "ai.settings.manage"));

  return (
    <Providers>
      {/*
        Two rows, not one. Brand + navigation + user block together want roughly
        1400px of content; the max-w-6xl container offers 1120. On a single row
        flex had to shrink them past their content width, which wrapped labels
        mid-item and pushed the brand text over the first nav link. Giving the
        navigation its own full-width row removes the competition entirely, so
        nothing has to be dropped from the header to make it fit.
      */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 pt-3 pb-2">
          <Link href="/" className="flex shrink-0 items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset, next/image adds no value here */}
            <img src="/logos/paragon-id.png" alt="Paragon ID" className="h-6 w-auto" />
            <span className="hidden h-5 w-px bg-slate-200 sm:block" aria-hidden="true" />
            <span className="hidden whitespace-nowrap text-xs font-medium leading-tight text-slate-500 sm:block">
              UK
              <br />
              Carbon Reporting
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-3">
            {session?.user && (
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-100">
                  {initials(session.user.name ?? "?")}
                </span>
                <div className="hidden leading-tight sm:block">
                  <div className="whitespace-nowrap text-sm font-medium text-slate-800">{session.user.name}</div>
                  <div className="whitespace-nowrap text-xs text-slate-500">
                    {ROLE_LABELS[session.user.role] ?? session.user.role}
                  </div>
                </div>
              </div>
            )}
            <SignOutButton />
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-2">
          <NavLinks
            canViewPlatformAdmin={canViewPlatformAdmin}
            canManageOrganisation={organisation !== null && hasPermission(organisation, "organisation.membership.manage")}
          />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      {session?.user && (
        // useSearchParams (the assistant reads the reporting period from the
        // URL) needs a Suspense boundary in the App Router.
        <Suspense fallback={null}>
          <AssistantPanel available={aiAvailability.available} unavailableMessage={aiAvailability.message} />
        </Suspense>
      )}
    </Providers>
  );
}

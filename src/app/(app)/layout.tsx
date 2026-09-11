import { Suspense } from "react";
import { auth } from "@/auth";
import { getAiAvailability } from "@/lib/ai";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { prisma } from "@/lib/prisma";
import { AssistantPanel } from "@/components/ai/assistant-panel";
import { ConnectedShell } from "@/components/board/connected-shell";
import { ScopeBar } from "@/components/board/scope-bar";
import { resolveBoardNav } from "@/lib/board/live-nav";
import { isVerifiedSyntheticOrganisation } from "@/lib/board/demo-identity";
import { monthInputValue } from "@/lib/report-period";
import { Providers } from "./providers";
import { SignOutButton } from "./sign-out-button";

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

  // BD04: nav is resolved server-side from the actual permitted/available
  // route set (INTEGRATION/LIVE_BINDINGS.md §1) — BOARD_NAV itself is only a
  // candidate list, never an authorization source.
  const nav = resolveBoardNav(organisation);

  // Organisation display name for the scope bar's brand slot — the existing
  // OrganisationContext only carries the slug, not the name, so this is one
  // small extra read-only lookup (mirrors the existing pattern of reading
  // extra rows straight in a server page/layout, e.g. the current carbon
  // landing's own site query).
  const organisationName = organisation
    ? ((await prisma.organisation.findUnique({ where: { id: organisation.organisationId }, select: { name: true } }))
        ?.name ?? organisation.organisationSlug)
    : "Carbon Ledger";

  const account = session?.user ? (
    <>
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-xs font-semibold text-teal-800"
      >
        {initials(session.user.name ?? "?")}
      </span>
      <span className="hidden leading-tight sm:inline-flex sm:flex-col">
        <span>{session.user.name}</span>
        <span className="bd-muted">{ROLE_LABELS[session.user.role] ?? session.user.role}</span>
      </span>
      <SignOutButton />
    </>
  ) : (
    <SignOutButton />
  );

  // BD04 ships the shell/scope bar before BD03's real carbon-period read
  // adapter exists, and a shared layout never reliably receives a page's
  // searchParams (INTEGRATION/LIVE_BINDINGS.md §1) — so the scope bar runs
  // in its "operational" mode here (organisation identity only, no date/site
  // form) rather than showing a stale or fabricated carbon period. The
  // actual carbon period picker keeps living on `/carbon` itself, unchanged.
  const scopeBar = (
    <ScopeBar
      organisationName={organisationName}
      sites={[]}
      from={monthInputValue(new Date())}
      to={monthInputValue(new Date())}
      action="/carbon"
      periodMode="operational"
    />
  );

  // BD02: server-derived only, never a client toggle or a URL/branch-name
  // guess. `null` here means no disposable demo database's own recorded
  // identity is available to check against the environment manifest — true
  // for every environment this branch has run in so far (BD02 could not
  // provision one this session; see Docs/board-sprint/CONTINUITY.md). The
  // banner is correctly off until a real guarded environment's identity can
  // be read here.
  const synthetic = organisation ? await isVerifiedSyntheticOrganisation(organisation.organisationId) : false;

  return (
    <Providers>
      <ConnectedShell nav={nav} scopeBar={scopeBar} account={account} synthetic={synthetic}>
        {children}
        {session?.user && (
          // useSearchParams (the assistant reads the reporting period from the
          // URL) needs a Suspense boundary in the App Router.
          <Suspense fallback={null}>
            <AssistantPanel available={aiAvailability.available} unavailableMessage={aiAvailability.message} />
          </Suspense>
        )}
      </ConnectedShell>
    </Providers>
  );
}

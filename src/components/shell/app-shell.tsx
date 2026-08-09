import { Suspense } from "react";
import Link from "next/link";
import type { Session } from "next-auth";
import { AssistantPanel } from "@/components/ai/assistant-panel";
import { SignOutButton } from "@/app/(app)/sign-out-button";
import { buildNavGroups } from "./nav-config";
import { MobileNavToggle, PrimaryNav } from "./primary-nav";

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

export interface AppShellProps {
  session: Session | null;
  isAdmin: boolean;
  aiAvailability: { available: boolean; message: string | null };
  /** Whether /data/entries exists yet — flips on in Phase 2. */
  historicalDataEnabled?: boolean;
  children: React.ReactNode;
}

/**
 * The one place the authenticated shell's header/nav/main/assistant are
 * assembled. Session-derived chrome (avatar, role label, sign-out) stays
 * exactly as it behaved in the original src/app/(app)/layout.tsx; only the
 * navigation is restructured (grouped PrimaryNav + MobileNavToggle instead
 * of the old flat NavLinks) and a skip-link + explicit landmark labelling
 * are added.
 */
export function AppShell({ session, isAdmin, aiAvailability, historicalDataEnabled = false, children }: AppShellProps) {
  const groups = buildNavGroups({ isAdmin, historicalDataEnabled });

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 pt-3 pb-2">
          <div className="flex min-w-0 items-center gap-2">
            <MobileNavToggle groups={groups} />
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
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {session?.user && (
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200">
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
          <PrimaryNav groups={groups} />
        </div>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
      {session?.user && (
        // useSearchParams (the assistant reads the reporting period from the
        // URL) needs a Suspense boundary in the App Router.
        <Suspense fallback={null}>
          <AssistantPanel available={aiAvailability.available} unavailableMessage={aiAvailability.message} />
        </Suspense>
      )}
    </>
  );
}

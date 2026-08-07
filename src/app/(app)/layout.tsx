import Link from "next/link";
import { auth } from "@/auth";
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
  const isAdmin = session?.user?.role === "ADMIN";

  return (
    <Providers>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-3">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold tracking-tight text-white">
                PI
              </span>
              <span className="hidden flex-col leading-tight sm:flex">
                <span className="text-sm font-semibold text-slate-900">Paragon ID UK</span>
                <span className="text-xs text-slate-500">Carbon Reporting</span>
              </span>
            </Link>
            <NavLinks isAdmin={isAdmin} />
          </div>
          <div className="flex items-center gap-3">
            {session?.user && (
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-100">
                  {initials(session.user.name ?? "?")}
                </span>
                <div className="hidden leading-tight sm:block">
                  <div className="text-sm font-medium text-slate-800">{session.user.name}</div>
                  <div className="text-xs text-slate-500">{ROLE_LABELS[session.user.role] ?? session.user.role}</div>
                </div>
              </div>
            )}
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </Providers>
  );
}

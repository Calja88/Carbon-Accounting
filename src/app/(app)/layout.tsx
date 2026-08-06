import Link from "next/link";
import { auth } from "@/auth";
import { Providers } from "./providers";
import { SignOutButton } from "./sign-out-button";

const ROLE_LABELS: Record<string, string> = {
  DATA_OWNER: "Data owner",
  SUSTAINABILITY_LEAD: "Sustainability lead",
  FINANCE: "Finance",
  ADMIN: "Admin",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <Providers>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-sm font-semibold text-slate-900">
              Paragon ID UK · Carbon Reporting
            </Link>
            <nav className="flex items-center gap-4 text-sm text-slate-600">
              <Link href="/" className="hover:text-slate-900">
                Dashboard
              </Link>
              <Link href="/entry" className="hover:text-slate-900">
                Data entry
              </Link>
              <Link href="/reports" className="hover:text-slate-900">
                Reports
              </Link>
              {session?.user?.role === "ADMIN" && (
                <Link href="/admin/factors" className="hover:text-slate-900">
                  Emission factors
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {session?.user && (
              <span className="text-sm text-slate-500">
                {session.user.name}
                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {ROLE_LABELS[session.user.role] ?? session.user.role}
                </span>
              </span>
            )}
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </Providers>
  );
}

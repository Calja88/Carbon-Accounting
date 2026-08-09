import { auth } from "@/auth";
import { getAiAvailability } from "@/lib/ai";
import { AppShell } from "@/components/shell/app-shell";
import { Providers } from "./providers";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const isAdmin = session?.user?.role === "ADMIN";

  // Resolved on the server so the assistant opens already knowing whether it
  // can answer — the platform never offers an AI affordance that will fail.
  const aiAvailability = await getAiAvailability();

  return (
    <Providers>
      <AppShell session={session} isAdmin={isAdmin} aiAvailability={aiAvailability} historicalDataEnabled>
        {children}
      </AppShell>
    </Providers>
  );
}

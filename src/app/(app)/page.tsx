import { redirect } from "next/navigation";
import { ZodError } from "zod";
import type { OverviewModel } from "@/lib/board/contracts";
import { OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { getBoardOverview, InvalidBoardScopeError, type BoardOverviewSearchParams } from "@/lib/board/overview-entry";
import { ExecutiveOverview } from "@/components/board/overview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * BD05: the real executive Overview. Supersedes BD04's temporary
 * `redirect("/carbon")` — the working emissions dashboard stays reachable
 * at `/carbon`, unchanged, per INTEGRATION/LIVE_BINDINGS.md §1.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<BoardOverviewSearchParams>;
}) {
  const params = await searchParams;
  let model: OverviewModel | { unavailable: { title: string; detail: string } };
  try {
    model = await getBoardOverview(params);
  } catch (err) {
    if (err instanceof PermissionDeniedError) {
      model = { unavailable: { title: "Carbon view not permitted", detail: "Your current membership does not have permission to view the Overview." } };
    } else if (err instanceof OrganisationAccessError) {
      if (err.reason === "NOT_AUTHENTICATED") redirect("/login");
      model = { unavailable: { title: "No organisation access", detail: "Your account isn't an active member of any organisation right now." } };
    } else if (err instanceof InvalidBoardScopeError) {
      model = { unavailable: { title: "Invalid selection", detail: "That organisation or site selection could not be verified." } };
    } else if (err instanceof ZodError) {
      model = { unavailable: { title: "Invalid period selected", detail: "The selected date range or site could not be understood. Use the period picker on the Carbon page to choose a valid range." } };
    } else {
      throw err;
    }
  }
  if ("unavailable" in model) return <Unavailable title={model.unavailable.title} detail={model.unavailable.detail} />;
  return <ExecutiveOverview model={model} />;
}

function Unavailable({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">{detail}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

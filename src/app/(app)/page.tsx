import { redirect } from "next/navigation";
import { ZodError } from "zod";
import type { OverviewModel } from "@/lib/board/contracts";
import { OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { getBoardOverview, InvalidBoardScopeError, type BoardOverviewSearchParams } from "@/lib/board/overview-entry";
import { ExecutiveOverview } from "@/components/board/overview";
import { PageHeader, Surface } from "@/components/ui/primitives";
import { logEvent } from "@/lib/observability/logger";

/**
 * The one carbon dashboard. Phase 1B folded /carbon's figures in here and
 * left that route as a redirect, so there is a single place a period or site
 * selection has to be understood.
 *
 * The four handled cases below are all rejected *selections* — a denial or an
 * unusable scope, which the visitor can correct. Anything else is a genuine
 * fault: it is logged with its root cause and rethrown to the error boundary
 * rather than being flattened into an empty dashboard.
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
      // Structured and redacted by the logger — the cause is recorded, no secret is.
      logEvent({
        level: "error",
        message: "overview.load_failed",
        fields: {
          route: "/",
          error: err instanceof Error ? err.name : typeof err,
          detail: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
  }
  if ("unavailable" in model) return <Unavailable title={model.unavailable.title} detail={model.unavailable.detail} />;
  return <ExecutiveOverview model={model} />;
}

/** A selection this visitor cannot be shown — not a failure, and not an empty dashboard either. */
function Unavailable({ title, detail }: { title: string; detail: string }) {
  return (
    <>
      <PageHeader eyebrow="Dashboard" title={title} />
      <Surface>
        <div className="bd-empty" role="status">
          <h3>{title}</h3>
          <p>{detail}</p>
        </div>
      </Surface>
    </>
  );
}

import { NextResponse, type NextRequest } from "next/server";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { getComplianceEvaluation } from "@/lib/ems/legal/evaluation-service";

/**
 * Serves an ISSUED evaluation's frozen report snapshot (task T45, spec §9
 * "report freezes source obligation versions"). Only ISSUED evaluations
 * expose `reportPayload` — a PLANNED/IN_PROGRESS/COMPLETED evaluation is not
 * yet a report, it is still a live in-progress record, so this route 404s
 * for those rather than returning a payload that would go stale.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  let orgContext;
  try {
    orgContext = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) return new NextResponse("Sign in first.", { status: 401 });
    throw err;
  }

  const { id } = await context.params;

  let evaluation;
  try {
    evaluation = await getComplianceEvaluation(orgContext, id);
  } catch (err) {
    if (err instanceof PermissionDeniedError) return new NextResponse("Forbidden.", { status: 403 });
    if (err instanceof TenantOwnershipError) return new NextResponse("Not found.", { status: 404 });
    throw err;
  }
  if (!evaluation || evaluation.status !== "ISSUED" || !evaluation.reportPayload) {
    return new NextResponse("This evaluation has not been issued yet.", { status: 404 });
  }

  return NextResponse.json(
    {
      id: evaluation.id,
      programmeName: evaluation.programme.name,
      periodStart: evaluation.periodStart,
      periodEnd: evaluation.periodEnd,
      issuedAt: evaluation.issuedAt,
      leadMembershipId: evaluation.leadMembershipId,
      report: evaluation.reportPayload,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

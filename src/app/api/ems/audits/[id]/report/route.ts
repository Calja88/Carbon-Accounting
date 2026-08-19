import { NextResponse } from "next/server";
import { getIssuedAuditReport } from "@/lib/ems/audits/report-service";
import { OrganisationAccessError, requireOrganisationContext } from "@/lib/organisation/session";

/**
 * Downloads the frozen, issued audit report (task T61,
 * Docs/PHASE6_AUDIT_INCIDENT_CAPA_SPEC.md §7). Non-disclosing: a missing
 * audit, a foreign-tenant audit, and a report that has not yet been issued
 * (still `DRAFT`, or no report at all) all produce the identical 404 here —
 * see `report-service.ts#getIssuedAuditReport` (T61 acceptance: "issued
 * report immutable ... foreign report download reveals nothing").
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let context;
  try {
    context = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) {
      return new NextResponse("You must be signed in to download this report.", { status: 401 });
    }
    throw err;
  }

  const revision = await getIssuedAuditReport(context, id);
  if (!revision) {
    return new NextResponse("That audit report could not be found.", { status: 404 });
  }

  const body = JSON.stringify(revision.frozenPayload, null, 2);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="audit-report-${id}.json"`,
      "X-Content-SHA256": revision.checksumSha256 ?? "",
    },
  });
}

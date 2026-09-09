import { NextResponse } from "next/server";
import { buildStructuredExport } from "@/lib/lca/report-service";
import { recordAuditEvent } from "@/lib/lca/audit-service";
import { canExportLca, getLcaContext } from "@/lib/lca/permissions";
import { requireAssessmentInScope } from "@/lib/repositories/lca-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { PermissionDeniedError } from "@/lib/rbac/authorize";

/**
 * The whole assessment as structured data: goal and scope, model, inventory,
 * results with their provenance, registers, evidence metadata, validation and
 * readiness. Intended for downstream systems and for anyone who needs the
 * assessment without this application in front of it.
 *
 * Tenant-scoped at the initial lookup before any export data is built —
 * Batch G, highest IDOR priority per PHASE1_FILE_REFACTOR_MAP.md §8.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const context = await getLcaContext();
  if (!canExportLca(context)) {
    return new NextResponse("You must be signed in to export an assessment.", { status: 401 });
  }

  try {
    await requireAssessmentInScope(context!, id);
  } catch (err) {
    if (err instanceof TenantOwnershipError || err instanceof PermissionDeniedError) {
      return new NextResponse("Not found.", { status: 404 });
    }
    throw err;
  }

  let payload;
  try {
    payload = await buildStructuredExport(id);
  } catch {
    return new NextResponse("That assessment could not be found.", { status: 404 });
  }

  await recordAuditEvent({
    assessmentId: id,
    entityType: "report_export",
    action: "exported",
    actorUserId: context!.userId,
    summary: "Structured JSON export downloaded.",
  });

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${payload.assessment.reference}-assessment.json"`,
    },
  });
}

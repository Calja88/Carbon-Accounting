import { NextResponse } from "next/server";
import { buildStructuredExport } from "@/lib/lca/report-service";
import { recordAuditEvent } from "@/lib/lca/audit-service";
import { canViewLca, getLcaActor } from "@/lib/lca/permissions";

/**
 * The whole assessment as structured data: goal and scope, model, inventory,
 * results with their provenance, registers, evidence metadata, validation and
 * readiness. Intended for downstream systems and for anyone who needs the
 * assessment without this application in front of it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const actor = await getLcaActor();
  if (!canViewLca(actor)) {
    return new NextResponse("You must be signed in to export an assessment.", { status: 401 });
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
    actorUserId: actor?.id,
    summary: "Structured JSON export downloaded.",
  });

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${payload.assessment.reference}-assessment.json"`,
    },
  });
}

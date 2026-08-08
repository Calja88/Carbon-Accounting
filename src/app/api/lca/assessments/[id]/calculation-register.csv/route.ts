import { NextResponse } from "next/server";
import { buildCalculationRegisterCsv } from "@/lib/lca/report-service";
import { recordAuditEvent } from "@/lib/lca/audit-service";
import { canViewLca, getLcaActor } from "@/lib/lca/permissions";

/**
 * The calculation register: every result line with the whole arithmetic behind
 * it, at full stored precision. This is the file a reviewer works from.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const actor = await getLcaActor();
  if (!canViewLca(actor)) {
    return new NextResponse("You must be signed in to export a calculation register.", { status: 401 });
  }

  const register = await buildCalculationRegisterCsv(id);
  if (!register) {
    return new NextResponse(
      "This assessment has not been calculated yet, so there is no register to export.",
      { status: 404 },
    );
  }

  await recordAuditEvent({
    assessmentId: id,
    entityType: "report_export",
    action: "exported",
    actorUserId: actor?.id,
    summary: `Calculation register exported as ${register.fileName}.`,
  });

  return new NextResponse(register.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${register.fileName}"`,
    },
  });
}

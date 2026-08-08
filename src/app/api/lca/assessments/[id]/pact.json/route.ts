import { NextResponse } from "next/server";
import { buildPactExport } from "@/lib/lca/report-service";
import { recordAuditEvent } from "@/lib/lca/audit-service";
import { canViewLca, getLcaActor } from "@/lib/lca/permissions";
import { PactAdapterError } from "@/lib/lca/pact/adapter";

/**
 * A PACT-aligned product footprint document for sharing this result with a
 * customer's system.
 *
 * The document carries its own conformance notice: the structure follows the
 * published PACT data model as this implementation understands it, but it has
 * not been validated against an authoritative schema and this platform does not
 * implement the PACT network API. That statement travels with the file rather
 * than living only in documentation.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const actor = await getLcaActor();
  if (!canViewLca(actor)) {
    return new NextResponse("You must be signed in to export a product footprint document.", { status: 401 });
  }

  let outcome;
  try {
    outcome = await buildPactExport(id);
  } catch (error) {
    if (error instanceof PactAdapterError) {
      return new NextResponse(error.message, { status: 422 });
    }
    return new NextResponse(
      error instanceof Error ? error.message : "That assessment could not be exported.",
      { status: 404 },
    );
  }

  await recordAuditEvent({
    assessmentId: id,
    entityType: "report_export",
    action: "exported",
    actorUserId: actor?.id,
    summary: "PACT-aligned product footprint document downloaded.",
    metadata: { notes: outcome.notes },
  });

  const body = {
    // Notes travel alongside the document rather than inside it, so the
    // document itself stays the shape a receiving system expects.
    "//": outcome.notes,
    ...outcome.document,
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${outcome.document.productNameCompany.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-product-footprint.json"`,
    },
  });
}

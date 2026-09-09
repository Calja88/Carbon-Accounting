import { NextResponse } from "next/server";
import { buildCalculationRegisterCsv } from "@/lib/lca/report-service";
import { recordAuditEvent } from "@/lib/lca/audit-service";
import { canExportLca, getLcaContext } from "@/lib/lca/permissions";
import { requireAssessmentInScope } from "@/lib/repositories/lca-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { PermissionDeniedError } from "@/lib/rbac/authorize";

/**
 * The calculation register: every result line with the whole arithmetic behind
 * it, at full stored precision. This is the file a reviewer works from.
 *
 * Tenant-scoped at the initial lookup (requireAssessmentInScope) before any
 * report data is built — Batch G, highest IDOR priority per
 * PHASE1_FILE_REFACTOR_MAP.md §8.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const context = await getLcaContext();
  if (!canExportLca(context)) {
    return new NextResponse("You must be signed in to export a calculation register.", { status: 401 });
  }

  try {
    await requireAssessmentInScope(context!, id);
  } catch (err) {
    if (err instanceof TenantOwnershipError || err instanceof PermissionDeniedError) {
      return new NextResponse("Not found.", { status: 404 });
    }
    throw err;
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
    actorUserId: context!.userId,
    summary: `Calculation register exported as ${register.fileName}.`,
  });

  return new NextResponse(register.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${register.fileName}"`,
    },
  });
}

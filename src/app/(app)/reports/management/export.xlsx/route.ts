/**
 * Phase 5B — the Management Carbon Report's export.
 *
 * Deliberately thin. It calls `loadManagementReport` with the *same* search
 * params the page reads, so the workbook is a serialisation of the very report
 * object the reader is looking at rather than a second query with a second set
 * of rules. Nothing is aggregated here.
 *
 * Authorization is checked here and again inside `loadManagementReport`
 * (`requireCarbonView`, tenant scoping, and `requireSiteInScope` for an
 * explicitly selected site), before a single byte is written: the server
 * decides, not the presence of a button. Exporting is a read, so a CLOSED
 * reporting period exports exactly like an open one — the Phase 4-ii barrier
 * governs mutations and is untouched here.
 */
import { NextRequest, NextResponse } from "next/server";
import { OrganisationAccessError, requireOrganisationContext } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { requireManagementReportExport } from "@/lib/rbac/carbon-access";
import { logEvent } from "@/lib/observability/logger";
import { loadManagementReport } from "@/lib/carbon/live-management-report";
import { buildManagementReportWorkbook, managementReportFileName } from "@/lib/carbon/management-report-export";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(request: NextRequest) {
  let context;
  try {
    context = await requireOrganisationContext();
    // Checked server-side, so hiding the button is presentation rather than
    // protection: a reader without the permission gets nothing by guessing
    // the URL.
    requireManagementReportExport(context);
  } catch (err) {
    if (err instanceof OrganisationAccessError) return new NextResponse("Sign in first.", { status: 401 });
    if (err instanceof PermissionDeniedError) return new NextResponse("Report not found", { status: 404 });
    throw err;
  }

  const params = request.nextUrl.searchParams;
  try {
    const report = await loadManagementReport(context, {
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      siteId: params.get("siteId") ?? undefined,
    });

    const workbook = buildManagementReportWorkbook(report);
    const body = new Uint8Array(await workbook.xlsx.writeBuffer());

    return new NextResponse(body, {
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${managementReportFileName(report)}"`,
        // A management report is a position at a moment, not a cacheable asset.
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof OrganisationAccessError) return new NextResponse("Sign in first.", { status: 401 });
    if (err instanceof PermissionDeniedError) return new NextResponse("Report not found", { status: 404 });
    // A site that is not the reader's to see is a bad selection, not a fault,
    // and is refused rather than quietly widened to every site they can see.
    if (err instanceof TenantOwnershipError) {
      return new NextResponse("That site is not available in this report.", { status: 400 });
    }
    // The real exception is what makes a failure fixable; the caller only ever
    // sees the sentence below.
    logEvent({
      level: "error",
      message: "management report export failed",
      organisationId: context.organisationId,
      correlationId: context.correlationId,
      fields: {
        errorName: err instanceof Error ? err.name : typeof err,
        errorMessage: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
    });
    return new NextResponse("This report could not be exported. Try again, and report it if it persists.", { status: 500 });
  }
}

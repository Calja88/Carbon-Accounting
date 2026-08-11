import { NextResponse } from "next/server";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { requirePermission, PermissionDeniedError } from "@/lib/rbac/authorize";
import { buildTemplateCsv } from "@/lib/factor-import";

export async function GET() {
  try {
    const context = await requireOrganisationContext();
    requirePermission(context, "carbon.factor.manage");
  } catch (err) {
    if (err instanceof OrganisationAccessError) return new NextResponse("Sign in first.", { status: 401 });
    if (err instanceof PermissionDeniedError) return new NextResponse("Not permitted.", { status: 403 });
    throw err;
  }

  return new NextResponse(buildTemplateCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="emission-factor-template.csv"',
    },
  });
}

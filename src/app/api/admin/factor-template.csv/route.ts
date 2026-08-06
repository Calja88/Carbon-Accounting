import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin";
import { buildTemplateCsv } from "@/lib/factor-import";

export async function GET() {
  const session = await requireAdminSession();
  if (!session) return new NextResponse("Admins only", { status: 403 });

  return new NextResponse(buildTemplateCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="emission-factor-template.csv"',
    },
  });
}

import { NextResponse } from "next/server";
import { buildInventoryTemplateCsv } from "@/lib/lca/import/inventory-import";

/** The downloadable bill-of-materials / inventory import template. */
export async function GET() {
  return new NextResponse(buildInventoryTemplateCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="product-inventory-template.csv"',
    },
  });
}

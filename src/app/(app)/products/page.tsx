import Link from "next/link";
import { Package } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { listProducts } from "@/lib/lca/assessment-service";
import { canEditLcaData, getLcaActor } from "@/lib/lca/permissions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, EmptyState, PageHeading, Td } from "@/components/lca/ui";
import { CreateProductForm } from "./product-forms";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const [products, entities, actor] = await Promise.all([listProducts(), prisma.entity.findMany({ orderBy: { name: "asc" } }), getLcaActor()]);
  const canEdit = canEditLcaData(actor);

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Product carbon footprints"
        title="Products"
        description="Products assessed at product level. Each product holds one or more versions, and an assessment is attached to a version — so a design change gets its own footprint rather than overwriting the previous one."
        actions={canEdit ? <CreateProductForm entities={entities} /> : null}
      />

      <Card>
        <CardContent className="p-0">
          {products.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No products yet"
                description={
                  canEdit
                    ? "Add a product to start a life cycle assessment. You will need its SKU, and a version label for the design being assessed."
                    : "No products have been added yet. Ask a data owner or sustainability lead to add one."
                }
              />
            </div>
          ) : (
            <DataTable
              headers={["Product", "SKU", "Operating unit", "Category", "Versions", { label: "Assessments", align: "right" }, "Status"]}
            >
              {products.map((product) => {
                const assessmentCount = product.versions.reduce((sum, v) => sum + v._count.assessments, 0);
                return (
                  <tr key={product.id} className="hover:bg-slate-50">
                    <Td>
                      <Link href={`/products/${product.id}`} className="flex items-center gap-2 font-medium text-slate-900 hover:text-brand-700">
                        <Package className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                        {product.name}
                      </Link>
                      {product.description && <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{product.description}</p>}
                    </Td>
                    <Td className="font-mono text-xs">{product.sku}</Td>
                    <Td>{product.entity.name}</Td>
                    <Td>{product.category ?? <span className="text-slate-400">—</span>}</Td>
                    <Td>{product.versions.map((v) => v.versionLabel).join(", ")}</Td>
                    <Td align="right">{assessmentCount}</Td>
                    <Td>
                      <Badge tone={product.status === "ACTIVE" ? "success" : "neutral"}>
                        {product.status === "ACTIVE" ? "Active" : "Discontinued"}
                      </Badge>
                    </Td>
                  </tr>
                );
              })}
            </DataTable>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

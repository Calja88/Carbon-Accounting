import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireAdminSession } from "@/lib/admin";
import { getFactorSetDetail, getFactorSetCategoryCounts, getFactorSetCategoryRows } from "@/lib/factor-sets-service";
import { factorCategoryLabel } from "@/lib/factor-categories";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, Td } from "@/components/ui/data-table";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { ProvenanceStrip } from "@/components/ui/provenance-strip";

export default async function AdminFactorSetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const session = await requireAdminSession();
  if (!session) redirect("/");

  const { id } = await params;
  const { category } = await searchParams;
  const set = await getFactorSetDetail(id);
  if (!set) notFound();

  const categoryCounts = await getFactorSetCategoryCounts(id);
  const rows = category ? await getFactorSetCategoryRows(id, category) : null;

  return (
    <div className="max-w-3xl space-y-4">
      <Breadcrumbs
        items={[
          { label: "Emission factors", href: "/factors" },
          ...(rows ? [{ label: set.name, href: `/factors/${id}` }, { label: factorCategoryLabel(category!) }] : [{ label: set.name }]),
        ]}
      />

      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{set.name}</h1>
        {set.isPlaceholder && <Badge tone="warning">Placeholder — not verified</Badge>}
      </div>

      <ProvenanceStrip
        origin="IMPORTED"
        source={`${set.publisher} · vintage ${set.vintageYear}${set.supplierName ? ` · ${set.supplierName}` : ""}`}
        timestamp={
          set.importedBy
            ? `imported by ${set.importedBy.name}`
            : `effective from ${new Date(set.effectiveFrom).toLocaleDateString("en-GB")}`
        }
      />

      <Card>
        <CardContent className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <div className="text-slate-500">Source type</div>
            <div className="font-medium text-slate-900">
              {set.sourceType}
              {set.supplierName ? ` — ${set.supplierName}` : ""}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Publisher</div>
            <div className="font-medium text-slate-900">{set.publisher}</div>
          </div>
          <div>
            <div className="text-slate-500">Vintage year</div>
            <div className="font-medium text-slate-900">{set.vintageYear}</div>
          </div>
          <div>
            <div className="text-slate-500">Effective</div>
            <div className="font-medium text-slate-900">
              {new Date(set.effectiveFrom).toLocaleDateString("en-GB")} –{" "}
              {set.effectiveTo ? new Date(set.effectiveTo).toLocaleDateString("en-GB") : "current"}
            </div>
          </div>
          {set.sourceFileName && (
            <div>
              <div className="text-slate-500">Source file</div>
              <div className="font-medium text-slate-900">{set.sourceFileName}</div>
            </div>
          )}
          {set.importedBy && (
            <div>
              <div className="text-slate-500">Imported by</div>
              <div className="font-medium text-slate-900">{set.importedBy.name}</div>
            </div>
          )}
          {set.notes && (
            <div className="sm:col-span-2">
              <div className="text-slate-500">Notes</div>
              <div className="text-slate-800">{set.notes}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {rows ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                {factorCategoryLabel(category!)} ({rows.length})
              </CardTitle>
              <Link href={`/factors/${id}`} className="text-sm font-medium text-brand-700 hover:text-brand-800">
                ← All categories
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              caption={`Factors in the ${factorCategoryLabel(category!)} category`}
              headers={["Subtype", "Basis", "Region", { label: "Factor", align: "right" }, "Unit"]}
            >
              {rows.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50">
                  <Td>{f.subtypeKey ?? "—"}</Td>
                  <Td>{f.basis}</Td>
                  <Td>{f.region}</Td>
                  <Td align="right">{f.co2eFactor.toString()}</Td>
                  <Td>{f.unit}</Td>
                </tr>
              ))}
            </DataTable>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Factors in this set ({set._count.factors}) — by category</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {categoryCounts.map((c) => (
              <Link
                key={c.category}
                href={`/factors/${id}?category=${encodeURIComponent(c.category)}`}
                className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
              >
                <span className="text-slate-700" title={c.category}>
                  {factorCategoryLabel(c.category)}
                </span>
                <span className="flex items-center gap-2 text-slate-500">
                  {c.count} factor{c.count === 1 ? "" : "s"}
                  <ChevronRight className="h-3.5 w-3.5 text-brand-700" aria-hidden="true" />
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

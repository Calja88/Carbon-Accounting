import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdminSession } from "@/lib/admin";
import { getFactorSetDetail, getFactorSetCategoryCounts, getFactorSetCategoryRows } from "@/lib/factor-sets-service";
import { factorCategoryLabel } from "@/lib/factor-categories";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
    <div className="max-w-3xl">
      <Link href="/admin/factors" className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" />
        All factor sets
      </Link>

      <div className="mt-3 flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{set.name}</h1>
        {set.isPlaceholder && <Badge tone="warning">Placeholder — not verified</Badge>}
      </div>

      <Card className="mt-4">
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
        <Card className="mt-4">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                {factorCategoryLabel(category!)} ({rows.length})
              </CardTitle>
              <Link href={`/admin/factors/${id}`} className="text-sm font-medium text-blue-700 hover:text-blue-800">
                ← All categories
              </Link>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pb-2 font-medium">Subtype</th>
                  <th className="pb-2 font-medium">Basis</th>
                  <th className="pb-2 font-medium">Region</th>
                  <th className="pb-2 text-right font-medium">Factor</th>
                  <th className="pb-2 font-medium">Unit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 text-slate-500">{f.subtypeKey ?? "—"}</td>
                    <td className="py-1.5 text-slate-500">{f.basis}</td>
                    <td className="py-1.5 text-slate-500">{f.region}</td>
                    <td className="py-1.5 text-right text-slate-900">{f.co2eFactor.toString()}</td>
                    <td className="py-1.5 text-slate-500">{f.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Factors in this set ({set._count.factors}) — by category</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {categoryCounts.map((c) => (
              <Link
                key={c.category}
                href={`/admin/factors/${id}?category=${encodeURIComponent(c.category)}`}
                className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
              >
                <span className="text-slate-700" title={c.category}>
                  {factorCategoryLabel(c.category)}
                </span>
                <span className="flex items-center gap-2 text-slate-500">
                  {c.count} factor{c.count === 1 ? "" : "s"}
                  <ArrowLeft className="h-3.5 w-3.5 rotate-180 text-blue-700" />
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

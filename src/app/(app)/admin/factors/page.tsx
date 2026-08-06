import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/admin";
import { listFactorSets } from "@/lib/factor-sets-service";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SOURCE_TYPE_LABELS: Record<string, string> = {
  OFFICIAL_DEFRA_DESNZ: "Official (DEFRA/DESNZ)",
  EEIO_SPEND_BASED: "EEIO spend-based",
  SUPPLIER_SPECIFIC: "Supplier-specific",
};

export default async function AdminFactorsPage() {
  const session = await requireAdminSession();
  if (!session) redirect("/");

  const sets = await listFactorSets();

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Emission factors</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every emission factor used anywhere in this platform is loaded here — never hand-entered or guessed. A
            new import always creates a new, versioned set; nothing is ever edited in place.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/api/admin/factor-template.csv">
            <Button variant="secondary">Download CSV template</Button>
          </a>
          <Link href="/admin/factors/upload">
            <Button>Import factors</Button>
          </Link>
        </div>
      </div>

      <div className="mt-6 space-y-2">
        {sets.length === 0 && (
          <p className="text-sm text-slate-500">
            No factor sets imported yet. Scope 1/2 currently runs on the seeded placeholder set only — Scope 3 has no
            factors at all until one is imported.
          </p>
        )}
        {sets.map((s) => (
          <Link key={s.id} href={`/admin/factors/${s.id}`}>
            <Card className="transition-shadow hover:shadow-md">
              <CardContent className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{s.name}</span>
                    {s.isPlaceholder && <Badge tone="warning">Placeholder — not verified</Badge>}
                  </div>
                  <div className="text-sm text-slate-500">
                    {SOURCE_TYPE_LABELS[s.sourceType] ?? s.sourceType}
                    {s.supplierName ? ` — ${s.supplierName}` : ""} · {s.publisher} · vintage {s.vintageYear} ·{" "}
                    {s._count.factors} factor{s._count.factors === 1 ? "" : "s"}
                  </div>
                  <div className="text-xs text-slate-400">
                    Effective from {new Date(s.effectiveFrom).toLocaleDateString("en-GB")}
                    {s.effectiveTo ? ` to ${new Date(s.effectiveTo).toLocaleDateString("en-GB")}` : " — current"}
                    {s.importedBy ? ` · imported by ${s.importedBy.name}` : ""}
                  </div>
                </div>
                <span className="text-sm font-medium text-emerald-700">View →</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

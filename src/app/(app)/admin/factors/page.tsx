import Link from "next/link";
import { redirect } from "next/navigation";
import { Database, ArrowRight, Download, Upload } from "lucide-react";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { requirePermission, PermissionDeniedError } from "@/lib/rbac/authorize";
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
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "carbon.factor.view");
  } catch (err) {
    if (err instanceof OrganisationAccessError || err instanceof PermissionDeniedError) redirect("/");
    throw err;
  }

  const sets = await listFactorSets(context);

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Emission factors</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every emission factor used anywhere in this platform is loaded here — never hand-entered or guessed. A
            new import always creates a new, versioned set; nothing is ever edited in place.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a href="/api/admin/factor-template.csv">
            <Button variant="secondary">
              <Download className="h-4 w-4" />
              CSV template
            </Button>
          </a>
          <Link href="/admin/factors/upload">
            <Button>
              <Upload className="h-4 w-4" />
              Import factors
            </Button>
          </Link>
        </div>
      </div>

      <div className="space-y-2">
        {sets.length === 0 && (
          <p className="text-sm text-slate-500">
            No factor sets imported yet. Scope 1/2 currently runs on the seeded placeholder set only — Scope 3 has no
            factors at all until one is imported.
          </p>
        )}
        {sets.map((s) => (
          <Link key={s.id} href={`/admin/factors/${s.id}`}>
            <Card className="transition-all hover:-translate-y-0.5 hover:shadow-md">
              <CardContent className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                    <Database className="h-4 w-4" />
                  </span>
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
                </div>
                <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-blue-700">
                  View
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

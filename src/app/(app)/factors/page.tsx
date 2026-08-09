import Link from "next/link";
import { redirect } from "next/navigation";
import { Database, Download, Upload } from "lucide-react";
import { requireAdminSession } from "@/lib/admin";
import { listFactorSets } from "@/lib/factor-sets-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, Td } from "@/components/ui/data-table";
import { RecordList } from "@/components/ui/record-list";

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
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Emission factors</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
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
          <Link href="/factors/upload">
            <Button>
              <Upload className="h-4 w-4" />
              Import factors
            </Button>
          </Link>
        </div>
      </div>

      <RecordList
        state={sets.length === 0 ? "empty" : "ready"}
        emptyTitle="No factor sets imported yet"
        emptyDescription="Scope 1/2 currently runs on the seeded placeholder set only — Scope 3 has no factors at all until one is imported."
      >
        <div className="rounded-lg border border-slate-200 bg-white">
          <DataTable
            caption="Emission factor sets"
            headers={["Set", "Source type", "Publisher", "Vintage", { label: "Factors", align: "right" }, "Effective"]}
          >
            {sets.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <Td>
                  <Link href={`/factors/${s.id}`} className="flex items-center gap-2 font-medium text-slate-900 hover:text-brand-700">
                    <Database className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    {s.name}
                  </Link>
                  {s.isPlaceholder && (
                    <Badge tone="warning" className="mt-1">
                      Placeholder — not verified
                    </Badge>
                  )}
                </Td>
                <Td>
                  {SOURCE_TYPE_LABELS[s.sourceType] ?? s.sourceType}
                  {s.supplierName && <div className="text-xs text-slate-500">{s.supplierName}</div>}
                </Td>
                <Td>{s.publisher}</Td>
                <Td>{s.vintageYear}</Td>
                <Td align="right">{s._count.factors}</Td>
                <Td>
                  <div>
                    {new Date(s.effectiveFrom).toLocaleDateString("en-GB")}
                    {s.effectiveTo ? ` – ${new Date(s.effectiveTo).toLocaleDateString("en-GB")}` : " – current"}
                  </div>
                  {s.importedBy && <div className="text-xs text-slate-400">imported by {s.importedBy.name}</div>}
                </Td>
              </tr>
            ))}
          </DataTable>
        </div>
      </RecordList>
    </div>
  );
}

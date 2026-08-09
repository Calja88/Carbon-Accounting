import Link from "next/link";
import { notFound } from "next/navigation";
import { Factory, Upload, Zap, ShoppingBag } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSiteContractStatus, getSiteQuantityStatus } from "@/lib/entry-status";
import { DataTable, Td } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";

// Plain-language section groupings — no "Scope 1 / Scope 2" jargon on the
// data-entry surface itself (that framing lives behind the "Why are we
// asking this?" tooltip on each item instead).
const SECTIONS: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  SCOPE_1: { label: "Facilities, vehicles & refrigerants", icon: Factory },
  SCOPE_2: { label: "Electricity & purchased energy", icon: Zap },
  SCOPE_3: { label: "Purchased goods, travel & commuting", icon: ShoppingBag },
};

export default async function SiteEntryPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const site = await prisma.site.findUnique({ where: { id: siteId }, include: { entity: true } });
  if (!site) notFound();

  const [statuses, contract] = await Promise.all([getSiteQuantityStatus(siteId), getSiteContractStatus(siteId)]);

  const bySection = statuses.reduce<Record<string, typeof statuses>>((acc, s) => {
    (acc[s.dataPoint.scope] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <div>
        <Breadcrumbs items={[{ label: "Enter data", href: "/data/entry" }, { label: site.name }]} />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{site.name}</h1>
        <p className="text-sm text-slate-500">{site.entity.name}</p>
      </div>

      {Object.entries(bySection).map(([scope, items]) => {
        const section = SECTIONS[scope] ?? { label: scope, icon: Factory };
        const Icon = section.icon;
        return (
          <div key={scope}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {section.label}
            </h2>
            <div className="rounded-lg border border-slate-200 bg-white">
              <DataTable
                caption={`${section.label} data points for ${site.name}`}
                headers={["Data point", "Period", "Status", { label: "", align: "right" }]}
              >
                {items.map(({ dataPoint, status, periodLabel }) => (
                  <tr key={dataPoint.id} className="hover:bg-slate-50">
                    <Td className="font-medium text-slate-900">{dataPoint.dataPointName}</Td>
                    <Td>{periodLabel}</Td>
                    <Td>
                      <StatusBadge domain="entry" status={status} />
                    </Td>
                    <Td align="right">
                      <div className="flex flex-wrap items-center justify-end gap-3">
                        {/* Cat 6 business travel is bulk-loaded from ExpenseIn — see
                            src/lib/expensein-import.ts — so offer that alongside manual entry. */}
                        {dataPoint.code === "S3-06" && (
                          <Link
                            href={`/data/entry/${siteId}/business-travel-import`}
                            className="flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800"
                          >
                            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                            Import from ExpenseIn
                          </Link>
                        )}
                        <Link
                          href={`/data/entry/${siteId}/${dataPoint.code}`}
                          className="text-sm font-medium text-brand-700 hover:text-brand-800"
                        >
                          {status === "missing" || status === "log" ? "Enter data" : "View / update"}
                        </Link>
                      </div>
                    </Td>
                  </tr>
                ))}

                {scope === "SCOPE_2" && (
                  <tr className="hover:bg-slate-50">
                    <Td className="font-medium text-slate-900">Electricity supplier & REGO certificates</Td>
                    <Td>{contract ? `On file: ${contract.supplierName}` : "—"}</Td>
                    <Td>
                      <StatusBadge domain="entry" status={contract ? "submitted" : "missing"} />
                    </Td>
                    <Td align="right">
                      <Link
                        href={`/data/entry/${siteId}/electricity-contract`}
                        className="text-sm font-medium text-brand-700 hover:text-brand-800"
                      >
                        {contract ? "View / update" : "Enter details"}
                      </Link>
                    </Td>
                  </tr>
                )}
              </DataTable>
            </div>
          </div>
        );
      })}
    </div>
  );
}

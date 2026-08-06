import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSiteContractStatus, getSiteQuantityStatus } from "@/lib/entry-status";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STATUS_BADGE: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "danger" }> = {
  submitted: { label: "Submitted", tone: "success" },
  flagged: { label: "Flagged for review", tone: "warning" },
  missing: { label: "Not yet submitted", tone: "neutral" },
  log: { label: "Log as needed", tone: "neutral" },
};

// Plain-language section groupings — no "Scope 1 / Scope 2" jargon on the
// data-entry surface itself (that framing lives behind the "Why are we
// asking this?" tooltip on each item instead).
const SECTION_LABELS: Record<string, string> = {
  SCOPE_1: "Facilities, vehicles & refrigerants",
  SCOPE_2: "Electricity & purchased energy",
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
    <div>
      <Link href="/entry" className="text-sm text-emerald-700 hover:underline">
        ← All sites
      </Link>
      <h1 className="mt-2 text-lg font-semibold text-slate-900">{site.name}</h1>
      <p className="text-sm text-slate-500">{site.entity.name}</p>

      {Object.entries(bySection).map(([scope, items]) => (
        <div key={scope} className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {SECTION_LABELS[scope] ?? scope}
          </h2>
          <div className="space-y-2">
            {items.map(({ dataPoint, status, periodLabel }) => (
              <Card key={dataPoint.id}>
                <CardContent className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-900">{dataPoint.dataPointName}</div>
                    <div className="text-sm text-slate-500">{periodLabel}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={STATUS_BADGE[status].tone}>{STATUS_BADGE[status].label}</Badge>
                    <Link
                      href={`/entry/${siteId}/${dataPoint.code}`}
                      className="text-sm font-medium text-emerald-700 hover:underline"
                    >
                      {status === "missing" || status === "log" ? "Enter data" : "View / update"}
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}

            {scope === "SCOPE_2" && (
              <Card>
                <CardContent className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-900">Electricity supplier & REGO certificates</div>
                    <div className="text-sm text-slate-500">
                      {contract ? `On file: ${contract.supplierName}` : "Not yet on file"}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={contract ? "success" : "neutral"}>{contract ? "On file" : "Not yet submitted"}</Badge>
                    <Link
                      href={`/entry/${siteId}/electricity-contract`}
                      className="text-sm font-medium text-emerald-700 hover:underline"
                    >
                      {contract ? "View / update" : "Enter details"}
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

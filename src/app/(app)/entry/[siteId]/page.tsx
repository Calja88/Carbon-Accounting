import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Factory, Lock, Upload, Zap, ShoppingBag } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSiteContractStatus, getSiteQuantityStatus } from "@/lib/entry-status";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { requireSiteInScope } from "@/lib/repositories/carbon-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { hasPermission } from "@/lib/rbac/authorize";
import { getReportingPeriod } from "@/lib/carbon/reporting-period-service";
import { formatMonthLabel } from "@/lib/carbon/reporting-period-view";

const STATUS_BADGE: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "danger" }> = {
  submitted: { label: "Submitted", tone: "success" },
  flagged: { label: "Flagged for review", tone: "warning" },
  missing: { label: "Not yet submitted", tone: "neutral" },
  log: { label: "Log as needed", tone: "neutral" },
  awaiting_factor: { label: "Saved — awaiting emission factor", tone: "warning" },
};

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

  let context;
  try {
    context = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    throw err;
  }

  let site;
  try {
    site = await requireSiteInScope(context, siteId);
  } catch (err) {
    if (err instanceof TenantOwnershipError) notFound();
    throw err;
  }
  const entity = await prisma.entity.findUnique({ where: { id: site.entityId } });
  if (!entity) notFound();

  const [statuses, contract] = await Promise.all([
    getSiteQuantityStatus(context, siteId),
    getSiteContractStatus(context, siteId),
  ]);

  // The month the entry forms default to. Saying up front that it is closed
  // beats letting somebody fill a form the server is bound to refuse — the
  // refusal itself still comes from the barrier, not from this check.
  const now = new Date();
  const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const period = hasPermission(context, "carbon.view")
    ? await getReportingPeriod(context, siteId, currentMonth)
    : null;

  const bySection = statuses.reduce<Record<string, typeof statuses>>((acc, s) => {
    (acc[s.dataPoint.scope] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <div>
        <Link href="/entry" className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-3.5 w-3.5" />
          All sites
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{site.name}</h1>
        <p className="text-sm text-slate-500">{entity.name}</p>
      </div>

      {period?.state === "CLOSED" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4" role="status">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-amber-800" />
            <h2 className="text-sm font-semibold text-amber-900">
              {formatMonthLabel(currentMonth)} is closed — read only
            </h2>
          </div>
          <p className="mt-1 text-sm text-amber-800">
            Activity data for {formatMonthLabel(currentMonth)} at this site can be viewed but not added, changed or
            deleted. Other months are unaffected. Reopen the period on{" "}
            <Link href={`/data?siteId=${siteId}`} className="font-medium underline">
              Data Collection
            </Link>{" "}
            before making accounting changes to this month.
          </p>
        </div>
      )}

      {Object.entries(bySection).map(([scope, items]) => {
        const section = SECTIONS[scope] ?? { label: scope, icon: Factory };
        const Icon = section.icon;
        return (
          <div key={scope}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              <Icon className="h-4 w-4" />
              {section.label}
            </h2>
            <div className="space-y-2">
              {items.map(({ dataPoint, status, periodLabel }) => (
                <Card key={dataPoint.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-900">{dataPoint.dataPointName}</div>
                      <div className="text-sm text-slate-500">{periodLabel}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge tone={STATUS_BADGE[status].tone}>{STATUS_BADGE[status].label}</Badge>
                      {/* Cat 6 business travel is bulk-loaded from ExpenseIn — see
                          src/lib/expensein-import.ts — so offer that alongside manual entry. */}
                      {dataPoint.code === "S3-06" && (
                        <Link
                          href={`/entry/${siteId}/business-travel-import`}
                          className="flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-800"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          Import from ExpenseIn
                        </Link>
                      )}
                      <Link
                        href={`/entry/${siteId}/${dataPoint.code}`}
                        className="text-sm font-medium text-blue-700 hover:text-blue-800"
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
                        className="text-sm font-medium text-blue-700 hover:text-blue-800"
                      >
                        {contract ? "View / update" : "Enter details"}
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

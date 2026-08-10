import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSiteContractStatus } from "@/lib/entry-status";
import { resolvePrompt } from "@/lib/prompts";
import { ContractForm } from "./contract-form";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { requireSiteInScope } from "@/lib/repositories/carbon-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";

export default async function ElectricityContractPage({ params }: { params: Promise<{ siteId: string }> }) {
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

  const [supplierDp, regoDp, contract] = await Promise.all([
    prisma.activityDataPoint.findUnique({ where: { code: "S2-02" } }),
    prisma.activityDataPoint.findUnique({ where: { code: "S2-03" } }),
    getSiteContractStatus(context, siteId),
  ]);

  if (!supplierDp || !regoDp) notFound();

  const tokenValues = { siteName: site.name, periodStart: new Date(), frequency: supplierDp.frequency };

  return (
    <div>
      <Link href={`/entry/${siteId}`} className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" />
        {site.name}
      </Link>
      <div className="mt-4">
        <ContractForm
          site={{ id: site.id, name: site.name }}
          supplierPrompt={resolvePrompt(supplierDp.promptTemplate, tokenValues)}
          regoPrompt={resolvePrompt(regoDp.promptTemplate, tokenValues)}
          existing={
            contract
              ? {
                  supplierName: contract.supplierName,
                  tariffType: contract.tariffType,
                  regoBacked: contract.regoBacked,
                  regoVolumeKwh: contract.regoVolumeKwh?.toString() ?? null,
                }
              : null
          }
        />
      </div>
    </div>
  );
}

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSiteContractStatus } from "@/lib/entry-status";
import { resolvePrompt } from "@/lib/prompts";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { ContractForm } from "./contract-form";

export default async function ElectricityContractPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;

  const [site, supplierDp, regoDp, contract] = await Promise.all([
    prisma.site.findUnique({ where: { id: siteId } }),
    prisma.activityDataPoint.findUnique({ where: { code: "S2-02" } }),
    prisma.activityDataPoint.findUnique({ where: { code: "S2-03" } }),
    getSiteContractStatus(siteId),
  ]);

  if (!site || !supplierDp || !regoDp) notFound();

  const tokenValues = { siteName: site.name, periodStart: new Date(), frequency: supplierDp.frequency };

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Enter data", href: "/data/entry" },
          { label: site.name, href: `/data/entry/${siteId}` },
          { label: "Electricity supplier & REGO" },
        ]}
      />
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

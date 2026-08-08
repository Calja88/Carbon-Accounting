import { prisma } from "@/lib/prisma";
import { listSuppliers, listSupplierPcfs, pcfPerUnit } from "@/lib/lca/supplier-service";
import { canManageSuppliers, getLcaActor } from "@/lib/lca/permissions";
import { BOUNDARY_LABELS, PCF_VERIFICATION_LABELS } from "@/lib/lca/labels";
import { Badge } from "@/components/ui/badge";
import { DataTable, EmptyState, Notice, PageHeading, SectionCard, Td } from "@/components/lca/ui";
import { CreateSupplierForm, PactImportForm, SupplierPcfForm } from "./supplier-forms";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const [suppliers, pcfs, entities, actor] = await Promise.all([
    listSuppliers(),
    listSupplierPcfs(),
    prisma.entity.findMany({ orderBy: { name: "asc" } }),
    getLcaActor(),
  ]);

  const canEdit = canManageSuppliers(actor);

  // Where a product-side supplier matches a corporate supplier-specific factor
  // set or corporate activity entries, surface it — without merging any figures.
  const corporateSupplierNames = await prisma.emissionFactorSet.findMany({
    where: { sourceType: "SUPPLIER_SPECIFIC" },
    select: { supplierName: true },
  });
  const corporateNames = new Set(
    corporateSupplierNames.map((s) => (s.supplierName ?? "").toLowerCase()).filter(Boolean),
  );

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Product carbon footprints"
        title="Suppliers and supplier footprints"
        description="A supplier's own measured figure for the thing you actually bought is the best input a product assessment can have. These records hold them with everything that makes one usable — declared unit, boundary, methodology, period and verification status."
        actions={
          canEdit ? (
            <div className="flex flex-wrap gap-2">
              <PactImportForm
                entities={entities.map((e) => ({ id: e.id, name: e.name }))}
                suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
              />
              <CreateSupplierForm entities={entities.map((e) => ({ id: e.id, name: e.name }))} />
            </div>
          ) : null
        }
      />

      <SectionCard
        title="Supplier product footprints"
        description="Any of these can replace a generic secondary factor on an inventory line whose unit is compatible with the declared unit."
        actions={
          canEdit ? (
            <SupplierPcfForm
              suppliers={suppliers.map((s) => ({ id: s.id, name: s.name, entityId: s.entityId }))}
              defaultEntityId={entities[0]?.id ?? ""}
            />
          ) : null
        }
      >
        {pcfs.length === 0 ? (
          <EmptyState
            title="No supplier footprints recorded"
            description="Record one when a supplier provides a figure, or import a PACT-aligned exchange document. Both routes keep the boundary, methodology, period and verification status alongside the number, because a footprint without those cannot be placed."
          />
        ) : (
          <DataTable
            headers={[
              "Supplier",
              "Their product",
              { label: "Footprint", align: "right" },
              { label: "Per unit", align: "right" },
              "Boundary",
              "Period",
              "Verification",
              { label: "In use", align: "right" },
            ]}
          >
            {pcfs.map((pcf) => (
              <tr key={pcf.id}>
                <Td className="font-medium text-slate-900">
                  {pcf.supplier.name}
                  {corporateNames.has(pcf.supplier.name.toLowerCase()) && (
                    <Badge tone="info" className="ml-2">
                      Also a corporate factor source
                    </Badge>
                  )}
                </Td>
                <Td>
                  {pcf.productName}
                  {pcf.productIdentifier && <span className="mt-0.5 block font-mono text-xs text-slate-500">{pcf.productIdentifier}</span>}
                </Td>
                <Td align="right">
                  {pcf.pcfValue.toString()} kgCO2e
                  <span className="block text-xs text-slate-500">
                    per {pcf.declaredUnitQuantity.toString()} {pcf.declaredUnitUnit}
                  </span>
                </Td>
                <Td align="right">
                  {pcfPerUnit(pcf)} <span className="text-xs text-slate-500">/{pcf.declaredUnitUnit}</span>
                </Td>
                <Td className="text-xs">{BOUNDARY_LABELS[pcf.boundary]}</Td>
                <Td className="text-xs">
                  {pcf.reportingPeriodStart && pcf.reportingPeriodEnd
                    ? `${pcf.reportingPeriodStart.toISOString().slice(0, 7)} to ${pcf.reportingPeriodEnd.toISOString().slice(0, 7)}`
                    : "—"}
                </Td>
                <Td className="text-xs">
                  <Badge
                    tone={
                      pcf.verificationStatus === "THIRD_PARTY_VERIFIED"
                        ? "success"
                        : pcf.verificationStatus === "UNVERIFIED"
                          ? "warning"
                          : "info"
                    }
                  >
                    {PCF_VERIFICATION_LABELS[pcf.verificationStatus]}
                  </Badge>
                  {pcf.sourceFormat && <span className="mt-1 block text-slate-500">{pcf.sourceFormat}</span>}
                </Td>
                <Td align="right">{pcf._count.inventoryItems}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      <SectionCard title="Suppliers" description="Counterparties this organisation buys from.">
        {suppliers.length === 0 ? (
          <EmptyState title="No suppliers yet" description="Add the suppliers whose inputs appear in product assessments." />
        ) : (
          <DataTable
            headers={["Supplier", "Identifier", "Country", "Operating unit", { label: "Footprints held", align: "right" }, { label: "Lines using them", align: "right" }]}
          >
            {suppliers.map((supplier) => (
              <tr key={supplier.id}>
                <Td className="font-medium text-slate-900">{supplier.name}</Td>
                <Td className="font-mono text-xs">{supplier.identifier ?? "—"}</Td>
                <Td>{supplier.country ?? "—"}</Td>
                <Td>{supplier.entity.name}</Td>
                <Td align="right">{supplier._count.productPcfs}</Td>
                <Td align="right">{supplier._count.inventoryItems}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      <Notice tone="info" title="How supplier data relates to the corporate inventory">
        The corporate side of this platform already recognises supplier-specific emission factor sets for Scope 3
        reporting. A supplier here with the same name is flagged above, so the two views of one counterparty can be seen
        together. The figures themselves stay separate: a product footprint is an intensity figure for one product, a
        corporate inventory is an absolute figure for the organisation, and the platform never adds one to the other.
      </Notice>
    </div>
  );
}

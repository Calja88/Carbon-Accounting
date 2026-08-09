import Link from "next/link";
import { notFound } from "next/navigation";
import { Factory, Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getProduct } from "@/lib/lca/assessment-service";
import { canEditLcaData, getLcaActor } from "@/lib/lca/permissions";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { BackLink, DataTable, EmptyState, PageHeading, SectionCard, StatusBadge, Td } from "@/components/lca/ui";
import { AddLocationForm, AddVersionForm, EditProductForm } from "../product-forms";
import { deleteManufacturingLocationAction } from "../actions";
import { NewAssessmentForm } from "../../assessments/new-assessment-form";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const [product, actor] = await Promise.all([getProduct(productId), getLcaActor()]);
  if (!product) notFound();

  const canEdit = canEditLcaData(actor);
  const [sites, methodologies] = await Promise.all([
    prisma.site.findMany({ where: { isActive: true }, include: { entity: true }, orderBy: [{ entity: { name: "asc" } }, { name: "asc" }] }),
    prisma.lcaMethodologyProfile.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
  ]);

  const allAssessments = product.versions.flatMap((v) => v.assessments.map((a) => ({ ...a, versionLabel: v.versionLabel })));

  return (
    <div className="space-y-6">
      <BackLink href="/products">All products</BackLink>

      <PageHeading
        eyebrow={product.entity.name}
        title={product.name}
        description={
          <>
            <span className="font-mono text-xs">{product.sku}</span>
            {product.category && <span className="ml-2">· {product.category}</span>}
            {product.description && <span className="mt-1 block">{product.description}</span>}
          </>
        }
        actions={
          canEdit ? (
            <NewAssessmentForm
              productVersions={product.versions.map((v) => ({ id: v.id, label: `${product.name} — ${v.versionLabel}`, entityId: product.entityId }))}
              methodologies={methodologies.map((m) => ({ id: m.id, label: `${m.name} ${m.version}`, isDefault: m.isDefault }))}
              defaultEntityId={product.entityId}
            />
          ) : null
        }
      />

      <SectionCard
        title="Assessments"
        description="Each assessment is a product carbon footprint for one version of this product, under one methodology and one boundary."
      >
        {allAssessments.length === 0 ? (
          <EmptyState
            title="No assessments yet"
            description="Start an assessment to define its goal, scope and functional unit, build the lifecycle model, and calculate a footprint."
          />
        ) : (
          <DataTable headers={["Reference", "Assessment", "Version", "Status", "Owner", { label: "Inventory lines", align: "right" }]}>
            {allAssessments.map((assessment) => (
              <tr key={assessment.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs">
                  <Link href={`/assessments/${assessment.id}`} className="text-brand-700 hover:text-brand-800">
                    {assessment.reference}
                  </Link>
                </Td>
                <Td className="font-medium text-slate-900">{assessment.title}</Td>
                <Td>{assessment.versionLabel}</Td>
                <Td>
                  <StatusBadge status={assessment.status} />
                </Td>
                <Td>{assessment.owner?.name ?? <span className="text-slate-400">Unassigned</span>}</Td>
                <Td align="right">{assessment._count.inventoryItems}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      <SectionCard
        title="Versions"
        description="A new version is the right home for a design change. Assessments already issued against an earlier version keep saying what they said."
        actions={canEdit ? <AddVersionForm productId={product.id} /> : null}
      >
        <DataTable headers={["Version", "What changed", "Effective from", { label: "Assessments", align: "right" }]}>
          {product.versions.map((version) => (
            <tr key={version.id}>
              <Td className="font-medium text-slate-900">{version.versionLabel}</Td>
              <Td>{version.description ?? <span className="text-slate-400">—</span>}</Td>
              <Td>{version.effectiveFrom ? version.effectiveFrom.toISOString().slice(0, 10) : <span className="text-slate-400">—</span>}</Td>
              <Td align="right">{version.assessments.length}</Td>
            </tr>
          ))}
        </DataTable>
      </SectionCard>

      <SectionCard
        title="Manufacturing locations"
        description="Where each version is made. A location linked to one of our own sites lets an assessment cite that site's corporate energy records as its data source."
        actions={
          canEdit ? (
            <AddLocationForm
              productId={product.id}
              versions={product.versions.map((v) => ({ id: v.id, versionLabel: v.versionLabel }))}
              sites={sites.map((s) => ({ id: s.id, name: s.name, entityName: s.entity.name }))}
            />
          ) : null
        }
      >
        {product.versions.every((v) => v.manufacturingLocations.length === 0) ? (
          <EmptyState
            title="No manufacturing locations recorded"
            description="Recording where a product is made lets the platform check a factor's geography against the real one, and lets manufacturing data be traced to a site."
          />
        ) : (
          <DataTable headers={["Version", "Location", "Country", "Internal site", "Primary", ""]}>
            {product.versions.flatMap((version) =>
              version.manufacturingLocations.map((location) => (
                <tr key={location.id}>
                  <Td>{version.versionLabel}</Td>
                  <Td className="font-medium text-slate-900">
                    <span className="flex items-center gap-1.5">
                      <Factory className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                      {location.name}
                    </span>
                  </Td>
                  <Td>{location.country ?? <span className="text-slate-400">—</span>}</Td>
                  <Td>{location.site ? location.site.name : <span className="text-slate-400">External</span>}</Td>
                  <Td>{location.isPrimary ? "Yes" : "—"}</Td>
                  <Td align="right">
                    {canEdit && (
                      <DestructiveActionDialog
                        triggerLabel={`Remove ${location.name}`}
                        triggerIcon={<Trash2 className="h-3.5 w-3.5" />}
                        title={`Remove "${location.name}"?`}
                        description="This manufacturing location will no longer be recorded against this product. This cannot be undone."
                        confirmLabel="Remove"
                        formAction={deleteManufacturingLocationAction}
                      >
                        <input type="hidden" name="locationId" value={location.id} />
                        <input type="hidden" name="productId" value={product.id} />
                      </DestructiveActionDialog>
                    )}
                  </Td>
                </tr>
              )),
            )}
          </DataTable>
        )}
      </SectionCard>

      {canEdit && (
        <SectionCard title="Product details" description="Identifiers and description used across assessments and exports.">
          <EditProductForm
            product={{
              id: product.id,
              name: product.name,
              sku: product.sku,
              description: product.description,
              category: product.category,
              status: product.status,
              notes: product.notes,
            }}
          />
        </SectionCard>
      )}
    </div>
  );
}

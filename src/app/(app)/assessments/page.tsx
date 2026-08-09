import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { listAssessments } from "@/lib/lca/assessment-service";
import { canEditLcaData, getLcaActor } from "@/lib/lca/permissions";
import { formatKgPrecise } from "@/components/charts/palette";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, EmptyState, PageHeading, StatusBadge, Td } from "@/components/lca/ui";
import { BOUNDARY_LABELS } from "@/lib/lca/labels";
import { NewAssessmentForm } from "./new-assessment-form";

export const dynamic = "force-dynamic";

export default async function AssessmentsPage() {
  const [assessments, actor, productVersions, methodologies] = await Promise.all([
    listAssessments(),
    getLcaActor(),
    prisma.productVersion.findMany({
      include: { product: { include: { entity: true } } },
      orderBy: [{ product: { name: "asc" } }, { versionLabel: "asc" }],
    }),
    prisma.lcaMethodologyProfile.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
  ]);

  const canEdit = canEditLcaData(actor);

  // The headline figure comes from each assessment's own latest run, so the
  // list can never show a number the assessment page disagrees with.
  const runs = await prisma.lcaCalculationRun.findMany({
    where: { id: { in: assessments.map((a) => a.lastCalculationRunId).filter(Boolean) as string[] } },
    select: { id: true, totals: true, runAt: true },
  });
  const runById = new Map(runs.map((r) => [r.id, r]));

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Product carbon footprints"
        title="Assessments"
        description="Every product life cycle assessment, with its current status and latest calculated footprint. Scenarios are held against their baseline assessment rather than listed here."
        actions={
          canEdit ? (
            <NewAssessmentForm
              productVersions={productVersions.map((v) => ({
                id: v.id,
                label: `${v.product.name} — ${v.versionLabel} (${v.product.entity.name})`,
                entityId: v.product.entityId,
              }))}
              methodologies={methodologies.map((m) => ({ id: m.id, label: `${m.name} ${m.version}`, isDefault: m.isDefault }))}
            />
          ) : null
        }
      />

      <Card>
        <CardContent className="p-0">
          {assessments.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No assessments yet"
                description={
                  productVersions.length === 0
                    ? "Add a product first — an assessment is always attached to a specific version of a product."
                    : "Start an assessment to define its goal, scope and functional unit, build the lifecycle model, and calculate a footprint."
                }
                action={
                  productVersions.length === 0 ? (
                    <Link href="/products" className="text-sm font-medium text-brand-700 hover:text-brand-800">
                      Go to products →
                    </Link>
                  ) : null
                }
              />
            </div>
          ) : (
            <DataTable
              headers={[
                "Reference",
                "Assessment",
                "Product",
                "Boundary",
                "Status",
                { label: "Per functional unit", align: "right" },
                "Owner",
              ]}
            >
              {assessments.map((assessment) => {
                const run = assessment.lastCalculationRunId ? runById.get(assessment.lastCalculationRunId) : null;
                const totals = run?.totals as { headlinePerFunctionalUnitKgCo2e?: number } | undefined;

                return (
                  <tr key={assessment.id} className="hover:bg-slate-50">
                    <Td className="font-mono text-xs">
                      <Link href={`/assessments/${assessment.id}`} className="text-brand-700 hover:text-brand-800">
                        {assessment.reference}
                      </Link>
                    </Td>
                    <Td className="font-medium text-slate-900">
                      {assessment.title}
                      <span className="mt-0.5 block text-xs font-normal text-slate-500">
                        {assessment._count.processes} process(es) · {assessment._count.inventoryItems} inventory line(s)
                      </span>
                    </Td>
                    <Td>
                      <Link href={`/products/${assessment.productVersion.productId}`} className="hover:text-brand-700">
                        {assessment.productVersion.product.name}
                      </Link>
                      <span className="mt-0.5 block text-xs text-slate-500">{assessment.productVersion.versionLabel}</span>
                    </Td>
                    <Td>{BOUNDARY_LABELS[assessment.boundary]}</Td>
                    <Td>
                      <StatusBadge status={assessment.status} />
                    </Td>
                    <Td align="right">
                      {totals?.headlinePerFunctionalUnitKgCo2e !== undefined ? (
                        <>
                          {formatKgPrecise(totals.headlinePerFunctionalUnitKgCo2e)}
                          <span className="ml-1 text-xs text-slate-500">kgCO2e</span>
                        </>
                      ) : (
                        <span className="text-slate-400">Not calculated</span>
                      )}
                    </Td>
                    <Td>{assessment.owner?.name ?? <span className="text-slate-400">Unassigned</span>}</Td>
                  </tr>
                );
              })}
            </DataTable>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

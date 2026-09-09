import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { listVersions } from "@/lib/lca/assessment-service";
import { canApproveLca, getLcaContext } from "@/lib/lca/permissions";
import { requireAssessmentInScope } from "@/lib/repositories/lca-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { formatKgPrecise } from "@/components/charts/palette";
import { Badge } from "@/components/ui/badge";
import { DataTable, EmptyState, Notice, PageHeading, SectionCard, Td } from "@/components/lca/ui";
import { CreateRevisionForm } from "./revision-form";

export const dynamic = "force-dynamic";

interface FrozenPayloadSummary {
  calculation?: { totals?: { headlinePerFunctionalUnitKgCo2e?: number } } | null;
  validation?: { errorCount?: number; warningCount?: number };
  readiness?: { overall?: string };
}

export default async function VersionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getLcaContext();
  if (!context) notFound();
  try {
    await requireAssessmentInScope(context, id);
  } catch (err) {
    if (err instanceof TenantOwnershipError || err instanceof PermissionDeniedError) notFound();
    throw err;
  }

  const [assessment, versions, revisions] = await Promise.all([
    prisma.lcaAssessment.findUnique({
      where: { id },
      include: { supersededBy: true, parentAssessment: true, revisions: true },
    }),
    listVersions(context, id),
    prisma.lcaAssessment.findMany({
      where: { parentAssessmentId: id },
      select: { id: true, reference: true, title: true, status: true, version: true },
    }),
  ]);
  if (!assessment) notFound();

  const canApprove = canApproveLca(context);
  const suggestedReference = `${assessment.reference.replace(/-R\d+$/, "")}-R${assessment.version + 1}`;

  return (
    <div className="space-y-6">
      <PageHeading
        title="Versions"
        description="Issued versions are frozen copies of the whole assessment. They never change: a later correction is a new revision, so anything already disclosed can still be reproduced exactly."
        actions={
          canApprove && assessment.status !== "SUPERSEDED" ? (
            <CreateRevisionForm assessmentId={id} suggestedReference={suggestedReference} currentTitle={assessment.title} />
          ) : null
        }
      />

      {assessment.parentAssessment && (
        <Notice tone="info" title="This is a revision">
          Created from{" "}
          <Link href={`/assessments/${assessment.parentAssessment.id}`} className="font-medium underline">
            {assessment.parentAssessment.reference}
          </Link>
          , which has been marked superseded.
        </Notice>
      )}

      {assessment.supersededBy && (
        <Notice tone="warning" title="Superseded">
          Replaced by{" "}
          <Link href={`/assessments/${assessment.supersededBy.id}`} className="font-medium underline">
            {assessment.supersededBy.reference} {assessment.supersededBy.title}
          </Link>
          . This assessment is read-only and stays available so anything issued from it can still be traced.
        </Notice>
      )}

      <SectionCard title="Issued versions" description="Each carries a complete frozen payload — model, inventory, factor snapshots, results, registers, validation and readiness.">
        {versions.length === 0 ? (
          <EmptyState
            title="No versions issued"
            description="Issue a version from the review page once the assessment is complete. Everything is frozen at that moment, so a figure someone has seen can never move underneath them."
          />
        ) : (
          <DataTable
            headers={["Version", "Label", "Status", { label: "Headline", align: "right" }, "Validation at issue", "Readiness at issue", "Issued", ""]}
          >
            {versions.map((version) => {
              const payload = version.payload as unknown as FrozenPayloadSummary;
              const headline = payload?.calculation?.totals?.headlinePerFunctionalUnitKgCo2e;
              return (
                <tr key={version.id}>
                  <Td className="font-medium text-slate-900">Version {version.version}</Td>
                  <Td>{version.label ?? <span className="text-slate-400">—</span>}</Td>
                  <Td>
                    <Badge tone={version.status === "ISSUED" ? "success" : "neutral"}>
                      {version.status.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                  </Td>
                  <Td align="right">
                    {headline !== undefined ? `${formatKgPrecise(headline)} kgCO2e` : <span className="text-slate-400">—</span>}
                  </Td>
                  <Td className="text-xs">
                    {payload?.validation
                      ? `${payload.validation.errorCount ?? 0} error(s), ${payload.validation.warningCount ?? 0} warning(s)`
                      : "—"}
                  </Td>
                  <Td className="text-xs">{payload?.readiness?.overall?.replace(/_/g, " ").toLowerCase() ?? "—"}</Td>
                  <Td className="text-xs">
                    {version.issuedAt ? version.issuedAt.toISOString().slice(0, 10) : "—"}
                    {version.issuedBy && <span className="block text-slate-500">{version.issuedBy.name}</span>}
                  </Td>
                  <Td align="right">
                    <Link
                      href={`/assessments/${id}/versions/${version.id}`}
                      className="text-xs font-medium text-blue-700 hover:text-blue-800"
                    >
                      Open
                    </Link>
                  </Td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </SectionCard>

      {revisions.length > 0 && (
        <SectionCard title="Revisions created from this assessment" description="Each revision is a separate assessment with its own lifecycle.">
          <DataTable headers={["Reference", "Title", "Version", "Status"]}>
            {revisions.map((revision) => (
              <tr key={revision.id}>
                <Td className="font-mono text-xs">
                  <Link href={`/assessments/${revision.id}`} className="text-blue-700 hover:text-blue-800">
                    {revision.reference}
                  </Link>
                </Td>
                <Td>{revision.title}</Td>
                <Td>{revision.version}</Td>
                <Td className="text-xs">{revision.status.replace(/_/g, " ").toLowerCase()}</Td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
      )}
    </div>
  );
}

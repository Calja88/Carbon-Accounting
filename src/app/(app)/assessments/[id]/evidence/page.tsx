import { notFound } from "next/navigation";
import { Download, ExternalLink, Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  activeEvidenceStorageProvider,
  formatBytes,
  listEvidence,
  MAX_EVIDENCE_BYTES,
} from "@/lib/lca/evidence-service";
import { checkCanEditAssessment, getLcaContext } from "@/lib/lca/permissions";
import { requireAssessmentInScope } from "@/lib/repositories/lca-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState, Notice, PageHeading, SectionCard, Td } from "@/components/lca/ui";
import { EvidenceForm } from "./evidence-form";
import { deleteEvidenceAction } from "./actions";

export const dynamic = "force-dynamic";

function targetLabel(evidence: Awaited<ReturnType<typeof listEvidence>>[number]): string {
  if (evidence.inventoryItem) return `Inventory line: ${evidence.inventoryItem.name}`;
  if (evidence.process) return `Process: ${evidence.process.name}`;
  if (evidence.supplierPcf) return `Supplier PCF: ${evidence.supplierPcf.productName}`;
  if (evidence.assumption) return `Assumption: ${evidence.assumption.assumption}`;
  if (evidence.exclusion) return `Exclusion: ${evidence.exclusion.excludedItem}`;
  if (evidence.verification) return `Verification: ${evidence.verification.organisation}`;
  return "The assessment as a whole";
}

export default async function EvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getLcaContext();
  if (!context) notFound();

  let assessment;
  try {
    assessment = await requireAssessmentInScope(context, id);
  } catch (err) {
    if (err instanceof TenantOwnershipError || err instanceof PermissionDeniedError) notFound();
    throw err;
  }

  const [evidence, processes, items, assumptions, exclusions, verifications] = await Promise.all([
    listEvidence(id),
    prisma.lcaProcess.findMany({ where: { assessmentId: id }, orderBy: [{ sortOrder: "asc" }], select: { id: true, name: true } }),
    prisma.lcaInventoryItem.findMany({ where: { assessmentId: id }, orderBy: [{ sortOrder: "asc" }], select: { id: true, name: true } }),
    prisma.lcaAssumption.findMany({ where: { assessmentId: id }, select: { id: true, assumption: true } }),
    prisma.lcaExclusion.findMany({ where: { assessmentId: id }, select: { id: true, excludedItem: true } }),
    prisma.lcaVerification.findMany({ where: { assessmentId: id }, select: { id: true, organisation: true, verificationDate: true } }),
  ]);

  const supplierPcfs = await prisma.lcaSupplierPcf.findMany({
    where: { entityId: assessment.entityId },
    include: { supplier: true },
    orderBy: { productName: "asc" },
  });

  const permission = checkCanEditAssessment(context, assessment.status);
  const canEdit = permission.ok;
  const provider = activeEvidenceStorageProvider();

  return (
    <div className="space-y-6">
      <PageHeading
        title="Evidence"
        description="The source documents behind the figures. A reviewer works from these, not from numbers typed into a system."
        actions={
          canEdit ? (
            <EvidenceForm
              assessmentId={id}
              processes={processes}
              items={items}
              assumptions={assumptions.map((a) => ({ id: a.id, label: a.assumption.slice(0, 70) }))}
              exclusions={exclusions.map((e) => ({ id: e.id, label: e.excludedItem.slice(0, 70) }))}
              verifications={verifications.map((v) => ({
                id: v.id,
                label: `${v.organisation} · ${v.verificationDate.toISOString().slice(0, 10)}`,
              }))}
              supplierPcfs={supplierPcfs.map((p) => ({ id: p.id, label: `${p.supplier.name} — ${p.productName}` }))}
              storageProvider={provider.name}
              maxBytes={MAX_EVIDENCE_BYTES}
            />
          ) : null
        }
      />

      {!canEdit && <Notice tone="info">{permission.reason}</Notice>}

      <Notice tone="info" title={`Files are held by the "${provider.name}" storage provider`}>
        No object-storage credentials are configured for this deployment, so uploads are held in the application database
        with a SHA-256 checksum. The storage layer sits behind an interface: pointing it at S3, Azure Blob or Vercel Blob
        later is one provider implementation, not a change to the schema or to any evidence already held. External links
        are supported alongside uploads for evidence that lives in a document management system.
      </Notice>

      <SectionCard title="Evidence library" description={`${evidence.length} item(s) attached to this assessment.`}>
        {evidence.length === 0 ? (
          <EmptyState
            title="No evidence attached"
            description="Attach the meter readings, invoices, bills of materials, supplier declarations and test reports the figures came from, and link each one to the record it supports."
          />
        ) : (
          <DataTable headers={["Title", "Supports", "Kind", { label: "Size", align: "right" }, "Checksum", "Added", ""]}>
            {evidence.map((item) => (
              <tr key={item.id}>
                <Td className="font-medium text-slate-900">
                  {item.title}
                  {item.description && <span className="mt-0.5 block text-xs font-normal text-slate-500">{item.description}</span>}
                </Td>
                <Td className="text-xs">{targetLabel(item)}</Td>
                <Td>
                  {item.kind === "UPLOADED_FILE" ? (
                    <Badge tone="info">{item.fileName ?? "File"}</Badge>
                  ) : (
                    <Badge tone="neutral">Link</Badge>
                  )}
                </Td>
                <Td align="right" className="text-xs">
                  {formatBytes(item.sizeBytes)}
                </Td>
                <Td className="font-mono text-[10px] text-slate-500">
                  {item.checksumSha256 ? `${item.checksumSha256.slice(0, 12)}…` : "—"}
                </Td>
                <Td className="text-xs">
                  {item.uploadedBy?.name}
                  <span className="block text-slate-500">{item.uploadedAt.toISOString().slice(0, 10)}</span>
                </Td>
                <Td align="right">
                  <span className="flex items-center justify-end gap-1">
                    {item.kind === "UPLOADED_FILE" ? (
                      <a href={`/api/lca/evidence/${item.id}`}>
                        <Button variant="ghost" size="sm" aria-label={`Download ${item.title}`}>
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </a>
                    ) : item.externalUrl ? (
                      <a href={item.externalUrl} target="_blank" rel="noreferrer noopener">
                        <Button variant="ghost" size="sm" aria-label={`Open ${item.title}`}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </a>
                    ) : null}
                    {canEdit && (
                      <form action={deleteEvidenceAction}>
                        <input type="hidden" name="assessmentId" value={id} />
                        <input type="hidden" name="evidenceId" value={item.id} />
                        <Button type="submit" variant="ghost" size="sm" aria-label={`Remove ${item.title}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </form>
                    )}
                  </span>
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>
    </div>
  );
}

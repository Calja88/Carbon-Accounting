import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission, hasPermission } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getControlledDocumentDetail } from "@/lib/documents/document-control-service";
import { activeEvidenceStorageProviderName, formatBytes } from "@/lib/documents/evidence-service";
import {
  UploadRevisionEvidenceForm,
  LinkExistingEvidenceForm,
  SubmitForReviewButton,
  RecordReviewButton,
  ApproveRevisionButton,
  PublishRevisionEffectiveForm,
  CreateSuccessorRevisionForm,
  DistributeRevisionForm,
  AcknowledgeDistributionButton,
} from "./document-detail-forms";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning"> = {
  DRAFT: "neutral",
  IN_REVIEW: "info",
  APPROVED: "info",
  EFFECTIVE: "success",
  OBSOLETE: "warning",
};

/** "database" today; a future SharePoint provider (SP01+) registers under its own name — the label map just grows. */
const PROVIDER_LABELS: Record<string, string> = {
  database: "Database (built-in)",
};

export default async function ControlledDocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  let document;
  try {
    document = await getControlledDocumentDetail(context, id);
  } catch (error) {
    if (error instanceof TenantOwnershipError) redirect("/ems/documents");
    throw error;
  }
  if (!document) redirect("/ems/documents");

  const canManage = hasPermission(context, "ems.controlled_document.manage");
  const canApprove = hasPermission(context, "ems.controlled_document.approve");

  const members = await prisma.organisationMembership.findMany({
    where: { organisationId: context.organisationId, status: "ACTIVE" },
    include: { user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  const memberOptions = members.map((m) => ({ id: m.id, name: m.user.name ?? m.id }));

  const latest = document.revisions[0];
  const canCreateSuccessor =
    canManage && latest && latest.status !== "DRAFT" && latest.status !== "IN_REVIEW";

  const providerName = activeEvidenceStorageProviderName();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{document.reference}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {document.title} · {document.category} · owner {document.owner?.user.name ?? "unassigned"}
          </p>
        </div>
        {document.currentRevision ? (
          <Badge tone={STATUS_TONE[document.currentRevision.status] ?? "neutral"}>
            {document.currentRevision.status}
          </Badge>
        ) : (
          <Badge>NO REVISION</Badge>
        )}
      </div>

      <Card>
        <CardContent className="space-y-2 p-6 text-sm">
          <p>
            <span className="font-medium text-slate-700">Classification:</span> {document.classification}
          </p>
          {document.currentRevision?.status === "EFFECTIVE" && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
              Issued content is pinned to revision {document.currentRevision.revisionNumber} — checksum{" "}
              <code className="text-xs">{document.currentRevision.checksumSha256?.slice(0, 12) ?? "—"}…</code>,
              effective {document.currentRevision.effectiveDate?.toISOString().slice(0, 10) ?? "—"}. A later
              SharePoint or upload edit never changes this issued reference; only a new successor revision can.
            </p>
          )}
          <p className="text-xs text-slate-500">
            Storage provider: {PROVIDER_LABELS[providerName] ?? providerName}
            {providerName === "database" && " — SharePoint connection not yet configured for this organisation (pending SP01+)."}
          </p>
        </CardContent>
      </Card>

      {canCreateSuccessor && <CreateSuccessorRevisionForm documentId={document.id} />}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Revisions</h2>
        {document.revisions.map((revision) => (
          <Card key={revision.id}>
            <CardContent className="space-y-3 p-6">
              <div className="flex items-center justify-between">
                <p className="font-medium text-slate-900">
                  Revision {revision.revisionNumber}
                  {revision.id === document.currentRevisionId && (
                    <span className="ml-2 text-xs font-normal text-slate-500">(current)</span>
                  )}
                </p>
                <Badge tone={STATUS_TONE[revision.status] ?? "neutral"}>{revision.status}</Badge>
              </div>

              {revision.changeSummary && <p className="text-sm text-slate-600">{revision.changeSummary}</p>}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-500 sm:grid-cols-4">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Content</dt>
                  <dd>
                    {revision.evidenceObject
                      ? `${revision.evidenceObject.filename} (${formatBytes(revision.evidenceObject.byteSize)})`
                      : "None attached"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Checksum</dt>
                  <dd className="font-mono text-xs">{revision.checksumSha256 ? `${revision.checksumSha256.slice(0, 12)}…` : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Effective</dt>
                  <dd>{revision.effectiveDate?.toISOString().slice(0, 10) ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Review due</dt>
                  <dd>{revision.reviewDueDate?.toISOString().slice(0, 10) ?? "—"}</dd>
                </div>
              </dl>

              {revision.evidenceObjectId && (
                <a
                  href={`/api/ems/documents/${document.id}/revisions/${revision.id}`}
                  className="inline-block text-sm font-medium text-blue-700 underline-offset-2 hover:underline"
                >
                  Download content
                </a>
              )}

              {canManage && (revision.status === "DRAFT" || revision.status === "IN_REVIEW") && !revision.evidenceObjectId && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <UploadRevisionEvidenceForm documentId={document.id} revisionId={revision.id} />
                  <LinkExistingEvidenceForm documentId={document.id} revisionId={revision.id} />
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                {canManage && revision.status === "DRAFT" && (
                  <SubmitForReviewButton documentId={document.id} revisionId={revision.id} />
                )}
                {canManage && revision.status === "IN_REVIEW" && !revision.reviewedByUserId && (
                  <RecordReviewButton documentId={document.id} revisionId={revision.id} />
                )}
                {canApprove && revision.status === "IN_REVIEW" && revision.reviewedByUserId && (
                  <ApproveRevisionButton documentId={document.id} revisionId={revision.id} />
                )}
              </div>

              {canApprove && revision.status === "APPROVED" && (
                <PublishRevisionEffectiveForm documentId={document.id} revisionId={revision.id} />
              )}

              {revision.status === "EFFECTIVE" && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-700">Distribution</h3>
                  <ul className="space-y-1 text-sm text-slate-600">
                    {revision.distributions.map((d) => (
                      <li key={d.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-2">
                        <span>
                          {d.audienceMembership?.user.name ?? d.audienceRole ?? "—"} · issued{" "}
                          {d.issuedAt.toISOString().slice(0, 10)}
                          {d.acknowledgedAt ? ` · acknowledged ${d.acknowledgedAt.toISOString().slice(0, 10)}` : ""}
                        </span>
                        {!d.acknowledgedAt && <AcknowledgeDistributionButton documentId={document.id} distributionId={d.id} />}
                      </li>
                    ))}
                    {revision.distributions.length === 0 && <li className="text-slate-500">Not yet distributed.</li>}
                  </ul>
                  {canManage && <DistributeRevisionForm documentId={document.id} revisionId={revision.id} members={memberOptions} />}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

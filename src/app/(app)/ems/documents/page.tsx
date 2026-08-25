import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission, hasPermission } from "@/lib/rbac/authorize";
import { Badge } from "@/components/ui/badge";
import { listControlledDocuments } from "@/lib/documents/document-control-service";
import { CreateDocumentForm } from "./document-forms";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning"> = {
  DRAFT: "neutral",
  IN_REVIEW: "info",
  APPROVED: "info",
  EFFECTIVE: "success",
  OBSOLETE: "warning",
};

export default async function ControlledDocumentsPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const canManage = hasPermission(context, "ems.controlled_document.manage");

  const [documents, members] = await Promise.all([
    listControlledDocuments(context),
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Controlled documents</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            The document register introduced in task T22 — draft, review, approve and publish controlled documents,
            each with an immutable-once-approved revision history. All content shown here is synthetic.
          </p>
        </div>
        <Link
          href="/ems/evidence"
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Evidence hub
        </Link>
      </div>

      {canManage && (
        <CreateDocumentForm members={members.map((m) => ({ id: m.id, name: m.user.name ?? m.id }))} />
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2">Reference</th>
              <th scope="col" className="px-4 py-2">Title</th>
              <th scope="col" className="px-4 py-2">Category</th>
              <th scope="col" className="px-4 py-2">Classification</th>
              <th scope="col" className="px-4 py-2">Current revision</th>
              <th scope="col" className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {documents.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  No controlled documents yet.{canManage ? " Create the first one above." : ""}
                </td>
              </tr>
            )}
            {documents.map((doc) => (
              <tr key={doc.id} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link href={`/ems/documents/${doc.id}`} className="font-medium text-slate-900 underline-offset-2 hover:underline">
                    {doc.reference}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-700">{doc.title}</td>
                <td className="px-4 py-2 text-slate-500">{doc.category}</td>
                <td className="px-4 py-2 text-slate-500">{doc.classification}</td>
                <td className="px-4 py-2 text-slate-500">
                  {doc.currentRevision ? `Rev. ${doc.currentRevision.revisionNumber}` : "—"}
                </td>
                <td className="px-4 py-2">
                  {doc.currentRevision ? (
                    <Badge tone={STATUS_TONE[doc.currentRevision.status] ?? "neutral"}>{doc.currentRevision.status}</Badge>
                  ) : (
                    <Badge>NO REVISION</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

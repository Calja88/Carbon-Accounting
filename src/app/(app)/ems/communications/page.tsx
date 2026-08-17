import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission, PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { listCommunicationPlans } from "@/lib/ems/communications/communication-service";
import { CommunicationsWorkspace } from "./communication-forms";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function EmsCommunicationsPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const ctx = toTenantRepositoryContext(context);
  const documentRevisionWhere: Prisma.ControlledDocumentRevisionWhereInput = { status: { in: ["APPROVED", "EFFECTIVE"] } };
  const [plans, members, documentRevisions] = await Promise.all([
    listCommunicationPlans(context),
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.controlledDocumentRevision.findMany({
      where: tenantWhere(ctx, documentRevisionWhere),
      include: { document: { select: { reference: true, title: true } } },
      orderBy: [{ document: { reference: "asc" } }, { revisionNumber: "desc" }],
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Environmental communications</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Plan internal and external environmental communications and record what was actually sent. External
          communications from a plan requiring approval must already be approved before they can be recorded.
        </p>
      </div>
      <CommunicationsWorkspace
        plans={plans.map((plan) => ({
          id: plan.id,
          subject: plan.subject,
          audience: plan.audience,
          triggerFrequency: plan.triggerFrequency,
          method: plan.method,
          approvalRequired: plan.approvalRequired,
          status: plan.status,
          ownerName: plan.owner.user.name,
          records: plan.records.map((record) => ({
            id: record.id,
            occurredAt: record.occurredAt.toISOString(),
            audience: record.audience,
            parties: record.parties,
            contentSummary: record.contentSummary,
            approverMembershipId: record.approverMembershipId,
            approvedAt: record.approvedAt?.toISOString() ?? null,
            responseFollowUp: record.responseFollowUp,
          })),
        }))}
        members={members.map((member) => ({ id: member.id, name: member.user.name }))}
        documents={documentRevisions.map((revision) => ({
          id: revision.id,
          label: `${revision.document.reference} — ${revision.document.title} (rev ${revision.revisionNumber}, ${revision.status.toLowerCase()})`,
        }))}
        canManage={hasPermission(context, "ems.communication.manage")}
      />
    </div>
  );
}

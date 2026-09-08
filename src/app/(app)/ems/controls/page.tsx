import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission, PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { listOperationalControls, listSignificantAspectControlGaps } from "@/lib/ems/controls/control-service";
import { OperationalControlsWorkspace } from "./control-forms";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function EmsControlsPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const ctx = toTenantRepositoryContext(context);
  const scopeWhere = context.access.mode === "ORGANISATION_WIDE" ? {} : {
    process: { OR: [
      { siteId: { in: [...context.access.siteIds] } },
      { entityId: { in: [...context.access.entityIds] } },
    ] },
  };
  const documentRevisionWhere: Prisma.ControlledDocumentRevisionWhereInput = { status: { in: ["APPROVED", "EFFECTIVE"] } };
  const [controls, gaps, aspects, members, documentRevisions] = await Promise.all([
    listOperationalControls(context),
    listSignificantAspectControlGaps(context),
    prisma.environmentalAspect.findMany({
      where: tenantWhere(ctx, scopeWhere),
      include: { process: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
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

  const checkIds = controls.flatMap((control) => control.checks.map((check) => check.id));
  const evidenceLinks = checkIds.length === 0 ? [] : await prisma.evidenceLink.findMany({
    where: tenantWhere(ctx, { resourceType: "control_check", resourceId: { in: checkIds } }),
    include: { evidence: { select: { id: true, filename: true } } },
    orderBy: { linkedAt: "desc" },
  });
  const evidenceByCheck = new Map<string, Array<{ id: string; filename: string }>>();
  for (const link of evidenceLinks) {
    const current = evidenceByCheck.get(link.resourceId) ?? [];
    current.push(link.evidence);
    evidenceByCheck.set(link.resourceId, current);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Operational controls</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Link significant aspects to responsible, reviewable controls and exact controlled-document revisions.
          Reviews create successor versions, preserving the historic control and its checks.
        </p>
      </div>
      <OperationalControlsWorkspace
        controls={controls.map((control) => ({
          id: control.id,
          controlKey: control.controlKey,
          version: control.version,
          title: control.title,
          type: control.type,
          status: control.status,
          description: control.description,
          frequency: control.frequency,
          acceptanceCriteria: control.acceptanceCriteria,
          effectivenessCriteria: control.effectivenessCriteria,
          ownerMembershipId: control.ownerMembershipId,
          ownerName: control.owner.user.name,
          controlledDocumentRevisionId: control.controlledDocumentRevisionId,
          documentLabel: control.controlledDocumentRevision
            ? `${control.controlledDocumentRevision.document.reference} rev ${control.controlledDocumentRevision.revisionNumber}`
            : null,
          reviewDueDate: control.reviewDueDate.toISOString(),
          reviewOverdue: control.reviewOverdue,
          reviewedAt: control.reviewedAt?.toISOString() ?? null,
          supersedesControlId: control.supersedesControlId,
          aspectIds: control.aspectLinks.map((link) => link.aspectId),
          aspects: control.aspectLinks.map((link) => ({ id: link.aspect.id, name: link.aspect.name })),
          applicabilityProcessId: control.applicabilities[0]?.processId ?? null,
          externalProviderReference: control.applicabilities[0]?.externalProviderReference ?? null,
          checks: control.checks.map((check) => ({
            id: check.id,
            scheduledAt: check.scheduledAt.toISOString(),
            performedAt: check.performedAt?.toISOString() ?? null,
            result: check.result,
            notes: check.notes,
            exceptionSummary: check.exceptionSummary,
            actionReference: check.actionReference,
            evidence: evidenceByCheck.get(check.id) ?? [],
          })),
        }))}
        gaps={gaps.map((gap) => ({ id: gap.id, name: gap.name, processName: gap.process.name }))}
        aspects={aspects.map((aspect) => ({ id: aspect.id, name: aspect.name, processId: aspect.processId, processName: aspect.process.name }))}
        members={members.map((member) => ({ id: member.id, name: member.user.name }))}
        documentRevisions={documentRevisions.map((revision) => ({
          id: revision.id,
          label: `${revision.document.reference} — ${revision.document.title} (rev ${revision.revisionNumber}, ${revision.status.toLowerCase()})`,
        }))}
        canManage={hasPermission(context, "ems.control.manage")}
      />
    </div>
  );
}

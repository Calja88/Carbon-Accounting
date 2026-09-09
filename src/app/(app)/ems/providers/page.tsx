import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission, PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { listExternalProviderControls } from "@/lib/ems/providers/provider-control-service";
import { ExternalProviderWorkspace } from "./provider-forms";

export const dynamic = "force-dynamic";

export default async function EmsProvidersPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const ctx = toTenantRepositoryContext(context);
  const [providers, aspects, members] = await Promise.all([
    listExternalProviderControls(context),
    prisma.environmentalAspect.findMany({
      where: tenantWhere(ctx, {}),
      include: { process: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">External-provider controls</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Communicate environmental requirements to value-chain providers, link them to the aspects they affect,
          and record periodic evaluations. Evaluation results never overwrite each other.
        </p>
      </div>
      <ExternalProviderWorkspace
        providers={providers.map((provider) => ({
          id: provider.id,
          providerReference: provider.providerReference,
          providerName: provider.providerName,
          providedDescription: provider.providedDescription,
          communicatedRequirements: provider.communicatedRequirements,
          evaluationFrequency: provider.evaluationFrequency,
          status: provider.status,
          ownerMembershipId: provider.ownerMembershipId,
          ownerName: provider.owner.user.name,
          nextReviewDueDate: provider.nextReviewDueDate.toISOString(),
          reviewOverdue: provider.reviewOverdue,
          aspects: provider.aspectLinks.map((link) => ({ id: link.aspect.id, name: link.aspect.name })),
          evaluations: provider.evaluations.map((evaluation) => ({
            id: evaluation.id,
            evaluatedAt: evaluation.evaluatedAt.toISOString(),
            result: evaluation.result,
            notes: evaluation.notes,
            actionReference: evaluation.actionReference,
          })),
        }))}
        aspects={aspects.map((aspect) => ({ id: aspect.id, name: aspect.name, processName: aspect.process.name }))}
        members={members.map((member) => ({ id: member.id, name: member.user.name }))}
        canManage={hasPermission(context, "ems.control.manage")}
      />
    </div>
  );
}

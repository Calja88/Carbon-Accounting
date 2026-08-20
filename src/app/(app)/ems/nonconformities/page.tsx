import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission, hasPermission } from "@/lib/rbac/authorize";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import {
  listNonconformities,
  listNonconformityClassifications,
  getNonconformityClosurePolicy,
  NONCONFORMITY_MANAGE_PERMISSION,
} from "@/lib/ems/nonconformity/nonconformity-service";
import { CreateNonconformityForm, NonconformityList, NonconformityPolicyWorkspace, type NonconformityListRow } from "./nonconformity-forms";

export const dynamic = "force-dynamic";

export default async function NonconformitiesPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const ctx = toTenantRepositoryContext(context);

  const [nonconformities, complianceObligations, operationalControls, classifications, members, policy] = await Promise.all([
    listNonconformities(context),
    prisma.complianceObligation.findMany({ where: tenantWhere(ctx, {}), select: { id: true, activeVersionId: true } }),
    prisma.operationalControl.findMany({ where: tenantWhere(ctx, {}), orderBy: { title: "asc" }, select: { id: true, title: true } }),
    listNonconformityClassifications(context),
    prisma.organisationMembership.findMany({ where: { organisationId: context.organisationId, status: "ACTIVE" }, include: { user: { select: { name: true } } } }),
    getNonconformityClosurePolicy(context),
  ]);

  const rows: NonconformityListRow[] = nonconformities.map((nc) => ({
    id: nc.id,
    reference: nc.reference,
    sourceType: nc.sourceType,
    status: nc.status,
    requirementReference: nc.requirementReference,
    createdAt: nc.createdAt.toISOString().slice(0, 10),
  }));

  const canManage = hasPermission(context, NONCONFORMITY_MANAGE_PERMISSION);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Nonconformities</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Nonconformities created from audit findings, incidents, compliance evaluations, complaints, monitoring or
          manual observation. Every record traces back to a source and a requirement — root cause, corrective action
          and effectiveness review are handled separately.
        </p>
      </div>

      {canManage && (
        <CreateNonconformityForm
          complianceObligations={complianceObligations.map((o) => ({ id: o.id, name: o.id }))}
          operationalControls={operationalControls.map((c) => ({ id: c.id, name: c.title }))}
          classifications={classifications.map((c) => ({ id: c.id, name: c.label }))}
          members={members.map((m) => ({ id: m.id, name: m.user.name ?? m.id }))}
        />
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">All nonconformities</h2>
        <NonconformityList nonconformities={rows} />
      </div>

      {canManage && (
        <NonconformityPolicyWorkspace
          classifications={classifications.map((c) => ({ id: c.id, key: c.key, label: c.label, rank: c.rank }))}
          policy={{
            requireContainment: policy.requireContainment,
            requireRootCauseApproval: policy.requireRootCauseApproval,
            requireCorrectiveActionsComplete: policy.requireCorrectiveActionsComplete,
            requireEffectivenessReview: policy.requireEffectivenessReview,
          }}
        />
      )}
    </div>
  );
}

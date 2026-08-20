import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission, PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { listCompetenceRequirements } from "@/lib/ems/competence/requirement-service";
import { CompetenceRequirementWorkspace, type RequirementRow } from "./requirement-forms";

export const dynamic = "force-dynamic";

export default async function CompetenceRequirementsPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.competence.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const ctx = toTenantRepositoryContext(context);

  const [requirements, roles, processes, aspects, controls, obligationVersions, emergencyScenarios] = await Promise.all([
    listCompetenceRequirements(context),
    prisma.roleDefinition.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    prisma.activityProcess.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    prisma.environmentalAspect.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    prisma.operationalControl.findMany({ where: tenantWhere(ctx, {}), orderBy: { title: "asc" } }),
    prisma.complianceObligationVersion.findMany({ where: tenantWhere(ctx, {}), select: { id: true, title: true }, orderBy: { title: "asc" } }),
    prisma.emergencyScenario.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
  ]);

  const roleOptions = roles.map((role) => ({ id: role.id, name: role.name }));
  const processOptions = processes.map((process) => ({ id: process.id, name: process.name }));
  const aspectOptions = aspects.map((aspect) => ({ id: aspect.id, name: aspect.name }));
  const controlOptions = controls.map((control) => ({ id: control.id, name: control.title }));
  const obligationOptions = obligationVersions.map((version) => ({ id: version.id, name: version.title }));
  const emergencyOptions = emergencyScenarios.map((scenario) => ({ id: scenario.id, name: scenario.name }));

  const roleNames = new Map(roleOptions.map((option) => [option.id, option.name]));
  const processNames = new Map(processOptions.map((option) => [option.id, option.name]));
  const aspectNames = new Map(aspectOptions.map((option) => [option.id, option.name]));
  const controlNames = new Map(controlOptions.map((option) => [option.id, option.name]));
  const obligationNames = new Map(obligationOptions.map((option) => [option.id, option.name]));
  const emergencyNames = new Map(emergencyOptions.map((option) => [option.id, option.name]));

  function scopeLabel(scope: {
    id: string;
    scopeType: string;
    roleId: string | null;
    processId: string | null;
    aspectId: string | null;
    controlId: string | null;
    obligationVersionId: string | null;
    emergencyScenarioId: string | null;
    emergencyRoleLabel: string | null;
  }): { id: string; kind: string; label: string } {
    if (scope.roleId) return { id: scope.id, kind: "Role", label: roleNames.get(scope.roleId) ?? "Unknown role" };
    if (scope.processId) return { id: scope.id, kind: "Process", label: processNames.get(scope.processId) ?? "Unknown process" };
    if (scope.aspectId) return { id: scope.id, kind: "Aspect", label: aspectNames.get(scope.aspectId) ?? "Unknown aspect" };
    if (scope.controlId) return { id: scope.id, kind: "Control", label: controlNames.get(scope.controlId) ?? "Unknown control" };
    if (scope.obligationVersionId) return { id: scope.id, kind: "Obligation", label: obligationNames.get(scope.obligationVersionId) ?? "Unknown obligation" };
    if (scope.emergencyScenarioId) return { id: scope.id, kind: "Emergency", label: emergencyNames.get(scope.emergencyScenarioId) ?? "Unknown scenario" };
    return { id: scope.id, kind: "Emergency role", label: scope.emergencyRoleLabel ?? "Unlabelled" };
  }

  const requirementRows: RequirementRow[] = requirements.map((requirement) => ({
    id: requirement.id,
    requirementKey: requirement.requirementKey,
    activeVersionId: requirement.activeVersionId,
    versions: requirement.versions.map((version) => ({
      id: version.id,
      requirementId: requirement.id,
      version: version.version,
      status: version.status,
      title: version.title,
      description: version.description,
      renewalRule: version.renewalRule,
      acceptableEvidence: version.acceptableEvidence,
      preparedByUserId: version.preparedByUserId,
      approvedByUserId: version.approvedByUserId,
      approvedAt: version.approvedAt ? version.approvedAt.toISOString() : null,
      supersedesVersionId: version.supersedesVersionId,
      scopes: version.scopes.map(scopeLabel),
    })),
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Competence requirements</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Define what competence a role, process, aspect, control, obligation, or emergency role requires. A version
          moves DRAFT → APPROVED → ACTIVE; activating a version supersedes whatever was previously active. Approved
          and active versions are immutable — changing a requirement&apos;s content always creates a new successor
          draft, and every draft, approval, and activation is recorded in the audit trail.
        </p>
      </div>

      <CompetenceRequirementWorkspace
        requirements={requirementRows}
        roles={roleOptions}
        processes={processOptions}
        aspects={aspectOptions}
        controls={controlOptions}
        obligationVersions={obligationOptions}
        emergencyScenarios={emergencyOptions}
        canEdit={hasPermission(context, "ems.competence.manage")}
      />
    </div>
  );
}

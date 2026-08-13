import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission, PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { listOperationalControls } from "@/lib/ems/controls/control-service";
import { listMonitoringPlans } from "@/lib/ems/monitoring/monitoring-service";
import { listMonitoringEquipment } from "@/lib/ems/monitoring/calibration-service";
import { MonitoringWorkspace } from "./monitoring-forms";

export const dynamic = "force-dynamic";

export default async function EmsMonitoringPage() {
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
  const [plans, equipment, aspects, controls, members] = await Promise.all([
    listMonitoringPlans(context),
    listMonitoringEquipment(context),
    prisma.environmentalAspect.findMany({
      where: tenantWhere(ctx, scopeWhere), include: { process: { select: { name: true } } }, orderBy: { name: "asc" },
    }),
    listOperationalControls(context),
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: "ACTIVE" },
      include: { user: { select: { name: true } } }, orderBy: { user: { name: "asc" } },
    }),
  ]);

  const resultIds = plans.flatMap((plan) => plan.results.map((result) => result.id));
  const calibrationIds = equipment.flatMap((item) => item.calibrations.map((calibration) => calibration.id));
  const evidenceLinks = resultIds.length + calibrationIds.length === 0 ? [] : await prisma.evidenceLink.findMany({
    where: tenantWhere(ctx, {
      OR: [
        ...(resultIds.length ? [{ resourceType: "monitoring_result", resourceId: { in: resultIds } }] : []),
        ...(calibrationIds.length ? [{ resourceType: "equipment_calibration", resourceId: { in: calibrationIds } }] : []),
      ],
    }),
    include: { evidence: { select: { id: true, filename: true } } }, orderBy: { linkedAt: "desc" },
  });
  const evidenceByResource = new Map<string, Array<{ id: string; filename: string }>>();
  for (const link of evidenceLinks) {
    const current = evidenceByResource.get(link.resourceId) ?? [];
    current.push(link.evidence);
    evidenceByResource.set(link.resourceId, current);
  }

  return <div className="space-y-8">
    <div><h1 className="text-2xl font-semibold tracking-tight text-slate-900">Environmental monitoring and calibration</h1><p className="mt-1 max-w-3xl text-sm text-slate-500">Configure explicit methods and units, retain append-only results, and keep instrument assurance visible. Out-of-tolerance records remain in history until a documented review explains validity and response.</p></div>
    <MonitoringWorkspace
      plans={plans.map((plan) => ({
        id: plan.id, planKey: plan.planKey, parameter: plan.parameter, method: plan.method, location: plan.location,
        frequency: plan.frequency, unit: plan.unit, acceptanceCriteria: plan.acceptanceCriteria, status: plan.status,
        aspectLabel: plan.aspect?.name ?? null,
        controlLabel: plan.control ? `${plan.control.title} v${plan.control.version}` : null,
        responsibleName: plan.responsible.user.name, equipmentLabel: plan.equipment?.reference ?? null,
        results: plan.results.map((result) => ({
          id: result.id, measuredAt: result.measuredAt.toISOString(), value: result.value.toString(), unit: result.unit,
          qualitativeResult: result.qualitativeResult, dataQualityFlag: result.dataQualityFlag,
          reviewStatus: result.reviewStatus, reviewNote: result.reviewNote,
          exceptionReview: result.exceptionReview ? {
            validityDecision: result.exceptionReview.validityDecision, consequence: result.exceptionReview.consequence,
            actionReference: result.exceptionReview.actionReference,
          } : null,
          evidence: evidenceByResource.get(result.id) ?? [],
        })),
      }))}
      equipment={equipment.map((item) => ({
        id: item.id, reference: item.reference, description: item.description, location: item.location,
        calibrationFrequency: item.calibrationFrequency, status: item.status,
        calibrationDueDate: item.calibrationDueDate.toISOString(), calibrationOverdue: item.calibrationOverdue,
        ownerName: item.owner.user.name,
        calibrations: item.calibrations.map((calibration) => ({
          id: calibration.id, performedAt: calibration.performedAt.toISOString(), dueDate: calibration.dueDate.toISOString(),
          provider: calibration.provider, method: calibration.method, result: calibration.result,
          nextDueDate: calibration.nextDueDate.toISOString(), outOfTolerance: calibration.outOfTolerance,
          responseReference: calibration.responseReference,
          exceptionReview: calibration.exceptionReview ? {
            validityDecision: calibration.exceptionReview.validityDecision, consequence: calibration.exceptionReview.consequence,
            actionReference: calibration.exceptionReview.actionReference,
          } : null,
          evidence: evidenceByResource.get(calibration.id) ?? [],
        })),
      }))}
      aspects={aspects.map((aspect) => ({ id: aspect.id, label: `${aspect.name} — ${aspect.process.name}` }))}
      controls={controls.filter((control) => control.status === "ACTIVE").map((control) => ({ id: control.id, label: `${control.title} v${control.version}` }))}
      members={members.map((member) => ({ id: member.id, label: member.user.name }))}
      canRecord={hasPermission(context, "ems.monitoring.record")}
      canReview={hasPermission(context, "ems.monitoring.review")}
    />
  </div>;
}

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission, PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { listEmergencyScenarios } from "@/lib/ems/emergency/emergency-service";
import { EmergencyWorkspace } from "./emergency-forms";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function EmsEmergencyPage() {
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
  const [scenarios, aspects, members, documentRevisions, commsPlans] = await Promise.all([
    listEmergencyScenarios(context),
    prisma.environmentalAspect.findMany({ where: tenantWhere(ctx, {}), select: { id: true, name: true }, orderBy: { name: "asc" } }),
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
    prisma.communicationPlan.findMany({
      where: tenantWhere(ctx, { status: "ACTIVE" as const }),
      select: { id: true, subject: true },
      orderBy: { subject: "asc" },
    }),
  ]);

  const scenarioIds = scenarios.map((scenario) => scenario.id);
  const exercises = scenarioIds.length === 0 ? [] : await prisma.emergencyExercise.findMany({
    where: tenantWhere(ctx, { scenarioId: { in: scenarioIds } }),
    include: { plan: { select: { id: true, version: true } }, actions: true },
    orderBy: { exerciseDate: "desc" },
  });
  const exercisesByScenario = new Map<string, typeof exercises>();
  for (const exercise of exercises) {
    const current = exercisesByScenario.get(exercise.scenarioId) ?? [];
    current.push(exercise);
    exercisesByScenario.set(exercise.scenarioId, current);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Emergency preparedness and response</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Record credible emergency scenarios, keep controlled emergency plans current, and exercise the exact plan
          version in force. Exercise outcomes never automatically create an incident or nonconformity — that always
          remains an explicit, separate step.
        </p>
      </div>
      <EmergencyWorkspace
        scenarios={scenarios.map((scenario) => ({
          id: scenario.id,
          name: scenario.name,
          priority: scenario.priority,
          status: scenario.status,
          triggerDescription: scenario.triggerDescription,
          receptors: scenario.receptors,
          credibleConsequence: scenario.credibleConsequence,
          reviewDueDate: scenario.reviewDueDate.toISOString(),
          reviewOverdue: scenario.reviewOverdue,
          plans: scenario.plans.map((plan) => ({
            id: plan.id,
            version: plan.version,
            status: plan.status,
            roles: plan.roles,
            resources: plan.resources,
            effectiveDate: plan.effectiveDate.toISOString(),
            reviewDueDate: plan.reviewDueDate.toISOString(),
            controlledDocumentRevisionId: plan.controlledDocumentRevisionId,
            communicationPlanId: plan.communicationPlanId,
          })),
          exercises: (exercisesByScenario.get(scenario.id) ?? []).map((exercise) => ({
            id: exercise.id,
            planVersion: exercise.plan.version,
            type: exercise.type,
            exerciseDate: exercise.exerciseDate.toISOString(),
            participantMembershipIds: exercise.participantMembershipIds,
            objectives: exercise.objectives,
            outcome: exercise.outcome,
            observations: exercise.observations,
            lessons: exercise.lessons,
            actions: exercise.actions.map((action) => ({
              id: action.id,
              description: action.description,
              status: action.status,
              dueDate: action.dueDate?.toISOString() ?? null,
              actionReference: action.actionReference,
              incidentReference: action.incidentReference,
              nonconformityReference: action.nonconformityReference,
            })),
          })),
        }))}
        aspects={aspects}
        members={members.map((member) => ({ id: member.id, name: member.user.name }))}
        documents={documentRevisions.map((revision) => ({
          id: revision.id,
          label: `${revision.document.reference} — ${revision.document.title} (rev ${revision.revisionNumber}, ${revision.status.toLowerCase()})`,
        }))}
        commsPlans={commsPlans}
        canManagePlans={hasPermission(context, "ems.emergency_plan.manage")}
        canRecordExercises={hasPermission(context, "ems.emergency_exercise.record")}
      />
    </div>
  );
}

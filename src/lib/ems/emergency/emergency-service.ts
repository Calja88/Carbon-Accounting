/**
 * Tenant-scoped emergency preparedness and response (task T35,
 * Docs/PHASE3_ASPECTS_OPERATIONS_SPEC.md §2 "Communications and emergency
 * preparedness"). Follows the T33 OperationalControl versioning pattern
 * exactly for `EmergencyPlan`: a revision is always a new row via
 * `supersedesPlanId`, never a mutation, and `controlledDocumentRevisionId`
 * is mandatory (T35 acceptance: "emergency plan revisions are controlled
 * documents"). An `EmergencyExercise` pins the exact plan version it
 * exercised — never "the current plan" — so historic outcomes stay
 * reproducible even after the plan is revised.
 *
 * T35 acceptance: "failed exercise can explicitly create an incident/NC/
 * action but makes no automatic legal conclusion" — `addExerciseAction`
 * is always a separate, explicit call; nothing here ever creates one as a
 * side effect of recording an exercise outcome.
 */

import type { EmergencyExerciseOutcome, EmergencyExerciseType, EmergencyPlanStatus, EmergencyScenarioPriority, EmergencyScenarioStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import {
  toTenantRepositoryContext,
  findTenantEmergencyScenario,
  findTenantEmergencyPlan,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, assertOwned, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { suppressNotificationsForResource } from "@/lib/notifications/notification-service";
import { linkEvidence, uploadEvidenceObject } from "@/lib/documents/evidence-service";

export { TenantOwnershipError };

export class EmergencyPreparednessError extends Error {}

// --- Scenarios ---------------------------------------------------------

export interface EmergencyScenarioInput {
  name: string;
  aspectId?: string | null;
  processId?: string | null;
  siteId?: string | null;
  triggerDescription: string;
  receptors: string;
  credibleConsequence: string;
  priority: EmergencyScenarioPriority;
  controlsSummary?: string | null;
  reviewDueDate: Date;
  actorUserId: string;
}

async function validateScenarioReferences(context: OrganisationContext, input: EmergencyScenarioInput) {
  const ctx = toTenantRepositoryContext(context);
  const [aspect, process, site] = await Promise.all([
    input.aspectId ? prisma.environmentalAspect.findFirst({ where: tenantWhere(ctx, { id: input.aspectId }), select: { id: true } }) : null,
    input.processId ? prisma.activityProcess.findFirst({ where: tenantWhere(ctx, { id: input.processId }), select: { id: true } }) : null,
    input.siteId ? prisma.site.findFirst({ where: tenantWhere(ctx, { id: input.siteId }), select: { id: true } }) : null,
  ]);
  if (input.aspectId && !aspect) throw new TenantOwnershipError();
  if (input.processId && !process) throw new TenantOwnershipError();
  if (input.siteId && !site) throw new TenantOwnershipError();
}

export async function createEmergencyScenario(context: OrganisationContext, input: EmergencyScenarioInput) {
  requirePermission(context, "ems.emergency_plan.manage");
  const ctx = toTenantRepositoryContext(context);
  await validateScenarioReferences(context, input);
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const scenario = await tx.emergencyScenario.create({
      data: {
        organisationId: txCtx.organisationId,
        name: input.name.trim(),
        aspectId: input.aspectId || null,
        processId: input.processId || null,
        siteId: input.siteId || null,
        triggerDescription: input.triggerDescription.trim(),
        receptors: input.receptors.trim(),
        credibleConsequence: input.credibleConsequence.trim(),
        priority: input.priority,
        controlsSummary: input.controlsSummary?.trim() || null,
        reviewDueDate: input.reviewDueDate,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "emergency_scenario.created",
      resourceType: "emergency_scenario",
      resourceId: scenario.id,
      summary: `Emergency scenario "${scenario.name}" recorded.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { name: scenario.name, priority: scenario.priority },
    });
    return scenario;
  });
}

export async function setEmergencyScenarioStatus(
  context: OrganisationContext,
  scenarioId: string,
  status: EmergencyScenarioStatus,
  actorUserId: string,
) {
  requirePermission(context, "ems.emergency_plan.manage");
  const ctx = toTenantRepositoryContext(context);
  const scenario = await findTenantEmergencyScenario(ctx, scenarioId);
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.emergencyScenario.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: scenario.id } },
      data: { status },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "emergency_scenario.status_changed",
      resourceType: "emergency_scenario",
      resourceId: scenario.id,
      summary: `Emergency scenario "${scenario.name}" set to ${status}.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: scenario.status },
      after: { status },
    });
    return updated;
  });
}

export async function listEmergencyScenarios(context: OrganisationContext, asOf = new Date()) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const scenarios = await prisma.emergencyScenario.findMany({
    where: tenantWhere(ctx, {}),
    include: {
      aspect: { select: { id: true, name: true } },
      plans: { orderBy: { version: "desc" } },
    },
    orderBy: { reviewDueDate: "asc" },
  });
  return scenarios.map((scenario) => ({
    ...scenario,
    reviewOverdue: scenario.status === "ACTIVE" && scenario.reviewDueDate.getTime() < asOf.getTime(),
  }));
}

// --- Plans (versioned, controlled-document backed) ----------------------

export interface EmergencyPlanInput {
  scenarioId: string;
  controlledDocumentRevisionId: string;
  roles: string;
  resources: string;
  communicationPlanId?: string | null;
  effectiveDate: Date;
  reviewDueDate: Date;
  actorUserId: string;
}

async function validatePlanReferences(context: OrganisationContext, input: EmergencyPlanInput) {
  const ctx = toTenantRepositoryContext(context);
  const scenario = await findTenantEmergencyScenario(ctx, input.scenarioId);

  const documentWhere: Prisma.ControlledDocumentRevisionWhereInput = {
    id: input.controlledDocumentRevisionId,
    status: { in: ["APPROVED", "EFFECTIVE"] },
  };
  const documentRevision = await prisma.controlledDocumentRevision.findFirst({
    where: tenantWhere(ctx, documentWhere),
    select: { id: true },
  });
  if (!documentRevision) {
    throw new EmergencyPreparednessError("Choose an approved or effective controlled-document revision from this organisation.");
  }

  let communicationPlan: { id: string } | null = null;
  if (input.communicationPlanId) {
    communicationPlan = await prisma.communicationPlan.findFirst({
      where: tenantWhere(ctx, { id: input.communicationPlanId }),
      select: { id: true },
    });
    if (!communicationPlan) throw new TenantOwnershipError();
  }

  return { scenario, documentRevision, communicationPlan };
}

async function createPlanVersion(
  context: OrganisationContext,
  input: EmergencyPlanInput,
  version: number,
  supersedesPlanId: string | null,
) {
  requirePermission(context, "ems.emergency_plan.manage");
  const validated = await validatePlanReferences(context, input);
  const ctx = toTenantRepositoryContext(context);
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const plan = await tx.emergencyPlan.create({
      data: {
        organisationId: txCtx.organisationId,
        scenarioId: validated.scenario.id,
        version,
        controlledDocumentRevisionId: validated.documentRevision.id,
        roles: input.roles.trim(),
        resources: input.resources.trim(),
        communicationPlanId: validated.communicationPlan?.id ?? null,
        effectiveDate: input.effectiveDate,
        reviewDueDate: input.reviewDueDate,
        supersedesPlanId,
        createdByUserId: input.actorUserId,
      },
    });
    if (supersedesPlanId) {
      await tx.emergencyPlan.update({
        where: { organisationId_id: { organisationId: txCtx.organisationId, id: supersedesPlanId } },
        data: { status: "SUPERSEDED" },
      });
      await suppressNotificationsForResource(tx, txCtx, "emergency_plan", supersedesPlanId);
    }
    await recordAuditEvent(tx, txCtx, {
      eventType: supersedesPlanId ? "emergency_plan.revised" : "emergency_plan.created",
      resourceType: "emergency_plan",
      resourceId: plan.id,
      summary: `Emergency plan version ${version} recorded for scenario "${validated.scenario.name}".`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { scenarioId: plan.scenarioId, version },
    });
    return plan;
  });
}

export async function createEmergencyPlan(context: OrganisationContext, input: EmergencyPlanInput) {
  const ctx = toTenantRepositoryContext(context);
  const activePlanWhere: Prisma.EmergencyPlanWhereInput = { scenarioId: input.scenarioId, status: "ACTIVE" };
  const existing = await prisma.emergencyPlan.findFirst({
    where: tenantWhere(ctx, activePlanWhere),
    select: { id: true },
  });
  if (existing) throw new EmergencyPreparednessError("This scenario already has an active plan. Revise it to create a successor version.");
  return createPlanVersion(context, input, 1, null);
}

export async function reviseEmergencyPlan(
  context: OrganisationContext,
  planId: string,
  input: Omit<EmergencyPlanInput, "scenarioId">,
) {
  const ctx = toTenantRepositoryContext(context);
  const current = await findTenantEmergencyPlan(ctx, planId);
  if (!current) throw new TenantOwnershipError();
  if (current.status !== "ACTIVE") throw new EmergencyPreparednessError("Only the current active plan can be revised.");
  return createPlanVersion(context, { ...input, scenarioId: current.scenarioId }, current.version + 1, current.id);
}

/**
 * Retires the current active emergency plan for a scenario without creating
 * a successor — the exit for a scenario whose plan is being withdrawn
 * (usually alongside retiring the scenario itself) rather than revised.
 *
 * An emergency plan is IMMUTABLE_ISSUED in substance: every version is
 * pinned to a `ControlledDocumentRevision`, and recorded exercises reference
 * an exact plan version with `onDelete: Restrict`. So there is no delete
 * path at all — `EmergencyPlanStatus.RETIRED` is the terminal state the enum
 * already carries, and the controlled-document revision behind the plan is
 * left untouched.
 */
export async function retireEmergencyPlan(
  context: OrganisationContext,
  planId: string,
  reason: string,
  actorUserId: string,
) {
  requirePermission(context, "ems.emergency_plan.manage");
  const ctx = toTenantRepositoryContext(context);
  const plan = await findTenantEmergencyPlan(ctx, planId);
  if (!plan) throw new TenantOwnershipError();
  if (plan.status !== "ACTIVE" && plan.status !== "DRAFT") {
    throw new EmergencyPreparednessError("Only a draft or active emergency plan can be retired.");
  }
  if (!reason.trim()) throw new EmergencyPreparednessError("Record why the emergency plan is being retired.");
  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const retired = await tx.emergencyPlan.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: plan.id } },
      data: { status: "RETIRED" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "emergency_plan.retired",
      resourceType: "emergency_plan",
      resourceId: plan.id,
      summary: `Emergency plan version ${plan.version} retired: ${reason.trim()}`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: plan.status },
      after: { status: retired.status },
    });
    return retired;
  });
}

// --- Exercises ------------------------------------------------------------

export interface EmergencyExerciseInput {
  scenarioId: string;
  planId: string;
  type: EmergencyExerciseType;
  exerciseDate: Date;
  participantMembershipIds: string[];
  objectives: string;
  outcome: EmergencyExerciseOutcome;
  observations?: string | null;
  lessons?: string | null;
  actorUserId: string;
}

export async function recordEmergencyExercise(context: OrganisationContext, input: EmergencyExerciseInput) {
  requirePermission(context, "ems.emergency_exercise.record");
  const ctx = toTenantRepositoryContext(context);

  const scenario = await findTenantEmergencyScenario(ctx, input.scenarioId);
  const plan = await findTenantEmergencyPlan(ctx, input.planId, scenario.id);
  if (!plan) throw new TenantOwnershipError();

  const participantIds = [...new Set(input.participantMembershipIds.filter(Boolean))];
  if (participantIds.length === 0) throw new EmergencyPreparednessError("Record at least one participant.");
  const participants = await prisma.organisationMembership.findMany({
    where: { id: { in: participantIds }, organisationId: ctx.organisationId },
    select: { id: true },
  });
  if (participants.length !== participantIds.length) throw new TenantOwnershipError();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const exercise = await tx.emergencyExercise.create({
      data: {
        organisationId: txCtx.organisationId,
        scenarioId: scenario.id,
        planId: plan.id,
        type: input.type,
        exerciseDate: input.exerciseDate,
        participantMembershipIds: participantIds,
        objectives: input.objectives.trim(),
        outcome: input.outcome,
        observations: input.observations?.trim() || null,
        lessons: input.lessons?.trim() || null,
        recordedByUserId: input.actorUserId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "emergency_exercise.recorded",
      resourceType: "emergency_exercise",
      resourceId: exercise.id,
      summary: `Emergency exercise recorded with outcome ${exercise.outcome}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { scenarioId: scenario.id, planId: plan.id, outcome: exercise.outcome },
    });
    return exercise;
  });
}

export async function listEmergencyExercises(context: OrganisationContext, scenarioId?: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.emergencyExercise.findMany({
    where: tenantWhere(ctx, scenarioId ? { scenarioId } : {}),
    include: { plan: { select: { id: true, version: true } }, actions: true },
    orderBy: { exerciseDate: "desc" },
  });
}

/**
 * Records a follow-up action from an exercise. `incidentReference`/
 * `nonconformityReference` are plain text — creating a real Incident/NC
 * record (Phase 6) always remains a separate, explicit step a human takes
 * elsewhere; this function never performs it automatically, regardless of
 * the exercise outcome.
 */
export interface EmergencyExerciseActionInput {
  exerciseId: string;
  description: string;
  ownerMembershipId?: string | null;
  dueDate?: Date | null;
  actionReference?: string | null;
  incidentReference?: string | null;
  nonconformityReference?: string | null;
  actorUserId: string;
}

export async function addExerciseAction(context: OrganisationContext, input: EmergencyExerciseActionInput) {
  requirePermission(context, "ems.emergency_exercise.record");
  const ctx = toTenantRepositoryContext(context);
  const exercise = assertOwned(ctx, await prisma.emergencyExercise.findFirst({ where: tenantWhere(ctx, { id: input.exerciseId }) }));

  if (input.ownerMembershipId) {
    const owner = await prisma.organisationMembership.findFirst({
      where: { id: input.ownerMembershipId, organisationId: ctx.organisationId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!owner) throw new TenantOwnershipError();
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const action = await tx.emergencyExerciseAction.create({
      data: {
        organisationId: txCtx.organisationId,
        exerciseId: exercise.id,
        description: input.description.trim(),
        ownerMembershipId: input.ownerMembershipId || null,
        dueDate: input.dueDate ?? null,
        actionReference: input.actionReference?.trim() || null,
        incidentReference: input.incidentReference?.trim() || null,
        nonconformityReference: input.nonconformityReference?.trim() || null,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "emergency_exercise_action.recorded",
      resourceType: "emergency_exercise",
      resourceId: exercise.id,
      summary: "Follow-up action recorded for an emergency exercise.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { exerciseId: exercise.id, actionId: action.id },
    });
    return action;
  });
}

export async function uploadEvidenceToExercise(
  context: OrganisationContext,
  input: { exerciseId: string; fileName: string; mimeType: string; bytes: Buffer; purpose?: string | null; actorUserId: string },
) {
  requirePermission(context, "ems.emergency_exercise.record");
  const ctx = toTenantRepositoryContext(context);
  const exercise = await prisma.emergencyExercise.findFirst({ where: tenantWhere(ctx, { id: input.exerciseId }) });
  if (!exercise) throw new TenantOwnershipError();
  const evidence = await uploadEvidenceObject(context, {
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
    uploadedByUserId: input.actorUserId,
  });
  await linkEvidence(context, {
    evidenceId: evidence.id,
    resourceType: "emergency_exercise",
    resourceId: exercise.id,
    purpose: input.purpose,
    linkedByUserId: input.actorUserId,
  });
  return evidence;
}

export type { EmergencyPlanStatus };

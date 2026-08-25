"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  ObjectiveError,
  createEnvironmentalObjective,
  createSuccessorEnvironmentalObjectiveVersion,
  approveEnvironmentalObjectiveVersion,
  rejectEnvironmentalObjectiveVersion,
  returnEnvironmentalObjectiveVersionForRevision,
  submitEnvironmentalObjectiveVersionForReview,
  updateEnvironmentalObjectiveVersionDraft,
  decideObjectiveAchievement,
  cancelEnvironmentalObjectiveVersion,
  type ObjectiveSourceLinkInput,
} from "@/lib/ems/objectives/objective-service";
import {
  ObjectiveMetricError,
  createObjectiveMetricDefinition,
  approveObjectiveMetricVersion,
  getObjectiveMetricVersion,
} from "@/lib/ems/objectives/metric-service";
import {
  resolveMetricVersionObservations,
  MetricAdapterUnavailableError,
} from "@/lib/ems/objectives/metric-adapters/registry";
import { MetricAdapterConfigError, MetricAdapterResolutionError } from "@/lib/ems/objectives/metric-adapters/types";
import {
  createEnvironmentalObjectiveFormSchema,
  createSuccessorObjectiveVersionFormSchema,
  decideEnvironmentalObjectiveVersionFormSchema,
  decideObjectiveAchievementFormSchema,
  cancelObjectiveVersionFormSchema,
  updateEnvironmentalObjectiveVersionDraftFormSchema,
  createObjectiveMetricDefinitionFormSchema,
  approveObjectiveMetricVersionFormSchema,
  resolveObjectiveMetricObservationFormSchema,
} from "@/lib/ems/objectives/schemas";
import type { ObjectiveMetricSourceType, Prisma } from "@prisma/client";

export interface ObjectiveActionState {
  error: string | null;
  message: string | null;
}

const emptyState: ObjectiveActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation.";
  if (error instanceof ObjectiveError) return error.message;
  if (error instanceof ObjectiveMetricError) return error.message;
  throw error;
}

function revalidateObjectives() {
  revalidatePath("/ems/objectives");
}

function sourceLinksFromForm(formData: FormData): ObjectiveSourceLinkInput[] {
  const raw = formData.get("sourceLinks");
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as ObjectiveSourceLinkInput[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function draftFieldsFromForm(formData: FormData) {
  return {
    title: formData.get("title"),
    intent: formData.get("intent"),
    ownerMembershipId: formData.get("ownerMembershipId"),
    baselineDescription: formData.get("baselineDescription"),
    baselineDate: formData.get("baselineDate") || undefined,
    targetValue: formData.get("targetValue") || undefined,
    targetQualitative: formData.get("targetQualitative"),
    unit: formData.get("unit"),
    targetDate: formData.get("targetDate"),
    evaluationMethod: formData.get("evaluationMethod"),
    sourceLinks: sourceLinksFromForm(formData),
  };
}

export async function createEnvironmentalObjectiveAction(_previous: ObjectiveActionState, formData: FormData): Promise<ObjectiveActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createEnvironmentalObjectiveFormSchema.safeParse(draftFieldsFromForm(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the objective details." };
    await createEnvironmentalObjective(context, {
      title: parsed.data.title,
      intent: parsed.data.intent,
      ownerMembershipId: parsed.data.ownerMembershipId,
      baselineDescription: parsed.data.baselineDescription,
      baselineDate: parsed.data.baselineDate ?? null,
      targetValue: parsed.data.targetValue ?? null,
      targetQualitative: parsed.data.targetQualitative || null,
      unit: parsed.data.unit || null,
      targetDate: parsed.data.targetDate,
      evaluationMethod: parsed.data.evaluationMethod,
      sourceLinks: parsed.data.sourceLinks,
      actorUserId: context.userId,
    });
    revalidateObjectives();
    return { ...emptyState, message: "Draft objective created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function updateEnvironmentalObjectiveVersionDraftAction(
  _previous: ObjectiveActionState,
  formData: FormData,
): Promise<ObjectiveActionState> {
  try {
    const context = await requireOrganisationContext();
    const objectiveVersionId = String(formData.get("objectiveVersionId") ?? "");
    const parsed = updateEnvironmentalObjectiveVersionDraftFormSchema.safeParse(draftFieldsFromForm(formData));
    if (!objectiveVersionId || !parsed.success) {
      return { ...emptyState, error: parsed.success ? "Choose a version." : parsed.error.issues[0]?.message ?? "Check the objective details." };
    }
    await updateEnvironmentalObjectiveVersionDraft(context, objectiveVersionId, {
      title: parsed.data.title,
      intent: parsed.data.intent,
      ownerMembershipId: parsed.data.ownerMembershipId,
      baselineDescription: parsed.data.baselineDescription,
      baselineDate: parsed.data.baselineDate ?? null,
      targetValue: parsed.data.targetValue ?? null,
      targetQualitative: parsed.data.targetQualitative || null,
      unit: parsed.data.unit || null,
      targetDate: parsed.data.targetDate,
      evaluationMethod: parsed.data.evaluationMethod,
      sourceLinks: parsed.data.sourceLinks,
      actorUserId: context.userId,
    });
    revalidateObjectives();
    return { ...emptyState, message: "Draft updated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createSuccessorEnvironmentalObjectiveVersionAction(
  _previous: ObjectiveActionState,
  formData: FormData,
): Promise<ObjectiveActionState> {
  try {
    const context = await requireOrganisationContext();
    const objectiveId = String(formData.get("objectiveId") ?? "");
    const parsed = createSuccessorObjectiveVersionFormSchema.safeParse({
      ...draftFieldsFromForm(formData),
      revisionRationale: formData.get("revisionRationale"),
    });
    if (!objectiveId || !parsed.success) {
      return { ...emptyState, error: parsed.success ? "Choose an objective." : parsed.error.issues[0]?.message ?? "Check the objective details." };
    }
    await createSuccessorEnvironmentalObjectiveVersion(context, objectiveId, {
      title: parsed.data.title,
      intent: parsed.data.intent,
      ownerMembershipId: parsed.data.ownerMembershipId,
      baselineDescription: parsed.data.baselineDescription,
      baselineDate: parsed.data.baselineDate ?? null,
      targetValue: parsed.data.targetValue ?? null,
      targetQualitative: parsed.data.targetQualitative || null,
      unit: parsed.data.unit || null,
      targetDate: parsed.data.targetDate,
      evaluationMethod: parsed.data.evaluationMethod,
      sourceLinks: parsed.data.sourceLinks,
      revisionRationale: parsed.data.revisionRationale,
      actorUserId: context.userId,
    });
    revalidateObjectives();
    return { ...emptyState, message: "Successor draft version created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function submitEnvironmentalObjectiveVersionForReviewAction(
  _previous: ObjectiveActionState,
  formData: FormData,
): Promise<ObjectiveActionState> {
  try {
    const context = await requireOrganisationContext();
    const objectiveVersionId = String(formData.get("objectiveVersionId") ?? "");
    if (!objectiveVersionId) return { ...emptyState, error: "Choose a version." };
    await submitEnvironmentalObjectiveVersionForReview(context, objectiveVersionId, context.userId);
    revalidateObjectives();
    return { ...emptyState, message: "Submitted for review." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function decideEnvironmentalObjectiveVersionAction(
  _previous: ObjectiveActionState,
  formData: FormData,
): Promise<ObjectiveActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = decideEnvironmentalObjectiveVersionFormSchema.safeParse({
      objectiveVersionId: formData.get("objectiveVersionId"),
      decision: formData.get("decision"),
      comment: formData.get("comment"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the decision details." };
    const input = { actorUserId: context.userId, comment: parsed.data.comment || null };
    if (parsed.data.decision === "APPROVED") {
      await approveEnvironmentalObjectiveVersion(context, parsed.data.objectiveVersionId, input);
    } else if (parsed.data.decision === "REJECTED") {
      await rejectEnvironmentalObjectiveVersion(context, parsed.data.objectiveVersionId, input);
    } else {
      await returnEnvironmentalObjectiveVersionForRevision(context, parsed.data.objectiveVersionId, input);
    }
    revalidateObjectives();
    return { ...emptyState, message: `Decision recorded: ${parsed.data.decision}.` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function decideObjectiveAchievementAction(
  _previous: ObjectiveActionState,
  formData: FormData,
): Promise<ObjectiveActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = decideObjectiveAchievementFormSchema.safeParse({
      objectiveVersionId: formData.get("objectiveVersionId"),
      achieved: formData.get("achieved") === "true",
      rationale: formData.get("rationale"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the review details." };
    await decideObjectiveAchievement(context, parsed.data.objectiveVersionId, {
      actorUserId: context.userId,
      achieved: parsed.data.achieved,
      rationale: parsed.data.rationale,
    });
    revalidateObjectives();
    return { ...emptyState, message: parsed.data.achieved ? "Objective marked achieved." : "Objective marked not achieved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function cancelEnvironmentalObjectiveVersionAction(
  _previous: ObjectiveActionState,
  formData: FormData,
): Promise<ObjectiveActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = cancelObjectiveVersionFormSchema.safeParse({
      objectiveVersionId: formData.get("objectiveVersionId"),
      rationale: formData.get("rationale"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Enter a rationale." };
    await cancelEnvironmentalObjectiveVersion(context, parsed.data.objectiveVersionId, {
      actorUserId: context.userId,
      rationale: parsed.data.rationale,
    });
    revalidateObjectives();
    return { ...emptyState, message: "Objective version cancelled." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

/**
 * Builds the `aggregationConfig` JSON the T51 adapters expect from the
 * flat adapter-link fields the form submits. Only CORPORATE_CARBON and
 * PRODUCT_LCA read this — every other source type gets `null`
 * (MANUAL/MONITORING/DERIVED_APPROVED_FORMULA have no adapter wired up in
 * `registry.ts`), so an incomplete config for those never blocks saving a
 * draft metric definition.
 */
function aggregationConfigFromForm(
  sourceType: ObjectiveMetricSourceType,
  data: ReturnType<typeof createObjectiveMetricDefinitionFormSchema.parse>,
): Prisma.InputJsonValue | null {
  if (sourceType === "CORPORATE_CARBON") {
    if (!data.reportSnapshotId || !data.periodStart || !data.periodEnd || !data.scope) return null;
    return {
      reportSnapshotId: data.reportSnapshotId,
      periodStart: data.periodStart.toISOString(),
      periodEnd: data.periodEnd.toISOString(),
      scope: data.scope,
      ...(data.basis ? { basis: data.basis } : {}),
      ...(data.category ? { category: data.category } : {}),
      ...(data.siteId ? { siteId: data.siteId } : {}),
    };
  }
  if (sourceType === "PRODUCT_LCA") {
    if (!data.assessmentId || !data.versionId || !data.intensityBasis) return null;
    return { assessmentId: data.assessmentId, versionId: data.versionId, intensityBasis: data.intensityBasis };
  }
  return null;
}

export async function createObjectiveMetricDefinitionAction(
  _previous: ObjectiveActionState,
  formData: FormData,
): Promise<ObjectiveActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createObjectiveMetricDefinitionFormSchema.safeParse({
      objectiveId: formData.get("objectiveId"),
      name: formData.get("name"),
      sourceType: formData.get("sourceType"),
      unit: formData.get("unit"),
      frequency: formData.get("frequency"),
      boundaryDescription: formData.get("boundaryDescription"),
      reportSnapshotId: formData.get("reportSnapshotId"),
      periodStart: formData.get("periodStart") || undefined,
      periodEnd: formData.get("periodEnd") || undefined,
      scope: formData.get("scope"),
      basis: formData.get("basis"),
      category: formData.get("category"),
      siteId: formData.get("siteId"),
      assessmentId: formData.get("assessmentId"),
      versionId: formData.get("versionId"),
      intensityBasis: formData.get("intensityBasis"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the metric details." };
    await createObjectiveMetricDefinition(context, {
      objectiveId: parsed.data.objectiveId,
      name: parsed.data.name,
      sourceType: parsed.data.sourceType,
      unit: parsed.data.unit,
      frequency: parsed.data.frequency,
      boundaryDescription: parsed.data.boundaryDescription || null,
      aggregationConfig: aggregationConfigFromForm(parsed.data.sourceType, parsed.data),
      actorUserId: context.userId,
    });
    revalidateObjectives();
    return { ...emptyState, message: "Draft metric definition created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export interface MetricObservationState {
  error: string | null;
  observations: Array<{
    periodStart: string;
    periodEnd: string;
    value: string;
    unit: string;
    magnitudeKind: string;
    provenance: Record<string, unknown>;
  }> | null;
}

const emptyObservationState: MetricObservationState = { error: null, observations: null };

/** Read-only surfacing of a metric version's T51 adapter reading — never writes, mutates or recalculates the underlying carbon/LCA record. */
export async function resolveObjectiveMetricObservationAction(
  _previous: MetricObservationState,
  formData: FormData,
): Promise<MetricObservationState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = resolveObjectiveMetricObservationFormSchema.safeParse({ metricVersionId: formData.get("metricVersionId") });
    if (!parsed.success) return { ...emptyObservationState, error: "Choose a metric version." };
    const version = await getObjectiveMetricVersion(context, parsed.data.metricVersionId);
    if (!version) return { ...emptyObservationState, error: "That metric version could not be found in this organisation." };
    const observations = await resolveMetricVersionObservations(context, version);
    return {
      error: null,
      observations: observations.map((observation) => ({
        periodStart: observation.periodStart.toISOString().slice(0, 10),
        periodEnd: observation.periodEnd.toISOString().slice(0, 10),
        value: observation.value.toString(),
        unit: observation.unit,
        magnitudeKind: observation.magnitudeKind,
        provenance: observation.provenance,
      })),
    };
  } catch (error) {
    if (error instanceof MetricAdapterUnavailableError) return { ...emptyObservationState, error: error.message };
    if (error instanceof MetricAdapterConfigError) return { ...emptyObservationState, error: error.message };
    if (error instanceof MetricAdapterResolutionError) return { ...emptyObservationState, error: error.message };
    return { ...emptyObservationState, error: friendlyError(error) };
  }
}

export async function approveObjectiveMetricVersionAction(
  _previous: ObjectiveActionState,
  formData: FormData,
): Promise<ObjectiveActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = approveObjectiveMetricVersionFormSchema.safeParse({ metricVersionId: formData.get("metricVersionId") });
    if (!parsed.success) return { ...emptyState, error: "Choose a metric version." };
    await approveObjectiveMetricVersion(context, parsed.data.metricVersionId, { actorUserId: context.userId });
    revalidateObjectives();
    return { ...emptyState, message: "Metric definition approved and made active." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

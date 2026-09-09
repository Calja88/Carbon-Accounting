"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  IncidentError,
  createEnvironmentalIncident,
  recordIncidentCorrection,
  assignIncidentSeverity,
  startIncidentInvestigation,
  completeIncidentResponse,
  closeEnvironmentalIncident,
  reopenEnvironmentalIncident,
  createIncidentSeverityLevel,
  upsertIncidentEscalationRule,
  uploadIncidentEvidence,
} from "@/lib/ems/incidents/incident-service";
import { recordIncidentNotificationAssessment } from "@/lib/ems/incidents/notification-assessment-service";
import {
  createEnvironmentalIncidentFormSchema,
  recordIncidentCorrectionFormSchema,
  assignIncidentSeverityFormSchema,
  recordIncidentNotificationAssessmentFormSchema,
  reopenEnvironmentalIncidentFormSchema,
  createIncidentSeverityLevelFormSchema,
  upsertIncidentEscalationRuleFormSchema,
} from "@/lib/ems/incidents/schemas";

export interface IncidentActionState {
  error: string | null;
  message: string | null;
}

const emptyState: IncidentActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation.";
  if (error instanceof IncidentError) return error.message;
  throw error;
}

function revalidateIncidents(incidentId?: string) {
  revalidatePath("/ems/incidents");
  if (incidentId) revalidatePath(`/ems/incidents/${incidentId}`);
}

export async function createEnvironmentalIncidentAction(_previous: IncidentActionState, formData: FormData): Promise<IncidentActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createEnvironmentalIncidentFormSchema.safeParse({
      reference: formData.get("reference"),
      occurredAt: formData.get("occurredAt") || undefined,
      discoveredAt: formData.get("discoveredAt") || undefined,
      entityId: formData.get("entityId"),
      siteId: formData.get("siteId"),
      processId: formData.get("processId"),
      aspectId: formData.get("aspectId"),
      type: formData.get("type"),
      factualDescription: formData.get("factualDescription"),
      immediateResponse: formData.get("immediateResponse"),
      potentialReceptors: formData.get("potentialReceptors"),
      restricted: formData.get("restricted") === "on" || formData.get("restricted") === "true",
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the incident details." };
    const incident = await createEnvironmentalIncident(context, {
      reference: parsed.data.reference,
      occurredAt: parsed.data.occurredAt ?? null,
      discoveredAt: parsed.data.discoveredAt ?? null,
      entityId: parsed.data.entityId || null,
      siteId: parsed.data.siteId || null,
      processId: parsed.data.processId || null,
      aspectId: parsed.data.aspectId || null,
      type: parsed.data.type,
      factualDescription: parsed.data.factualDescription,
      immediateResponse: parsed.data.immediateResponse || null,
      potentialReceptors: parsed.data.potentialReceptors || null,
      restricted: parsed.data.restricted,
      actorUserId: context.userId,
    });
    revalidateIncidents(incident.id);
    return { ...emptyState, message: "Incident reported." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function recordIncidentCorrectionAction(_previous: IncidentActionState, formData: FormData): Promise<IncidentActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = recordIncidentCorrectionFormSchema.safeParse({
      incidentId: formData.get("incidentId"),
      correctedFactualDescription: formData.get("correctedFactualDescription"),
      correctedImmediateResponse: formData.get("correctedImmediateResponse"),
      correctedPotentialReceptors: formData.get("correctedPotentialReceptors"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the correction." };
    await recordIncidentCorrection(context, parsed.data.incidentId, {
      correctedFactualDescription: parsed.data.correctedFactualDescription || null,
      correctedImmediateResponse: parsed.data.correctedImmediateResponse || null,
      correctedPotentialReceptors: parsed.data.correctedPotentialReceptors || null,
      reason: parsed.data.reason,
      actorUserId: context.userId,
    });
    revalidateIncidents(parsed.data.incidentId);
    return { ...emptyState, message: "Correction recorded. The original report is preserved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function assignIncidentSeverityAction(_previous: IncidentActionState, formData: FormData): Promise<IncidentActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = assignIncidentSeverityFormSchema.safeParse({
      incidentId: formData.get("incidentId"),
      severityLevelId: formData.get("severityLevelId"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Choose a severity level." };
    await assignIncidentSeverity(context, parsed.data.incidentId, parsed.data.severityLevelId, context.userId);
    revalidateIncidents(parsed.data.incidentId);
    return { ...emptyState, message: "Severity assigned; incident triaged." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function startIncidentInvestigationAction(_previous: IncidentActionState, formData: FormData): Promise<IncidentActionState> {
  try {
    const context = await requireOrganisationContext();
    const incidentId = String(formData.get("incidentId") ?? "");
    if (!incidentId) return { ...emptyState, error: "Choose an incident." };
    await startIncidentInvestigation(context, incidentId, context.userId);
    revalidateIncidents(incidentId);
    return { ...emptyState, message: "Investigation started." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function completeIncidentResponseAction(_previous: IncidentActionState, formData: FormData): Promise<IncidentActionState> {
  try {
    const context = await requireOrganisationContext();
    const incidentId = String(formData.get("incidentId") ?? "");
    if (!incidentId) return { ...emptyState, error: "Choose an incident." };
    await completeIncidentResponse(context, incidentId, context.userId);
    revalidateIncidents(incidentId);
    return { ...emptyState, message: "Response marked complete." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function closeEnvironmentalIncidentAction(_previous: IncidentActionState, formData: FormData): Promise<IncidentActionState> {
  try {
    const context = await requireOrganisationContext();
    const incidentId = String(formData.get("incidentId") ?? "");
    if (!incidentId) return { ...emptyState, error: "Choose an incident." };
    await closeEnvironmentalIncident(context, incidentId, context.userId);
    revalidateIncidents(incidentId);
    return { ...emptyState, message: "Incident closed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function reopenEnvironmentalIncidentAction(_previous: IncidentActionState, formData: FormData): Promise<IncidentActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = reopenEnvironmentalIncidentFormSchema.safeParse({
      incidentId: formData.get("incidentId"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Enter a reason for reopening." };
    await reopenEnvironmentalIncident(context, parsed.data.incidentId, parsed.data.reason, context.userId);
    revalidateIncidents(parsed.data.incidentId);
    return { ...emptyState, message: "Incident reopened." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function recordIncidentNotificationAssessmentAction(
  _previous: IncidentActionState,
  formData: FormData,
): Promise<IncidentActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = recordIncidentNotificationAssessmentFormSchema.safeParse({
      incidentId: formData.get("incidentId"),
      authorityOrParty: formData.get("authorityOrParty"),
      dueTrigger: formData.get("dueTrigger"),
      decision: formData.get("decision"),
      rationale: formData.get("rationale"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the assessment." };
    const reviewerMembershipId = String(formData.get("reviewerMembershipId") ?? "");
    if (!reviewerMembershipId) return { ...emptyState, error: "Choose a competent reviewer." };
    await recordIncidentNotificationAssessment(context, parsed.data.incidentId, {
      authorityOrParty: parsed.data.authorityOrParty,
      dueTrigger: parsed.data.dueTrigger || null,
      decision: parsed.data.decision,
      rationale: parsed.data.rationale,
      reviewerMembershipId,
      actorUserId: context.userId,
    });
    revalidateIncidents(parsed.data.incidentId);
    return { ...emptyState, message: "Notification assessment recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createIncidentSeverityLevelAction(_previous: IncidentActionState, formData: FormData): Promise<IncidentActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createIncidentSeverityLevelFormSchema.safeParse({
      key: formData.get("key"),
      label: formData.get("label"),
      rank: formData.get("rank"),
      requiresEscalation: formData.get("requiresEscalation") === "on" || formData.get("requiresEscalation") === "true",
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the severity level." };
    await createIncidentSeverityLevel(context, {
      key: parsed.data.key,
      label: parsed.data.label,
      rank: parsed.data.rank,
      requiresEscalation: parsed.data.requiresEscalation,
      actorUserId: context.userId,
    });
    revalidateIncidents();
    return { ...emptyState, message: "Severity level added." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function upsertIncidentEscalationRuleAction(_previous: IncidentActionState, formData: FormData): Promise<IncidentActionState> {
  try {
    const context = await requireOrganisationContext();
    const permissionRaw = String(formData.get("notifyPermission") ?? "").trim();
    const parsed = upsertIncidentEscalationRuleFormSchema.safeParse({
      severityLevelId: formData.get("severityLevelId"),
      recipientsPolicy: permissionRaw ? { kind: "permission", permission: permissionRaw } : {},
      isActive: formData.get("isActive") === "on" || formData.get("isActive") === "true",
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the escalation rule." };
    if (!permissionRaw) return { ...emptyState, error: "Choose who should be notified." };
    await upsertIncidentEscalationRule(context, {
      severityLevelId: parsed.data.severityLevelId,
      recipientsPolicy: parsed.data.recipientsPolicy,
      isActive: parsed.data.isActive,
      actorUserId: context.userId,
    });
    revalidateIncidents();
    return { ...emptyState, message: "Escalation rule saved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function uploadIncidentEvidenceAction(_previous: IncidentActionState, formData: FormData): Promise<IncidentActionState> {
  try {
    const context = await requireOrganisationContext();
    const incidentId = String(formData.get("incidentId") ?? "");
    const file = formData.get("file");
    if (!incidentId) return { ...emptyState, error: "Choose an incident." };
    if (!(file instanceof File) || file.size === 0) return { ...emptyState, error: "Choose a file to upload." };
    const bytes = Buffer.from(await file.arrayBuffer());
    await uploadIncidentEvidence(context, {
      incidentId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes,
      purpose: String(formData.get("purpose") ?? "") || null,
      actorUserId: context.userId,
    });
    revalidateIncidents(incidentId);
    return { ...emptyState, message: "Evidence uploaded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

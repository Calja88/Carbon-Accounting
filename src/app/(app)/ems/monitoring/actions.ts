"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { EvidenceError } from "@/lib/documents/evidence-service";
import {
  MonitoringError, createMonitoringPlan, documentResultExceptionReview, recordMonitoringResult,
  reviewMonitoringResult, uploadEvidenceToMonitoringResult,
} from "@/lib/ems/monitoring/monitoring-service";
import {
  CalibrationError, createMonitoringEquipment, documentCalibrationExceptionReview,
  notifyOverdueCalibrations, recordEquipmentCalibration, uploadCalibrationCertificate,
} from "@/lib/ems/monitoring/calibration-service";
import {
  equipmentCalibrationFormSchema, monitoringEquipmentFormSchema, monitoringExceptionReviewFormSchema,
  monitoringPlanFormSchema, monitoringResultFormSchema, monitoringResultReviewFormSchema,
} from "@/lib/ems/monitoring/schemas";

export interface MonitoringActionState { error: string | null; message: string | null }
const emptyState: MonitoringActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation or scope.";
  if (error instanceof MonitoringError || error instanceof CalibrationError || error instanceof EvidenceError) return error.message;
  if (error instanceof Error && error.message.includes("Unique constraint")) return "That task-local key or reference already exists.";
  throw error;
}

function refresh() { revalidatePath("/ems/monitoring"); }
function dateOrNull(value: Date | "" | undefined) { return value instanceof Date ? value : null; }

export async function createMonitoringPlanAction(_previous: MonitoringActionState, formData: FormData): Promise<MonitoringActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = monitoringPlanFormSchema.safeParse({
      ...Object.fromEntries(formData), instrumentRequired: formData.get("instrumentRequired") === "on",
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the monitoring plan." };
    await createMonitoringPlan(context, {
      ...parsed.data, aspectId: parsed.data.aspectId || null, controlId: parsed.data.controlId || null,
      obligationReference: parsed.data.obligationReference || null, objectiveReference: parsed.data.objectiveReference || null,
      equipmentId: parsed.data.equipmentId || null, reviewDueDate: dateOrNull(parsed.data.reviewDueDate), actorUserId: context.userId,
    });
    refresh();
    return { ...emptyState, message: `Created monitoring plan "${parsed.data.planKey}".` };
  } catch (error) { return { ...emptyState, error: friendlyError(error) }; }
}

export async function recordMonitoringResultAction(_previous: MonitoringActionState, formData: FormData): Promise<MonitoringActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = monitoringResultFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the monitoring result." };
    await recordMonitoringResult(context, {
      ...parsed.data, periodStart: dateOrNull(parsed.data.periodStart), periodEnd: dateOrNull(parsed.data.periodEnd),
      qualitativeResult: parsed.data.qualitativeResult || null, actorUserId: context.userId,
    });
    refresh();
    return { ...emptyState, message: "Monitoring result appended." };
  } catch (error) { return { ...emptyState, error: friendlyError(error) }; }
}

export async function reviewMonitoringResultAction(_previous: MonitoringActionState, formData: FormData): Promise<MonitoringActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = monitoringResultReviewFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the review." };
    await reviewMonitoringResult(context, { ...parsed.data, actorUserId: context.userId });
    refresh();
    return { ...emptyState, message: "Result reviewed without changing its recorded value." };
  } catch (error) { return { ...emptyState, error: friendlyError(error) }; }
}

export async function createMonitoringEquipmentAction(_previous: MonitoringActionState, formData: FormData): Promise<MonitoringActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = monitoringEquipmentFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the equipment details." };
    await createMonitoringEquipment(context, { ...parsed.data, actorUserId: context.userId });
    refresh();
    return { ...emptyState, message: `Added equipment "${parsed.data.reference}".` };
  } catch (error) { return { ...emptyState, error: friendlyError(error) }; }
}

export async function recordEquipmentCalibrationAction(_previous: MonitoringActionState, formData: FormData): Promise<MonitoringActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = equipmentCalibrationFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the calibration record." };
    await recordEquipmentCalibration(context, { ...parsed.data, responseReference: parsed.data.responseReference || null, actorUserId: context.userId });
    refresh();
    return { ...emptyState, message: "Calibration appended; prior records remain available." };
  } catch (error) { return { ...emptyState, error: friendlyError(error) }; }
}

export async function documentMonitoringExceptionAction(_previous: MonitoringActionState, formData: FormData): Promise<MonitoringActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = monitoringExceptionReviewFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the exception review." };
    const common = {
      reason: parsed.data.reason, validityDecision: parsed.data.validityDecision, consequence: parsed.data.consequence,
      actionReference: parsed.data.actionReference || null, actorUserId: context.userId,
    };
    if (parsed.data.resultId) await documentResultExceptionReview(context, { ...common, resultId: parsed.data.resultId });
    else await documentCalibrationExceptionReview(context, { ...common, calibrationId: parsed.data.calibrationId! });
    refresh();
    return { ...emptyState, message: "Exception review documented; the original record remains retained." };
  } catch (error) { return { ...emptyState, error: friendlyError(error) }; }
}

export async function notifyOverdueCalibrationsAction(_previous: MonitoringActionState, _formData: FormData): Promise<MonitoringActionState> {
  void _previous;
  void _formData;
  try {
    const context = await requireOrganisationContext();
    const outcomes = await notifyOverdueCalibrations(context);
    refresh();
    return { ...emptyState, message: `Calibration dates checked: ${outcomes.length} overdue notification${outcomes.length === 1 ? "" : "s"} delivered or already present.` };
  } catch (error) { return { ...emptyState, error: friendlyError(error) }; }
}

async function fileParts(formData: FormData, idName: "resultId" | "calibrationId") {
  const id = String(formData.get(idName) ?? "");
  const file = formData.get("file");
  if (!id || !(file instanceof File) || file.size === 0) throw new EvidenceError("Choose a record and evidence file.");
  return { id, file, bytes: Buffer.from(await file.arrayBuffer()) };
}

export async function uploadMonitoringResultEvidenceAction(_previous: MonitoringActionState, formData: FormData): Promise<MonitoringActionState> {
  try {
    const context = await requireOrganisationContext();
    const { id, file, bytes } = await fileParts(formData, "resultId");
    await uploadEvidenceToMonitoringResult(context, { resultId: id, fileName: file.name, mimeType: file.type || "application/octet-stream", bytes, purpose: String(formData.get("purpose") ?? "").trim() || null, actorUserId: context.userId });
    refresh();
    return { ...emptyState, message: "Monitoring evidence attached." };
  } catch (error) { return { ...emptyState, error: friendlyError(error) }; }
}

export async function uploadCalibrationCertificateAction(_previous: MonitoringActionState, formData: FormData): Promise<MonitoringActionState> {
  try {
    const context = await requireOrganisationContext();
    const { id, file, bytes } = await fileParts(formData, "calibrationId");
    await uploadCalibrationCertificate(context, { calibrationId: id, fileName: file.name, mimeType: file.type || "application/octet-stream", bytes, actorUserId: context.userId });
    refresh();
    return { ...emptyState, message: "Calibration certificate attached." };
  } catch (error) { return { ...emptyState, error: friendlyError(error) }; }
}

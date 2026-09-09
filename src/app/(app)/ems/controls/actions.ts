"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { EvidenceError } from "@/lib/documents/evidence-service";
import {
  OperationalControlError,
  createOperationalControl,
  notifyOverdueControlReviews,
  recordControlCheck,
  retireOperationalControl,
  reviseOperationalControl,
  uploadEvidenceToControlCheck,
} from "@/lib/ems/controls/control-service";
import { controlCheckFormSchema, operationalControlFormSchema } from "@/lib/ems/controls/schemas";

export interface ControlActionState {
  error: string | null;
  message: string | null;
}

const emptyState: ControlActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation or scope.";
  if (error instanceof OperationalControlError || error instanceof EvidenceError) return error.message;
  if (error instanceof Error && error.message.includes("Unique constraint")) return "That control version already exists.";
  throw error;
}

function revalidateControls() {
  revalidatePath("/ems/controls");
}

function parseControlForm(formData: FormData) {
  return operationalControlFormSchema.safeParse({
    ...Object.fromEntries(formData),
    aspectIds: formData.getAll("aspectIds").map(String),
  });
}

function toControlInput(parsed: ReturnType<typeof operationalControlFormSchema.parse>, actorUserId: string) {
  const hasApplicability = Boolean(parsed.applicabilityProcessId || parsed.externalProviderReference);
  return {
    ...parsed,
    description: parsed.description || null,
    controlledDocumentRevisionId: parsed.controlledDocumentRevisionId || null,
    applicabilities: hasApplicability ? [{
      processId: parsed.applicabilityProcessId || null,
      externalProviderReference: parsed.externalProviderReference || null,
    }] : [],
    actorUserId,
  };
}

export async function createControlAction(_previous: ControlActionState, formData: FormData): Promise<ControlActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = parseControlForm(formData);
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the control details." };
    await createOperationalControl(context, toControlInput(parsed.data, context.userId));
    revalidateControls();
    return { ...emptyState, message: `Created "${parsed.data.title}".` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function reviseControlAction(_previous: ControlActionState, formData: FormData): Promise<ControlActionState> {
  try {
    const context = await requireOrganisationContext();
    const controlId = String(formData.get("controlId") ?? "");
    const parsed = parseControlForm(formData);
    if (!controlId || !parsed.success) {
      return { ...emptyState, error: parsed.success ? "Choose a control." : parsed.error.issues[0]?.message ?? "Check the review details." };
    }
    await reviseOperationalControl(context, controlId, toControlInput(parsed.data, context.userId));
    revalidateControls();
    return { ...emptyState, message: "Review recorded as a successor control version." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function retireControlAction(_previous: ControlActionState, formData: FormData): Promise<ControlActionState> {
  try {
    const context = await requireOrganisationContext();
    await retireOperationalControl(context, String(formData.get("controlId") ?? ""), context.userId);
    revalidateControls();
    return { ...emptyState, message: "Control retired; its historic version remains traceable." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function recordControlCheckAction(_previous: ControlActionState, formData: FormData): Promise<ControlActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = controlCheckFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the review check details." };
    await recordControlCheck(context, {
      ...parsed.data,
      performedAt: parsed.data.performedAt instanceof Date ? parsed.data.performedAt : null,
      notes: parsed.data.notes || null,
      exceptionSummary: parsed.data.exceptionSummary || null,
      actionReference: parsed.data.actionReference || null,
      actorUserId: context.userId,
    });
    revalidateControls();
    return { ...emptyState, message: "Control check recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function notifyOverdueReviewsAction(_previous: ControlActionState, _formData: FormData): Promise<ControlActionState> {
  void _previous;
  void _formData;
  try {
    const context = await requireOrganisationContext();
    const outcomes = await notifyOverdueControlReviews(context);
    revalidateControls();
    const delivered = outcomes.filter((outcome) => outcome.status === "DELIVERED").length;
    return { ...emptyState, message: `Review cycle checked: ${delivered} overdue owner notification${delivered === 1 ? "" : "s"} delivered or already present.` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function uploadControlCheckEvidenceAction(_previous: ControlActionState, formData: FormData): Promise<ControlActionState> {
  try {
    const context = await requireOrganisationContext();
    const checkId = String(formData.get("checkId") ?? "");
    const file = formData.get("file");
    if (!checkId || !(file instanceof File) || file.size === 0) return { ...emptyState, error: "Choose a control check and evidence file." };
    await uploadEvidenceToControlCheck(context, {
      checkId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes: Buffer.from(await file.arrayBuffer()),
      purpose: String(formData.get("purpose") ?? "").trim() || null,
      actorUserId: context.userId,
    });
    revalidateControls();
    return { ...emptyState, message: "Check evidence attached." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

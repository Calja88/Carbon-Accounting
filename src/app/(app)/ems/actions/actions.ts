"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  ActionError,
  createActionProgramme,
  setActionProgrammeStatus,
  createActionItem,
  reassignActionItem,
  setActionItemStatus,
  recordActionProgress,
  completeActionItem,
  verifyActionItem,
  reopenActionItem,
} from "@/lib/ems/actions/action-service";
import { notifyOverdueActionItems } from "@/lib/ems/actions/reminder-handler";
import {
  createActionProgrammeFormSchema,
  setActionProgrammeStatusFormSchema,
  createActionItemFormSchema,
  reassignActionItemFormSchema,
  setActionItemStatusFormSchema,
  recordActionProgressFormSchema,
  completeActionItemFormSchema,
  verifyActionItemFormSchema,
  reopenActionItemFormSchema,
} from "@/lib/ems/actions/schemas";

export interface ActionWorkspaceState {
  error: string | null;
  message: string | null;
}

const emptyState: ActionWorkspaceState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation.";
  if (error instanceof ActionError) return error.message;
  throw error;
}

function revalidateActions() {
  revalidatePath("/ems/actions");
}

export async function createActionProgrammeAction(_previous: ActionWorkspaceState, formData: FormData): Promise<ActionWorkspaceState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createActionProgrammeFormSchema.safeParse({
      objectiveId: formData.get("objectiveId"),
      title: formData.get("title"),
      resourcesDescription: formData.get("resourcesDescription"),
      ownerMembershipId: formData.get("ownerMembershipId"),
      startDate: formData.get("startDate") || undefined,
      targetDate: formData.get("targetDate") || undefined,
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the programme details." };
    await createActionProgramme(context, {
      objectiveId: parsed.data.objectiveId || null,
      title: parsed.data.title,
      resourcesDescription: parsed.data.resourcesDescription || null,
      ownerMembershipId: parsed.data.ownerMembershipId,
      startDate: parsed.data.startDate ?? null,
      targetDate: parsed.data.targetDate ?? null,
      actorUserId: context.userId,
    });
    revalidateActions();
    return { ...emptyState, message: "Action programme created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function setActionProgrammeStatusAction(_previous: ActionWorkspaceState, formData: FormData): Promise<ActionWorkspaceState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = setActionProgrammeStatusFormSchema.safeParse({
      programmeId: formData.get("programmeId"),
      status: formData.get("status"),
    });
    if (!parsed.success) return { ...emptyState, error: "Choose a programme and status." };
    await setActionProgrammeStatus(context, parsed.data.programmeId, parsed.data.status, context.userId);
    revalidateActions();
    return { ...emptyState, message: "Programme status updated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

function dependsOnIdsFromForm(formData: FormData): string[] {
  const raw = formData.get("dependsOnActionItemIds");
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function createActionItemAction(_previous: ActionWorkspaceState, formData: FormData): Promise<ActionWorkspaceState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createActionItemFormSchema.safeParse({
      programmeId: formData.get("programmeId"),
      title: formData.get("title"),
      description: formData.get("description"),
      priority: formData.get("priority") || "MEDIUM",
      ownerMembershipId: formData.get("ownerMembershipId"),
      startDate: formData.get("startDate") || undefined,
      dueDate: formData.get("dueDate"),
      completionCriteria: formData.get("completionCriteria"),
      dependsOnActionItemIds: dependsOnIdsFromForm(formData),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the action details." };
    await createActionItem(context, {
      programmeId: parsed.data.programmeId,
      title: parsed.data.title,
      description: parsed.data.description || null,
      priority: parsed.data.priority,
      ownerMembershipId: parsed.data.ownerMembershipId,
      startDate: parsed.data.startDate ?? null,
      dueDate: parsed.data.dueDate,
      completionCriteria: parsed.data.completionCriteria || null,
      dependsOnActionItemIds: parsed.data.dependsOnActionItemIds,
      actorUserId: context.userId,
    });
    revalidateActions();
    return { ...emptyState, message: "Action created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function reassignActionItemAction(_previous: ActionWorkspaceState, formData: FormData): Promise<ActionWorkspaceState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = reassignActionItemFormSchema.safeParse({
      actionItemId: formData.get("actionItemId"),
      newOwnerMembershipId: formData.get("newOwnerMembershipId"),
      note: formData.get("note"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Choose a new owner." };
    await reassignActionItem(context, parsed.data.actionItemId, {
      newOwnerMembershipId: parsed.data.newOwnerMembershipId,
      note: parsed.data.note || null,
      actorUserId: context.userId,
    });
    revalidateActions();
    return { ...emptyState, message: "Action reassigned." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function setActionItemStatusAction(_previous: ActionWorkspaceState, formData: FormData): Promise<ActionWorkspaceState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = setActionItemStatusFormSchema.safeParse({
      actionItemId: formData.get("actionItemId"),
      status: formData.get("status"),
      note: formData.get("note"),
    });
    if (!parsed.success) return { ...emptyState, error: "Choose an action and status." };
    await setActionItemStatus(context, parsed.data.actionItemId, parsed.data.status, context.userId, parsed.data.note || null);
    revalidateActions();
    return { ...emptyState, message: "Action status updated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function recordActionProgressAction(_previous: ActionWorkspaceState, formData: FormData): Promise<ActionWorkspaceState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = recordActionProgressFormSchema.safeParse({
      actionItemId: formData.get("actionItemId"),
      progressPercent: formData.get("progressPercent") || undefined,
      note: formData.get("note"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Enter a progress note." };
    await recordActionProgress(context, parsed.data.actionItemId, {
      progressPercent: parsed.data.progressPercent ?? null,
      note: parsed.data.note,
      actorUserId: context.userId,
    });
    revalidateActions();
    return { ...emptyState, message: "Progress recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function completeActionItemAction(_previous: ActionWorkspaceState, formData: FormData): Promise<ActionWorkspaceState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = completeActionItemFormSchema.safeParse({
      actionItemId: formData.get("actionItemId"),
      completionEvidenceNote: formData.get("completionEvidenceNote"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Describe the completion evidence." };
    await completeActionItem(context, parsed.data.actionItemId, {
      completionEvidenceNote: parsed.data.completionEvidenceNote,
      actorUserId: context.userId,
    });
    revalidateActions();
    return { ...emptyState, message: "Action completed. The linked objective is not automatically marked achieved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function verifyActionItemAction(_previous: ActionWorkspaceState, formData: FormData): Promise<ActionWorkspaceState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = verifyActionItemFormSchema.safeParse({ actionItemId: formData.get("actionItemId") });
    if (!parsed.success) return { ...emptyState, error: "Choose an action." };
    await verifyActionItem(context, parsed.data.actionItemId, { actorUserId: context.userId });
    revalidateActions();
    return { ...emptyState, message: "Action verified." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function reopenActionItemAction(_previous: ActionWorkspaceState, formData: FormData): Promise<ActionWorkspaceState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = reopenActionItemFormSchema.safeParse({
      actionItemId: formData.get("actionItemId"),
      reopenReason: formData.get("reopenReason"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Enter a reason for reopening." };
    await reopenActionItem(context, parsed.data.actionItemId, {
      reopenReason: parsed.data.reopenReason,
      actorUserId: context.userId,
    });
    revalidateActions();
    return { ...emptyState, message: "Action reopened." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function runOverdueActionReminderSweepAction(
  _previous: ActionWorkspaceState,
  _formData: FormData,
): Promise<ActionWorkspaceState> {
  void _previous;
  void _formData;
  try {
    const context = await requireOrganisationContext();
    const results = await notifyOverdueActionItems(context);
    revalidateActions();
    return { ...emptyState, message: `Overdue reminder sweep complete: ${results.length} overdue action(s) checked.` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

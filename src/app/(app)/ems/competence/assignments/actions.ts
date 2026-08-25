"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  CompetenceAssignmentError,
  assignCompetenceRequirement,
  startCompetenceAssignment,
  markCompetenceAssignmentGap,
} from "@/lib/ems/competence/assignment-service";
import { assignCompetenceRequirementFormSchema, markCompetenceAssignmentGapFormSchema } from "@/lib/ems/competence/person-schemas";

export interface AssignmentActionState {
  error: string | null;
  message: string | null;
}

const emptyState: AssignmentActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation or scope.";
  if (error instanceof CompetenceAssignmentError) return error.message;
  throw error;
}

function revalidateAssignments(personId?: string) {
  revalidatePath("/ems/competence/assignments");
  revalidatePath("/ems/competence/gaps");
  if (personId) revalidatePath(`/ems/competence/people/${personId}`);
}

export async function assignCompetenceRequirementAction(_previous: AssignmentActionState, formData: FormData): Promise<AssignmentActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = assignCompetenceRequirementFormSchema.safeParse({
      requirementVersionId: formData.get("requirementVersionId"),
      personId: formData.get("personId"),
      dueDate: formData.get("dueDate"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the assignment details." };
    await assignCompetenceRequirement(context, {
      requirementVersionId: parsed.data.requirementVersionId,
      personId: parsed.data.personId,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      actorUserId: context.userId,
    });
    revalidateAssignments(parsed.data.personId);
    return { ...emptyState, message: "Competence requirement assigned." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function startCompetenceAssignmentAction(_previous: AssignmentActionState, formData: FormData): Promise<AssignmentActionState> {
  try {
    const context = await requireOrganisationContext();
    const assignmentId = String(formData.get("assignmentId") ?? "");
    const personId = String(formData.get("personId") ?? "");
    if (!assignmentId) return { ...emptyState, error: "Choose an assignment." };
    await startCompetenceAssignment(context, assignmentId, context.userId);
    revalidateAssignments(personId || undefined);
    return { ...emptyState, message: "Assignment moved to in-progress." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function markCompetenceAssignmentGapAction(_previous: AssignmentActionState, formData: FormData): Promise<AssignmentActionState> {
  try {
    const context = await requireOrganisationContext();
    const assignmentId = String(formData.get("assignmentId") ?? "");
    const personId = String(formData.get("personId") ?? "");
    const parsed = markCompetenceAssignmentGapFormSchema.safeParse({ note: formData.get("note") });
    if (!assignmentId || !parsed.success) {
      return { ...emptyState, error: parsed.success ? "Choose an assignment." : parsed.error.issues[0]?.message ?? "Check the note." };
    }
    await markCompetenceAssignmentGap(context, assignmentId, { note: parsed.data.note || null, actorUserId: context.userId });
    revalidateAssignments(personId || undefined);
    return { ...emptyState, message: "Assignment marked as a gap." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

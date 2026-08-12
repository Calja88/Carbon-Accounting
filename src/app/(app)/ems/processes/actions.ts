"use server";

/**
 * Process/activity profile actions (task T30) — thin server-action wrappers
 * around `src/lib/ems/aspects/process-service.ts`. Every action resolves the
 * caller's `OrganisationContext` fresh (never trusts a client-supplied
 * organisationId) and turns service errors into a friendly form message
 * rather than leaking internals, matching the T19 members-page pattern.
 */

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError, type OrganisationContext } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  createActivityProcess,
  reviseActivityProcess,
  activateActivityProcess,
  archiveActivityProcess,
  applyProcessProfileTemplate,
  ActivityProcessError,
} from "@/lib/ems/aspects/process-service";
import { createActivityProcessFormSchema, applyProcessProfileTemplateFormSchema } from "@/lib/ems/aspects/schemas";

export interface ProcessActionState {
  error: string | null;
  message: string | null;
}

const emptyState: ProcessActionState = { error: null, message: null };

function friendlyError(err: unknown): string {
  if (err instanceof OrganisationAccessError) return "You must be signed in.";
  if (err instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (err instanceof TenantOwnershipError) return "That record could not be found in this organisation.";
  if (err instanceof ActivityProcessError) return err.message;
  throw err;
}

async function requireContext(): Promise<OrganisationContext> {
  return requireOrganisationContext();
}

function revalidateProcesses() {
  revalidatePath("/ems/processes");
}

export async function createProcessAction(_prev: ProcessActionState, formData: FormData): Promise<ProcessActionState> {
  let context: OrganisationContext;
  try {
    context = await requireContext();
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  const parsed = createActivityProcessFormSchema.safeParse({
    programmeId: formData.get("programmeId"),
    siteId: formData.get("siteId"),
    name: formData.get("name"),
    activityType: formData.get("activityType") || undefined,
    lifecycleStage: formData.get("lifecycleStage") || undefined,
    operatingCondition: formData.get("operatingCondition") || undefined,
  });
  if (!parsed.success) {
    return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the values and try again." };
  }

  try {
    await createActivityProcess(context, {
      programmeId: parsed.data.programmeId,
      siteId: parsed.data.siteId || undefined,
      name: parsed.data.name,
      activityType: parsed.data.activityType,
      lifecycleStage: parsed.data.lifecycleStage || undefined,
      operatingCondition: parsed.data.operatingCondition,
      createdByMembershipId: context.membershipId,
      actorUserId: context.userId,
    });
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  revalidateProcesses();
  return { ...emptyState, message: `Created "${parsed.data.name}".` };
}

export async function reviseProcessAction(_prev: ProcessActionState, formData: FormData): Promise<ProcessActionState> {
  let context: OrganisationContext;
  try {
    context = await requireContext();
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  const processId = String(formData.get("processId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!processId || !name) return { ...emptyState, error: "Enter a name." };

  try {
    await reviseActivityProcess(context, processId, { name, actorUserId: context.userId });
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  revalidateProcesses();
  return { ...emptyState, message: `Revised "${name}".` };
}

export async function activateProcessAction(_prev: ProcessActionState, formData: FormData): Promise<ProcessActionState> {
  let context: OrganisationContext;
  try {
    context = await requireContext();
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  const processId = String(formData.get("processId") ?? "");
  try {
    await activateActivityProcess(context, processId, context.userId);
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  revalidateProcesses();
  return { ...emptyState, message: "Activated." };
}

export async function archiveProcessAction(_prev: ProcessActionState, formData: FormData): Promise<ProcessActionState> {
  let context: OrganisationContext;
  try {
    context = await requireContext();
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  const processId = String(formData.get("processId") ?? "");
  try {
    await archiveActivityProcess(context, processId, context.userId);
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  revalidateProcesses();
  return { ...emptyState, message: "Archived." };
}

export async function applyTemplateAction(_prev: ProcessActionState, formData: FormData): Promise<ProcessActionState> {
  let context: OrganisationContext;
  try {
    context = await requireContext();
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }

  const parsed = applyProcessProfileTemplateFormSchema.safeParse({
    programmeId: formData.get("programmeId"),
    templateId: formData.get("templateId"),
    siteId: formData.get("siteId"),
    confirm: formData.get("confirm") === "on" ? true : undefined,
  });
  if (!parsed.success) {
    return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the values and try again." };
  }

  try {
    const result = await applyProcessProfileTemplate(context, {
      programmeId: parsed.data.programmeId,
      templateId: parsed.data.templateId,
      siteId: parsed.data.siteId,
      confirm: parsed.data.confirm,
      createdByMembershipId: context.membershipId,
      actorUserId: context.userId,
    });
    revalidateProcesses();
    return {
      ...emptyState,
      message: `Applied template: ${result.createdProcessIds.length} draft process(es) created, ${result.reusedProcessIds.length} already existed.`,
    };
  } catch (err) {
    return { ...emptyState, error: friendlyError(err) };
  }
}

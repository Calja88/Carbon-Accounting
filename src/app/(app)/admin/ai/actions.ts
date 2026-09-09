"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AiLoggingLevel, AiTaskType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { requirePermission, PermissionDeniedError } from "@/lib/rbac/authorize";
import { AI_TASK_TYPES, ensureAiSettingsRow, invalidateAiConfigCache } from "@/lib/ai/config";
import { refreshModelCatalog } from "@/lib/ai/catalog-store";

/**
 * Admin actions for the AI layer.
 *
 * Phase 1 tenancy (T18): every action here operates on the calling
 * Organisation's own `AiSettings` row only — resolved from the caller's
 * `OrganisationContext`, gated by `ai.settings.manage`, never a legacy
 * ADMIN-role check. An organisation administrator's grants apply to their
 * own tenant only; nothing here can read or write another Organisation's
 * settings ("admin status does not imply platform-global access").
 *
 * Note what these deliberately cannot do: there is no field, anywhere, for an
 * API key. The key lives only in the server environment
 * (`OPENROUTER_API_KEY`); it is never written to, or read from, the database,
 * and no endpoint returns it. The model catalogue itself (`refreshModelCatalog`)
 * is platform-global, shared by every tenant — refreshing it is still gated by
 * this Organisation's own `ai.settings.manage` grant, same as the rest of this
 * page, per the file map's note that a platform-wide refresh should be kept
 * behind an ordinary organisation-scoped permission unless/until a separate
 * platform-operator control plane exists.
 */

async function requireAiSettingsContext() {
  const context = await requireOrganisationContext();
  requirePermission(context, "ai.settings.manage");
  return context;
}

export interface AiSettingsState {
  error: string | null;
  saved: boolean;
}

const settingsSchema = z.object({
  aiEnabled: z.coerce.boolean(),
  openRouterEnabled: z.coerce.boolean(),
  freeOnly: z.coerce.boolean(),
  allowFreeRouter: z.coerce.boolean(),
  autoAcceptExtraction: z.coerce.boolean(),
  minConfidence: z.coerce.number().min(0).max(1),
  loggingLevel: z.enum(["MINIMAL", "STANDARD", "VERBOSE"]),
  requestsPerMinute: z.coerce.number().int().min(1).max(600),
  requestsPerDay: z.coerce.number().int().min(1).max(100_000),
});

/** Checkboxes only appear in FormData when ticked. */
function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) !== null;
}

export async function saveAiSettingsAction(_prev: AiSettingsState, formData: FormData): Promise<AiSettingsState> {
  let context;
  try {
    context = await requireAiSettingsContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) return { error: "You must be signed in.", saved: false };
    if (err instanceof PermissionDeniedError) return { error: "You don't have permission to manage AI settings.", saved: false };
    throw err;
  }

  const parsed = settingsSchema.safeParse({
    aiEnabled: checkbox(formData, "aiEnabled"),
    openRouterEnabled: checkbox(formData, "openRouterEnabled"),
    freeOnly: checkbox(formData, "freeOnly"),
    allowFreeRouter: checkbox(formData, "allowFreeRouter"),
    autoAcceptExtraction: checkbox(formData, "autoAcceptExtraction"),
    minConfidence: formData.get("minConfidence"),
    loggingLevel: formData.get("loggingLevel"),
    requestsPerMinute: formData.get("requestsPerMinute"),
    requestsPerDay: formData.get("requestsPerDay"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the values and try again.", saved: false };
  }

  const settings = await ensureAiSettingsRow(context.organisationId);

  const taskModels = AI_TASK_TYPES.map((task) => ({
    task,
    modelId: String(formData.get(`model-${task}`) ?? "").trim(),
    fallbackModelId: String(formData.get(`fallback-${task}`) ?? "").trim() || null,
  }));

  const missing = taskModels.find((tm) => tm.modelId.length === 0);
  if (missing) {
    return { error: `Choose a model for ${missing.task.replace(/_/g, " ").toLowerCase()}.`, saved: false };
  }

  await prisma.$transaction([
    prisma.aiSettings.update({
      where: { id: settings.id },
      data: {
        aiEnabled: parsed.data.aiEnabled,
        openRouterEnabled: parsed.data.openRouterEnabled,
        freeOnly: parsed.data.freeOnly,
        allowFreeRouter: parsed.data.allowFreeRouter,
        autoAcceptExtraction: parsed.data.autoAcceptExtraction,
        minConfidence: parsed.data.minConfidence,
        loggingLevel: parsed.data.loggingLevel as AiLoggingLevel,
        requestsPerMinute: parsed.data.requestsPerMinute,
        requestsPerDay: parsed.data.requestsPerDay,
        updatedByUserId: context.userId,
      },
    }),
    ...taskModels.map((tm) =>
      prisma.aiTaskModel.upsert({
        where: { settingsId_task: { settingsId: settings.id, task: tm.task as AiTaskType } },
        update: { modelId: tm.modelId, fallbackModelId: tm.fallbackModelId },
        create: {
          settingsId: settings.id,
          task: tm.task as AiTaskType,
          modelId: tm.modelId,
          fallbackModelId: tm.fallbackModelId,
        },
      }),
    ),
  ]);

  invalidateAiConfigCache(context.organisationId);
  revalidatePath("/admin/ai");

  return { error: null, saved: true };
}

export interface CatalogRefreshState {
  error: string | null;
  message: string | null;
}

/**
 * Pulls OpenRouter's live model list. Admin-triggered only — a request path
 * must never be able to set off an outbound catalogue fetch. The catalogue
 * itself is platform-global (see catalog-store.ts), but triggering a refresh
 * still requires this Organisation's own `ai.settings.manage` grant.
 */
export async function refreshCatalogAction(): Promise<CatalogRefreshState> {
  try {
    await requireAiSettingsContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) return { error: "You must be signed in.", message: null };
    if (err instanceof PermissionDeniedError) return { error: "You don't have permission to manage AI settings.", message: null };
    throw err;
  }

  try {
    const result = await refreshModelCatalog();
    revalidatePath("/admin/ai");
    return {
      error: null,
      message: `Loaded ${result.modelCount} models, ${result.freeCount} of them free, at ${result.refreshedAt.toLocaleTimeString("en-GB")}.`,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not load the model catalogue.",
      message: null,
    };
  }
}

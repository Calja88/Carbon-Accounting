/**
 * AI configuration: safe defaults from the environment, overridden by
 * per-Organisation database settings an organisation's own administrator can
 * change in the UI without a code change or redeploy (`/admin/ai`).
 *
 * Phase 1 tenancy (T18): `AiSettings` is one row per Organisation, not a
 * single global row — PHASE1_TENANCY_RBAC_SPEC.md §4 ("Replace singleton
 * with one settings root per Organisation"). Every function here takes the
 * caller's `organisationId` and resolves/creates that Organisation's own
 * row; it never falls back to another tenant's settings.
 *
 * The OpenRouter API key is *not* part of this. It is read once, server-side,
 * inside the provider (src/lib/ai/providers/openrouter.ts) straight from
 * `process.env.OPENROUTER_API_KEY`. It is never stored in the database, never
 * returned from an endpoint, never logged, and never reaches the client
 * bundle — nothing in this file or anywhere under `src/lib/ai` puts it into a
 * value that crosses a server/client boundary. It is shared across every
 * tenant, same as the model catalogue (see catalog-store.ts).
 */

import { AiLoggingLevel, AiTaskType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const AI_TASK_TYPES: AiTaskType[] = [
  AiTaskType.GENERAL_CHAT,
  AiTaskType.CARBON_REASONING,
  AiTaskType.EMISSION_CLASSIFICATION,
  AiTaskType.DOCUMENT_EXTRACTION,
  AiTaskType.DOCUMENT_VISION,
  AiTaskType.LCA_ASSISTANT,
  AiTaskType.DATA_QUALITY_REVIEW,
  AiTaskType.REPORT_ASSISTANT,
];

export const AI_TASK_LABELS: Record<AiTaskType, string> = {
  GENERAL_CHAT: "General chat",
  CARBON_REASONING: "Carbon reasoning",
  EMISSION_CLASSIFICATION: "Emission classification",
  DOCUMENT_EXTRACTION: "Document extraction",
  DOCUMENT_VISION: "Documents & images (vision)",
  LCA_ASSISTANT: "LCA assistant",
  DATA_QUALITY_REVIEW: "Data quality review",
  REPORT_ASSISTANT: "Report assistant",
};

/**
 * OpenRouter's own free-model router. Documented by OpenRouter as a router
 * that only ever selects models that are free to call, which is why it is
 * treated as free even when the cached catalogue is unavailable. It is the
 * default fallback precisely because it survives an individual free model
 * being retired — the failure mode this codebase has to tolerate most.
 */
export const FREE_ROUTER_MODEL_ID = "openrouter/free";

/**
 * Starting model per task. These are *defaults*, not a hard-coded routing
 * table: an administrator changes them in `/admin/ai`, or an operator sets
 * the matching environment variable, without touching source. Every default
 * here is a free model (OpenRouter's `:free` suffix or the free router), so a
 * fresh install works under `AI_FREE_ONLY=true`.
 */
export const DEFAULT_TASK_MODELS: Record<AiTaskType, string> = {
  GENERAL_CHAT: FREE_ROUTER_MODEL_ID,
  CARBON_REASONING: "nvidia/nemotron-3-super-120b-a12b:free",
  EMISSION_CLASSIFICATION: "openai/gpt-oss-20b:free",
  DOCUMENT_EXTRACTION: "google/gemma-4-26b-a4b-it:free",
  DOCUMENT_VISION: "google/gemma-4-26b-a4b-it:free",
  LCA_ASSISTANT: "nvidia/nemotron-3-super-120b-a12b:free",
  DATA_QUALITY_REVIEW: "openai/gpt-oss-20b:free",
  REPORT_ASSISTANT: FREE_ROUTER_MODEL_ID,
};

const TASK_ENV_VARS: Record<AiTaskType, string> = {
  GENERAL_CHAT: "AI_MODEL_GENERAL_CHAT",
  CARBON_REASONING: "AI_MODEL_CARBON_REASONING",
  EMISSION_CLASSIFICATION: "AI_MODEL_EMISSION_CLASSIFICATION",
  DOCUMENT_EXTRACTION: "AI_MODEL_DOCUMENT_EXTRACTION",
  DOCUMENT_VISION: "AI_MODEL_DOCUMENT_VISION",
  LCA_ASSISTANT: "AI_MODEL_LCA_ASSISTANT",
  DATA_QUALITY_REVIEW: "AI_MODEL_DATA_QUALITY_REVIEW",
  REPORT_ASSISTANT: "AI_MODEL_REPORT_ASSISTANT",
};

export interface TaskModelConfig {
  modelId: string;
  fallbackModelId: string | null;
}

export interface AiRuntimeConfig {
  aiEnabled: boolean;
  openRouterEnabled: boolean;
  freeOnly: boolean;
  allowFreeRouter: boolean;
  autoAcceptExtraction: boolean;
  minConfidence: number;
  loggingLevel: AiLoggingLevel;
  requestsPerMinute: number;
  requestsPerDay: number;
  timeoutMs: number;
  maxDocumentBytes: number;
  taskModels: Record<AiTaskType, TaskModelConfig>;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Defaults with no database access — used before/without any admin override. */
export function defaultAiConfig(): AiRuntimeConfig {
  const taskModels = {} as Record<AiTaskType, TaskModelConfig>;
  const envFallback = process.env.AI_MODEL_FALLBACK?.trim() || FREE_ROUTER_MODEL_ID;

  for (const task of AI_TASK_TYPES) {
    const fromEnv = process.env[TASK_ENV_VARS[task]]?.trim();
    const modelId = fromEnv || DEFAULT_TASK_MODELS[task];
    taskModels[task] = {
      modelId,
      fallbackModelId: envFallback === modelId ? null : envFallback,
    };
  }

  return {
    aiEnabled: envBool("AI_ENABLED", true),
    openRouterEnabled: envBool("AI_OPENROUTER_ENABLED", true),
    // Free-only defaults ON: a fresh deployment cannot start spending money
    // by accident, it has to be turned off deliberately.
    freeOnly: envBool("AI_FREE_ONLY", true),
    allowFreeRouter: envBool("AI_ALLOW_FREE_ROUTER", true),
    autoAcceptExtraction: envBool("AI_AUTO_ACCEPT_EXTRACTION", false),
    minConfidence: (() => {
      const raw = Number(process.env.AI_MIN_CONFIDENCE);
      return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.7;
    })(),
    loggingLevel: (() => {
      const raw = process.env.AI_LOGGING_LEVEL?.trim().toUpperCase();
      return raw && raw in AiLoggingLevel ? (raw as AiLoggingLevel) : AiLoggingLevel.STANDARD;
    })(),
    requestsPerMinute: envInt("AI_RATE_LIMIT_PER_MINUTE", 12),
    requestsPerDay: envInt("AI_RATE_LIMIT_PER_DAY", 300),
    timeoutMs: envInt("AI_REQUEST_TIMEOUT_MS", 60_000),
    maxDocumentBytes: envInt("AI_MAX_DOCUMENT_BYTES", 8 * 1024 * 1024),
    taskModels,
  };
}

interface CachedConfig {
  value: AiRuntimeConfig;
  expiresAt: number;
}

// Short-lived process cache, keyed per Organisation, so a chat turn that
// makes several AI calls doesn't re-read settings each time. Deliberately
// tiny: an admin change takes effect within seconds, and
// `invalidateAiConfigCache()` makes it immediate in the process that saved
// it. A single admin action can only invalidate its own organisation's
// entry — never another tenant's cached config.
const CONFIG_CACHE_TTL_MS = 15_000;
const cache = new Map<string, CachedConfig>();

export function invalidateAiConfigCache(organisationId: string): void {
  cache.delete(organisationId);
}

/**
 * Effective configuration for one Organisation: environment defaults, then
 * that Organisation's own database overrides. A database that is
 * unreachable, or an Organisation with no settings row yet, is not an error
 * — the environment defaults stand, so AI keeps working (or keeps being
 * safely off) either way.
 */
export async function getAiConfig(organisationId: string): Promise<AiRuntimeConfig> {
  const cached = cache.get(organisationId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const base = defaultAiConfig();
  let value = base;

  try {
    const row = await prisma.aiSettings.findUnique({
      where: { organisationId },
      include: { taskModels: true },
    });

    if (row) {
      const taskModels = { ...base.taskModels };
      for (const tm of row.taskModels) {
        taskModels[tm.task] = {
          modelId: tm.modelId,
          fallbackModelId: tm.fallbackModelId,
        };
      }
      value = {
        ...base,
        aiEnabled: row.aiEnabled,
        openRouterEnabled: row.openRouterEnabled,
        freeOnly: row.freeOnly,
        allowFreeRouter: row.allowFreeRouter,
        autoAcceptExtraction: row.autoAcceptExtraction,
        minConfidence: Number(row.minConfidence),
        loggingLevel: row.loggingLevel,
        requestsPerMinute: row.requestsPerMinute,
        requestsPerDay: row.requestsPerDay,
        taskModels,
      };
    }
  } catch {
    // Settings are an enhancement, not a dependency — fall back to env.
  }

  cache.set(organisationId, { value, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
  return value;
}

/** Creates this Organisation's settings row on first use so the admin UI has something to edit. */
export async function ensureAiSettingsRow(organisationId: string) {
  const existing = await prisma.aiSettings.findUnique({
    where: { organisationId },
    include: { taskModels: true },
  });
  if (existing) return existing;

  const defaults = defaultAiConfig();
  return prisma.aiSettings.create({
    data: {
      organisationId,
      aiEnabled: defaults.aiEnabled,
      openRouterEnabled: defaults.openRouterEnabled,
      freeOnly: defaults.freeOnly,
      allowFreeRouter: defaults.allowFreeRouter,
      autoAcceptExtraction: defaults.autoAcceptExtraction,
      minConfidence: defaults.minConfidence,
      loggingLevel: defaults.loggingLevel,
      requestsPerMinute: defaults.requestsPerMinute,
      requestsPerDay: defaults.requestsPerDay,
      taskModels: {
        create: AI_TASK_TYPES.map((task) => ({
          task,
          modelId: defaults.taskModels[task].modelId,
          fallbackModelId: defaults.taskModels[task].fallbackModelId,
        })),
      },
    },
    include: { taskModels: true },
  });
}

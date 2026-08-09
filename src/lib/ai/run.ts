/**
 * The orchestrator every AI call goes through.
 *
 * Responsibilities, in order: is AI allowed to run at all → is this user
 * within their rate limit → which models may we try (free-only enforced here)
 * → call, validate, fall back → write the audit row → hand back a typed
 * result or a controlled AiUnavailableError.
 *
 * Retry policy is deliberately shallow. One retry against the same model for
 * a transport blip or a malformed JSON reply, then move to the next model in
 * the chain, with a hard cap on total attempts. Anything more aggressive
 * turns a provider wobble into a self-inflicted rate-limit ban.
 */

import { AiCallStatus, AiTaskType, Prisma } from "@prisma/client";
import { z } from "zod";
import { AiAuditContext, recordAiInteraction } from "./audit";
import { getAiConfig, AiRuntimeConfig } from "./config";
import { ensureAiInitialized, loadCatalog } from "./catalog-store";
import { ModelRequirements, resolveModelChain, selectPdfEngine } from "./model-routing";
import { getAiProvider } from "./provider-registry";
import { checkAiRateLimit } from "./rate-limit";
import { toProviderJsonSchema } from "./schemas";
import {
  AiAttachment,
  AiMessage,
  AiProviderError,
  AiRunResult,
  AiUnavailableError,
  AiUsage,
} from "./types";

/** Hard ceiling across every model in the chain, so a bad day can't spiral. */
const MAX_TOTAL_ATTEMPTS = 4;

export interface AiRunOptions {
  task: AiTaskType;
  feature: string;
  systemPrompt: string;
  messages: AiMessage[];
  attachments?: AiAttachment[];
  requirements?: ModelRequirements;
  maxOutputTokens?: number;
  temperature?: number;
  audit: Omit<AiAuditContext, "task" | "feature">;
}

export interface AiStructuredRunOptions<T> extends AiRunOptions {
  schema: z.ZodType<T>;
  schemaName: string;
}

function reasonToStatus(reason: AiUnavailableError["reason"]): AiCallStatus {
  switch (reason) {
    case "DISABLED":
      return AiCallStatus.DISABLED;
    case "NOT_CONFIGURED":
      return AiCallStatus.NOT_CONFIGURED;
    case "NO_MODEL_AVAILABLE":
      return AiCallStatus.NO_MODEL_AVAILABLE;
    case "RATE_LIMITED":
      return AiCallStatus.RATE_LIMITED;
    case "TIMEOUT":
      return AiCallStatus.TIMEOUT;
    case "VALIDATION_FAILED":
      return AiCallStatus.VALIDATION_FAILED;
    case "FORBIDDEN":
      return AiCallStatus.FORBIDDEN;
    default:
      return AiCallStatus.PROVIDER_ERROR;
  }
}

export interface AiAvailability {
  available: boolean;
  reason: AiUnavailableError["reason"] | null;
  message: string | null;
  config: AiRuntimeConfig;
}

/**
 * Can AI run right now? Used by the UI to show an honest disabled state
 * instead of offering a button that will fail.
 */
export async function getAiAvailability(): Promise<AiAvailability> {
  // Self-initialising: creates the settings row and loads/refreshes the
  // model catalogue automatically when a key is present, throttled so this
  // never becomes a fetch-per-request. No-ops with no key configured.
  await ensureAiInitialized();
  const config = await getAiConfig();

  if (!config.aiEnabled) {
    return {
      available: false,
      reason: "DISABLED",
      message: "AI assistance is switched off for this platform.",
      config,
    };
  }
  if (!config.openRouterEnabled) {
    return {
      available: false,
      reason: "DISABLED",
      message: "The AI provider is switched off for this platform.",
      config,
    };
  }
  if (!getAiProvider().isConfigured()) {
    return {
      available: false,
      reason: "NOT_CONFIGURED",
      message: "AI assistance isn't configured on this deployment. Everything else works as normal.",
      config,
    };
  }
  return { available: true, reason: null, message: null, config };
}

/**
 * Pulls a JSON object out of a model reply. Models that don't enforce a
 * schema often wrap JSON in a code fence or add a sentence around it — this
 * recovers the object without ever loosening what counts as valid, because
 * the Zod parse still runs afterwards.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new SyntaxError("Empty response.");

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1]?.trim(), trimmed].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start !== -1 && end > start) {
        try {
          return JSON.parse(candidate.slice(start, end + 1));
        } catch {
          // fall through to the next candidate
        }
      }
    }
  }
  throw new SyntaxError("Response did not contain a JSON object.");
}

interface AttemptOutcome {
  text: string;
  modelUsed: string;
  usage: AiUsage | null;
}

async function runChain<T>(
  options: AiRunOptions,
  parse: (text: string) => T,
  jsonSchema: { name: string; schema: Record<string, unknown> } | null,
): Promise<AiRunResult<T>> {
  const started = Date.now();
  const availability = await getAiAvailability();
  const config = availability.config;

  const auditBase: AiAuditContext = { ...options.audit, task: options.task, feature: options.feature };

  const fail = async (error: AiUnavailableError, modelRequested: string, attempts: number, modelUsed: string | null) => {
    await recordAiInteraction(
      {
        ...auditBase,
        provider: getAiProvider().id,
        modelRequested,
        modelUsed,
        status: reasonToStatus(error.reason),
        usedFallback: false,
        attempts,
        latencyMs: Date.now() - started,
        errorCode: error.reason,
        errorMessage: error.detail ?? error.message,
      },
      config.loggingLevel,
    );
    throw error;
  };

  if (!availability.available) {
    await fail(
      new AiUnavailableError(availability.reason ?? "DISABLED", availability.message ?? "AI is unavailable."),
      "(none)",
      0,
      null,
    );
  }

  if (options.audit.userId) {
    const verdict = await checkAiRateLimit(options.audit.userId, config);
    if (!verdict.allowed) {
      await fail(new AiUnavailableError("RATE_LIMITED", verdict.reason ?? "Too many AI requests."), "(none)", 0, null);
    }
  }

  const catalog = await loadCatalog();

  let chain;
  try {
    chain = resolveModelChain(options.task, config, catalog, options.requirements);
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      await fail(err, config.taskModels[options.task]?.modelId ?? "(unconfigured)", 0, null);
    }
    throw err;
  }

  const requestedModel = chain.candidates[0].modelId;
  const messages: AiMessage[] = [{ role: "system", content: options.systemPrompt }, ...options.messages];

  let attempts = 0;
  let lastError: unknown = null;
  let lastStatus: AiCallStatus = AiCallStatus.PROVIDER_ERROR;

  for (const candidate of chain.candidates) {
    // One retry per model: enough to shake off a transient 502 or a single
    // malformed JSON reply, not enough to become a retry storm.
    for (let attemptOnModel = 0; attemptOnModel < 2; attemptOnModel++) {
      if (attempts >= MAX_TOTAL_ATTEMPTS) break;
      attempts++;

      const provider = getAiProvider({
        pdfEngine: selectPdfEngine(candidate, config.freeOnly),
      });

      let outcome: AttemptOutcome;
      try {
        const response = await provider.complete({
          modelId: candidate.modelId,
          messages,
          attachments: options.attachments,
          maxOutputTokens: options.maxOutputTokens,
          temperature: options.temperature,
          jsonSchema: jsonSchema && candidate.supportsStructuredOutputs ? jsonSchema : undefined,
          timeoutMs: config.timeoutMs,
        });
        outcome = { text: response.text, modelUsed: response.modelUsed, usage: response.usage };
      } catch (err) {
        lastError = err;
        lastStatus =
          err instanceof AiProviderError && err.status === null && /timed out/i.test(err.message)
            ? AiCallStatus.TIMEOUT
            : AiCallStatus.PROVIDER_ERROR;
        if (err instanceof AiProviderError && !err.retryable) break; // next model
        continue;
      }

      try {
        const data = parse(outcome.text);
        const interactionId = await recordAiInteraction(
          {
            ...auditBase,
            provider: provider.id,
            modelRequested: requestedModel,
            modelUsed: outcome.modelUsed,
            status: AiCallStatus.SUCCESS,
            usedFallback: candidate.isFallback,
            attempts,
            latencyMs: Date.now() - started,
            promptTokens: outcome.usage?.promptTokens ?? null,
            completionTokens: outcome.usage?.completionTokens ?? null,
            totalTokens: outcome.usage?.totalTokens ?? null,
            costUsd: outcome.usage?.costUsd ?? null,
            confidence: extractConfidence(data),
            outputSummary: jsonSchema ? (toJsonValue(data) ?? null) : null,
          },
          config.loggingLevel,
        );

        return {
          data,
          meta: {
            task: options.task,
            provider: provider.id,
            modelRequested: requestedModel,
            modelUsed: outcome.modelUsed,
            usedFallback: candidate.isFallback,
            attempts,
            latencyMs: Date.now() - started,
            usage: outcome.usage,
            interactionId,
          },
        };
      } catch (err) {
        lastError = err;
        lastStatus = AiCallStatus.VALIDATION_FAILED;
        // A model that ignored the schema once will usually ignore it twice;
        // the retry is worth exactly one go before moving on.
      }
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
  // A validation failure means every model tried produced something that
  // didn't fit the required shape — never a reason to fall back to showing
  // whatever raw text it did produce.
  const error = new AiUnavailableError(
    lastStatus === AiCallStatus.VALIDATION_FAILED ? "VALIDATION_FAILED" : "PROVIDER_ERROR",
    lastStatus === AiCallStatus.VALIDATION_FAILED
      ? "I couldn't generate a reliable answer. Please try again."
      : "AI assistance is temporarily unavailable.",
    detail,
  );

  await recordAiInteraction(
    {
      ...auditBase,
      provider: getAiProvider().id,
      modelRequested: requestedModel,
      modelUsed: null,
      status: lastStatus,
      usedFallback: chain.candidates.length > 1,
      attempts,
      latencyMs: Date.now() - started,
      errorCode: lastStatus,
      errorMessage: detail,
    },
    config.loggingLevel,
  );

  throw error;
}

function extractConfidence(data: unknown): number | null {
  if (data && typeof data === "object" && "overall" in data) {
    const overall = (data as { overall?: { confidence?: unknown } }).overall;
    const value = Number(overall?.confidence);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function toJsonValue(data: unknown): Prisma.InputJsonValue | null {
  try {
    return JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
  } catch {
    return null;
  }
}

/** Free-text AI call (chat, explanations, narrative drafting). */
export async function runTextTask(options: AiRunOptions): Promise<AiRunResult<string>> {
  return runChain(
    options,
    (text) => {
      const trimmed = text.trim();
      if (!trimmed) throw new Error("The model returned an empty answer.");
      return trimmed;
    },
    null,
  );
}

/**
 * Schema-constrained AI call. The JSON Schema is sent to models that support
 * structured outputs; either way the reply is parsed and validated with Zod
 * before anything downstream sees it.
 */
export async function runStructuredTask<T>(options: AiStructuredRunOptions<T>): Promise<AiRunResult<T>> {
  const jsonSchema = { name: options.schemaName, schema: toProviderJsonSchema(options.schema) };
  return runChain(
    options,
    (text) => {
      const parsed = options.schema.safeParse(extractJsonObject(text));
      if (!parsed.success) {
        throw new Error(`Model output failed validation: ${parsed.error.issues[0]?.message ?? "unknown issue"}`);
      }
      return parsed.data;
    },
    jsonSchema,
  );
}

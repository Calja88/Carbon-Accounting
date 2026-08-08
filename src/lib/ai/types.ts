/**
 * The provider boundary for the AI layer.
 *
 * Nothing outside `src/lib/ai/providers/` may import an SDK or call a model
 * HTTP API directly. Application code calls the `carbonAI` façade
 * (src/lib/ai/index.ts), which calls the orchestrator, which calls whichever
 * `AiProvider` is registered. Swapping OpenRouter for Gemini/Anthropic/OpenAI/
 * Groq/a local model means adding one file under `providers/` and registering
 * it — no call site changes.
 *
 * The provider interface is deliberately thin (complete + listModels). The
 * carbon-specific capabilities (classifyEmission, extractDocument, assistLCA
 * …) live one layer up, because they are *our* domain operations, not
 * anything a model vendor implements.
 */

import type { AiTaskType } from "@prisma/client";

// ---------------------------------------------------------------------------
// Messages and attachments
// ---------------------------------------------------------------------------

export type AiRole = "system" | "user" | "assistant";

export interface AiMessage {
  role: AiRole;
  content: string;
}

/** A file sent alongside a prompt. Content is always treated as untrusted. */
export interface AiAttachment {
  kind: "image" | "pdf";
  filename: string;
  mimeType: string;
  /** Raw base64 (no `data:` prefix). */
  base64: string;
}

export interface AiUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  /**
   * Only ever the figure the provider itself reported. Never estimated,
   * never derived from a price list held in this codebase.
   */
  costUsd: number | null;
}

// ---------------------------------------------------------------------------
// Provider requests / responses
// ---------------------------------------------------------------------------

export interface AiCompletionRequest {
  modelId: string;
  messages: AiMessage[];
  attachments?: AiAttachment[];
  maxOutputTokens?: number;
  temperature?: number;
  /**
   * When set, the provider asks the model for schema-constrained JSON. The
   * caller still validates the parsed result — a provider promise of
   * "structured output" is never treated as a guarantee.
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AiCompletionResponse {
  text: string;
  modelUsed: string;
  usage: AiUsage | null;
  finishReason: string | null;
}

/** Provider-reported capabilities, read from the provider's own metadata. */
export interface AiModelCapabilities {
  /** FREE / PAID / UNKNOWN — never guessed; see catalog.ts. */
  cost: ModelCostClass;
  contextLength: number | null;
  supportsImages: boolean;
  supportsFiles: boolean;
  supportsStructuredOutputs: boolean;
  supportsTools: boolean;
}

export interface AiModelInfo extends AiModelCapabilities {
  id: string;
  name: string;
  provider: string;
}

export const MODEL_COST_CLASSES = ["FREE", "PAID", "UNKNOWN"] as const;
export type ModelCostClass = (typeof MODEL_COST_CLASSES)[number];

export interface AiProvider {
  /** Stable identifier stored on every audit row, e.g. "openrouter". */
  readonly id: string;
  /** False when the provider has no credentials configured. */
  isConfigured(): boolean;
  complete(request: AiCompletionRequest): Promise<AiCompletionResponse>;
  /** The provider's own live model catalogue. Never a list hard-coded here. */
  listModels(): Promise<AiModelInfo[]>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Why an AI call could not be completed. Every one of these is a *soft*
 * failure: the carbon-accounting application must keep working, and the user
 * is told AI assistance is unavailable rather than shown a crash.
 */
export type AiUnavailableReason =
  | "DISABLED"
  | "NOT_CONFIGURED"
  | "NO_MODEL_AVAILABLE"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "VALIDATION_FAILED"
  | "FORBIDDEN";

export class AiUnavailableError extends Error {
  constructor(
    readonly reason: AiUnavailableReason,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/** A transport/HTTP failure from a provider, carrying the status for retry decisions. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

// ---------------------------------------------------------------------------
// Orchestrator result
// ---------------------------------------------------------------------------

export interface AiRunMetadata {
  task: AiTaskType;
  provider: string;
  modelRequested: string;
  modelUsed: string;
  usedFallback: boolean;
  attempts: number;
  latencyMs: number;
  usage: AiUsage | null;
  interactionId: string | null;
}

export interface AiRunResult<T> {
  data: T;
  meta: AiRunMetadata;
}

/**
 * Every AI suggestion carries these, so a reader can always see how much
 * weight to put on it and why. `reasoningSummary` is a short auditable
 * justification written for a human reviewer — never a chain-of-thought
 * transcript.
 */
export const AI_CONFIDENCE_STATES = ["CONFIRMED", "SUGGESTED", "NEEDS_REVIEW", "INSUFFICIENT_DATA"] as const;
export type AiConfidenceState = (typeof AI_CONFIDENCE_STATES)[number];
